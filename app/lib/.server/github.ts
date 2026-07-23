export const GITHUB_TOKEN_COOKIE = 'jayc_gh_token';
export const GITHUB_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function getGitHubToken(request: Request): string | undefined {
  const header = request.headers.get('Cookie');

  if (!header) {
    return undefined;
  }

  const match = header.match(new RegExp(`(?:^|;\\s*)${GITHUB_TOKEN_COOKIE}=([^;]+)`));

  return match ? decodeURIComponent(match[1]) : undefined;
}

export function setTokenCookie(token: string): string {
  return `${GITHUB_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${GITHUB_TOKEN_MAX_AGE}`;
}

export function clearTokenCookie(): string {
  return `${GITHUB_TOKEN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

const GITHUB_API = 'https://api.github.com';

/** minimal GitHub REST client — always returns the raw Response so callers can branch on status */
export function gh(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'jayc',
    },
  });
}
