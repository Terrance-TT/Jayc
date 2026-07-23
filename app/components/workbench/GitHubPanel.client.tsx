import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { IconButton } from '~/components/ui/IconButton';
import {
  checkGitHubStatus,
  connectGitHub,
  disconnectGitHub,
  githubStatusStore,
  pushToGitHub,
  type PushResult,
} from '~/lib/stores/github';

export function GitHubPanel() {
  const [open, setOpen] = useState(false);
  const [repoName, setRepoName] = useState('jayc-app');
  const [isPrivate, setIsPrivate] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<PushResult | undefined>(undefined);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  const status = useStore(githubStatusStore);

  useEffect(() => {
    void checkGitHubStatus();
  }, []);

  // close the panel when clicking anywhere outside of it
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handler = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);

    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const onPush = async () => {
    if (!repoName.trim()) {
      setError('Repository name cannot be empty');
      return;
    }

    setPushing(true);
    setError('');
    setResult(undefined);

    try {
      const pushed = await pushToGitHub(repoName.trim(), isPrivate);
      setResult(pushed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary focus:outline-none focus:border-accent';

  return (
    <div className="relative" ref={panelRef}>
      <IconButton
        title={status?.connected ? `GitHub — connected as ${status.login}` : 'Connect to GitHub'}
        onClick={() => setOpen((v) => !v)}
      >
        <div
          className={
            status?.connected ? 'i-ph:github-logo-fill text-accent text-xl' : 'i-ph:github-logo text-xl'
          }
        />
      </IconButton>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] w-[340px] rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 shadow-xl z-50">
          {!status?.connected ? (
            <>
              <div className="flex items-center gap-2 mb-1 text-bolt-elements-textPrimary font-semibold">
                <div className="i-ph:github-logo text-lg" />
                Connect to GitHub
              </div>
              <p className="text-xs text-bolt-elements-textSecondary mb-3 leading-relaxed">
                Save this project as a GitHub repository in one click — just like Replit. You'll be asked to
                authorize Jayc in a popup.
              </p>
              <button
                onClick={() => connectGitHub()}
                className="w-full py-2 text-sm font-medium rounded-lg bg-accent-500 text-white hover:brightness-95 transition-all flex items-center justify-center gap-2"
              >
                <div className="i-ph:github-logo text-base" />
                Continue with GitHub
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                {status.avatarUrl && <img src={status.avatarUrl} alt="" className="w-6 h-6 rounded-full" />}
                <span className="text-sm text-bolt-elements-textPrimary flex-1 truncate">{status.login}</span>
                <button
                  className="text-xs text-bolt-elements-textTertiary hover:text-red-500 transition-colors"
                  onClick={() => {
                    void disconnectGitHub();
                    setResult(undefined);
                  }}
                >
                  Disconnect
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <input
                  className={`${inputClass} font-mono`}
                  placeholder="Repository name"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                />
                <label className="flex items-center gap-2 text-xs text-bolt-elements-textSecondary cursor-pointer">
                  <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                  Private repository
                </label>
                {error && <div className="text-xs text-red-500">{error}</div>}

                {result ? (
                  <a
                    href={result.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2 text-sm font-medium rounded-lg border border-green-500/40 text-green-500 hover:bg-green-500/10 transition-all flex items-center justify-center gap-2"
                  >
                    <div className="i-ph:check-circle-fill text-base" />
                    Pushed {result.fileCount} files — view on GitHub
                  </a>
                ) : (
                  <button
                    onClick={onPush}
                    disabled={pushing}
                    className="w-full py-2 text-sm font-medium rounded-lg bg-accent-500 text-white hover:brightness-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {pushing ? (
                      <>
                        <div className="i-svg-spinners:90-ring-with-bg text-base" />
                        Pushing…
                      </>
                    ) : (
                      <>
                        <div className="i-ph:git-branch text-base" />
                        Push to GitHub
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
