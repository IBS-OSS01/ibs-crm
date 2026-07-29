import { doc, getDoc, collection, getDocs } from 'firebase/firestore'
import { db } from '../../lib/firebase-config'

export async function getUser(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function getAllUsers() {
  const snap = await getDocs(collection(db, 'users'))

  return snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))
}

export async function updateUser(uid, data) {
  throw new Error('Not implemented yet')
}

export async function deleteUser(uid) {
  throw new Error('Not implemented yet')
}
