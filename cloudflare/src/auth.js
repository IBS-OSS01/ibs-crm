// Checks a Firebase Auth ID token (the app keeps using Firebase for sign-in, which is free) without any server SDK:
// the token is a signed JWT; Google publishes the public keys that verify it.
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

let keyCache = { at: 0, keys: new Map() }          // kid -> CryptoKey, kept while the Worker instance lives

const b64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return s }
const bytes = (s) => Uint8Array.from(atob(b64u(s)), c => c.charCodeAt(0))
const json = (s) => JSON.parse(new TextDecoder().decode(bytes(s)))

async function keyFor(kid) {
  if (keyCache.keys.has(kid) && Date.now() - keyCache.at < 6 * 3600e3) return keyCache.keys.get(kid)
  const res = await fetch(JWKS_URL)
  if (!res.ok) throw new Error('Could not fetch the Google signing keys')
  const { keys } = await res.json()
  const map = new Map()
  for (const k of keys) map.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
  keyCache = { at: Date.now(), keys: map }
  return map.get(kid)
}

// → { uid, email } for a valid token, or null
export async function verifyIdToken(token, projectId) {
  try {
    const [h, p, sig] = String(token || '').split('.')
    if (!h || !p || !sig) return null
    const header = json(h), claims = json(p)
    if (header.alg !== 'RS256' || !header.kid) return null
    const now = Math.floor(Date.now() / 1000)
    if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return null
    if (!claims.sub || typeof claims.sub !== 'string' || claims.exp <= now - 5 || claims.iat > now + 300) return null
    const key = await keyFor(header.kid)
    if (!key) return null
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(sig), new TextEncoder().encode(`${h}.${p}`))
    return ok ? { uid: claims.sub, email: claims.email || '' } : null
  } catch { return null }
}
