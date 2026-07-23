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

    /*
     * 2. create the repo WITH an initial commit (auto_init) — a completely
     *    empty repository rejects Git Data API calls with
     *    "409 Git Repository is empty"
     *    (422 = repo already exists — then we just push to it)
     */
    const createRes = await gh(token, '/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        private: body.isPrivate !== false,
        auto_init: true,
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

    let head = await readBranchHead(token, owner, repoName, branch);

    if (!head) {
      /*
       * the repo exists but has zero commits (e.g. the user created it
       * manually on github.com) — seed it with a first commit so the Git
       * Data API accepts blobs
       */
      await createInitialCommit(token, owner, repoName, branch);
      head = await readBranchHead(token, owner, repoName, branch);
    }

    // 4. upload every file as a blob, in small parallel batches
    const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
    const CHUNK_SIZE = 4;

    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const batch = await Promise.all(
        files.slice(i, i + CHUNK_SIZE).map(async (file) => {
          const sha = await uploadBlob(token, owner, repoName, file);

          return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha };
        }),
      );

      treeEntries.push(...batch);
    }

    // 5. tree -> commit -> point the branch at it
    const treeRes = await gh(token, `/repos/${owner}/${repoName}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: head?.treeSha, tree: treeEntries }),
    });

    if (!treeRes.ok) {
      return json({ error: 'Failed to build the file tree on GitHub' }, 502);
    }

    const tree = (await treeRes.json()) as { sha: string };

    const commitRes = await gh(token, `/repos/${owner}/${repoName}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: head ? 'Update from Jayc' : 'Initial commit — built with Jayc',
        tree: tree.sha,
        parents: head ? [head.commitSha] : [],
      }),
    });

    if (!commitRes.ok) {
      return json({ error: 'Failed to create the commit on GitHub' }, 502);
    }

    const commit = (await commitRes.json()) as { sha: string };

    const refResult = head
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

interface BranchHead {
  commitSha: string;
  treeSha: string;
}

/** the branch's latest commit + its tree, or undefined when the branch doesn't exist yet */
async function readBranchHead(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<BranchHead | undefined> {
  const refRes = await gh(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);

  if (!refRes.ok) {
    return undefined;
  }

  const ref = (await refRes.json()) as { object: { sha: string } };
  const commitSha = ref.object.sha;

  const commitRes = await gh(token, `/repos/${owner}/${repo}/git/commits/${commitSha}`);

  if (!commitRes.ok) {
    return undefined;
  }

  const commit = (await commitRes.json()) as { tree: { sha: string } };

  return { commitSha, treeSha: commit.tree.sha };
}

/*
 * Seed an empty repository with a first commit via the Contents API — the
 * only write endpoint that works on a repo with zero commits.
 */
async function createInitialCommit(token: string, owner: string, repo: string, branch: string): Promise<void> {
  const response = await gh(token, `/repos/${owner}/${repo}/contents/README.md`, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'Initial commit',
      content: toBase64(`# ${repo}\n\nBuilt with Jayc\n`),
      branch,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(`Could not create the initial commit: ${detail.slice(0, 200)}`);
  }
}

/*
 * Upload a single file as a git blob with retries. GitHub occasionally
 * rate-limits or drops a request when a whole project is uploaded in rapid
 * succession, so a transient failure shouldn't abort the entire push.
 */
async function uploadBlob(token: string, owner: string, repo: string, file: PushFile): Promise<string> {
  let lastError = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      await sleep(500 * attempt);
    }

    const response = await gh(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
    });

    if (response.ok) {
      const blob = (await response.json()) as { sha: string };

      return blob.sha;
    }

    lastError = await response.text();

    // GitHub says how long to wait — listen to it
    const retryAfter = Number(response.headers.get('retry-after'));

    if (retryAfter > 0 && retryAfter <= 10) {
      await sleep(retryAfter * 1000);
    }

    if (response.status === 422) {
      /*
       * the file isn't valid UTF-8 (rare, e.g. odd characters in generated
       * code) — retrying as-is is pointless, send it base64-encoded instead
       */
      const fallback = await gh(token, `/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: toBase64(file.content), encoding: 'base64' }),
      });

      if (fallback.ok) {
        const blob = (await fallback.json()) as { sha: string };

        return blob.sha;
      }

      lastError = await fallback.text();
      break;
    }
  }

  throw new Error(`Failed to upload ${file.path} — GitHub said: ${lastError.slice(0, 200)}`);
}
