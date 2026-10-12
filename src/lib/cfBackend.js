// The app's data layer on Cloudflare (Workers + D1, free) — the same function names the app always used with Firestore
// (collection, doc, getDocs, addDoc, updateDoc, writeBatch, runTransaction, onSnapshot …), so no page needed rewriting.
//
// How it stays cheap and fresh:
//   • A collection is downloaded once and kept in memory and in the browser (IndexedDB).
//   • Before it is used again the app asks the Worker one tiny question — "has this collection changed?" (a stamp that changes
//     with every write). Unchanged → nothing is downloaded. Changed (by anyone, on any device) → it is read again. So the data is
//     always current, and a normal page costs one small request instead of thousands of reads.
//   • The app's own saves update the local copy at once (and keep the stamp in step), so they never force a re-read.
//   • "Live" listeners (onSnapshot) are plain polling of those stamps, every 30 s while the tab is visible.
import { auth } from './firebase-config'
import { API_URL } from './apiConfig.js'
import { runQuery, autoId, hasMarker } from './queryEval.js'
import { idbGet, idbPut, idbClear } from './idbStore.js'

const CHECK_MS = 15_000            // a copy checked this recently is used as is
const POLL_MS = 30_000             // live listeners look for changes this often
const MAX_OPS = 30                 // writes per request (the Worker's limit)
const HEAVY = new Set(['finance_attachments'])   // collections whose documents carry file bytes: never downloaded as a whole

// ── errors ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function fbError(code, message) { const e = new Error(message || code); e.name = 'FirebaseError'; e.code = code; return e }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── talking to the Worker ────────────────────────────────────────────────────────────────────────────────────────────────────
async function api(path, body, { retry = true } = {}) {
  let token = null
  try { await (auth.authStateReady ? auth.authStateReady() : Promise.resolve()); token = auth.currentUser ? await auth.currentUser.getIdToken() : null } catch { /* signed out */ }
  const send = () => fetch(API_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
  // reads are repeated (up to 3 tries) on a network failure or a temporary server error (5xx); writes never are
  let res, json
  for (let attempt = 0; ; attempt++) {
    try {
      res = await send()
      try { json = await res.json() } catch { json = null }
      if (res.status < 500 || !retry || attempt >= 2) break
    } catch (e) {
      if (!retry || attempt >= 2) throw fbError('unavailable', 'Could not reach the server — check your connection')
    }
    await sleep(600 * (attempt + 1))
  }
  if (!json) throw fbError('internal', 'The server sent an unreadable answer')
  if (!res.ok) throw fbError(json?.error?.code || 'internal', json?.error?.message || `Request failed (${res.status})`)
  return json
}

// ── the local copy ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// entry: { stamp, checkedAt, fetchedAt, docs: Map(id -> { v, data }), arr: [...]|null }
const mem = new Map()
const inflight = new Map()
const listeners = new Map()      // collection -> Set(fn)
const saveTimers = new Map()
let ownerUid = null

auth.onAuthStateChanged(u => {
  const uid = u?.uid || null
  if (uid !== ownerUid) { mem.clear(); inflight.clear(); if (ownerUid) idbClear() }
  ownerUid = uid
})

const merged = (id, e) => ({ id, ...e.data })
const arrOf = (entry) => { if (!entry.arr) entry.arr = [...entry.docs].map(([id, x]) => merged(id, x)); return entry.arr.slice() }
const clone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)))

function saveSoon(name) {
  clearTimeout(saveTimers.get(name))
  saveTimers.set(name, setTimeout(() => {
    const e = mem.get(name), uid = auth.currentUser?.uid
    if (!e || !uid || e.stamp < 0) return
    idbPut(`${uid}|${name}`, { stamp: e.stamp, fetchedAt: e.fetchedAt, docs: [...e.docs].map(([id, x]) => [id, x.v, x.data]) })
  }, 1500))
}

