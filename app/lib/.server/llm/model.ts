import { createOpenAI } from '@ai-sdk/openai';
import { env } from 'node:process';

/**
 * Model/base URL resolution order:
 * 1. Cloudflare Pages variables/secrets (cloudflareEnv) — the only source
 *    that exists in production; process.env is empty on Pages Functions.
 * 2. process env (local dev via .env.local)
 * 3. Moonshot defaults
 */
export function getMoonshotModel(apiKey: string, cloudflareEnv?: Env) {
  const moonshot = createOpenAI({
    apiKey,
    baseURL: cloudflareEnv?.MOONSHOT_BASE_URL || env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1',
  });

  return moonshot(cloudflareEnv?.MOONSHOT_MODEL || env.MOONSHOT_MODEL || 'kimi-k3');
}
