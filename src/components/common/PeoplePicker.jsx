/**
 * PeoplePicker — searchable person selector used across modules.
 *
 * Props:
 *   people        {Array}    — from usePeople()
 *   onSelect      {Function} — called with {name, email, ...personObj} when a person is chosen
 *   placeholder   {string}
 *   excludeEmails {string[]} — emails already added (grayed out)
 *   className     {string}
 */
import React, { useState, useRef, useEffect, useMemo } from 'react'

const SOURCE_BADGE = {
  both:     { label: 'User + Employee', cls: 'bg-green-100 text-green-700' },
  user:     { label: 'App User',        cls: 'bg-blue-100 text-blue-700'   },
  employee: { label: 'Employee',        cls: 'bg-amber-100 text-amber-700' },
}

export default function PeoplePicker({ people = [], onSelect, placeholder = 'Search name or email…', excludeEmails = [], className = '' }) {
  const [query, setQuery]     = useState('')
  const [open, setOpen]       = useState(false)
  const ref                   = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return people.filter(p => p.active !== false).slice(0, 8)
    return people.filter(p =>
      p.active !== false &&
      ((p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q) || (p.designation || '').toLowerCase().includes(q))
    ).slice(0, 10)
  }, [people, query])

  // "Add external" option when typed value looks like an email and doesn't match any person
  const isEmailLike = query.includes('@') && query.includes('.')
  const exactMatch  = people.some(p => p.email === query.toLowerCase())
  const showExternal = isEmailLike && !exactMatch

  const choose = (person) => {
    onSelect(person)
    setQuery('')
    setOpen(false)
  }

  const chooseExternal = () => {
    if (!query.trim()) return
    onSelect({ name: query.trim(), email: query.trim().toLowerCase(), source: 'external', userId: null, employeeId: null })
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); if (showExternal) chooseExternal(); else if (filtered[0]) choose(filtered[0]) }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
      />

      {open && (filtered.length > 0 || showExternal) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200/70 rounded-2xl shadow-card shadow-lg max-h-64 overflow-y-auto">
          {filtered.map(p => {
            const already = excludeEmails.includes(p.email)
            const badge   = SOURCE_BADGE[p.source] || SOURCE_BADGE.user
            return (
              <button
                key={p.email || p.id}
                type="button"
                onClick={() => !already && choose(p)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 flex items-center gap-2 transition ${
                  already ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-50 cursor-pointer'
                }`}
              >
                {/* Avatar circle */}
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                  {(p.name || p.email || '?')[0].toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {p.email}
                    {p.designation && <span className="ml-1 text-slate-300">· {p.designation}</span>}
                    {p.department && <span className="ml-1 text-slate-300">· {p.department}</span>}
                  </p>
                </div>
                <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-lg font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
                {already && <span className="text-xs text-slate-400 ml-1">Added</span>}
              </button>
            )
          })}

          {showExternal && (
            <button
              type="button"
              onClick={chooseExternal}
              className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-amber-50 transition"
            >
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-xs">@</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-700">Add external: {query}</p>
                <p className="text-xs text-slate-400">Not in users or employee list</p>
              </div>
              <span className="text-xs px-1.5 py-0.5 rounded-lg font-medium bg-slate-100 text-slate-500">External</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
