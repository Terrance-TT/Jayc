/**
 * Server-side D1 access helper.
 *
 * The `DB` binding is declared in `wrangler.toml` under `[[d1_databases]]`.
 * When the binding is missing (e.g. local dev without a D1 database
 * attached) `getDb` returns `undefined` so callers can degrade gracefully
 * instead of crashing.
 */

export function getDb(env: { DB?: D1Database }): D1Database | undefined {
  return env.DB;
}
