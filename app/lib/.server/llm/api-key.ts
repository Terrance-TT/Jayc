const SECRETS_COOKIE = 'jayc_secrets';

export function getAPIKey(cloudflareEnv: Env, request?: Request) {
  /**
   * Priority:
   * 1. MOONSHOT_API_KEY from the visitor's own browser secrets (BYOK)
   * 2. `process.env.MOONSHOT_API_KEY` (local dev, via .env.local)
   * 3. `cloudflareEnv.MOONSHOT_API_KEY` (deployed Pages secret)
   */
  const fromBrowser = request ? getSecretsFromRequest(request).MOONSHOT_API_KEY : undefined;

  /**
   * `process` only exists in local dev (Node) or under the nodejs_compat flag.
   * Guard the access so a plain workerd runtime doesn't crash on the missing global.
   */
  const fromProcess = typeof process === 'undefined' ? undefined : process.env.MOONSHOT_API_KEY;

  return fromBrowser || fromProcess || cloudflareEnv.MOONSHOT_API_KEY;
}

export function getSecretsFromRequest(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie');

  if (!header) {
    return {};
  }

  const match = header.match(new RegExp(`(?:^|;\\s*)${SECRETS_COOKIE}=([^;]+)`));

  if (!match) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(match[1]));

    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
