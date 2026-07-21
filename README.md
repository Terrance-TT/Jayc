# Jayc

AI app builder that enforces **modular architecture** on every generated app.

Jayc is a fork of [bolt.new](https://github.com/stackblitz/bolt.new) (MIT, © StackBlitz) with two key changes:

1. **Modular architecture enforcement** — the system prompt requires every generated app to be organized into `modules/` (`frontend`, `api`, `auth`, `database`, `payments`, `shared`), each with a `CONTRACT.md` defining its purpose, inputs, outputs, and boundaries. No cross-module spaghetti imports; files capped at 150 lines. See `app/lib/.server/llm/prompts.ts`, section 15.
2. **Runs on Moonshot AI (Kimi K3)** instead of Anthropic Claude — Moonshot's API is OpenAI-compatible. See `app/lib/.server/llm/model.ts`.

## Run locally

Requires Node 18.18+ and pnpm 9.

```bash
pnpm install
echo 'MOONSHOT_API_KEY=sk-...' > .env.local   # key from https://platform.moonshot.ai
pnpm dev                                      # → http://localhost:5173 (use Chrome/Edge)
```

Optional env vars (in `.env.local`):

| Var | Default | Notes |
|---|---|---|
| `MOONSHOT_MODEL` | `kimi-k3` | Try `kimi-k2.6` for faster/cheaper generations |
| `MOONSHOT_BASE_URL` | `https://api.moonshot.ai/v1` | Use `https://api.moonshot.cn/v1` in mainland China |

Note: `temperature` is pinned to `1` (Kimi K3 rejects any other value).

## Deploy (Cloudflare Pages, free)

```bash
npx wrangler login                              # opens browser to authorize
pnpm run deploy                                 # builds + deploys → https://<project>.pages.dev
npx wrangler pages secret put MOONSHOT_API_KEY  # paste your Moonshot key when prompted
pnpm run deploy                                 # redeploy so the secret goes live
```

The `public/_headers` file sets the COOP/COEP headers the in-browser WebContainer requires in production — do not remove it.

## License

MIT — same as upstream bolt.new. See [LICENSE](./LICENSE).
