import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { IconButton } from '~/components/ui/IconButton';
import { CONNECTORS, isConnectorConnected, type Connector } from '~/lib/connectors/catalog';
import { envVarsStore, initEnvVars, isValidEnvVarName, removeEnvVar, setEnvVar } from '~/lib/stores/envVars';

export function ConnectorsPanel() {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [customKey, setCustomKey] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  const envVars = useStore(envVarsStore);

  useEffect(() => {
    initEnvVars();
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

  const varCount = Object.keys(envVars).length;

  const saveConnector = (connector: Connector) => {
    let saved = false;

    for (const envKey of connector.envKeys) {
      const value = (drafts[envKey.name] ?? '').trim();

      if (value) {
        setEnvVar(envKey.name, value);
        saved = true;
      }
    }

    if (saved) {
      setDrafts((current) => {
        const next = { ...current };

        for (const envKey of connector.envKeys) {
          delete next[envKey.name];
        }

        return next;
      });
    }
  };

  const addCustom = () => {
    const key = customKey.trim();

    if (!isValidEnvVarName(key)) {
      setError('Key must be letters, numbers and underscores (e.g. CLERK_SECRET_KEY)');
      return;
    }

    if (!customValue.trim()) {
      setError('Value cannot be empty');
      return;
    }

    setEnvVar(key, customValue.trim());
    setCustomKey('');
    setCustomValue('');
    setError('');
  };

  const inputClass =
    'w-full px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary focus:outline-none focus:border-accent';

  return (
    <div className="relative" ref={panelRef}>
      <IconButton
        title={varCount > 0 ? `Tools & Connectors (${varCount} variable${varCount === 1 ? '' : 's'} set)` : 'Tools & Connectors — connect services like Clerk, Stripe, Supabase'}
        onClick={() => setOpen((v) => !v)}
      >
        <div className={varCount > 0 ? 'i-ph:plugs-connected-fill text-accent text-xl' : 'i-ph:plugs-connected text-xl'} />
      </IconButton>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] w-[400px] max-h-[70vh] overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 shadow-xl z-50">
          <div className="flex items-center gap-2 mb-1 text-bolt-elements-textPrimary font-semibold">
            <div className="i-ph:plugs-connected text-lg" />
            Tools & Connectors
          </div>

          <p className="text-xs text-bolt-elements-textSecondary mb-3 leading-relaxed">
            Paste API keys for the services your app uses. They are written to a{' '}
            <span className="font-mono">.env</span> file in your project, so the AI codes against real variable
            names instead of inventing them. Values stay in this browser only.
          </p>

          {varCount > 0 && (
            <>
              <div className="text-xs font-medium text-bolt-elements-textSecondary mb-1.5">Your variables</div>
              <div className="mb-3 divide-y divide-bolt-elements-borderColor border border-bolt-elements-borderColor rounded-lg overflow-hidden">
                {Object.keys(envVars).map((key) => (
                  <div key={key} className="flex items-center gap-2 px-3 py-2 bg-bolt-elements-background-depth-1">
                    <span className="font-mono text-xs text-bolt-elements-textPrimary flex-1 truncate">{key}</span>
                    <span className="text-bolt-elements-textTertiary text-xs tracking-widest">••••••••</span>
                    <button
                      className="text-bolt-elements-textTertiary hover:text-red-500 transition-colors"
                      title={`Delete ${key}`}
                      onClick={() => removeEnvVar(key)}
                    >
                      <div className="i-ph:trash text-base" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="text-xs font-medium text-bolt-elements-textSecondary mb-1.5">Connect a service</div>
          <div className="flex flex-col gap-1.5 mb-3">
            {CONNECTORS.map((connector) => {
              const connected = isConnectorConnected(connector, envVars);
              const expanded = expandedId === connector.id;

              return (
                <div
                  key={connector.id}
                  className="border border-bolt-elements-borderColor rounded-lg overflow-hidden bg-bolt-elements-background-depth-1"
                >
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-bolt-elements-background-depth-2 transition-colors"
                    onClick={() => setExpandedId(expanded ? null : connector.id)}
                  >
                    <span
                      className={`${connector.icon} text-lg shrink-0`}
                      style={{ color: connector.color }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-bolt-elements-textPrimary">{connector.name}</span>
                      <span className="block text-xs text-bolt-elements-textTertiary truncate">
                        {connector.tagline}
                      </span>
                    </span>
                    {connected && (
                      <span className="text-[10px] font-medium text-green-500 border border-green-500/40 rounded-full px-1.5 py-0.5 shrink-0">
                        Connected
                      </span>
                    )}
                    <div
                      className={`i-ph:caret-down text-sm text-bolt-elements-textTertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {expanded && (
                    <div className="px-3 pb-3 pt-1 flex flex-col gap-2 border-t border-bolt-elements-borderColor">
                      <a
                        href={connector.keysUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent hover:underline flex items-center gap-1 mt-1.5"
                      >
                        Get your keys <div className="i-ph:arrow-square-out text-xs" />
                      </a>
                      {connector.envKeys.map((envKey) => {
                        const alreadySet = Boolean(envVars[envKey.name]);

                        return (
                          <div key={envKey.name}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="font-mono text-xs text-bolt-elements-textPrimary">{envKey.name}</span>
                              {alreadySet && <div className="i-ph:check-circle-fill text-green-500 text-xs" />}
                            </div>
                            <p className="text-[11px] text-bolt-elements-textTertiary mb-1">
                              {envKey.description}
                              {envKey.optional ? ' (optional)' : ''}
                            </p>
                            <input
                              className={`${inputClass} font-mono text-xs`}
                              type="password"
                              placeholder={alreadySet ? 'Saved — paste to replace' : 'Paste value'}
                              value={drafts[envKey.name] ?? ''}
                              onChange={(e) =>
                                setDrafts((current) => ({ ...current, [envKey.name]: e.target.value }))
                              }
                              onKeyDown={(e) => e.key === 'Enter' && saveConnector(connector)}
                            />
                          </div>
                        );
                      })}
                      <button
                        onClick={() => saveConnector(connector)}
                        className="w-full py-1.5 text-sm font-medium rounded-lg bg-accent-500 text-white hover:brightness-95 transition-all"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-xs font-medium text-bolt-elements-textSecondary mb-1.5">Custom variable</div>
          <div className="flex flex-col gap-2">
            <input
              className={`${inputClass} font-mono`}
              placeholder="Key (e.g. CLERK_SECRET_KEY)"
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
            />
            <input
              className={inputClass}
              type="password"
              placeholder="Value"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
            />
            {error && <div className="text-xs text-red-500">{error}</div>}
            <button
              onClick={addCustom}
              className="w-full py-2 text-sm font-medium rounded-lg bg-accent-500 text-white hover:brightness-95 transition-all"
            >
              Add variable
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
