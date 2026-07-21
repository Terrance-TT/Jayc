import { env } from 'node:process';

const SECRETS_COOKIE = 'jayc_secrets';

export function getAPIKey(cloudflareEnv: Env, request?: Request) {
  /**
   * Priority:
   * 1. MOONSHOT_API_KEY from the visitor's own browser secrets (BYOK)
   * 2. `env.MOONSHOT_API_KEY` (local dev, via .env.local)
   * 3. `cloudflareEnv.MOONSHOT_API_KEY` (deployed Pages secret)
   */
  const fromBrowser = request ? getSecretsFromRequest(request).MOONSHOT_API_KEY : undefined;

  return fromBrowser || env.MOONSHOT_API_KEY || cloudflareEnv.MOONSHOT_API_KEY;
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
