import { env as processEnv } from 'node:process';

/**
 * Adaptive thinking budget for Kimi K3.
 *
 * K3 always reasons — the Moonshot API exposes a top-level `reasoning_effort`
 * field ("low" | "high" | "max", default "max") and every reasoning token is
 * billed as output. Left at the default, a "build me a landing page" request
 * can burn minutes of reasoning it doesn't need. This module estimates task
 * complexity ONCE from the first user message and maps it to an effort level
 * plus hard token/time ceilings.
 *
 * Moonshot recommends picking the effort before a session starts and NOT
 * switching mid-session (switching invalidates the prefix cache), which is
 * why only the FIRST user message is ever considered.
 */

export type TaskComplexity = 'simple' | 'standard' | 'complex';
export type K3ReasoningEffort = 'low' | 'high' | 'max';

export interface PlannerBudget {
  effort: K3ReasoningEffort;
  maxTokens: number;
  timeoutMs: number;
}

/**
 * Architect/planner budgets. timeoutMs is a hard wall-clock limit: when it
 * expires the planner call is aborted and relay.ts falls back to a direct
 * build, so even a pathological request can't think forever.
 */
const PLANNER_BUDGETS: Record<TaskComplexity, PlannerBudget> = {
  simple: { effort: 'low', maxTokens: 8192, timeoutMs: 120_000 },
  standard: { effort: 'high', maxTokens: 24576, timeoutMs: 300_000 },
  complex: { effort: 'max', maxTokens: 32768, timeoutMs: 600_000 }, // absolute ceiling
};

/**
 * Builder effort by complexity. Complex builds keep full "max" reasoning —
 * that is what K3 is for — while simpler work is capped so it doesn't
 * over-think. The builder's hard limits stay the token caps (MAX_TOKENS per
 * segment x MAX_RESPONSE_SEGMENTS) plus the wall-clock backstop below.
 */
const BUILDER_EFFORTS: Record<TaskComplexity, K3ReasoningEffort> = {
  simple: 'low',
  standard: 'high',
  complex: 'max',
};

/** Signals that mark a build as having real backend/architecture weight. */
const COMPLEX_SIGNALS = [
  'auth',
  'login',
  'log in',
  'sign in',
  'signin',
  'sign up',
  'signup',
  'user account',
  'database',
  'payment',
  'stripe',
  'checkout',
  'subscription',
  'e-commerce',
  'ecommerce',
  'marketplace',
  'dashboard',
  'admin',
  'real-time',
  'realtime',
  'websocket',
  'multiplayer',
  'chat app',
  'messaging',
  'social network',
  'saas',
  'full-stack',
  'fullstack',
  'backend',
  'api',
  'permission',
  'upload',
  'notification',
  'booking',
  'calendar',
  'crm',
  'cms',
  'blog',
  'comment',
  'search',
  'ai chat',
  'openai',
  'multi-page',
  'multiple pages',
  'user roles',
  'inventory',
  'analytics',
];

/** Signals that mark a build as a small, self-contained front-end piece. */
const SIMPLE_SIGNALS = [
  'landing page',
  'simple',
  'static',
  'single page',
  'single-page',
  'one page',
  'one-page',
  'portfolio',
  'calculator',
  'converter',
  'timer',
  'stopwatch',
  'counter',
  'todo',
  'to-do',
  'quiz',
  'flashcard',
  'coming soon',
  'brochure',
  'clock',
  'tic-tac-toe',
  'tic tac toe',
  'snake',
  'memory game',
];

const COMPLEX_REGEXES = COMPLEX_SIGNALS.map((s) => new RegExp(`\\b${escapeRegex(s)}\\b`, 'i'));
const SIMPLE_REGEXES = SIMPLE_SIGNALS.map((s) => new RegExp(`\\b${escapeRegex(s)}\\b`, 'i'));

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Estimates build complexity from the FIRST user message of the session.
 * Using only the first message keeps the estimate stable across continuation
 * and follow-up turns, so the reasoning effort never flips mid-session.
 */
export function estimateComplexity(messages: { role: string; content: string }[]): TaskComplexity {
  const firstUserMessage = messages.find((m) => m.role === 'user');

  if (!firstUserMessage) {
    return 'standard';
  }

  const text = firstUserMessage.content.toLowerCase();
  const complexHits = COMPLEX_REGEXES.reduce((hits, re) => hits + (re.test(text) ? 1 : 0), 0);

  if (complexHits >= 2) {
    return 'complex';
  }

  if (complexHits === 1) {
    return 'standard';
  }

  const looksSimple = SIMPLE_REGEXES.some((re) => re.test(text)) || text.length < 200;

  return looksSimple ? 'simple' : 'standard';
}

/** Planner (architect) budget for a complexity level, with env override. */
export function plannerBudgetFor(complexity: TaskComplexity, env?: Env): PlannerBudget {
  const budget = { ...PLANNER_BUDGETS[complexity] };
  const forced = readEffortOverride(env?.K3_PLANNER_EFFORT ?? processEnv.K3_PLANNER_EFFORT);

  if (forced) {
    budget.effort = forced;
  }

  return budget;
}

/** Builder effort for a complexity level, with env override. */
export function builderEffortFor(complexity: TaskComplexity, env?: Env): K3ReasoningEffort {
  return readEffortOverride(env?.K3_BUILDER_EFFORT ?? processEnv.K3_BUILDER_EFFORT) ?? BUILDER_EFFORTS[complexity];
}

/**
 * Wall-clock hard limit for ONE builder response segment. Generation is
 * already token-capped (MAX_TOKENS per segment x MAX_RESPONSE_SEGMENTS);
 * this is the backstop so a stalled/over-thinking stream dies and the
 * client's auto-resume takes over instead of hanging forever.
 * Override via BUILDER_SEGMENT_TIMEOUT_MS (milliseconds).
 */
export function builderSegmentTimeoutMs(env?: Env): number {
  const parsed = Number(env?.BUILDER_SEGMENT_TIMEOUT_MS ?? processEnv.BUILDER_SEGMENT_TIMEOUT_MS);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900_000;
}

function readEffortOverride(raw?: string): K3ReasoningEffort | null {
  const value = raw?.toLowerCase();

  return value === 'low' || value === 'high' || value === 'max' ? value : null;
}
