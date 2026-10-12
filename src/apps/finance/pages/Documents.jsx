// Documents — every file uploaded into Finance in one clickable list: bank statements (the original PDF / Excel kept at import)
// and the bills, receipts and photos attached to vouchers and invoices. Click a name to open or download it; click “Attached to”
// to open the voucher it belongs to.
import React, { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { listStatementFiles, downloadStatementFile } from '../utils/statementFiles.js'
import { dataUrlToBlobUrl } from '../utils/attachments.js'
import { useVoucherModal } from '../components/useVoucherModal.jsx'
import { ReportShell, Badge, Empty, cardCls, inputCls } from '../components/FinanceUI.jsx'

const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
const icon = (mime = '') => (/pdf/.test(mime) ? '📕' : /^image\//.test(mime) ? '🖼️' : /sheet|excel|csv/.test(mime) ? '📗' : '📄')
const day = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

export default function Documents() {
  const { raw, allLines, loading, reload } = useFinanceData(['bankStatements'])
  const { open, modal } = useVoucherModal({ raw, allLines, reload })
  const [files, setFiles] = useState([])        // normalised: { key, kind: 'statement' | 'attachment', name, mime, bytes, at, by, ... }
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const [stm, att] = await Promise.all([listStatementFiles('UIPL'), getDocs(collection(db, 'finance_attachments'))])
        const out = stm.map(s => ({ key: 's' + s.id, kind: 'statement', name: s.fileName, mime: s.mime, bytes: s.size, at: s.importedAt, by: s.importedByName, meta: s, where: `${s.bankName || 'Bank'} statement`, period: s.from && s.to ? `${day(s.from)} – ${day(s.to)}` : '' }))
        const groups = new Map()
        att.forEach(d => {
          const a = { id: d.id, ...d.data() }
          if (a.entityType === 'bank_statement_file') return                    // chunks of the statement files above
          const g = a.group || a.id
          if (!groups.has(g)) groups.set(g, [])
          groups.get(g).push(a)
        })
        groups.forEach((pages, g) => {
          pages.sort((x, y) => (x.page || 0) - (y.page || 0))
          const a = pages[0]
          out.push({ key: 'a' + g, kind: 'attachment', name: pages.length > 1 ? a.name.replace(/-p1(\.\w+)$/, '$1') : a.name, mime: pages.length > 1 ? 'application/pdf' : a.mime, bytes: pages.reduce((s, p) => s + (p.bytes || 0), 0), at: a.createdAt, by: a.createdByName, pages, entityId: a.entityId, entityType: a.entityType })
        })
        if (live) setFiles(out.sort((a, b) => (b.at || '').localeCompare(a.at || '')))
      } catch (e) { if (live) setErr('Could not load the files: ' + e.message) }
      finally { if (live) setBusy(false) }
    })()
    return () => { live = false }
  }, [])

  const entries = useMemo(() => (raw ? buildVoucherIndex(raw) : []), [raw])
  const link = (f) => {
    if (f.kind === 'statement') return null
    const e = entries.find(x => x.id === f.entityId)
    if (e) return { label: `${e.number}${e.partyName ? ' · ' + e.partyName : ''}`, entry: e }
    const inv = (raw?.invoices || []).find(i => i.id === f.entityId)
    return inv ? { label: `${inv.invoiceNumber} · ${inv.billToName || ''}`, entry: null } : { label: f.entityType || '', entry: null }
  }

  const show = async (f) => {
    try {
      if (f.kind === 'statement') return await downloadStatementFile(f.meta)
      if (f.pages.length === 1) { window.open(dataUrlToBlobUrl(f.pages[0].data), '_blank'); return }
      // a PDF that was stored as page pictures: show the pages one under another
      const w = window.open('', '_blank'); if (!w) return alert('Allow pop-ups to view this file.')
      w.document.write(`<title>${f.name}</title><body style="margin:0;background:#334155">${f.pages.map(p => `<img src="${p.data}" style="display:block;max-width:100%;margin:8px auto;background:#fff">`).join('')}</body>`); w.document.close()
    } catch (e) { alert(e.message) }
  }

  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return files.filter(f => (kind === 'all' || f.kind === kind) && words.every(w => `${f.name} ${f.where || ''} ${link(f)?.label || ''}`.toLowerCase().includes(w)))
  }, [files, q, kind, entries, raw]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ReportShell title="Documents" loading={loading} subtitle="Every file uploaded into Finance — bank statements and the bills, receipts and photos attached to entries. Click a name to open it."
      filters={<>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {[['all', 'All'], ['statement', 'Bank statements'], ['attachment', 'Bills & receipts']].map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={`px-3 py-1.5 font-medium ${kind === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search file or voucher…" className={`${inputCls} w-64`} />
      </>}>
      {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
            <th className="text-left px-4 py-3">File</th><th className="text-left px-4 py-3">Attached to</th><th className="text-right px-4 py-3">Size</th><th className="text-left px-4 py-3">Uploaded</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(f => { const l = link(f); return (
              <tr key={f.key} className="hover:bg-blue-50/40">
                <td className="px-4 py-2.5"><button onClick={() => show(f)} className="flex items-center gap-2 text-left text-blue-700 hover:underline font-medium"><span>{icon(f.mime)}</span><span className="break-all">{f.name}</span></button>
                  {f.pages?.length > 1 && <span className="text-xs text-slate-400 ml-7">{f.pages.length} pages</span>}</td>
                <td className="px-4 py-2.5 text-slate-600">{f.kind === 'statement' ? <span><Badge color="bg-blue-100 text-blue-700">Statement</Badge> <span className="ml-1">{f.where}{f.period ? ` · ${f.period}` : ''}</span></span>
                  : l?.entry ? <button onClick={() => open(l.entry)} className="text-blue-700 hover:underline text-left">{l.label}</button> : <span className="text-slate-500">{l?.label || '—'}</span>}</td>
                <td className="px-4 py-2.5 text-right text-slate-500 whitespace-nowrap">{f.bytes ? kb(f.bytes) : '—'}</td>
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{day(f.at)}{f.by ? <span className="block text-xs text-slate-400">{f.by}</span> : null}</td>
              </tr>) })}
            {busy && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Loading files…</td></tr>}
            {!busy && rows.length === 0 && <tr><td colSpan={4}><Empty>No files{q || kind !== 'all' ? ' match' : ' uploaded yet'}.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">{files.length} file(s) in total. Statements are kept untouched; pictures and PDFs on entries are stored in a compressed form.</p>
      {modal}
    </ReportShell>
  )
}
