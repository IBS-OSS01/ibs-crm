// Firestore-style queries evaluated in the browser over documents the app already holds (pure functions, no Firebase).
// Document = { id, data }. Constraints come from where() / orderBy() / limit(): { k: 'where', f, op, v } | { k: 'orderBy', f, dir } | { k: 'limit', n }.

const rank = (v) => (v === null ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : typeof v === 'string' ? 3 : Array.isArray(v) ? 4 : 5)
const same = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b))

export const fieldOf = (data, path) => {
  if (!path.includes('.')) return data ? data[path] : undefined
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), data)
}

// the order Firestore uses: by type first (null < boolean < number < string < array < map), then by value
export function compareValues(a, b) {
  const ra = rank(a), rb = rank(b)
  if (ra !== rb) return ra < rb ? -1 : 1
  if (ra === 2 || ra === 3 || ra === 1) return a < b ? -1 : a > b ? 1 : 0
  return 0
}

export function matches(data, c) {
  const v = fieldOf(data, c.f)
  switch (c.op) {
    case '==': return v !== undefined && same(v, c.v)
    case '!=': return v !== undefined && !same(v, c.v)
    case '<': return v !== undefined && rank(v) === rank(c.v) && compareValues(v, c.v) < 0
    case '<=': return v !== undefined && rank(v) === rank(c.v) && compareValues(v, c.v) <= 0
    case '>': return v !== undefined && rank(v) === rank(c.v) && compareValues(v, c.v) > 0
    case '>=': return v !== undefined && rank(v) === rank(c.v) && compareValues(v, c.v) >= 0
    case 'in': return v !== undefined && Array.isArray(c.v) && c.v.some(x => same(v, x))
    case 'not-in': return v !== undefined && Array.isArray(c.v) && !c.v.some(x => same(v, x))
    case 'array-contains': return Array.isArray(v) && v.some(x => same(x, c.v))
    case 'array-contains-any': return Array.isArray(v) && Array.isArray(c.v) && c.v.some(x => v.some(y => same(x, y)))
    default: throw new Error('Unsupported query operator ' + c.op)
  }
}

export function runQuery(docs, constraints = []) {
  let out = docs.filter(d => constraints.every(c => c.k !== 'where' || matches(d.data, c)))
  const orders = constraints.filter(c => c.k === 'orderBy')
  if (orders.length) {
    out = out.filter(d => orders.every(o => fieldOf(d.data, o.f) !== undefined))        // a document without the field is not in an ordered query
    out.sort((a, b) => {
      for (const o of orders) { const r = compareValues(fieldOf(a.data, o.f), fieldOf(b.data, o.f)); if (r) return o.dir === 'desc' ? -r : r }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  } else out = out.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lim = constraints.find(c => c.k === 'limit')
  return lim ? out.slice(0, lim.n) : out
}

// 20-character random ids, like Firestore's
export function autoId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(20)
  ;(globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

// markers the Worker understands (server time, delete a field, add to a number)
export const hasMarker = (v) => (v && typeof v === 'object' ? (typeof v.__op === 'string' ? true : Array.isArray(v) ? v.some(hasMarker) : Object.values(v).some(hasMarker)) : false)
