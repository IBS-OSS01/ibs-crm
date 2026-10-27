// Where the Cloudflare Worker (cloudflare/) lives — the app's only backend (data in D1, sign-in, and the website itself).
// In production the website is served by that same Worker, so calls go to the same address. VITE_API_URL overrides it (e.g. a local Worker on :8787).
export const API_URL = (import.meta.env && import.meta.env.VITE_API_URL) || (import.meta.env && import.meta.env.DEV ? 'https://ibs-erp.sankharbanda.workers.dev' : '')
