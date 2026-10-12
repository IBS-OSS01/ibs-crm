// How a write changes a stored document. Pure functions (no Cloudflare APIs) so they can be tested in Node.
//
// A write op is { t: 'set' | 'update' | 'delete', data, merge }. Values may be the three Firestore-style markers the client sends:
//   { __op: 'ts' }          server time (ISO string)
//   { __op: 'del' }         remove this field
//   { __op: 'inc', n: 5 }   add n to the number already there

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isMarker = (v) => isObj(v) && typeof v.__op === 'string'
export const hasMarker = (v) => (isMarker(v) ? true : Array.isArray(v) ? v.some(hasMarker) : isObj(v) ? Object.values(v).some(hasMarker) : false)

// the real value of `v`, given what is stored there now (`old`); undefined = leave the field out
function resolve(v, old, now) {
  if (isMarker(v)) {
    if (v.__op === 'ts') return now
    if (v.__op === 'del') return undefined
    if (v.__op === 'inc') return (typeof old === 'number' ? old : 0) + (Number(v.n) || 0)
    return undefined
  }
  if (Array.isArray(v)) return v.map(x => resolve(x, undefined, now)).filter(x => x !== undefined)
  if (isObj(v)) { const o = {}; for (const [k, x] of Object.entries(v)) { const r = resolve(x, isObj(old) ? old[k] : undefined, now); if (r !== undefined) o[k] = r } return o }
  return v
}

// set(…, { merge: true }): maps merge field by field, everything else is replaced
function deepMerge(base, patch, now) {
  const out = { ...(isObj(base) ? base : {}) }
  for (const [k, v] of Object.entries(patch || {})) {
    if (isMarker(v)) { const r = resolve(v, out[k], now); if (r === undefined) delete out[k]; else out[k] = r }
    else if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v, now)
    else { const r = resolve(v, out[k], now); if (r === undefined) delete out[k]; else out[k] = r }
  }
  return out
}

function setPath(obj, path, v, now) {
  const keys = path.split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) { if (!isObj(cur[keys[i]])) cur[keys[i]] = {}; cur = cur[keys[i]] }
  const last = keys[keys.length - 1]
  const r = resolve(v, cur[last], now)
  if (r === undefined) delete cur[last]; else cur[last] = r
}

export class WriteError extends Error { constructor(code, message) { super(message || code); this.code = code } }

// → the document as it should be stored, or null when the op deletes it. `existing` is the stored object, or null if there is none.
export function applyOp(existing, op, now) {
  if (op.t === 'delete') return null
  if (op.t === 'set') {
    if (op.merge) return deepMerge(existing, op.data, now)
    return resolve(op.data || {}, undefined, now)
  }
  if (op.t === 'update') {
    if (!existing) throw new WriteError('not-found', 'No document to update')
    const out = JSON.parse(JSON.stringify(existing))
    for (const [k, v] of Object.entries(op.data || {})) {
      if (k.includes('.')) setPath(out, k, v, now)
      else { const r = resolve(v, out[k], now); if (r === undefined) delete out[k]; else out[k] = r }
    }
    return out
  }
  throw new WriteError('invalid-argument', 'Unknown write ' + op.t)
}

// the keys whose value differs between two stored documents (for the public task-link rule)
export function changedKeys(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  return [...keys].filter(k => JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k]))
}
