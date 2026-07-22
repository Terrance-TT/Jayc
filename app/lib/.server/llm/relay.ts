import { env as processEnv } from 'node:process';
import { getAPIKey } from './api-key';

interface SimpleMessage {
  role: string;
  content: string;
}

const ARCHITECT_PROMPT = [
  'You are the chief architect for Jayc, an AI app builder that ENFORCES modular architecture.',
  "Given the user's app request, produce a COMPLETE technical design. A builder model will execute it file-by-file, and your design is AUTHORITATIVE - the builder is not allowed to deviate.",
  '',
  'Output format:',
  '',
  '## 1. Module map',
  'Every module this app needs (choose from frontend/api/auth/database/payments/shared - only what is actually needed).',
  '',
  '## 2. CONTRACT.md for each module',
  'For EACH module, write the full contract in this exact format:',
  '# Module: [Name]',
  '## Purpose - [one sentence]',
  '## Files - [every file path in this module, e.g. modules/auth/src/login.ts]',
  '## Inputs (what this module needs from others) - [module]: [what it provides]',
  '## Outputs (what this module provides) - [exported functions/types/API]',
  '## Boundaries - CANNOT directly modify: [other modules files] / CAN read via API: [other modules exports]',
  '',
  '## 3. File-by-file design',
  'One entry for EVERY file in the app:',
  '- modules/<module>/src/<file>: what it does, its exports (names + signatures), and its imports.',
  "  Imports may ONLY come from the same module or from another module's declared Outputs.",
  '',
  '## 4. Data model & flows',
  'Schemas, key types, the auth flow, request/response shapes.',
  '',
  '## 5. Build order',
  'Exact order to create files: CONTRACT.md files first, then leaf modules, then modules that depend on them.',
  '',
  'HARD RULES (state them in your plan; the builder MUST obey them):',
  '- Every module has a CONTRACT.md',
  "- No file imports from another module's src/ - cross-module communication only via declared Outputs",
  '- Max 150 lines per file - if a file would exceed it, split it in your design',
  '- Only create modules the app actually needs',
  '',
  'Be thorough but concise. Signatures and types, yes - full code implementations, no. Output the design only.',
].join('\n');

/**
 * Calls the planner model (default kimi-k3) non-streaming and returns the
 * finished design (prefers the polished content; falls back to the raw
 * reasoning if the budget ran out mid-reasoning). Returns null on any
 * failure so the caller can fall back to a direct build.
 * Cloudflare env takes precedence over process env (which is empty on Pages).
 */
export async function getArchitectPlan(messages: SimpleMessage[], env: Env): Promise<string | null> {
  const apiKey = getAPIKey(env);

  if (!apiKey) {
    return null;
  }

  const baseURL = env.MOONSHOT_BASE_URL || processEnv.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1';
  const plannerModel = env.MOONSHOT_PLANNER_MODEL || processEnv.MOONSHOT_PLANNER_MODEL || 'kimi-k3';

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: plannerModel,
        temperature: 1,
        max_tokens: 24576,
        stream: false,
        messages: [
          { role: 'system', content: ARCHITECT_PROMPT },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      console.log('[relay] planner error', res.status, await res.text().catch(() => ''));
      return null;
    }

    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message;
    const plan: string | null = msg?.content || msg?.reasoning_content || null;
    console.log('[relay] architect plan received:', plan ? plan.length : 0, 'chars');
    return plan;
  } catch (err) {
    console.log('[relay] planner failed, falling back to direct build', err);
    return null;
  }
}
