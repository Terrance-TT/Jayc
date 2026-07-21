import { env } from 'node:process';

/**
 * Output token cap per response segment (5x bolt.new's 8192 default).
 * Override without a code change by setting the MAX_TOKENS env var / secret.
 */
export const MAX_TOKENS = Number(env.MAX_TOKENS) || 40960;

/**
 * How many times a single generation may auto-continue after hitting
 * MAX_TOKENS. bolt.new's default of 2 can truncate a full modular app
 * mid-build; 4 raises the total ceiling to ~160k output tokens.
 * Override via the MAX_RESPONSE_SEGMENTS env var / secret.
 */
export const MAX_RESPONSE_SEGMENTS = Number(env.MAX_RESPONSE_SEGMENTS) || 4;
