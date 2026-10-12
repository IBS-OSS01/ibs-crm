// One-time move of the existing Firebase data to Cloudflare (D1), by an admin, from this browser.
// Reads each collection from Firestore (uses the free daily reads — do a few collections a day if the quota is tight),
// writes it to the Cloudflare Worker, and shows both counts side by side so you can see nothing was missed.
import React, { useState } from 'react'
import { collection as fsCollection, getDocs as fsGetDocs, getCountFromServer as fsCount } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { importDocs, countInCloudflare, idsInCloudflare } from '../../../lib/cfBackend.js'
import { RULES } from '../../../../cloudflare/src/rules.js'
import { usingCloudflare } from '../../../lib/cachedFirestore'

const ORDER = ['users', 'roles', 'company_settings']                 // people and settings first, then everything else A–Z
const NAMES = [...ORDER, ...Object.keys(RULES).filter(c => !ORDER.includes(c)).sort()]

// Firestore Timestamps become ISO strings (that is how the app stores dates everywhere else)
const plain = (v) => {
  if (v && typeof v === 'object') {
    if (typeof v.toDate === 'function') return v.toDate().toISOString()
    if (Array.isArray(v)) return v.map(plain)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
  }
  return v
}

export default function DataMove() {
  const [rows, setRows] = useState(() => Object.fromEntries(NAMES.map(n => [n, { fs: null, cf: null, msg: '' }])))
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const set = (n, p) => setRows(r => ({ ...r, [n]: { ...r[n], ...p } }))

  const count = async (n) => {
    set(n, { msg: 'counting…' })
    try {
      const [a, b] = await Promise.all([fsCount(fsCollection(db, n)).then(s => s.data().count).catch(() => null), countInCloudflare(n).catch(() => null)])
      set(n, { fs: a, cf: b, msg: '' })
    } catch (e) { set(n, { msg: e.message }) }
  }
  const move = async (n) => {
    set(n, { msg: 'reading from Firebase…' })
    try {
      const snap = await fsGetDocs(fsCollection(db, n))
      let docs = []; snap.forEach(d => docs.push({ id: d.id, data: plain(d.data()) }))
      const total = docs.length
      if (n === 'finance_audit_log') { const have = await idsInCloudflare(n); docs = docs.filter(d => !have.has(d.id)) }      // append-only: only entries not copied yet
      set(n, { fs: total, msg: `writing 0 / ${docs.length}…` })
      await importDocs(n, docs, (k) => set(n, { msg: `writing ${k} / ${docs.length}…` }))
      const cf = await countInCloudflare(n)
      set(n, { fs: total, cf, msg: cf >= total ? 'done ✓' : 'counts differ!' })
    } catch (e) { set(n, { msg: 'stopped: ' + (e.code ? e.code + ' — ' : '') + e.message }); e.collection = n; throw e }
  }
  const run = async (names, label) => {
    setBusy(label); setErr('')
    try { for (const n of names) await move(n) }
    catch (e) { setErr(`Stopped at ${e.collection || 'a collection'}: ${e.message}. If it is the free read quota, wait for the reset (about 12:30 PM IST) and press the button again — finished collections are safe to repeat.`) }
    setBusy('')
  }
  const flag = (v) => { try { localStorage.setItem('ibs_backend', v) } catch { /* ignore */ } window.location.reload() }

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Move data to Cloudflare</h2>
        <p className="text-sm text-slate-500 mt-1">Copies every collection from Firebase to the Cloudflare database. It reads each document once from Firebase (that uses the free daily read quota — if it stops with a quota message, continue the next day) and can be repeated safely: a repeat overwrites with the same data.</p>
        <p className="text-sm mt-2">This browser is using: <b>{usingCloudflare ? 'Cloudflare' : 'Firebase'}</b>.
          {usingCloudflare
            ? <button className="ml-3 text-blue-600 hover:underline text-sm" onClick={() => flag('firestore')}>switch this browser back to Firebase</button>
            : <button className="ml-3 text-blue-600 hover:underline text-sm" onClick={() => flag('cf')}>try Cloudflare in this browser</button>}</p>
      </div>
      {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{err}</div>}
      <div className="flex gap-2">
        <button disabled={!!busy} onClick={async () => { setBusy('count'); for (const n of NAMES) await count(n); setBusy('') }} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50">{busy === 'count' ? 'Counting…' : 'Count both sides'}</button>
        <button disabled={!!busy} onClick={() => run(NAMES, 'all')} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50">{busy === 'all' ? 'Moving…' : 'Move everything'}</button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="text-left px-3 py-2">Collection</th><th className="text-right px-3">Firebase</th><th className="text-right px-3">Cloudflare</th><th className="text-left px-3">Status</th><th className="px-3" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {NAMES.map(n => { const r = rows[n]; return (
              <tr key={n}><td className="px-3 py-1.5 font-mono text-xs">{n}</td>
                <td className="px-3 text-right">{r.fs ?? '—'}</td><td className={`px-3 text-right ${r.fs !== null && r.cf !== null && r.fs !== r.cf ? 'text-red-600 font-semibold' : ''}`}>{r.cf ?? '—'}</td>
                <td className="px-3 text-xs text-slate-500">{r.msg}</td>
                <td className="px-3 text-right"><button disabled={!!busy} onClick={() => run([n], n)} className="text-blue-600 hover:underline text-xs disabled:opacity-40">Move</button></td></tr>) })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
