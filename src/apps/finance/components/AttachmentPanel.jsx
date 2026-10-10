// "📎 Attachments" box for any record. On a record that already exists, files are saved
// straight away; on a new record they wait in `draft` and the form uploads them after saving.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { prepareFile, listAttachments, uploadAttachments, deleteAttachment, dataUrlToBlobUrl } from '../utils/attachments.js'
import { labelCls } from './FinanceUI.jsx'

export function useAttachmentDraft() {
  const [pending, setPending] = useState([])
  const reset = useCallback(() => setPending([]), [])
  return { pending, setPending, reset }
}

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function Viewer({ items, onClose }) {
  const [urls, setUrls] = useState([])
  useEffect(() => {
    const u = items.map(i => (i.mime === 'application/pdf' ? dataUrlToBlobUrl(i.data) : i.data))
    setUrls(u)
    return () => u.forEach((x, i) => items[i].mime === 'application/pdf' && URL.revokeObjectURL(x))
  }, [items])
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[92vh] overflow-auto p-3 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center"><p className="text-sm font-semibold text-slate-700">{items[0]?.name?.replace(/-p\d+\./, '.')}</p><button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button></div>
        {items.map((it, i) => it.mime === 'application/pdf'
          ? <iframe key={i} src={urls[i]} title={it.name} className="w-full h-[78vh] border rounded" />
          : <img key={i} src={it.data} alt={it.name} className="w-full rounded border" />)}
      </div>
    </div>
  )
}

export default function AttachmentPanel({ entityType, entityId, company, editable = true, draft, label = 'Attachments', hint }) {
  const { user, userProfile } = useAuth()
  const [saved, setSaved] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [view, setView] = useState(null)
  const fileRef = useRef(null)

  const load = useCallback(async () => { try { setSaved(await listAttachments(entityType, entityId)) } catch (e) { setMsg('Could not load attachments: ' + e.message) } }, [entityType, entityId])
  useEffect(() => { load() }, [load])

  // pages of one converted PDF are shown as a single entry
  const groups = (list) => { const m = new Map(); list.forEach(a => { const k = a.group || a.id || a.name + a.bytes; if (!m.has(k)) m.set(k, []); m.get(k).push(a) }); return [...m.values()] }

  const add = async (files) => {
    setMsg(''); setBusy(true)
    const notes = []
    try {
      for (const f of files) {
        try {
          const { items, note } = await prepareFile(f)
          notes.push(`${f.name}: ${note}`)
          if (entityId) await uploadAttachments(items, { entityType, entityId, company, user, profile: userProfile })
          else draft.setPending(p => [...p, ...items])
        } catch (e) { notes.push(e.message) }
      }
      if (entityId) await load()
    } finally { setBusy(false); setMsg(notes.join(' · ')); if (fileRef.current) fileRef.current.value = '' }
  }
  const del = async (grp) => {
    if (!window.confirm(`Delete “${grp[0].name.replace(/-p\d+\./, '.')}”?`)) return
    for (const a of grp) await deleteAttachment(a.id)
    await load()
  }

  const pending = draft?.pending || []
  const total = saved.reduce((s, a) => s + (a.bytes || 0), 0) + pending.reduce((s, a) => s + (a.bytes || 0), 0)
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/50">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className={`${labelCls} !mb-0`}>📎 {label} {(saved.length + pending.length) > 0 && <span className="normal-case font-normal text-slate-400">· {groups(saved).length + groups(pending).length} file(s), {kb(total)}</span>}</label>
        {editable && (
          <>
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="px-3 py-1 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">{busy ? 'Compressing…' : '+ Add picture / PDF'}</button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple capture={undefined} className="hidden" onChange={e => add([...e.target.files])} />
          </>
        )}
      </div>
      {(saved.length + pending.length) === 0 && <p className="text-xs text-slate-400">{hint || 'Bill, receipt or photo. Pictures are shrunk automatically; big PDFs are converted to compressed pictures.'}</p>}
      <div className="flex gap-2 flex-wrap">
        {groups(saved).map(g => (
          <div key={g[0].id} className="relative group w-20">
            <button type="button" onClick={() => setView(g)} className="block w-20 h-20 rounded-lg border border-slate-200 bg-white overflow-hidden hover:border-blue-400">
              {g[0].mime === 'application/pdf' ? <span className="flex flex-col items-center justify-center h-full text-red-500 text-xs font-bold"><span className="text-2xl">📄</span>PDF</span> : <img src={g[0].data} alt="" className="w-full h-full object-cover" />}
            </button>
            <p className="text-[10px] text-slate-500 truncate mt-0.5" title={g[0].name}>{g.length > 1 ? `${g.length} pages` : kb(g[0].bytes)}</p>
            {editable && <button type="button" onClick={() => del(g)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-slate-300 text-slate-400 hover:text-red-500 text-xs leading-none opacity-0 group-hover:opacity-100 transition">✕</button>}
          </div>
        ))}
        {groups(pending).map((g, i) => (
          <div key={'p' + i} className="relative group w-20">
            <button type="button" onClick={() => setView(g)} className="block w-20 h-20 rounded-lg border border-dashed border-blue-300 bg-white overflow-hidden">
              {g[0].mime === 'application/pdf' ? <span className="flex flex-col items-center justify-center h-full text-red-500 text-xs font-bold"><span className="text-2xl">📄</span>PDF</span> : <img src={g[0].data} alt="" className="w-full h-full object-cover" />}
            </button>
            <p className="text-[10px] text-blue-600 truncate mt-0.5">not saved yet</p>
            <button type="button" onClick={() => draft.setPending(p => p.filter(x => !g.includes(x)))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-slate-300 text-slate-400 hover:text-red-500 text-xs leading-none">✕</button>
          </div>
        ))}
      </div>
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
      {view && <Viewer items={view} onClose={() => setView(null)} />}
    </div>
  )
}
