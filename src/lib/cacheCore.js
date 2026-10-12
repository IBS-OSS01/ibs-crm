// Pure helpers behind the Firestore read cache (no Firebase imports, so they can be tested on their own).

// True when a value is plain data — numbers, strings, booleans, null, arrays and plain objects. Anything else (a Timestamp,
// serverTimestamp() / increment() / deleteField() sentinels, a DocumentReference, a Date) cannot be copied into the cache
// as written, so the caller re-reads that one document instead.
export function isPlain(v) {
  if (v === null) return true
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  if (t === 'undefined') return true
  if (Array.isArray(v)) return v.every(isPlain)
  if (t === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.values(v).every(isPlain)
  return false
}

// updateDoc(ref, { 'a.b': 1 }) addresses a nested field; a dotted key is not a plain top-level merge.
export const hasDottedKey = (data) => data && typeof data === 'object' && Object.keys(data).some(k => k.includes('.'))

// What the document looks like in the cache after a write. `id` first, like { id: d.id, ...d.data() } at load time.
export function patchedDoc(existing, id, data, { merge = false } = {}) {
  const clean = Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v !== undefined))
  return merge ? { ...(existing || {}), ...clean, id: (existing && existing.id) || id } : { id, ...clean }
}

// Is a copy fetched at `at` still good under this time-to-live?
export const isFresh = (at, ttl, now = Date.now()) => typeof at === 'number' && now - at < ttl
