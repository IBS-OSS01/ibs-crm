// The app's own sign-in (no Firebase, no third party): passwords live in the D1 `accounts` table as salted PBKDF2 hashes,
// and a successful sign-in returns a signed session token (HS256 JWT) that the app sends with every call.
//
//   POST /v1/auth/login           { email, password }         → { token, uid, email, exp }
//   POST /v1/auth/refresh         (Bearer)                    → a fresh token (also how the app learns an account was disabled / removed)
//   POST /v1/auth/setup           { token, password }         → sets the password from a one-time setup link, signs in
//   POST /v1/auth/change          { old, password } (Bearer)  → changes the signed-in person's own password
//   POST /v1/auth/admin/invite    { email, uid?, password? }  → admin: creates/refreshes a login; returns { uid, setupToken } (or sets the password)
//   POST /v1/auth/admin/email     { uid, email }              → admin: changes someone's login email
//   POST /v1/auth/admin/remove    { uid }                     → admin: deletes someone's login
// Setup tokens are random, stored only as a hash, valid 7 days and single use. Five wrong passwords in a row lock the account for 10 minutes.
const ITER = 100000                                 // PBKDF2 rounds (the most Workers allows)
const TOKEN_DAYS = 7
const SETUP_DAYS = 7
const MAX_FAILS = 5, LOCK_MS = 10 * 60e3

const enc = new TextEncoder()
const toHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
const fromHex = (h) => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16))
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)) }
const randHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)))
const sha256Hex = async (s) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

async function pbkdf2(password, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: iter }, key, 256))
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }

