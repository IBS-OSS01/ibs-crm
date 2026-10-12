// Firestore for the free plan (50,000 reads a day).
//
// Every file in the app imports its Firestore functions from here instead of 'firebase/firestore'. Nothing changes for them,
// except that:
//   • getCollectionCached(name) reads a whole collection ONCE and keeps it in memory and in the browser (IndexedDB), so moving
//     between pages, reloading the page and reopening the app cost no reads while the copy is fresh;
//   • every write the app makes (addDoc / setDoc / updateDoc / deleteDoc / writeBatch / runTransaction) also updates that copy
//     — from the data just written, or with a one-document read when that is not possible — so the copy never goes stale
//     because of this app's own saves, and a save does not force a re-read of the whole collection;
//   • a copy is re-read in full only when it is older than its time-to-live, or when the user presses "Refresh data".
// Changes made from another device or user show up after the time-to-live (6 h for finance data, 15 min for the rest) or a refresh.
import * as sdk from 'firebase/firestore'
import { auth, db } from './firebase-config'
import { isPlain, hasDottedKey, patchedDoc, isFresh } from './cacheCore.js'

export * from 'firebase/firestore'          // everything else is passed through unchanged; the writes below replace the originals

const TTL_FINANCE = 6 * 60 * 60 * 1000
const TTL_OTHER = 15 * 60 * 1000
const ttlOf = (name) => (/^finance_/.test(name) ? TTL_FINANCE : TTL_OTHER)

const mem = new Map()             // collection -> { at, map: Map(id -> doc), arr: doc[] | null }
const inflight = new Map()        // collection -> Promise (several pages asking at once share one read)
const timers = new Map()          // collection -> save timer
let ownerUid = null

// ── IndexedDB (best effort — the app works without it, it just reads more) ─────────────────────────────────────────────────
const DB_NAME = 'ibs-data-cache', STORE = 'collections'
let dbp = null
const openIdb = () => {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'))
      const r = indexedDB.open(DB_NAME, 1)
      r.onupgradeneeded = () => r.result.createObjectStore(STORE)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    } catch (e) { reject(e) }
  })
  dbp.catch(() => { dbp = null })
  return dbp
}
const idbGet = async (key) => { try { const d = await openIdb(); return await new Promise(res => { const q = d.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null) }) } catch { return null } }
const idbPut = async (key, val) => { try { const d = await openIdb(); await new Promise(res => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res() }) } catch { /* ignore */ } }
const idbClear = async () => { try { const d = await openIdb(); await new Promise(res => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res() }) } catch { /* ignore */ } }

// the copy belongs to whoever is signed in: another person on this browser must not see it, and signing out wipes it
auth.onAuthStateChanged(u => {
  const uid = u?.uid || null
  if (uid !== ownerUid) { mem.clear(); inflight.clear(); if (ownerUid) idbClear() }
  ownerUid = uid
})

const arrOf = (e) => { if (!e.arr) e.arr = [...e.map.values()]; return e.arr.slice() }

function saveSoon(name) {
  clearTimeout(timers.get(name))
  timers.set(name, setTimeout(async () => {
    const e = mem.get(name), uid = auth.currentUser?.uid
    if (!e || !uid) return
    const docs = [...e.map.values()]
    if (!docs.every(isPlain)) return                       // e.g. documents holding Timestamps: keep those in memory only
    await idbPut(`${uid}|${name}`, { at: e.at, docs })
  }, 1500))
}

// ── reading ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// All documents of a top-level collection, as [{ id, ...data }]. Throws like getDocs does (e.g. permission-denied).
export async function getCollectionCached(name, { force = false } = {}) {
  const have = mem.get(name)
  if (!force && have && isFresh(have.at, ttlOf(name))) return arrOf(have)
  if (inflight.has(name)) return inflight.get(name)
  const p = (async () => {
    const uid = auth.currentUser?.uid
    if (!force && uid) {
      const saved = await idbGet(`${uid}|${name}`)
      if (saved && Array.isArray(saved.docs) && isFresh(saved.at, ttlOf(name))) {
        const e = { at: saved.at, map: new Map(saved.docs.map(d => [d.id, d])), arr: null }
        mem.set(name, e)
        return arrOf(e)
      }
    }
    const snap = await sdk.getDocs(sdk.collection(db, name))
    const map = new Map()
    snap.forEach(d => map.set(d.id, { id: d.id, ...d.data() }))
    const e = { at: Date.now(), map, arr: null }
    mem.set(name, e)
    saveSoon(name)
    return arrOf(e)
  })().finally(() => inflight.delete(name))
  inflight.set(name, p)
  return p
}

export const dropCollectionCache = (name) => { mem.delete(name) }

// Forget every copy (memory and browser) — the next read of each collection goes to the server.
export async function clearDataCache() { mem.clear(); inflight.clear(); await idbClear() }

// When the oldest and newest copies were read from the server (for the "Refresh data" tooltip).
export function dataCacheInfo() {
  const ats = [...mem.values()].map(e => e.at).filter(Boolean)
  return { collections: mem.size, oldest: ats.length ? Math.min(...ats) : null, newest: ats.length ? Math.max(...ats) : null }
}

