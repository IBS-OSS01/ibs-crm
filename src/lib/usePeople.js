/**
 * usePeople — shared hook that merges Firebase users + HR employees
 * into one unified "people" list, deduped by email.
 *
 * Returns: { people, loading }
 *
 * Each person object:
 * {
 *   id:          string  — preferring userId, then employeeId
 *   name:        string
 *   email:       string  (lower-cased)
 *   designation: string  — role label or job title
 *   department:  string
 *   phone:       string
 *   active:      boolean
 *   source:      'user' | 'employee' | 'both'
 *   userId:      string | null
 *   employeeId:  string | null
 * }
 */
import { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from './firebase-config'

const ROLE_LABELS = {
  admin:           'Admin',
  project_manager: 'Project Manager',
  sales_manager:   'Sales Manager',
  sales_exec:      'Sales Executive',
  warehouse:       'Warehouse',
  accounts:        'Accounts',
  hr:              'HR',
}

let _cache = null
let _cacheTime = 0
const CACHE_TTL = 60_000 // 1 minute

export function usePeople() {
  const [people, setPeople]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      // Return cached result within TTL
      if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
        setPeople(_cache)
        setLoading(false)
        return
      }
      try {
        const [usersSnap, empSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'hr_employees')),
        ])

        // Build maps keyed by lower-case email
        const userMap = {}
        usersSnap.forEach(d => {
          const u = { id: d.id, ...d.data() }
          const email = (u.email || '').toLowerCase()
          if (email) userMap[email] = u
        })

        const empMap = {}
        empSnap.forEach(d => {
          const e = { id: d.id, ...d.data() }
          const email = (e.email || '').toLowerCase()
          if (email) empMap[email] = e
        })

        const allEmails = new Set([...Object.keys(userMap), ...Object.keys(empMap)])
        const merged = []

        allEmails.forEach(email => {
          const u = userMap[email]
          const e = empMap[email]
          const source = u && e ? 'both' : u ? 'user' : 'employee'
          merged.push({
            id:          u?.id || e?.id,
            name:        u?.name || e?.name || email,
            email,
            designation: e?.designation || ROLE_LABELS[u?.role] || u?.role || '',
            department:  e?.department || '',
            phone:       e?.phone || u?.phone || '',
            active:      e ? (e.active !== false) : true,
            source,
            userId:      u?.id || null,
            employeeId:  e?.id || null,
          })
        })

        // Also include users without any email that still have a name (edge case)
        usersSnap.forEach(d => {
          const u = { id: d.id, ...d.data() }
          if (!u.email && u.name) {
            merged.push({
              id: u.id, name: u.name, email: '', designation: ROLE_LABELS[u.role] || u.role || '',
              department: '', phone: '', active: true, source: 'user', userId: u.id, employeeId: null,
            })
          }
        })

        merged.sort((a, b) => a.name.localeCompare(b.name))
        _cache = merged
        _cacheTime = Date.now()
        if (active) { setPeople(merged); setLoading(false) }
      } catch (e) {
        console.error('[usePeople]', e)
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  return { people, loading }
}

/** Invalidate the in-memory cache (call after creating/editing users or employees) */
export function invalidatePeopleCache() {
  _cache = null
  _cacheTime = 0
}
