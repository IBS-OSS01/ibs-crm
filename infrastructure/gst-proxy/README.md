# GSTIN lookup proxy (free)

`gstinapi.in` can't be called from a browser (no CORS headers) and its key must not ship inside the app.
This 30-line Cloudflare Worker sits in between. Cloudflare Workers has a free plan (100k requests/day) and
needs no change to your Firebase plan.

## One-time setup (about 5 minutes)

1. Create a free account at https://dash.cloudflare.com (no card needed).
2. In this folder run:
   ```
   npx wrangler login
   npx wrangler deploy worker.js --name ibs-gst-proxy --compatibility-date 2025-01-01
   npx wrangler secret put GSTIN_API_KEY --name ibs-gst-proxy     # paste your gstinapi.in key when asked
   ```
3. Wrangler prints the URL, e.g. `https://ibs-gst-proxy.<you>.workers.dev`.
4. Put it in `.env.local`:
   ```
   VITE_GST_PROXY_URL=https://ibs-gst-proxy.<you>.workers.dev
   ```
   then `npm run build` and deploy the app. The Fetch buttons now use gstinapi.in instead of Appyflow.

Optional: set `ALLOWED_ORIGINS` (default `https://uipl-erp.web.app`) if you serve the app from another address.

## Notes
- Each lookup uses one gstinapi.in credit. The proxy only answers browsers coming from your allowed origin, but
  anyone who learns the URL could still call it from a script — keep an eye on the credit balance.
- The app checks every answer: if the state or GSTIN in the reply doesn't match the number you typed, nothing is filled in.
