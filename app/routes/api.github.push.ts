import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getGitHubToken, gh, json } from '~/lib/.server/github';

interface PushFile {
  path: string;
  content: string;
}

interface PushRequest {
  repoName?: string;
  isPrivate?: boolean;
  files?: PushFile[];
}

const REPO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

export async function action({ request }: ActionFunctionArgs) {
  const token = getGitHubToken(request);

  if (!token) {
    return json({ error: 'Not connected to GitHub' }, 401);
  }

  const body = await request.json<PushRequest>().catch(() => ({}) as PushRequest);
  const repoName = body.repoName?.trim();
  const files = Array.isArray(body.files) ? body.files.filter(isValidFile) : [];

  if (!repoName || !REPO_NAME_PATTERN.test(repoName)) {
    return json({ error: 'Invalid repository name' }, 400);
  }

  if (files.length === 0) {
    return json({ error: 'No files to push' }, 400);
  }

  try {
    // 1. who is pushing
    const userRes = await gh(token, '/user');

    if (!userRes.ok) {
      return json({ error: 'GitHub rejected the connection — try reconnecting' }, 401);
    }

    const user = (await userRes.json()) as { login: string };
    const owner = user.login;

    // 2. create the repo (422 = already exists — then we just push to it)
    const createRes = await gh(token, '/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        private: body.isPrivate !== false,
        auto_init: false,
        description: 'Built with Jayc',
      }),
    });

    if (!createRes.ok && createRes.status !== 422) {
      const detail = await createRes.text();

      return json({ error: `Could not create repository: ${detail}` }, 502);
    }

    // 3. figure out the branch + whether the repo already has commits
    let branch = 'main';
    const repoRes = await gh(token, `/repos/${owner}/${repoName}`);

    if (repoRes.ok) {
      const repo = (await repoRes.json()) as { default_branch?: string };
      branch = repo.default_branch || 'main';
    }

    let parentCommitSha: string | undefined;
    let baseTreeSha: string | undefined;

    const refRes = await gh(token, `/repos/${owner}/${repoName}/git/ref/heads/${branch}`);

    if (refRes.ok) {
      const ref = (await refRes.json()) as { object: { sha: string } };
      parentCommitSha = ref.object.sha;

      const parentRes = await gh(token, `/repos/${owner}/${repoName}/git/commits/${parentCommitSha}`);

      if (parentRes.ok) {
        baseTreeSha = ((await parentRes.json()) as { tree: { sha: string } }).tree.sha;
      }
    }

    // 4. upload every file as a blob, in small parallel batches
    const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
    const CHUNK_SIZE = 8;

    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const batch = await Promise.all(
        files.slice(i, i + CHUNK_SIZE).map(async (file) => {
          const blobRes = await gh(token, `/repos/${owner}/${repoName}/git/blobs`, {
            method: 'POST',
            body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
          });

          if (!blobRes.ok) {
            throw new Error(`Failed to upload ${file.path}`);
          }

          const blob = (await blobRes.json()) as { sha: string };

          return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
        }),
      );

      treeEntries.push(...batch);
    }

    // 5. tree -> commit -> point the branch at it
    const treeRes = await gh(token, `/repos/${owner}/${repoName}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });

    if (!treeRes.ok) {
      return json({ error: 'Failed to build the file tree on GitHub' }, 502);
    }

    const tree = (await treeRes.json()) as { sha: string };

    const commitRes = await gh(token, `/repos/${owner}/${repoName}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: parentCommitSha ? 'Update from Jayc' : 'Initial commit — built with Jayc',
        tree: tree.sha,
        parents: parentCommitSha ? [parentCommitSha] : [],
      }),
    });

    if (!commitRes.ok) {
      return json({ error: 'Failed to create the commit on GitHub' }, 502);
    }

    const commit = (await commitRes.json()) as { sha: string };

    const refResult = parentCommitSha
      ? await gh(token, `/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha: commit.sha }),
        })
      : await gh(token, `/repos/${owner}/${repoName}/git/refs`, {
          method: 'POST',
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
        });

    if (!refResult.ok) {
      return json({ error: 'Failed to update the branch on GitHub' }, 502);
    }

    return json({
      repoUrl: `https://github.com/${owner}/${repoName}`,
      owner,
      repo: repoName,
      branch,
      fileCount: files.length,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Push failed' }, 502);
  }
}

function isValidFile(file: PushFile): boolean {
  return Boolean(file && typeof file.path === 'string' && file.path.length > 0 && typeof file.content === 'string');
}
