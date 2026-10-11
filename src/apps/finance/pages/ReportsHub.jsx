// Reports Center — every report and function in Finance in one place: search, favourites, recently visited and categories.
// Favourites and "last visited" are kept in this browser.
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CATALOG, CATEGORIES, getFavourites, toggleFavourite, getVisits, recordVisit } from '../utils/reportsCatalog.js'
import { cardCls } from '../components/FinanceUI.jsx'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', '').toUpperCase() : '-')

const Folder = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" /></svg>
const Star = ({ on }) => <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? '#f59e0b' : 'none'} stroke={on ? '#f59e0b' : '#94a3b8'} strokeWidth="1.6" strokeLinejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" /></svg>

export default function ReportsHub() {
  const navigate = useNavigate()
  const [view, setView] = useState('home')              // home | favourites | recent | category name
  const [q, setQ] = useState('')
  const [favs, setFavs] = useState(getFavourites)
  const [visits, setVisits] = useState(getVisits)

  const open = (r) => { recordVisit(r.path); setVisits(getVisits()); navigate(r.path) }
  const star = (e, r) => { e.stopPropagation(); setFavs(toggleFavourite(r.path)) }

  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map(c => [c, CATALOG.filter(r => r.category === c).length])), [])
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    let list = CATALOG
    if (words.length) list = list.filter(r => words.every(w => `${r.label} ${r.desc} ${r.category}`.toLowerCase().includes(w)))
    else if (view === 'favourites') list = list.filter(r => favs.includes(r.path))
    else if (view === 'recent') list = list.filter(r => visits[r.path]).sort((a, b) => visits[b.path].localeCompare(visits[a.path])).slice(0, 15)
    else if (view !== 'home') list = list.filter(r => r.category === view)
    return list
  }, [q, view, favs, visits])

  const title = q ? `Search results` : view === 'home' ? 'All reports' : view === 'favourites' ? 'Favourites' : view === 'recent' ? 'Recently visited' : view
  const navBtn = (key, label, icon, count) => (
    <button key={key} onClick={() => { setView(key); setQ('') }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition ${view === key && !q ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
      <span className="text-slate-400">{icon}</span><span className="flex-1 truncate">{label}</span>{count !== undefined && <span className="text-xs text-slate-400">{count}</span>}
    </button>
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Reports Center</h2>
        <div className="flex-1 max-w-xl mx-auto w-full min-w-[14rem]">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500">
            <span className="text-blue-600">🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search reports" className="flex-1 bg-transparent outline-none text-sm" />
            {q && <button onClick={() => setQ('')} className="text-slate-400 text-sm">✕</button>}
          </div>
        </div>
        <span className="text-xs text-slate-400 hidden md:block">Shortcuts on any voucher screen: F4 Contra · F5 Payment · F6 Receipt · F9 Purchase</span>
      </div>

      <div className="grid lg:grid-cols-[16rem_1fr] gap-4 items-start">
        <aside className={`${cardCls} p-3 space-y-0.5`}>
          {navBtn('home', 'Home', '⌂', CATALOG.length)}
          {navBtn('favourites', 'Favourites', '☆', favs.length)}
          {navBtn('recent', 'Recently visited', '↺', Object.keys(visits).filter(p => CATALOG.some(r => r.path === p)).length)}
          <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Report category</p>
          {CATEGORIES.map(c => navBtn(c, c, <Folder />, counts[c]))}
        </aside>

        <section className={cardCls}>
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">{title}</h3><span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">{rows.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="w-10" /><th className="text-left px-3 py-2.5">Report name</th><th className="text-left px-3 py-2.5 hidden md:table-cell">What it shows</th><th className="text-left px-3 py-2.5 hidden lg:table-cell">Category</th><th className="text-left px-3 py-2.5">Last visited</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => (
                  <tr key={r.path + r.label} onClick={() => open(r)} className="cursor-pointer hover:bg-blue-50/40">
                    <td className="pl-4"><button onClick={e => star(e, r)} title={favs.includes(r.path) ? 'Remove from favourites' : 'Add to favourites'}><Star on={favs.includes(r.path)} /></button></td>
                    <td className="px-3 py-3 text-blue-700 font-medium">{r.label}</td>
                    <td className="px-3 py-3 text-slate-500 hidden md:table-cell">{r.desc}</td>
                    <td className="px-3 py-3 text-slate-500 hidden lg:table-cell">{r.category}</td>
                    <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{when(visits[r.path])}</td>
                  </tr>))}
                {rows.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">{q ? `No report matches “${q}”.` : view === 'favourites' ? 'Click the ☆ beside a report to keep it here.' : 'Nothing here yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