// ── session tokens ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const hmacKey = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export async function signToken(secret, uid, email) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64u(enc.encode(JSON.stringify({ sub: uid, email, iat: now, exp: now + TOKEN_DAYS * 86400 })))
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`)))
  return { token: `${head}.${body}.${sig}`, exp: now + TOKEN_DAYS * 86400 }
}

// → { uid, email } for a valid, unexpired token, or null
export async function verifyToken(token, secret) {
  try {
    if (!secret) return null
    const [h, p, s] = String(token || '').split('.')
    if (!h || !p || !s) return null
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64u(s), enc.encode(`${h}.${p}`))
    if (!ok) return null
    const claims = JSON.parse(new TextDecoder().decode(unb64u(p)))
    if (!claims.sub || claims.exp <= Math.floor(Date.now() / 1000)) return null
    return { uid: claims.sub, email: claims.email || '' }
  } catch { return null }
}

// ── accounts ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export class AuthError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code } }
const fail = (status, code, msg) => { throw new AuthError(status, code, msg) }
const cleanEmail = (e) => String(e || '').trim().toLowerCase()
const checkPassword = (p) => {
  if (typeof p !== 'string' || p.length < 8) fail(400, 'weak-password', 'Use at least 8 characters for the password.')
  if (p.length > 200) fail(400, 'invalid-argument', 'Password is too long.')
}

async function isActive(env, uid) {                  // an admin can switch a person off in Users → they can no longer sign in or refresh
  const row = await env.DB.prepare("SELECT data FROM docs WHERE col = 'users' AND id = ?").bind(uid).first()
  if (!row) return false
  try { return JSON.parse(row.data).active !== false } catch { return true }
}

async function startSession(env, acct) {
  const t = await signToken(env.SESSION_SECRET, acct.uid, acct.email)
  return { token: t.token, exp: t.exp, uid: acct.uid, email: acct.email }
}

async function setPassword(env, email, password) {
  checkPassword(password)
  const salt = randHex(16)
  const hash = await pbkdf2(password, salt, ITER)
  await env.DB.prepare('UPDATE accounts SET salt = ?, hash = ?, iter = ?, setup_hash = NULL, setup_exp = 0, fails = 0, locked_until = 0 WHERE email = ?').bind(salt, hash, ITER, email).run()
}

async function login(body, env) {
  const email = cleanEmail(body.email), password = String(body.password || '')
  const acct = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first()
  const bad = () => fail(401, 'wrong-credentials', 'Invalid email or password.')
  if (!acct || !acct.hash) bad()
  if (acct.locked_until > Date.now()) fail(429, 'too-many-attempts', 'Too many wrong passwords — try again in a few minutes.')
  const ok = same(await pbkdf2(password, acct.salt, acct.iter), acct.hash)
  if (!ok) {
    const fails = (acct.fails || 0) + 1
    await env.DB.prepare('UPDATE accounts SET fails = ?, locked_until = ? WHERE email = ?').bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0, email).run()
    bad()
  }
  if (acct.fails) await env.DB.prepare('UPDATE accounts SET fails = 0, locked_until = 0 WHERE email = ?').bind(email).run()
  if (!(await isActive(env, acct.uid))) fail(403, 'account-disabled', 'Your account has been disabled. Contact your administrator.')
  return startSession(env, acct)
}

async function refresh(session, env) {
  if (!session) fail(401, 'unauthenticated', 'Sign in again.')
  const acct = await env.DB.prepare('SELECT uid, email FROM accounts WHERE uid = ?').bind(session.uid).first()
  if (!acct) fail(401, 'unauthenticated', 'This login no longer exists.')
  if (!(await isActive(env, acct.uid))) fail(403, 'account-disabled', 'Your account has been disabled. Contact your administrator.')
  return startSession(env, acct)
}

async function setup(body, env) {
  const tokenHash = await sha256Hex(String(body.token || ''))
  const acct = await env.DB.prepare('SELECT * FROM accounts WHERE setup_hash = ? AND setup_exp > ?').bind(tokenHash, Date.now()).first()
  if (!acct) fail(400, 'invalid-link', 'This setup link has expired or was already used. Ask your administrator for a new one.')
  await setPassword(env, acct.email, body.password)
  return startSession(env, acct)
}

async function change(body, session, env) {
  if (!session) fail(401, 'unauthenticated', 'Sign in again.')
  const acct = await env.DB.prepare('SELECT * FROM accounts WHERE uid = ?').bind(session.uid).first()
  if (!acct || !acct.hash || !same(await pbkdf2(String(body.old || ''), acct.salt, acct.iter), acct.hash)) fail(400, 'wrong-credentials', 'The current password is not right.')
  await setPassword(env, acct.email, body.password)
  return { ok: true }
}

// admin: make (or refresh) a login. With a password the login works at once; without, a one-time setup link token is returned.
async function invite(body, env) {
  const email = cleanEmail(body.email)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'invalid-argument', 'Enter a valid email.')
  let acct = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first()
  if (!acct) {
    const uid = body.uid || randHex(14)
    const taken = await env.DB.prepare('SELECT email FROM accounts WHERE uid = ?').bind(uid).first()
    if (taken) fail(409, 'email-already-in-use', 'That person already has a login under another email.')
    await env.DB.prepare('INSERT INTO accounts (email, uid, created) VALUES (?, ?, ?)').bind(email, uid, Date.now()).run()
    acct = { email, uid }
  } else if (body.uid && body.uid !== acct.uid) fail(409, 'email-already-in-use', 'That email already has a login.')
  if (body.password) { await setPassword(env, email, body.password); return { uid: acct.uid, email } }
  const raw = randHex(24)
  await env.DB.prepare('UPDATE accounts SET setup_hash = ?, setup_exp = ? WHERE email = ?').bind(await sha256Hex(raw), Date.now() + SETUP_DAYS * 86400e3, email).run()
  return { uid: acct.uid, email, setupToken: raw }
}

async function changeEmail(body, env) {
  const email = cleanEmail(body.email)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'invalid-argument', 'Enter a valid email.')
  if (await env.DB.prepare('SELECT 1 AS x FROM accounts WHERE email = ? AND uid <> ?').bind(email, String(body.uid)).first()) fail(409, 'email-already-in-use', 'That email already has a login.')
  await env.DB.prepare('UPDATE accounts SET email = ? WHERE uid = ?').bind(email, String(body.uid)).run()
  return { ok: true, email }
}

async function remove(body, env) {
  await env.DB.prepare('DELETE FROM accounts WHERE uid = ?').bind(String(body.uid || '')).run()
  return { ok: true }
}

// → a result object for /v1/auth/* (the router in index.js turns thrown AuthErrors into replies);
//   `session` = the verified token ({ uid, email }) or null, `ctx.role` = the caller's role from the users collection
export async function handleAuth(path, body, session, ctx, env) {
  if (!env.SESSION_SECRET) fail(500, 'not-configured', 'The server has no session secret yet.')
  switch (path) {
    case '/v1/auth/login': return login(body, env)
    case '/v1/auth/refresh': return refresh(session, env)
    case '/v1/auth/setup': return setup(body, env)
    case '/v1/auth/change': return change(body, session, env)
    case '/v1/auth/admin/invite': case '/v1/auth/admin/email': case '/v1/auth/admin/remove':
      if (!(ctx.uid && ctx.role === 'admin')) fail(403, 'permission-denied', 'Only an administrator can do that.')
      return path.endsWith('invite') ? invite(body, env) : path.endsWith('email') ? changeEmail(body, env) : remove(body, env)
    default: fail(404, 'not-found', 'Unknown endpoint')
  }
}
