/**
 * IBS CRM — Permission Layer v1
 * src/auth/AuthContext.jsx
 *
 * Canonical auth context. Loads the Firebase Auth user and their Firestore
 * profile (users/{uid}), merges them into `currentUser`, and exposes permission
 * helpers backed by src/auth/permissions.js.
 *
 * src/context/AuthContext.jsx re-exports everything from here so all existing
 * imports continue to work without any changes to UI screens.
 */

import React, { createContext, useContext, useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase-config'
import { hasPermission, canView, canEdit, MODULES, RIGHTS } from './permissions'
import { prefetchUsers } from '../lib/useUsers'

// ── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext(null)

// Convert a role display name to the slug used for permission checks.
// "Sales Manager" → "sales_manager", "Admin" → "admin"
const slugify = (name = '') => name.toLowerCase().trim().replace(/[\s-]+/g, '_')

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user, setUser]                   = useState(null)   // Firebase Auth user
  const [userProfile, setUserProfile]     = useState(null)   // Firestore users/{uid}
  const [loading, setLoading]             = useState(true)
  const [disabledMessage, setDisabledMessage] = useState('')

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      try {
        if (authUser) {
          const snap    = await getDoc(doc(db, 'users', authUser.uid))
          const profile = snap.exists() ? snap.data() : null

          // App-level block: admin disabled this account
          if (profile && profile.active === false) {
            await auth.signOut()
            setUser(null)
            setUserProfile(null)
            setDisabledMessage('Your account has been disabled. Contact your administrator.')
            return
          }

          // Normalise role to a slug so checks like role === 'sales_manager' always work,
          // regardless of whether the role was stored as a doc ID or a display name.
          if (profile?.role && profile.role !== 'admin') {
            try {
              const roleSnap = await getDoc(doc(db, 'roles', profile.role))
              if (roleSnap.exists()) {
                profile.role = slugify(roleSnap.data().name || profile.role)
              }
            } catch (_) { /* keep whatever was stored */ }
          }

          setUser(authUser)
          setUserProfile(profile)
          setDisabledMessage('')
          // Pre-warm the users cache once after login — zero reads for all subsequent UserSelector usage
          prefetchUsers()
        } else {
          setUser(null)
          setUserProfile(null)
        }
      } catch (e) {
        console.error('AuthContext error:', e)
      } finally {
        setLoading(false)
      }
    })
    return () => unsubscribe()
  }, [])

  // ── currentUser ─────────────────────────────────────────────────────────────
  // Merged object: Firebase auth fields + Firestore profile fields.
  // null while loading or when signed out.
  const currentUser = user && userProfile
    ? { uid: user.uid, email: user.email, ...userProfile }
    : user
      ? { uid: user.uid, email: user.email }
      : null

  // ── Logout ───────────────────────────────────────────────────────────────────
  const logout = async () => {
    await auth.signOut()
    setUser(null)
    setUserProfile(null)
  }

  const clearDisabledMessage = () => setDisabledMessage('')

  // ── Permission helpers ────────────────────────────────────────────────────────
  /**
   * Returns true if the current user can VIEW (or edit) the given module.
   * Admins always return true.
   * Checks moduleRights first, falls back to legacy departments[].
   *
   * @param {string} module — MODULES constant or raw key, e.g. 'CRM'
   */
  const canViewModule = (module) => canView(userProfile, module)

  /**
   * Returns true if the current user can EDIT (create/update/delete) in the module.
   * Admins always return true.
   *
   * @param {string} module — MODULES constant or raw key, e.g. 'CRM'
   */
  const canEditModule = (module) => canEdit(userProfile, module)

  /**
   * General-purpose checker — pass any module + required right level.
   *
   * @param {string} module        — MODULES constant, e.g. MODULES.CRM
   * @param {string} requiredLevel — RIGHTS constant, e.g. RIGHTS.EDIT
   */
  const checkPermission = (module, requiredLevel = RIGHTS.VIEW) =>
    hasPermission(userProfile, module, requiredLevel)

  // ── Context value ─────────────────────────────────────────────────────────────
  const value = {
    // Auth state
    user,           // Firebase Auth user object
    currentUser,    // Merged auth + Firestore profile (convenience)
    userProfile,    // Raw Firestore profile
    loading,
    disabledMessage,
    clearDisabledMessage,
    logout,

    // Permission helpers
    canViewModule,
    canEditModule,
    checkPermission,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
/**
 * Primary auth hook. Returns the full context value.
 * Import from here or from src/context/AuthContext — both work.
 */
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/**
 * Convenience hook — returns currentUser directly.
 * Useful when you only need the merged user object.
 */
export function useCurrentUser() {
  return useAuth().currentUser
}

/**
 * Convenience hook — returns a bound permission checker.
 *
 * Usage:
 *   const { canView, canEdit, check } = usePermissions()
 *   if (canView('CRM')) { ... }
 *   if (check('HR', 'edit')) { ... }
 */
export function usePermissions() {
  const { canViewModule, canEditModule, checkPermission } = useAuth()
  return {
    canView:  canViewModule,
    canEdit:  canEditModule,
    check:    checkPermission,
  }
}

// Re-export constants so consumers can import everything from one place
export { MODULES, RIGHTS }

export default AuthContext