async function loadSaved(name) {
  const uid = auth.currentUser?.uid
  if (!uid) return null
  const s = await idbGet(`${uid}|${name}`)
  if (!s || !Array.isArray(s.docs)) return null
  const e = { stamp: s.stamp, checkedAt: 0, fetchedAt: s.fetchedAt || 0, docs: new Map(s.docs.map(([id, v, data]) => [id, { v, data }])), arr: null }
  mem.set(name, e)
  return e
}

// one stamp request for every collection asked about in the same instant
let pending = null
function stampOf(name) {
  return new Promise((resolve, reject) => {
    if (!pending) { pending = { names: new Set(), waiters: [] }; setTimeout(flushStamps, 5) }
    pending.names.add(name); pending.waiters.push({ name, resolve, reject })
  })
}
async function flushStamps() {
  const p = pending; pending = null
  try { const { stamps } = await api('/v1/stamps', { cols: [...p.names] }); p.waiters.forEach(w => w.resolve(stamps[w.name])) }
  catch (e) { p.waiters.forEach(w => w.reject(e)) }
}

async function fetchAll(name, { eq, omit } = {}) {
  const docs = new Map(); let after = null, stamp = null
  do {
    const r = await api('/v1/list', { col: name, ...(eq ? { eq } : {}), ...(omit ? { omit } : {}), ...(after ? { after } : {}) })
    if (stamp === null) stamp = r.stamp                      // read before the data: if anything changes meanwhile the next check sees a newer stamp
    for (const d of r.docs) docs.set(d.id, { v: d.v, data: d.data })
    after = r.next
  } while (after)
  return { docs, stamp }
}

// All documents of a collection as [{ id, ...data }], from the local copy when the Worker says nothing changed.
export async function getCollectionCached(name, { force = false } = {}) {
  if (HEAVY.has(name)) throw fbError('invalid-argument', `${name} holds files and is never read as a whole`)
  if (inflight.has(name)) return inflight.get(name)
  const p = (async () => {
    let e = mem.get(name) || await loadSaved(name)
    if (e && !force && Date.now() - e.checkedAt < CHECK_MS) return arrOf(e)
    if (e && !force) {
      const s = await stampOf(name)
      if (s === e.stamp) { e.checkedAt = Date.now(); return arrOf(e) }
    }
    const { docs, stamp } = await fetchAll(name)
    e = { stamp, checkedAt: Date.now(), fetchedAt: Date.now(), docs, arr: null }
    mem.set(name, e); saveSoon(name)
    return arrOf(e)
  })().finally(() => inflight.delete(name))
  inflight.set(name, p)
  return p
}

export const dropCollectionCache = (name) => { mem.delete(name) }
export async function clearDataCache() { mem.clear(); inflight.clear(); await idbClear() }
export function dataCacheInfo() {
  const ats = [...mem.values()].map(e => e.fetchedAt).filter(Boolean)
  return { collections: mem.size, oldest: ats.length ? Math.min(...ats) : null, newest: ats.length ? Math.max(...ats) : null }
}

// ── references, queries, snapshots ───────────────────────────────────────────────────────────────────────────────────────────
export const getFirestore = () => ({ type: 'db' })
export const collection = (_db, name) => ({ type: 'collection', id: name, path: name })
const docRef = (col, id) => ({ type: 'doc', id, path: `${col}/${id}`, parent: { type: 'collection', id: col, path: col } })
export function doc(first, ...rest) {
  if (first && first.type === 'collection') return docRef(first.path, rest[0] || autoId())
  return docRef(rest[0], rest[1] || autoId())
}
export const where = (f, op, v) => ({ k: 'where', f, op, v })
export const orderBy = (f, dir = 'asc') => ({ k: 'orderBy', f, dir })
export const limit = (n) => ({ k: 'limit', n })
export const query = (target, ...constraints) => ({ type: 'query', col: target.col || target.path, constraints: [...(target.constraints || []), ...constraints] })
export const serverTimestamp = () => ({ __op: 'ts' })
export const deleteField = () => ({ __op: 'del' })
export const increment = (n) => ({ __op: 'inc', n })

