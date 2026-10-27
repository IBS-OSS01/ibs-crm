// Where the Cloudflare Worker (cloudflare/) lives — the app's only database (Cloudflare D1). VITE_API_URL only overrides it (e.g. a local Worker on :8787).
export const API_URL = (import.meta.env && import.meta.env.VITE_API_URL) || 'https://ibs-api.sankharbanda.workers.dev'
