import { env as processEnv } from 'node:process';
import { getAPIKey } from './api-key';

interface SimpleMessage {
  role: string;
  content: string;
}

/**
 * Calls the planner model (default kimi-k3) non-streaming and returns its
 * reasoning/plan text. Returns null on any failure so the caller can fall
 * back to a direct build.
 */
export async function getArchitectPlan(messages: SimpleMessage[], env: Env): Promise<string | null> {
  const apiKey = getAPIKey(env);

  if (!apiKey) {
    return null;
  }

  const baseURL = processEnv.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1';
  const plannerModel = processEnv.MOONSHOT_PLANNER_MODEL || 'kimi-k3';

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: plannerModel,
        temperature: 1,
        max_tokens: 16384,
        stream: false,
        messages: [
          {
            role: 'system',
            content: [
              'You are the architect for Jayc, an AI app builder that enforces modular architecture.',
              "Given the user's app request, produce a concrete implementation plan:",
              '- Which modules are needed (frontend/api/auth/database/payments/shared)',
              '- For each module: its CONTRACT (purpose, files, inputs, outputs, boundaries)',
              '- Data models and auth flow',
              '- Build order',
              'Be concise. Output the plan only - no code, no chit-chat.',
            ].join('\n'),
          },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
      signal: AbortSignal.timeout(240_000),
    });

    if (!res.ok) {
      console.log('[relay] planner error', res.status, await res.text().catch(() => ''));
      return null;
    }

    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message;
    const plan: string | null = msg?.reasoning_content || msg?.content || null;
    console.log('[relay] architect plan received:', plan ? plan.length : 0, 'chars');
    return plan;
  } catch (err) {
    console.log('[relay] planner failed, falling back to direct build', err);
    return null;
  }
}
