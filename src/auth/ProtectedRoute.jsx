/**
 * IBS CRM — Permission Layer v1
 * src/auth/ProtectedRoute.jsx
 *
 * A route-level guard component. Wrap any <Route element={...}> content with
 * this to enforce authentication and/or module-level permissions.
 *
 * Props
 * ─────
 * module   {string}   (optional) MODULES constant to check, e.g. MODULES.CRM.
 *                     If omitted, only authentication is checked.
 * require  {string}   (optional) Minimum right level: 'view' (default) or 'edit'.
 * redirect {string}   (optional) Where to send unauthenticated users. Default: '/login'.
 * children {node}     The protected content / nested routes.
 *
 * Usage examples
 * ──────────────
 * // Auth only
 * <ProtectedRoute>
 *   <Layout />
 * </ProtectedRoute>
 *
 * // Auth + must have at least 'view' on CRM
 * <ProtectedRoute module={MODULES.CRM}>
 *   <CRMApp />
 * </ProtectedRoute>
 *
 * // Auth + must have 'edit' on HR
 * <ProtectedRoute module={MODULES.HR} require="edit">
 *   <HRAdminPanel />
 * </ProtectedRoute>
 */

import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { RIGHTS } from './permissions'

export default function ProtectedRoute({
  module   = null,
  require  = RIGHTS.VIEW,
  redirect = '/login',
  children,
}) {
  const { user, userProfile, loading, checkPermission } = useAuth()
  const location = useLocation()

  // ── Still loading auth state ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg,#0a0f1e 0%,#0f172a 50%,#0d1a3a 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: '16px',
      }}>
        <div style={{
          width: '32px', height: '32px',
          border: '3px solid #1e3a8a', borderTop: '3px solid #3b82f6',
          borderRadius: '50%', animation: 'spin 0.9s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // ── Not authenticated ────────────────────────────────────────────────────────
  if (!user) {
    return <Navigate to={redirect} state={{ from: location }} replace />
  }

  // ── Module permission check ──────────────────────────────────────────────────
  if (module && !checkPermission(module, require)) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-8">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-lg font-bold text-slate-800 mb-1">Access Denied</h2>
        <p className="text-sm text-slate-500 max-w-xs">
          You don't have{' '}
          <span className="font-semibold">{require}</span> access to the{' '}
          <span className="font-semibold">{module}</span> module.
        </p>
        <p className="text-xs text-slate-400 mt-3">
          Contact your administrator to request access.
        </p>
      </div>
    )
  }

  // ── Authorised ───────────────────────────────────────────────────────────────
  return children
}
