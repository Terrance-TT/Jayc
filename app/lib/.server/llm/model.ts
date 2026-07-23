import { createOpenAI } from '@ai-sdk/openai';
import { env } from 'node:process';
import type { K3ReasoningEffort } from './effort';

/**
 * Wraps fetch to inject Moonshot's top-level `reasoning_effort` field into
 * every chat-completions request body. @ai-sdk/openai@0.0.44 predates
 * reasoning models and has no provider option for this field, so a fetch
 * middleware is the supported way to set it without upgrading the SDK.
 */
function withReasoningEffort(effort: K3ReasoningEffort): typeof fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;

        body.reasoning_effort = effort;
        init = { ...init, body: JSON.stringify(body) };
      } catch {
        // Not a JSON body — leave the request untouched.
      }
    }

    return fetch(input, init);
  };
}

/**
 * Model/base URL resolution order:
 * 1. Cloudflare Pages variables/secrets (cloudflareEnv) — the only source
 *    that exists in production; process.env is empty on Pages Functions.
 * 2. process env (local dev via .env.local)
 * 3. Moonshot defaults
 *
 * `reasoningEffort` (from ./effort) is only applied to kimi-k3 models —
 * k2.x models reject the field and would error on every request.
 */
export function getMoonshotModel(apiKey: string, cloudflareEnv?: Env, reasoningEffort?: K3ReasoningEffort) {
  const modelName = cloudflareEnv?.MOONSHOT_MODEL || env.MOONSHOT_MODEL || 'kimi-k3';
  const injectEffort = reasoningEffort && modelName.startsWith('kimi-k3');

  const moonshot = createOpenAI({
    apiKey,
    baseURL: cloudflareEnv?.MOONSHOT_BASE_URL || env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1',
    ...(injectEffort ? { fetch: withReasoningEffort(reasoningEffort) } : {}),
  });

  return moonshot(modelName);
}
