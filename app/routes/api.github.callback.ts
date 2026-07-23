import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { setTokenCookie } from '~/lib/.server/github';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Missing authorization code from GitHub', { status: 400 });
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'jayc',
    },
    body: JSON.stringify({
      client_id: context.cloudflare.env.GITHUB_CLIENT_ID,
      client_secret: context.cloudflare.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/api/github/callback`,
    }),
  });

  const payload = (await tokenResponse.json()) as { access_token?: string; error?: string };

  if (!payload.access_token) {
    return new Response(`GitHub authorization failed: ${payload.error ?? 'unknown error'}`, { status: 401 });
  }

  /*
   * The token lives in an HttpOnly cookie — Jayc's client-side code can never
   * read it, it only ever travels browser -> Jayc function -> api.github.com.
   */
  return new Response(
    `<!doctype html>
<html>
  <body>
    <p>Connected to GitHub — you can close this window.</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'jayc-github-connected' }, window.location.origin);
        window.close();
      }
    </script>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': setTokenCookie(payload.access_token),
      },
    },
  );
}
