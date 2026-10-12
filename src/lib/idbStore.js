// A tiny key-value store in the browser's IndexedDB (best effort: every call quietly does nothing if IndexedDB is unavailable).
const DB_NAME = 'ibs-data-cache', STORE = 'collections'
let dbp = null
const open = () => {
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
export const idbGet = async (key) => { try { const d = await open(); return await new Promise(res => { const q = d.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null) }) } catch { return null } }
export const idbPut = async (key, val) => { try { const d = await open(); await new Promise(res => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res() }) } catch { /* ignore */ } }
export const idbClear = async () => { try { const d = await open(); await new Promise(res => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res() }) } catch { /* ignore */ } }