// ── keeping the copy in step with this app's own writes ────────────────────────────────────────────────────────────────────
const topName = (path) => (path && !String(path).includes('/') ? path : null)
const refName = (ref) => topName(ref?.parent?.path)
const colName = (cref) => topName(cref?.path)

function put(name, id, data, opts) {
  const e = mem.get(name)
  if (!e) return                                           // not cached (yet) — nothing to keep in step
  e.map.set(id, patchedDoc(e.map.get(id), id, data, opts))
  e.arr = null; saveSoon(name)
}
function remove(name, id) {
  const e = mem.get(name); if (!e) return
  e.map.delete(id); e.arr = null; saveSoon(name)
}
// one-document read: used when what was written cannot be copied as is (server timestamps, increments, dotted field paths…)
async function reread(ref) {
  const name = refName(ref); if (!name || !mem.has(name)) return
  try {
    const s = await sdk.getDoc(ref)
    if (s.exists()) put(name, ref.id, s.data(), { merge: false }); else remove(name, ref.id)
  } catch { mem.delete(name) }                             // could not confirm → read the whole collection next time
}
// set(): replaces the document, or merges when { merge: true }; mergeFields is rare enough to just re-read
const syncSet = (ref, data, options) => (options && options.mergeFields ? sync(ref, undefined, {}) : sync(ref, data, { merge: !!(options && options.merge) }))
const safe = async (fn) => { try { await fn() } catch (e) { console.warn('[cache] could not update the local copy; it will be re-read:', e); try { mem.clear() } catch { /* ignore */ } } }
const sync = (ref, data, opts) => safe(() => syncNow(ref, data, opts))
const syncNow = (ref, data, opts) => {
  const name = refName(ref); if (!name || !mem.has(name)) return Promise.resolve()
  if (data !== undefined && isPlain(data) && !hasDottedKey(data)) { put(name, ref.id, data, opts); return Promise.resolve() }
  return reread(ref)
}

export async function addDoc(cref, data) {
  const ref = await sdk.addDoc(cref, data)
  if (colName(cref)) await sync(ref, data, { merge: false })
  return ref
}
export async function setDoc(ref, data, options) {
  const out = await sdk.setDoc(ref, data, options)
  await syncSet(ref, data, options)
  return out
}
export async function updateDoc(ref, ...args) {
  const out = await sdk.updateDoc(ref, ...args)
  await sync(ref, args.length === 1 ? args[0] : undefined, { merge: true })      // (field, value, …) form → re-read
  return out
}
export async function deleteDoc(ref) {
  const out = await sdk.deleteDoc(ref)
  await safe(async () => { const name = refName(ref); if (name) remove(name, ref.id) })
  return out
}

export function writeBatch(firestore) {
  const b = sdk.writeBatch(firestore)
  const ops = []
  const w = {
    set(ref, data, options) { b.set(ref, data, options); ops.push({ kind: 'set', ref, data, options }); return w },
    update(ref, ...args) { b.update(ref, ...args); ops.push({ kind: 'update', ref, data: args.length === 1 ? args[0] : undefined }); return w },
    delete(ref) { b.delete(ref); ops.push({ kind: 'delete', ref }); return w },
    async commit() {
      const out = await b.commit()
      for (const o of ops) {
        if (o.kind === 'delete') await safe(async () => { const n = refName(o.ref); if (n) remove(n, o.ref.id) })
        else if (o.kind === 'set') await syncSet(o.ref, o.data, o.options)
        else await sync(o.ref, o.data, { merge: true })
      }
      return out
    },
  }
  return w
}

export async function runTransaction(firestore, updateFn, options) {
  let ops = []
  const out = await sdk.runTransaction(firestore, (tx) => {
    ops = []                                               // the function may run again on contention
    const t = {
      get: (...a) => tx.get(...a),
      set(ref, data, o) { tx.set(ref, data, o); ops.push({ kind: 'set', ref, data, options: o }); return t },
      update(ref, ...args) { tx.update(ref, ...args); ops.push({ kind: 'update', ref, data: args.length === 1 ? args[0] : undefined }); return t },
      delete(ref) { tx.delete(ref); ops.push({ kind: 'delete', ref }); return t },
    }
    return updateFn(t)
  }, options)
  for (const o of ops) {
    if (o.kind === 'delete') await safe(async () => { const n = refName(o.ref); if (n) remove(n, o.ref.id) })
    else if (o.kind === 'set') await syncSet(o.ref, o.data, o.options)
    else await sync(o.ref, o.data, { merge: true })
  }
  return out
}

// getDocs(collection(db, name)) look-alike served from the cache: { docs: [{ id, data() }], size, empty, forEach }.
export async function getCachedSnap(name, opts) {
  const arr = await getCollectionCached(name, opts)
  const docs = arr.map(({ id, ...rest }) => ({ id, data: () => rest, exists: () => true }))
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) }
}
