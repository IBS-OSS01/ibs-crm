// The one place the app gets its database functions from. Two interchangeable backends with the same names:
//   • ./cfBackend.js        — Cloudflare Workers + D1 (free, generous limits)
//   • ./firestoreBackend.js — Firebase Firestore with a read cache (free plan: 50k reads / 20k writes a day for everybody)
// Which one: build-time VITE_BACKEND=cloudflare (see .env.production), or for one browser localStorage 'ibs_backend' = 'cf' | 'firestore'
// (handy to try Cloudflare as an admin before switching everyone).
import * as fsb from './firestoreBackend.js'
import * as cfb from './cfBackend.js'

const pick = () => {
  try { const f = localStorage.getItem('ibs_backend'); if (f === 'cf') return true; if (f === 'firestore') return false } catch { /* no storage */ }
  return (import.meta.env && import.meta.env.VITE_BACKEND) === 'cloudflare'
}
export const usingCloudflare = pick()
const b = usingCloudflare ? cfb : fsb

export const collection = b.collection
export const doc = b.doc
export const getDocs = b.getDocs
export const getDoc = b.getDoc
export const addDoc = b.addDoc
export const setDoc = b.setDoc
export const updateDoc = b.updateDoc
export const deleteDoc = b.deleteDoc
export const query = b.query
export const where = b.where
export const orderBy = b.orderBy
export const limit = b.limit
export const writeBatch = b.writeBatch
export const runTransaction = b.runTransaction
export const onSnapshot = b.onSnapshot
export const serverTimestamp = b.serverTimestamp
export const deleteField = b.deleteField
export const increment = b.increment
export const getCountFromServer = b.getCountFromServer
export const getFirestore = b.getFirestore
export const getCollectionCached = b.getCollectionCached
export const getCachedSnap = b.getCachedSnap
export const clearDataCache = b.clearDataCache
export const dataCacheInfo = b.dataCacheInfo
export const dropCollectionCache = b.dropCollectionCache
