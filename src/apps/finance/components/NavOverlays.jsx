// Ctrl/⌘+K "jump to anything" palette and the "+ New" sheet.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { QUICK_ACTIONS, allNavItems } from '../navConfig.js'

const score = (item, tokens) => {
  const hay = `${item.label} ${item.keywords || ''} ${item.group || ''} ${item.hint || ''}`.toLowerCase()
  if (!tokens.every(t => hay.includes(t))) return -1
  const label = item.label.toLowerCase()
  return tokens.reduce((s, t) => s + (label.startsWith(t) ? 3 : label.includes(t) ? 2 : 1), 0)
}

export function CommandPalette({ open, onClose, onGo }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef(null)
  const all = useMemo(() => [
    ...QUICK_ACTIONS.map(a => ({ ...a, group: 'Create new', create: true })),
    ...allNavItems(),
  ], [])
  const results = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length) return all.slice(0, 14)
    return all.map(i => ({ i, s: score(i, tokens) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s || (b.i.create ? 1 : 0) - (a.i.create ? 1 : 0)).slice(0, 20).map(x => x.i)
  }, [q, all])
  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 30) } }, [open])
  useEffect(() => { setIdx(0) }, [q])
  if (!open) return null
  const onKey = (e) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && results[idx]) { onGo(results[idx].path); onClose() }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-3" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <span className="text-slate-400">🔍</span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Jump to a page or create something…  (try “gst”, “new bill”, “who owes me”)"
            className="flex-1 outline-none text-sm text-slate-800 placeholder-slate-400 bg-transparent" />
          <kbd className="hidden sm:block text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && <p className="px-4 py-6 text-sm text-slate-400 text-center">Nothing matches “{q}”.</p>}
          {results.map((r, i) => (
            <button key={r.path + r.label + (r.create ? 'c' : '')} onMouseEnter={() => setIdx(i)} onClick={() => { onGo(r.path); onClose() }}
              className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm ${i === idx ? 'bg-blue-50' : ''}`}>
              <span className="w-6 text-center">{r.icon}</span>
              <span className="flex-1 text-slate-800">{r.create ? `New ${r.label.toLowerCase()}` : r.label}{r.hint && <span className="text-slate-400"> · {r.hint}</span>}</span>
              <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${r.create ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{r.group}</span>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400 flex gap-4"><span>↑↓ move</span><span>Enter open</span><span>Ctrl/⌘ + K anywhere</span></div>
      </div>
    </div>
  )
}

export function QuickAddSheet({ open, onClose, onGo }) {
  useEffect(() => {
    if (!open) return
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 pb-8 sm:pb-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-slate-800 text-lg">What do you want to add?</h3><button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button></div>
        <div className="grid grid-cols-2 gap-2.5">
          {QUICK_ACTIONS.map(a => (
            <button key={a.label} onClick={() => { onGo(a.path); onClose() }} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 text-left transition active:scale-[.98]">
              <span className="text-2xl">{a.icon}</span>
              <span><span className="block text-sm font-semibold text-slate-800">{a.label}</span><span className="block text-xs text-slate-400">{a.hint}</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
