import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { clearTokenCookie } from '~/lib/.server/github';

export async function action(_args: ActionFunctionArgs) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': clearTokenCookie(),
    },
  });
}
