// The app's own sign-in (talks to the Worker's /v1/auth/* — see cloudflare/src/auth.js). It keeps the little the rest of the app
// needs from the old Firebase Auth object: `auth.currentUser` ({ uid, email, getIdToken }), `auth.onAuthStateChanged`,
// `auth.authStateReady`, `auth.signOut`. The session token is kept in this browser's localStorage and renewed while the app is in use.
import { API_URL } from './apiConfig.js'

const KEY = 'ibs_session'
const RENEW_AFTER_MS = 6 * 3600e3        // a token older than this is swapped for a fresh one on next use
const CHECK_MS = 30 * 60e3

let session = null                        // { token, uid, email, exp, at }
const subs = new Set()

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (s && s.token && s.exp * 1000 > Date.now()) return s
  } catch { /* private mode / blocked storage: the session then lasts until the tab closes */ }
  return null
}
function save(s) { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY) } catch { /* ignore */ } }

const userOf = (s) => s ? { uid: s.uid, email: s.email, getIdToken: getToken } : null
function publish() { const u = userOf(session); subs.forEach(fn => { try { fn(u) } catch (e) { console.error(e) } }) }
function setSession(r) {
  session = r ? { token: r.token, uid: r.uid, email: r.email, exp: r.exp, at: Date.now() } : null
  save(session); publish()
}

export class AuthFailure extends Error { constructor(code, message) { super(message); this.name = 'FirebaseError'; this.code = code } }   // same shape the pages already read (err.code / err.message)

async function call(path, body, token) {
  let res, json
  try { res = await fetch(API_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}) }); json = await res.json() }
  catch { throw new AuthFailure('unavailable', 'Could not reach the server — check your connection') }
  if (!res.ok) throw new AuthFailure(json?.error?.code || 'internal', json?.error?.message || `Request failed (${res.status})`)
  return json
}

let renewing = null
async function renew() {
  if (!session) return
  if (!renewing) renewing = call('/v1/auth/refresh', {}, session.token)
    .then(r => { if (session) setSession(r) })
    .catch(e => { if (e.code === 'unauthenticated' || e.code === 'account-disabled') { disabledNote = e.code === 'account-disabled' ? e.message : ''; setSession(null) } })   // network trouble keeps the session
    .finally(() => { renewing = null })
  return renewing
}
let disabledNote = ''
export const takeDisabledNote = () => { const n = disabledNote; disabledNote = ''; return n }

async function getToken() {
  if (!session) return null
  if (Date.now() - session.at > RENEW_AFTER_MS) await renew()
  return session ? session.token : null
}

session = load()
if (session) renew()
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) { session = load(); publish() } })      // sign-in / sign-out in another tab
  setInterval(() => { if (session && document.visibilityState === 'visible') renew() }, CHECK_MS)
}

export const auth = {
  get currentUser() { return userOf(session) },
  authStateReady: () => Promise.resolve(),
  onAuthStateChanged(fn) { subs.add(fn); queueMicrotask(() => { if (subs.has(fn)) fn(userOf(session)) }); return () => subs.delete(fn) },
  async signOut() { setSession(null) },
}

export async function signIn(email, password) { const r = await call('/v1/auth/login', { email, password }); setSession(r); return r }
export async function setPasswordFromLink(token, password) { const r = await call('/v1/auth/setup', { token, password }); setSession(r); return r }
export async function changePassword(old, password) { return call('/v1/auth/change', { old, password }, await getToken()) }
// administrators only
export async function inviteLogin({ email, uid, password }) { return call('/v1/auth/admin/invite', { email, uid, password }, await getToken()) }
export async function changeLoginEmail(uid, email) { return call('/v1/auth/admin/email', { uid, email }, await getToken()) }
export async function removeLogin(uid) { return call('/v1/auth/admin/remove', { uid }, await getToken()) }
export const setupLink = (token) => `${window.location.origin}/set-password?token=${token}`
