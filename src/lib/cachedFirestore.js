// The one place the app gets its database functions from: Cloudflare Workers + D1 (./cfBackend.js). It keeps the familiar function names
// (collection, doc, getDocs, addDoc, updateDoc, writeBatch, runTransaction, onSnapshot …) so pages did not need rewriting.
// Firebase is used only for sign-in (Auth) and for hosting the website — never for data.
import * as b from './cfBackend.js'

export const usingCloudflare = true

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
