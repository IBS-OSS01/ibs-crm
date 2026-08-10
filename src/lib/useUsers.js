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
    // Load users and roles together — roles gives us the *current* human
    // name for each role id (e.g. "sales_director" -> "Sales Director"),
    // so a rename in Admin > Roles is reflected everywhere immediately
    // instead of every screen guessing a label from the id string.
    const [usersSnap, rolesSnap] = await Promise.all([
      getDocs(query(collection(db, 'users'), orderBy('name'))),
      getDocs(collection(db, 'roles')),
    ])

    const roleNameById = {}
    rolesSnap.forEach(d => { roleNameById[d.id] = d.data().name || d.id })

    cachedUsers = usersSnap.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        roleName: roleNameById[data.role] || data.role || '',
      }
    })

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
