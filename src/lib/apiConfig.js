// Where the Cloudflare Worker (cloudflare/) lives. Set VITE_API_URL in .env.production after `wrangler deploy` prints the address.
export const API_URL = (import.meta.env && import.meta.env.VITE_API_URL) || 'http://127.0.0.1:8787'
