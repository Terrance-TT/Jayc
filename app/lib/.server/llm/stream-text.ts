import { streamText as _streamText, convertToCoreMessages } from 'ai';
import { env as processEnv } from 'node:process';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { getMoonshotModel } from '~/lib/.server/llm/model';
import { MAX_TOKENS } from './constants';
import { builderEffortFor, builderSegmentTimeoutMs, estimateComplexity, type K3ReasoningEffort } from './effort';
import { getSystemPrompt } from './prompts';
import { getArchitectPlan } from './relay';

interface ToolResult<Name extends string, Args, Result> {
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolResult<string, unknown, unknown>[];
}

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

export async function streamText(messages: Messages, env: Env, options?: StreamingOptions, forcedEffort?: K3ReasoningEffort) {
  /**
   * Estimate build complexity ONCE from the first user message (before the
   * relay rewrites anything) and pick the builder's reasoning effort from it.
   * Callers running small side-tasks (e.g. the prompt enhancer) can skip the
   * estimator entirely with forcedEffort — their synthetic wrapper text would
   * otherwise inherit the complexity of the user's prompt inside it.
   */
  const complexity = estimateComplexity(messages);
  const builderEffort = forcedEffort ?? builderEffortFor(complexity, env);
  const segmentTimeoutMs = forcedEffort === 'low' ? 300_000 : builderSegmentTimeoutMs(complexity, env);

  console.log(`[llm] complexity=${complexity} builderEffort=${builderEffort} segmentTimeout=${segmentTimeoutMs}ms`);

  /**
   * Optional two-model relay (set MOONSHOT_RELAY=1):
   * the planner model (MOONSHOT_PLANNER_MODEL, default kimi-k3) first produces
   * an architecture plan, then the builder model (MOONSHOT_MODEL, e.g.
   * kimi-k2.6) executes it. Relay only triggers on the first user message of a
   * chat; continuations and follow-up turns go straight to the builder.
   * Cloudflare env takes precedence over process env (which is empty on Pages).
   */
  const relayEnabled = (env.MOONSHOT_RELAY || processEnv.MOONSHOT_RELAY) === '1';

  if (relayEnabled && messages.length === 1 && messages[0].role === 'user') {
    const plan = await getArchitectPlan(messages, env);

    if (plan) {
      messages = [
        {
          role: 'user',
          content: `${messages[0].content}\n\n<architect_plan>\n${plan}\n</architect_plan>\n\nFollow this plan exactly when building.`,
        },
      ];
    }
  }

  return _streamText({
    model: getMoonshotModel(getAPIKey(env), env, builderEffort),
    system: getSystemPrompt(),
    maxTokens: MAX_TOKENS,
    temperature: 1, // Kimi K3 requires temperature=1
    /**
     * Wall-clock hard limit per response segment. If a stream stalls or the
     * model thinks past this ceiling, the segment aborts and the client's
     * auto-resume continues from where it stopped instead of hanging forever.
     */
    abortSignal: AbortSignal.timeout(segmentTimeoutMs),
    messages: convertToCoreMessages(messages),
    ...options,
  });
}
