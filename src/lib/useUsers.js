import { useState, useEffect } from 'react'
import {
  collection,
  getDocs,
  query,
  orderBy
} from 'firebase/firestore'
import { db } from './firebase-config'

let cachedUsers = null
let loadingPromise = null

async function loadUsers() {
  if (cachedUsers) return cachedUsers

  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    const q = query(collection(db, 'users'), orderBy('name'))
    const snap = await getDocs(q)

    cachedUsers = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))

    return cachedUsers
  })()

  return loadingPromise
}

export async function prefetchUsers() {
  try {
    await loadUsers()
  } catch (err) {
    console.error('prefetchUsers()', err)
  }
}

export function useUsers() {
  const [users, setUsers] = useState(cachedUsers || [])
  const [usersReady, setUsersReady] = useState(!!cachedUsers)

  useEffect(() => {
    let mounted = true

    loadUsers()
      .then(data => {
        if (!mounted) return
        setUsers(data)
        setUsersReady(true)
      })
      .catch(err => {
        console.error(err)
        setUsersReady(true)
      })

    return () => {
      mounted = false
    }
  }, [])

  const refreshUsers = async () => {
    cachedUsers = null
    loadingPromise = null

    const data = await loadUsers()

    setUsers(data)
    setUsersReady(true)
  }

  return {
    users,
    usersReady,
    refreshUsers
  }
}