const docSnap = (col, id, entry) => ({ id, ref: docRef(col, id), exists: () => !!entry, data: () => (entry ? clone(entry.data) : undefined), get: (f) => (entry ? clone(entry.data)[f] : undefined) })
const querySnap = (col, items) => {
  const docs = items.map(d => docSnap(col, d.id, { data: d.data }))
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn), docChanges: () => docs.map(d => ({ type: 'added', doc: d })) }
}
const colOf = (t) => (t.type === 'query' ? t.col : t.type === 'doc' ? t.parent.path : t.path)

export async function getDocs(target) {
  const col = colOf(target), cs = target.constraints || []
  if (HEAVY.has(col)) {
    const eqs = cs.filter(c => c.k === 'where' && c.op === '==')
    if (eqs.length !== cs.length) throw fbError('invalid-argument', `${col} can only be queried with == conditions`)
    const { docs } = await fetchAll(col, eqs.length ? { eq: Object.fromEntries(eqs.map(c => [c.f, c.v])) } : { omit: ['data'] })
    return querySnap(col, [...docs].map(([id, x]) => ({ id, data: x.data })))
  }
  await getCollectionCached(col)                                    // makes sure the local copy is current
  const items = [...mem.get(col).docs].map(([id, x]) => ({ id, data: x.data }))
  return querySnap(col, runQuery(items, cs))
}
export const getCachedSnap = async (name, opts) => {
  const arr = await getCollectionCached(name, opts)
  return querySnap(name, arr.map(({ id, ...data }) => ({ id, data })))
}

export async function getDoc(ref) {
  const col = ref.parent.path
  const e = mem.get(col)
  if (e && Date.now() - e.checkedAt < CHECK_MS) return docSnap(col, ref.id, e.docs.get(ref.id))
  const r = await api('/v1/get', { col, id: ref.id })
  return docSnap(col, ref.id, r.doc ? { data: r.doc.data } : null)
}

export async function getCountFromServer(target) {
  const { n } = await api('/v1/count', { col: colOf(target) })
  return { data: () => ({ count: n }) }
}

// ── live listeners (polling) ─────────────────────────────────────────────────────────────────────────────────────────────────
let pollTimer = null
function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    const names = [...listeners.keys()]
    if (!names.length) { clearInterval(pollTimer); pollTimer = null; return }
    try {
      const { stamps } = await api('/v1/stamps', { cols: names }, { retry: false })
      for (const n of names) { const e = mem.get(n); if (e && stamps[n] !== e.stamp) { const { docs, stamp } = await fetchAll(n); mem.set(n, { stamp, checkedAt: Date.now(), fetchedAt: Date.now(), docs, arr: null }); saveSoon(n); notify(n) } }
    } catch { /* offline — try again next time */ }
  }, POLL_MS)
}
const notify = (col) => (listeners.get(col) || new Set()).forEach(fn => { try { fn() } catch { /* a listener's own error */ } })

export function onSnapshot(target, cb, errCb) {
  let live = true
  const col = colOf(target)
  const run = async () => { try { const snap = target.type === 'doc' ? await getDoc(target) : await getDocs(target); if (live) cb(snap) } catch (e) { if (live) errCb?.(e) } }
  if (!HEAVY.has(col)) { if (!listeners.has(col)) listeners.set(col, new Set()); listeners.get(col).add(run); startPolling() }
  run()
  return () => { live = false; const s = listeners.get(col); if (s) { s.delete(run); if (!s.size) listeners.delete(col) } }
}

// ── writes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const clean = (data) => JSON.parse(JSON.stringify(data ?? {}))          // drops undefined, turns Dates into ISO strings

// keep the local copy in step with what the Worker just stored
function applyResult(ops, res) {
  const byKey = new Map((res.docs || []).map(d => [`${d.col}/${d.id}`, d]))
  const cols = [...new Set(ops.map(o => o.col))]
  for (const col of cols) {
    const e = mem.get(col); if (!e) continue
    const st = res.stamps?.[col]
    const inSync = st && e.stamp === st.prev
    for (const o of ops.filter(x => x.col === col)) {
      if (o.t === 'delete') e.docs.delete(o.id)
      else {
        const back = byKey.get(`${col}/${o.id}`)
        if (back) e.docs.set(o.id, { v: back.v, data: back.data })
        else if (!hasMarker(o.data)) e.docs.set(o.id, { v: (e.docs.get(o.id)?.v || 0) + 1, data: o.data })
      }
    }
    e.arr = null
    if (inSync) { e.stamp = st.u; e.checkedAt = Date.now() } else e.checkedAt = 0      // someone else wrote too: look again next time
    saveSoon(col); notify(col)
  }
}

