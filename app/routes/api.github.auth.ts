import { type LoaderFunctionArgs, redirect } from '@remix-run/cloudflare';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const clientId = context.cloudflare.env.GITHUB_CLIENT_ID;

  if (!clientId) {
    throw new Response('GitHub login is not configured on this deployment (missing GITHUB_CLIENT_ID)', {
      status: 500,
    });
  }

  const origin = new URL(request.url).origin;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/github/callback`,
    scope: 'repo',
  });

  return redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}
