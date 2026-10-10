// Tiny proxy for gstinapi.in so the browser app can use it without exposing the API key.
// Runs on Cloudflare Workers' free plan (100,000 requests/day) — nothing to do with Firebase billing.
//
//   GET https://<your-worker>.workers.dev/27AAAAA0000A1Z5   →   gstinapi.in JSON for that GSTIN
//
// Secrets / vars (set in the Cloudflare dashboard or with `wrangler secret put`):
//   GSTIN_API_KEY     your gstinapi.in key           (secret — never put it in the app)
//   ALLOWED_ORIGINS   comma separated, default https://uipl-erp.web.app

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export default {
  async fetch(req, env) {
    const allowed = (env.ALLOWED_ORIGINS || 'https://uipl-erp.web.app').split(',').map(s => s.trim())
    const origin = req.headers.get('Origin') || ''
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (origin && !allowed.includes(origin)) return reply({ success: false, error: 'Origin not allowed' }, 403)   // browsers only; curl can still call it, so keep your credit balance in mind

    const gstin = (new URL(req.url).pathname.split('/').filter(Boolean).pop() || '').toUpperCase()
    if (!GSTIN_RE.test(gstin)) return reply({ success: false, error: 'Invalid GSTIN format' }, 400)
    if (!env.GSTIN_API_KEY) return reply({ success: false, error: 'Proxy has no API key configured' }, 500)

    const up = await fetch(`https://www.gstinapi.in/v1/gstin/${gstin}`, { headers: { 'x-api-key': env.GSTIN_API_KEY } })
    const body = await up.text()
    return new Response(body, { status: up.status, headers: { ...cors, 'Content-Type': 'application/json' } })
  },
}
