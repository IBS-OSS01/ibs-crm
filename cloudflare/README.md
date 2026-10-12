# IBS data API on Cloudflare (Workers + D1) — free plan

Replaces Firestore as the app's database. The app keeps **Firebase Auth** (sign-in) and **Firebase Hosting** (the website files);
only the documents move. Free limits (Cloudflare): D1 5 M rows read / 100 k written per day and 5 GB; Workers 100 k requests per day.

## Files
- `src/index.js` — the Worker: `/v1/list`, `/v1/get`, `/v1/stamps`, `/v1/count`, `/v1/commit` (atomic, ≤ 30 writes)
- `src/rules.js` — who may read/write what (port of `firestore.rules`)
- `src/auth.js` — checks the Firebase ID token the app sends
- `src/docops.js` — how a write changes a document (merge, increment, server time, dotted paths)
- `schema.sql` — two tables: `docs` (every document as JSON) and `colstamp` (per-collection "last changed")
- App side: `src/lib/cfBackend.js` (data layer), `src/lib/cachedFirestore.js` (switch between backends), `src/apps/admin/pages/DataMove.jsx` (one-time copy)

## Test locally (no account needed)
```
cd cloudflare && npm install
npx wrangler d1 execute ibs-data --local --file=schema.sql
npx wrangler dev --local --var DEV_AUTH:1 --port 8787
node ../scripts/test-cloudflare.mjs      # the Worker and its rules
node ../scripts/test-cf-client.mjs       # the app's data layer against it
```

## Deploy (needs a free Cloudflare account)
1. `npx wrangler login`
2. `npx wrangler d1 create ibs-data` → copy the `database_id` into `wrangler.toml`
3. `npx wrangler d1 execute ibs-data --remote --file=schema.sql`
4. Seed the first admin (so the one-time move is allowed to write): insert a `users` document for that Firebase uid with `{"role":"admin"}`
5. `npx wrangler deploy` → prints `https://ibs-api.<account>.workers.dev`
6. App: put that address in `.env.production` as `VITE_API_URL=…`, build, deploy hosting
7. As admin: Admin → **Data move** → *Move everything*, check the counts match, *try Cloudflare in this browser*, test
8. When happy: `.env.production` → `VITE_BACKEND=cloudflare`, build, deploy hosting (everyone switches). Keep Firestore as the backup until you are sure.
