import { useEffect, useRef, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { loadSecrets, saveSecrets, isValidSecretName, type SecretsMap } from '~/lib/stores/secrets';

export function SecretsPanel() {
  const [open, setOpen] = useState(false);
  const [secrets, setSecrets] = useState<SecretsMap>({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSecrets(loadSecrets());
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

  const addSecret = () => {
    const key = newKey.trim();

    if (!isValidSecretName(key)) {
      setError('Key must be letters, numbers and underscores (e.g. MOONSHOT_API_KEY)');
      return;
    }

    if (!newValue.trim()) {
      setError('Value cannot be empty');
      return;
    }

    const updated = { ...secrets, [key]: newValue.trim() };
    setSecrets(updated);
    saveSecrets(updated);
    setNewKey('');
    setNewValue('');
    setError('');
  };

  const removeSecret = (key: string) => {
    const updated = { ...secrets };
    delete updated[key];
    setSecrets(updated);
    saveSecrets(updated);
  };

  const hasLlmKey = Boolean(secrets.MOONSHOT_API_KEY);

  const inputClass =
    'w-full px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary focus:outline-none focus:border-accent';

  return (
    <div className="relative" ref={panelRef}>
      <IconButton
        title={hasLlmKey ? 'Secrets (Moonshot key set)' : 'Secrets — add your Moonshot API key'}
        onClick={() => setOpen((v) => !v)}
      >
        <div className={hasLlmKey ? 'i-ph:lock-key-fill text-accent text-xl' : 'i-ph:lock-key text-xl'} />
      </IconButton>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] w-[380px] rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 shadow-xl z-50">
          <div className="flex items-center gap-2 mb-1 text-bolt-elements-textPrimary font-semibold">
            <div className="i-ph:lock-key text-lg" />
            Secrets
          </div>

          <p className="text-xs text-bolt-elements-textSecondary mb-3 leading-relaxed">
            Stored only in this browser and sent with your requests — never saved on any server. Set{' '}
            <span className="font-mono">MOONSHOT_API_KEY</span> to use your own Moonshot key for generations (get one
            at platform.moonshot.ai).
          </p>

          {Object.keys(secrets).length > 0 && (
            <div className="mb-3 divide-y divide-bolt-elements-borderColor border border-bolt-elements-borderColor rounded-lg overflow-hidden">
              {Object.keys(secrets).map((key) => (
                <div key={key} className="flex items-center gap-2 px-3 py-2 bg-bolt-elements-background-depth-1">
                  <span className="font-mono text-xs text-bolt-elements-textPrimary flex-1 truncate">{key}</span>
                  <span className="text-bolt-elements-textTertiary text-xs tracking-widest">••••••••</span>
                  <button
                    className="text-bolt-elements-textTertiary hover:text-red-500 transition-colors"
                    title={`Delete ${key}`}
                    onClick={() => removeSecret(key)}
                  >
                    <div className="i-ph:trash text-base" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <input
              className={`${inputClass} font-mono`}
              placeholder="Key (e.g. MOONSHOT_API_KEY)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <input
              className={inputClass}
              type="password"
              placeholder="Value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSecret()}
            />
            {error && <div className="text-xs text-red-500">{error}</div>}
            <button
              onClick={addSecret}
              className="w-full py-2 text-sm font-medium rounded-lg bg-accent-500 text-white hover:brightness-95 transition-all"
            >
              Add secret
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
