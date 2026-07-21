import { env } from 'node:process';

/**
 * Output token cap per response segment (5x bolt.new's 8192 default).
 *
 * bolt.new's default of 8192 is too small for Kimi K3: reasoning tokens count
 * toward this budget, and on complex prompts K3 can spend the entire budget
 * reasoning and return zero visible content (finishReason: 'length' with an
 * empty reply). 40960 gives K3 room for deep reasoning + full output.
 *
 * Override without a code change by setting the MAX_TOKENS env var / secret.
 */
export const MAX_TOKENS = Number(env.MAX_TOKENS) || 40960;

// limits the number of model responses that can be returned in a single request
export const MAX_RESPONSE_SEGMENTS = 2;
