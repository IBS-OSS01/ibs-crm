// A pick-list you can type into: shows the chosen name, and as you type narrows the list to the names that contain
// every word typed. Arrow keys + Enter, Esc to close. Drop-in for a <select> of customers / vendors / ledgers.
import React, { useEffect, useMemo, useRef, useState } from 'react'

export default function SearchSelect({ value, onChange, options, placeholder = 'Type to search…', className = '', required = false, disabled = false, autoFocus = false, emptyLabel = '', onBlur }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const box = useRef(null)
  const chosen = options.find(o => String(o.value) === String(value))

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const list = words.length ? options.filter(o => { const t = `${o.label} ${o.hint || ''}`.toLowerCase(); return words.every(w => t.includes(w)) }) : options
    return list.slice(0, 200)
  }, [q, options])

  useEffect(() => { setHi(0) }, [q])
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setQ('') } }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])

  const pick = (o) => { onChange(o ? o.value : ''); setOpen(false); setQ('') }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (shown[hi]) pick(shown[hi]) }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); setQ('') }
  }

  return (
    <div ref={box} className="relative">
      <input value={open ? q : (chosen ? chosen.label : '')} placeholder={chosen && open ? chosen.label : placeholder} disabled={disabled} autoFocus={autoFocus}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true) }} onKeyDown={onKey} onBlur={onBlur}
        className={className} autoComplete="off" required={required && !value} />
      {open && !disabled && (
        <ul className="absolute z-40 mt-1 w-full max-h-64 overflow-auto bg-white border border-slate-300 rounded-lg shadow-lg text-sm">
          {emptyLabel && <li onMouseDown={e => { e.preventDefault(); pick(null) }} className="px-3 py-1.5 text-slate-400 cursor-pointer hover:bg-slate-50">{emptyLabel}</li>}
          {shown.map((o, n) => (
            <li key={o.value} onMouseDown={e => { e.preventDefault(); pick(o) }} onMouseEnter={() => setHi(n)}
              className={`px-3 py-1.5 cursor-pointer ${n === hi ? 'bg-blue-50 text-blue-800' : 'text-slate-700'} ${String(o.value) === String(value) ? 'font-semibold' : ''}`}>
              {o.label}{o.hint && <span className="ml-2 text-xs text-slate-400">{o.hint}</span>}
            </li>))}
          {!shown.length && <li className="px-3 py-2 text-slate-400">No match for “{q}”.</li>}
        </ul>)}
    </div>
  )
}
