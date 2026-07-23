import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { clearTokenCookie, getGitHubToken, gh, json } from '~/lib/.server/github';

export async function loader({ request }: LoaderFunctionArgs) {
  const token = getGitHubToken(request);

  if (!token) {
    return json({ connected: false });
  }

  const response = await gh(token, '/user');

  if (!response.ok) {
    // token expired or was revoked — clear it so the client stops retrying
    return json({ connected: false }, 200, { 'set-cookie': clearTokenCookie() });
  }

  const user = (await response.json()) as { login: string; avatar_url: string };

  return json({ connected: true, login: user.login, avatarUrl: user.avatar_url });
}
