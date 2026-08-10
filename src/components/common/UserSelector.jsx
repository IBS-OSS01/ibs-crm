/**
 * UserSelector — searchable single-user selector.
 *
 * ZERO Firestore reads. Reads entirely from the session-scoped cache
 * pre-warmed by AuthContext after login (via useUsers()).
 *
 * Props
 * ─────
 *   value        {string|null}  — selected uid (or '' / null for empty)
 *   onChange     {fn}           — (uid: string|null) => void
 *   placeholder  {string}       — search box placeholder text
 *   filters      {{ company?: string, department?: string, role?: string }}
 *                               — optional local filters; zero extra reads
 *   readOnly     {boolean}      — display-only; hides the input
 *   disabled     {boolean}      — grayed, no interaction
 *   required     {boolean}      — shows * and red border on blur if empty
 *   label        {string}       — optional label rendered above the selector
 *   allowClear   {boolean}      — show ✕ clear button (default true)
 *   className    {string}       — wrapper div class
 *   includeDisabled {boolean}   — include disabled users in search results
 *                               (default false — disabled users are never
 *                               offered as a new selection anywhere they're
 *                               not explicitly opted back in). A user who is
 *                               already selected still displays correctly
 *                               even if they've since been disabled.
 *
 * Selection stores only the uid string.
 * Name / email / role / department are always derived from the live cache.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useUsers } from '../../lib/useUsers'

const ROLE_DISPLAY = {
  admin:           'Admin',
  project_manager: 'Project Manager',
  sales_manager:   'Sales Manager',
  sales_exec:      'Sales Executive',
  warehouse:       'Warehouse',
  accounts:        'Accounts',
  hr:              'HR',
}
const roleLabel = (r) => ROLE_DISPLAY[r] || (r ? r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '')

const COMPANY_COLOR = {
  UIPL:   'bg-blue-100 text-blue-700',
  Wayzim: 'bg-purple-100 text-purple-700',
}

export default function UserSelector({
  value       = null,
  onChange,
  placeholder = 'Search name, email, department or role…',
  filters     = {},
  readOnly    = false,
  disabled    = false,
  required    = false,
  label       = '',
  allowClear  = true,
  className   = '',
  includeDisabled = false,
}) {
  const { users, usersReady } = useUsers()

  const [query,    setQuery]   = useState('')
  const [open,     setOpen]    = useState(false)
  const [touched,  setTouched] = useState(false)
  const [hlIdx,    setHlIdx]   = useState(0)    // keyboard highlight index

  const rootRef  = useRef(null)
  const inputRef = useRef(null)

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Resolve selected user from cache ──────────────────────────────────────
  const selectedUser = useMemo(() => {
    if (!value || !users.length) return null
    return users.find(u => u.id === value) || null
  }, [value, users])

  // ── Apply optional filters + search ──────────────────────────────────────
  const filtered = useMemo(() => {
    let pool = users
    if (!includeDisabled) pool = pool.filter(u => u.active !== false)
    if (filters.company)    pool = pool.filter(u => Array.isArray(u.companies) ? u.companies.includes(filters.company) : u.company === filters.company)
    if (filters.department) pool = pool.filter(u => u.department === filters.department)
    if (filters.role)       pool = pool.filter(u => u.role       === filters.role)

    const q = query.trim().toLowerCase()
    if (q.length < 2) return []   // wait for 2+ characters

    return pool.filter(u =>
      (u.name || '').toLowerCase().includes(q)       ||
      (u.email || '').toLowerCase().includes(q)      ||
      (u.department || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q)       ||
      (u.roleName || '').toLowerCase().includes(q)   ||
      roleLabel(u.role).toLowerCase().includes(q)
    ).slice(0, 12)
  }, [users, filters, query])

  // Reset highlight when results change
  useEffect(() => { setHlIdx(0) }, [filtered.length, query])

  // ── Actions ───────────────────────────────────────────────────────────────
  const select = useCallback((uid) => {
    onChange?.(uid)
    setQuery('')
    setOpen(false)
    setTouched(true)
  }, [onChange])

  const clear = (e) => {
    e.stopPropagation()
    onChange?.(null)
    setQuery('')
    setTouched(true)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (!open || !filtered.length) {
      if (e.key === 'Escape') setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHlIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHlIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[hlIdx]) select(filtered[hlIdx].id)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  const isInvalid = required && touched && !value

  // ── READ-ONLY mode ────────────────────────────────────────────────────────
  if (readOnly) {
    return (
      <div className={`space-y-0.5 ${className}`}>
        {label && <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>}
        {selectedUser ? (
          <div className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200">
            <Avatar user={selectedUser} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{selectedUser.name}</p>
              <p className="text-xs text-slate-500 truncate">{selectedUser.email}</p>
            </div>
            {selectedUser.role && (
              <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {selectedUser.roleName || roleLabel(selectedUser.role)}
              </span>
            )}
            {selectedUser.active === false && (
              <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                Disabled
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400 px-3 py-2">—</p>
        )}
      </div>
    )
  }

  // ── DISABLED mode ─────────────────────────────────────────────────────────
  const disabledClass = disabled ? 'opacity-50 pointer-events-none' : ''

  return (
    <div ref={rootRef} className={`relative ${disabledClass} ${className}`}>
      {label && (
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}

      {/* ── Selected chip OR search input ── */}
      <div
        className={`flex items-center gap-2 min-h-[38px] px-3 py-1.5 border rounded-xl cursor-text transition
          ${isInvalid
            ? 'border-red-400 ring-1 ring-red-300'
            : open
              ? 'border-blue-500 ring-1 ring-blue-200'
              : 'border-slate-300 hover:border-slate-400'
          } bg-white`}
        onClick={() => { if (!disabled) { setOpen(true); inputRef.current?.focus() } }}
      >
        {/* Selected user chip (shown when a value is set and user is not typing) */}
        {selectedUser && !open && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Avatar user={selectedUser} size="xs" />
            <span className="text-sm font-semibold text-slate-800 truncate">{selectedUser.name}</span>
            {selectedUser.role && (
              <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                {selectedUser.roleName || roleLabel(selectedUser.role)}
              </span>
            )}
            {selectedUser.active === false && (
              <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                Disabled
              </span>
            )}
          </div>
        )}

        {/* Text input — always present but hidden when chip is showing */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTouched(true)}
          onKeyDown={handleKeyDown}
          placeholder={selectedUser ? '' : (usersReady ? placeholder : 'Loading users…')}
          disabled={disabled || !usersReady}
          className={`flex-1 text-sm bg-transparent outline-none placeholder-slate-400 min-w-0
            ${selectedUser && !open ? 'w-0 opacity-0 absolute' : ''}`}
        />

        {/* Clear button */}
        {allowClear && value && !open && (
          <button
            type="button"
            onMouseDown={clear}
            className="flex-shrink-0 text-slate-400 hover:text-slate-600 text-base leading-none ml-1"
            tabIndex={-1}
            aria-label="Clear selection"
          >
            ✕
          </button>
        )}

        {/* Caret */}
        {!value && (
          <svg className="flex-shrink-0 w-4 h-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        )}
      </div>

      {/* ── Validation message ── */}
      {isInvalid && (
        <p className="mt-0.5 text-xs text-red-500">Please select a user.</p>
      )}

      {/* ── Dropdown results ── */}
      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200/70 rounded-2xl shadow-xl max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-slate-400 text-sm">
              No users match "{query.trim()}"
            </div>
          ) : (
            filtered.map((u, idx) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={() => select(u.id)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-slate-50 last:border-0 transition
                  ${idx === hlIdx
                    ? 'bg-blue-50'
                    : u.id === value
                      ? 'bg-green-50'
                      : 'hover:bg-slate-50'
                  }`}
              >
                <Avatar user={u} />

                {/* User info block */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800 truncate">{u.name || '—'}</p>
                    {u.id === value && (
                      <span className="text-xs text-green-600 font-bold">✓ selected</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {u.email}
                    {u.department && <span className="ml-2 text-slate-400">· {u.department}</span>}
                  </p>
                </div>

                {/* Role badge */}
                <div className="flex-shrink-0 flex flex-col items-end gap-1">
                  {u.role && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium whitespace-nowrap">
                      {u.roleName || roleLabel(u.role)}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* ── Hint when open but < 2 chars typed ── */}
      {open && query.trim().length > 0 && query.trim().length < 2 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200/70 rounded-xl shadow-lg px-4 py-3">
          <p className="text-xs text-slate-400">Type one more character to search…</p>
        </div>
      )}
    </div>
  )
}

// ── Avatar circle ──────────────────────────────────────────────────────────────
function Avatar({ user, size = 'md' }) {
  const sizes = { xs: 'w-5 h-5 text-xs', sm: 'w-7 h-7 text-xs', md: 'w-8 h-8 text-sm' }
  const initial = (user.name || user.email || '?')[0].toUpperCase()
  return (
    <span className={`flex-shrink-0 ${sizes[size]} rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold`}>
      {initial}
    </span>
  )
}

/**
 * Utility: resolve a uid to display name using the cache.
 * Import and call outside React components if needed.
 *
 * Usage (inside a component):
 *   const { users } = useUsers()
 *   const name = resolveUserName(users, uid)
 */
export function resolveUserName(users, uid) {
  if (!uid) return ''
  const u = users.find(x => x.id === uid)
  return u?.name || u?.email || uid
}
