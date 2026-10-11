// Import customers or vendors from a contacts export (Zoho Books CSV / Excel). Shows what will happen to every row first.
import React, { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { collection, doc, writeBatch } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { readSheetFile } from '../utils/readSheetFile.js'
import { parseContacts, matchParty, toDoc } from '../utils/partiesImport.js'
import { btnPrimary, btnGhost, cardCls, Badge } from './FinanceUI.jsx'

export default function PartiesSheetImport({ kind, existing, onClose, onDone }) {
  const { user } = useAuth()
  const fileRef = useRef(null)
  const isVendor = kind === 'vendor'
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    setErr(''); setResult(''); setFileName(f.name)
    try {
      const wb = await readSheetFile(f)
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
      if (!data.length || !('Display Name' in data[0] || 'Contact Name' in data[0])) return setErr('This does not look like a contacts export — expected a “Display Name” column.')
      const taken = new Set()               // one saved record can absorb only one row of the file (branches stay separate)
      setRows(parseContacts(data, kind).map(r => {
        const hit = matchParty(r, existing.filter(x => !taken.has(x.id)), kind)
        if (hit) taken.add(hit.id)
        return { ...r, existing: hit }
      }))
    } catch (ex) { setErr('Could not read that file: ' + ex.message) }
  }
  const toggle = (i) => setRows(rs => rs.map((r, n) => n === i ? { ...r, include: !r.include } : r))
  const chosen = useMemo(() => (rows || []).filter(r => r.include), [rows])

  const run = async () => {
    setBusy(true); setErr('')
    try {
      const coll = isVendor ? 'finance_vendors' : 'crm_customers'
      let batch = writeBatch(db), ops = 0, created = 0, updated = 0
      for (const r of chosen) {
        const body = { ...toDoc(r, kind), updatedBy: user?.uid || '', updatedAt: new Date().toISOString() }
        if (r.existing) {
          // keep what is already on file when the sheet is blank
          Object.keys(body).forEach(k => { if (body[k] === '' || body[k] === undefined) delete body[k] })
          batch.set(doc(db, coll, r.existing.id), body, { merge: true }); updated++
        } else {
          batch.set(doc(collection(db, coll)), { ...body, ...(isVendor ? {} : { companies: ['UIPL'] }), createdBy: user?.uid || '', createdAt: new Date().toISOString() }); created++
        }
        if (++ops >= 400) { await batch.commit(); batch = writeBatch(db); ops = 0 }
      }
      if (ops) await batch.commit()
      setResult(`Done — ${created} ${isVendor ? 'vendor' : 'customer'}(s) added, ${updated} updated.`)
      onDone?.()
    } catch (ex) { setErr('Import failed: ' + ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${cardCls} w-full max-w-5xl p-5 space-y-3 max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold text-slate-800">Import {isVendor ? 'vendors / suppliers' : 'customers'}</h3><p className="text-xs text-slate-400">Zoho Books contacts export (CSV or Excel). Existing records with the same name are updated; blanks in the file never wipe what you already have.</p></div><button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button></div>
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}
        {result && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{result}</div>}
        <div><button className={btnGhost} onClick={() => fileRef.current?.click()}>{fileName || 'Choose .csv / .xlsx file'}</button><input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} /></div>
        {rows && (
          <>
            <p className="text-sm text-slate-600"><b>{rows.length}</b> rows · <b>{chosen.length}</b> selected ({chosen.filter(r => !r.existing).length} new, {chosen.filter(r => r.existing).length} updates). Rows that look like individuals (no GSTIN, company or address), statutory payees (EPFO, income tax, GST…) and repeats are un-ticked — tick any you want.</p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[46vh]">
              <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase sticky top-0"><tr><th className="px-2 py-2 w-8" /><th className="text-left px-2">Name</th><th className="text-left px-2">GSTIN</th><th className="text-left px-2">City / State</th><th className="text-left px-2">Phone / email</th>{isVendor && <th className="text-left px-2">TDS</th>}<th className="px-2">Terms</th><th className="px-2">Note</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{rows.map((r, i) => (
                  <tr key={i} className={r.include ? '' : 'opacity-50'}>
                    <td className="px-2"><input type="checkbox" checked={r.include} onChange={() => toggle(i)} /></td>
                    <td className="px-2 py-1.5 max-w-xs truncate font-medium" title={r.name}>{r.name}</td>
                    <td className={`px-2 font-mono ${r.gstinOk ? '' : 'text-red-600'}`} title={r.gstinOk ? '' : 'GSTIN fails the checksum'}>{r.gstin || '—'}</td>
                    <td className="px-2">{[r.city, r.state || r.country].filter(Boolean).join(', ')}</td>
                    <td className="px-2 truncate max-w-[180px]">{[r.phone, r.email].filter(Boolean).join(' · ')}</td>
                    {isVendor && <td className="px-2">{r.tdsSection ? `${r.tdsSection} @ ${r.tdsRate}%` : ''}</td>}
                    <td className="px-2 text-center">{r.paymentTerms}</td>
                    <td className="px-2">{r.existing ? <Badge color="bg-amber-100 text-amber-700">update</Badge> : <Badge color="bg-green-100 text-green-700">new</Badge>}{r.duplicateInFile && <Badge color="bg-slate-100 text-slate-500">repeat</Badge>}{r.statutory && <Badge color="bg-purple-100 text-purple-700">statutory</Badge>}{r.looksLikePerson && <Badge color="bg-slate-100 text-slate-500">individual?</Badge>}</td>
                  </tr>))}
                </tbody></table>
            </div>
            <div className="flex gap-2"><button className={btnPrimary} disabled={busy || !!result || !chosen.length} onClick={run}>{busy ? 'Importing…' : `Import ${chosen.length}`}</button><button className={btnGhost} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button></div>
          </>
        )}
      </div>
    </div>
  )
}
