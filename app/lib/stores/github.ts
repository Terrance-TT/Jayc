import { atom } from 'nanostores';
import { workbenchStore } from './workbench';
import { WORK_DIR } from '~/utils/constants';

export interface GitHubStatus {
  connected: boolean;
  login?: string;
  avatarUrl?: string;
}

export interface PushResult {
  repoUrl: string;
  owner: string;
  repo: string;
  branch: string;
  fileCount: number;
}

/** undefined = haven't checked yet */
export const githubStatusStore = atom<GitHubStatus | undefined>(undefined);

export async function checkGitHubStatus(): Promise<GitHubStatus> {
  try {
    const response = await fetch('/api/github/status');
    const status = (await response.json()) as GitHubStatus;
    githubStatusStore.set(status);

    return status;
  } catch {
    const status: GitHubStatus = { connected: false };
    githubStatusStore.set(status);

    return status;
  }
}

/** opens the OAuth popup; resolves when the user comes back connected */
export function connectGitHub() {
  const popup = window.open('/api/github/auth', 'jayc-github-auth', 'width=640,height=720');

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    if ((event.data as { type?: string } | undefined)?.type === 'jayc-github-connected') {
      cleanup();
      void checkGitHubStatus();
    }
  };

  const timer = setInterval(() => {
    if (popup?.closed) {
      cleanup();
      void checkGitHubStatus();
    }
  }, 500);

  const cleanup = () => {
    clearInterval(timer);
    window.removeEventListener('message', onMessage);
  };

  window.addEventListener('message', onMessage);
}

export async function disconnectGitHub() {
  await fetch('/api/github/disconnect', { method: 'POST' });
  githubStatusStore.set({ connected: false });
}

export async function pushToGitHub(repoName: string, isPrivate: boolean): Promise<PushResult> {
  const files = collectProjectFiles();

  const response = await fetch('/api/github/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoName, isPrivate, files }),
  });

  const data = (await response.json()) as PushResult & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || 'Push failed');
  }

  return data;
}

const GENERATED_GITIGNORE = ['node_modules', 'dist', '.env', '.env.*', ''].join('\n');

function collectProjectFiles(): Array<{ path: string; content: string }> {
  const files = workbenchStore.files.get();
  const collected: Array<{ path: string; content: string }> = [];

  for (const [filePath, dirent] of Object.entries(files)) {
    if (dirent?.type !== 'file' || dirent.isBinary) {
      continue;
    }

    const relativePath = filePath.startsWith(`${WORK_DIR}/`) ? filePath.slice(WORK_DIR.length + 1) : filePath;

    if (!relativePath || relativePath.includes('node_modules/') || relativePath.startsWith('.git/')) {
      continue;
    }

    // never push real secrets — .env stays in the browser, .gitignore keeps it that way
    if (relativePath === '.env' || relativePath.startsWith('.env.')) {
      continue;
    }

    collected.push({ path: relativePath, content: dirent.content });
  }

  if (!collected.some((file) => file.path === '.gitignore')) {
    collected.push({ path: '.gitignore', content: GENERATED_GITIGNORE });
  }

  return collected;
}
