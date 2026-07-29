/**
 * IBS CRM — Permission Layer v1
 * src/auth/permissions.js
 *
 * Pure utility functions — no React, no Firebase imports.
 * Works directly with the `userProfile` object loaded from Firestore users/{uid}.
 *
 * Firestore moduleRights shape:
 *   moduleRights: { CRM: 'edit', HR: 'view', FINANCE: 'none', ... }
 *
 * Right levels (lowest → highest):
 *   none  — explicitly blocked
 *   view  — read-only access
 *   edit  — full read + write access
 */

// ── Module key constants ───────────────────────────────────────────────────────
// These match the keys stored in Firestore moduleRights.
export const MODULES = {
  CRM:      'CRM',
  SERVICES: 'SERVICES',
  HR:       'HR',
  PROJECTS: 'PROJECTS',
  FINANCE:  'FINANCE',
  SALESENG: 'SALESENG',
  ADMIN:    'ADMIN',
}

// ── Right level constants ──────────────────────────────────────────────────────
export const RIGHTS = {
  NONE: 'none',
  VIEW: 'view',
  EDIT: 'edit',
}

// Internal priority map — higher number = more access
const LEVEL_PRIORITY = { none: 0, view: 1, edit: 2 }

/**
 * Core permission checker.
 *
 * Returns true if the user profile grants AT LEAST `requiredLevel` for `module`.
 *
 * Resolution order:
 *  1. No profile → false
 *  2. role === 'admin' → always true
 *  3. requiredLevel === 'none' → always true (everyone passes a "none" gate)
 *  4. moduleRights[module] present → compare priority
 *  5. Legacy fallback: departments[] includes module → grants view + edit
 *
 * @param {object|null} profile   - userProfile from Firestore
 * @param {string}      module    - MODULES constant, e.g. MODULES.CRM
 * @param {string}      requiredLevel - RIGHTS constant, default RIGHTS.VIEW
 * @returns {boolean}
 */
export function hasPermission(profile, module, requiredLevel = RIGHTS.VIEW) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  if (requiredLevel === RIGHTS.NONE) return true

  const granted = profile.moduleRights?.[module]

  if (granted !== undefined) {
    // Explicitly set — compare priority levels
    return (LEVEL_PRIORITY[granted] ?? 0) >= (LEVEL_PRIORITY[requiredLevel] ?? 1)
  }

  // Legacy fallback: departments[] (no moduleRights set yet)
  const depts = profile.departments || []
  if (depts.includes(module)) return true

  return false
}

/**
 * Returns true if the user can VIEW (or edit) the given module.
 * Shorthand for hasPermission(profile, module, 'view').
 */
export const canView = (profile, module) => hasPermission(profile, module, RIGHTS.VIEW)

/**
 * Returns true if the user can EDIT (create / update / delete) in the given module.
 * Shorthand for hasPermission(profile, module, 'edit').
 */
export const canEdit = (profile, module) => hasPermission(profile, module, RIGHTS.EDIT)

/**
 * Returns the effective right level string for a module: 'none' | 'view' | 'edit'.
 * Useful for rendering permission badges in admin UI.
 */
export function effectiveRight(profile, module) {
  if (!profile) return RIGHTS.NONE
  if (profile.role === 'admin') return RIGHTS.EDIT

  const granted = profile.moduleRights?.[module]
  if (granted !== undefined) return granted

  // Legacy fallback
  if ((profile.departments || []).includes(module)) return RIGHTS.EDIT

  return RIGHTS.NONE
}
