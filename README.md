# Jayc

AI app builder that enforces **modular architecture** on every generated app.

Jayc is a fork of [bolt.new](https://github.com/stackblitz/bolt.new) (MIT, © StackBlitz) with these key changes:

1. **Modular architecture enforcement** — the system prompt requires every generated app to be organized into `modules/` (`frontend`, `api`, `auth`, `database`, `payments`, `shared`), each with a `CONTRACT.md` defining its purpose, inputs, outputs, and boundaries. No cross-module spaghetti imports; files capped at 150 lines. See `app/lib/.server/llm/prompts.ts`, section 15.
2. **Runs on Moonshot AI (Kimi)** instead of Anthropic Claude — Moonshot's API is OpenAI-compatible. See `app/lib/.server/llm/model.ts`.
3. **Optional two-model relay** (`MOONSHOT_RELAY=1`) — a planner model (Kimi K3) first designs the module contracts and build order, then a builder model (e.g. Kimi K2.6) executes the plan. See `app/lib/.server/llm/relay.ts`.

## Run locally

Requires Node 18.18+ and pnpm 9.

```bash
pnpm install
echo 'MOONSHOT_API_KEY=sk-...' > .env.local   # key from https://platform.moonshot.ai
pnpm dev                                      # → http://localhost:5173 (use Chrome/Edge)
```

Optional env vars (in `.env.local` or as Cloudflare Pages secrets):

| Var | Default | Notes |
|---|---|---|
| `MOONSHOT_MODEL` | `kimi-k3` | Builder model. `kimi-k2.6` is faster/cheaper |
| `MOONSHOT_BASE_URL` | `https://api.moonshot.ai/v1` | Use `https://api.moonshot.cn/v1` in mainland China |
| `MOONSHOT_RELAY` | off | Set to `1` to enable the two-model relay |
| `MOONSHOT_PLANNER_MODEL` | `kimi-k3` | Planner model used by the relay |
| `MAX_TOKENS` | `40960` | Output cap per response segment |

Note: `temperature` is pinned to `1` (Kimi K3 rejects any other value).

## Database (optional)

By default, projects are stored only in the browser's IndexedDB. To persist
projects per signed-in user (Clerk) and sync them across devices, Jayc can use
a **Cloudflare D1** database — see [DATABASE_SETUP.md](./DATABASE_SETUP.md)
for the step-by-step setup (create the database, apply the migration, paste
the `database_id` into `wrangler.toml`, redeploy).

## Deploy (Cloudflare Pages, free)

```bash
npx wrangler login
pnpm run deploy
npx wrangler pages secret put MOONSHOT_API_KEY
pnpm run deploy
```

The `public/_headers` file sets the COOP/COEP headers the in-browser WebContainer requires in production — do not remove it.

## License

MIT — same as upstream bolt.new. See [LICENSE](./LICENSE).
