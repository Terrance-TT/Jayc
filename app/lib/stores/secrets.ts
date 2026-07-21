const STORAGE_KEY = 'jayc_secrets';
const COOKIE_NAME = 'jayc_secrets';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type SecretsMap = Record<string, string>;

export function loadSecrets(): SecretsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    return raw ? (JSON.parse(raw) as SecretsMap) : {};
  } catch {
    return {};
  }
}

export function saveSecrets(secrets: SecretsMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(secrets));
  syncSecretsCookie(secrets);
}

/*
 * The cookie mirror lets our own /api/* routes read the secrets per-request.
 * Secrets never touch any other server — they go browser -> Jayc function -> Moonshot.
 */
function syncSecretsCookie(secrets: SecretsMap) {
  if (Object.keys(secrets).length === 0) {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;

    return;
  }

  const value = encodeURIComponent(JSON.stringify(secrets));
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
}

export function isValidSecretName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
