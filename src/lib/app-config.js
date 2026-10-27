// The app's data layer (lib/cfBackend.js) ignores `db`; it exists so the pages' existing calls keep their shape. Data lives in Cloudflare D1.
export { auth } from './session.js'
export const db = { type: 'db' }