async function send(ops, expect) {
  if (!ops.length) return
  if (expect && ops.length > MAX_OPS) throw fbError('invalid-argument', `A transaction can change at most ${MAX_OPS} documents`)
  for (let i = 0; i < ops.length; i += MAX_OPS) {            // a batch bigger than one request is applied in several; each request is atomic
    const part = ops.slice(i, i + MAX_OPS)
    const res = await api('/v1/commit', { ops: part, ...(expect ? { expect } : {}) }, { retry: false })
    applyResult(part, res)
  }
}
const setOp = (ref, data, options) => ({ t: 'set', col: ref.parent.path, id: ref.id, data: clean(data), merge: !!(options && (options.merge || options.mergeFields)) })
const updateOp = (ref, args) => {
  let data = args[0]
  if (typeof data === 'string') { data = {}; for (let i = 0; i < args.length; i += 2) data[args[i]] = args[i + 1] }
  return { t: 'update', col: ref.parent.path, id: ref.id, data: clean(data) }
}
const deleteOp = (ref) => ({ t: 'delete', col: ref.parent.path, id: ref.id })

export async function addDoc(cref, data) { const ref = doc(cref); await send([setOp(ref, data)]); return ref }
export async function setDoc(ref, data, options) { await send([setOp(ref, data, options)]) }
export async function updateDoc(ref, ...args) { await send([updateOp(ref, args)]) }
export async function deleteDoc(ref) { await send([deleteOp(ref)]) }

export function writeBatch() {
  const ops = []
  const b = {
    set(ref, data, options) { ops.push(setOp(ref, data, options)); return b },
    update(ref, ...args) { ops.push(updateOp(ref, args)); return b },
    delete(ref) { ops.push(deleteOp(ref)); return b },
    commit: () => send(ops.splice(0, ops.length)),
  }
  return b
}

export async function runTransaction(_db, fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const reads = new Map(), ops = []
    const tx = {
      async get(ref) { const col = ref.parent.path; const r = await api('/v1/get', { col, id: ref.id }); reads.set(`${col}/${ref.id}`, { col, id: ref.id, v: r.doc?.v || 0 }); return docSnap(col, ref.id, r.doc ? { data: r.doc.data } : null) },
      set(ref, data, options) { ops.push(setOp(ref, data, options)); return tx },
      update(ref, ...args) { ops.push(updateOp(ref, args)); return tx },
      delete(ref) { ops.push(deleteOp(ref)); return tx },
    }
    const out = await fn(tx)
    try { await send(ops, [...reads.values()]); return out }
    catch (e) { if (e.code === 'aborted' && attempt < 4) { await sleep(50 * (attempt + 1)); continue } throw e }
  }
}

// ── one-time move of existing data ───────────────────────────────────────────────────────────────────────────────────────────
// Writes documents (as read from the old database) under their original ids. Requests are cut by count AND size, because a few
// documents carry file bytes.
export async function importDocs(col, docs, onProgress) {
  let part = [], size = 0, done = 0
  const flush = async () => {
    if (!part.length) return
    const res = await api('/v1/commit', { ops: part }, { retry: false })
    applyResult(part, res); done += part.length; part = []; size = 0
    onProgress?.(done)
  }
  for (const d of docs) {
    const op = { t: 'set', col, id: d.id, data: clean(d.data), merge: false }
    const n = JSON.stringify(op).length
    if (part.length >= MAX_OPS || (part.length && size + n > 2_500_000)) await flush()
    part.push(op); size += n
  }
  await flush()
  return done
}
export const countInCloudflare = async (col) => (await api('/v1/count', { col })).n
export async function idsInCloudflare(col) { const { docs } = await fetchAll(col); return new Set(docs.keys()) }
