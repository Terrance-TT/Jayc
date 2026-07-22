# Database setup (Cloudflare D1)

Jayc can store each signed-in user's **projects** (the apps they generate) in a
Cloudflare D1 (SQLite) database, so projects survive browser data clearing and
sync across devices. This is **optional** — without it, projects are kept only
in the browser's IndexedDB (local cache).

Everything below assumes you have the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
available (`npx wrangler ...`) and are logged in (`npx wrangler login`).

## 1. Create the D1 database

```bash
npx wrangler d1 create jayc-db
```

The output looks like this:

```
✅ Successfully created DB 'jayc-db'!

[[d1_databases]]
binding = "DB"
database_name = "jayc-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## 2. Paste the `database_id` into `wrangler.toml`

Open `wrangler.toml` in the repo root and replace the placeholder:

```toml
[[d1_databases]]
binding = "DB"
database_name = "jayc-db"
database_id = "REPLACE_WITH_YOUR_D1_ID"   # ← paste your real id here
migrations_dir = "migrations"
```

Commit this change (the `database_id` is not a secret).

## 3. Apply the migration

The migration lives in `migrations/0001_init.sql` and creates the `projects` table.

**Remote (production) database:**

```bash
npx wrangler d1 migrations apply jayc-db --remote
```

**Local dev database** (used by `wrangler pages dev`, stored in `.wrangler/state`):**

```bash
npx wrangler d1 migrations apply jayc-db --local
```

Wrangler asks for confirmation before applying — answer `y`.

To verify, you can run:

```bash
npx wrangler d1 execute jayc-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```

You should see `projects` (plus wrangler's internal `d1_migrations` table).

## 4. Redeploy

```bash
pnpm run deploy
```

Because the D1 binding is declared in `wrangler.toml`, Cloudflare Pages
attaches it automatically on deploy — no dashboard configuration needed.

## 5. Local development

```bash
# make sure the local database has the schema (step 3, --local variant)
npx wrangler d1 migrations apply jayc-db --local

pnpm dev
```

Notes:

- `pnpm dev` runs `wrangler pages dev`, which reads `wrangler.toml` and binds
  the local D1 database automatically.
- Sign-in (Clerk) is required for cloud sync: the API route
  (`/api/projects`) returns `401` for anonymous users and the client silently
  skips syncing.
- If the `DB` binding is missing (e.g. you skipped this setup), the API
  returns `503` and the app keeps working with IndexedDB only.

## 6. How it works (quick reference)

| Piece | Location | Purpose |
|---|---|---|
| Schema | `migrations/0001_init.sql` | `projects` table + `(user_id, updated_at)` index |
| Server module | `app/lib/.server/db/` | D1 client helper + project repository functions |
| API route | `app/routes/api.projects.ts` | `GET /api/projects`, `GET /api/projects?id=…`, `POST`, `DELETE` |
| Client sync | `app/lib/persistence/cloudSync.client.ts` | Fire-and-forget POST after each local save |
| Hook change | `app/lib/persistence/useChatHistory.ts` | Calls `syncProjectToCloud` after IndexedDB write |

- All queries are parameterized (`db.prepare(...).bind(...)`).
- Every query is scoped by the Clerk `userId`, so users can never read or
  overwrite each other's rows.
- IndexedDB stays the local cache; the D1 copy is the durable, cross-device one.
