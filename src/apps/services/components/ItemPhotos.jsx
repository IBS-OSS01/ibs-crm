import React, { useEffect, useState } from 'react'
import { listSpareImages } from '../utils/spareImages'
import { isHttpLink } from '../utils/spareItems'

// Thumbnail of an item's first photo in a table cell; click opens all its photos (uploaded ones + any photo links from the Excel sheet).
export default function ItemPhotos({ item }) {
  const [open, setOpen] = useState(false)
  if (!item) return <span className="text-slate-300">—</span>
  const links = item.images || []
  const count = (item.imageCount || 0) + links.length
  if (!count) return <span className="text-slate-300">—</span>
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={`${count} photo${count > 1 ? 's' : ''}`} className="relative inline-block">
        {item.thumb
          ? <img src={item.thumb} alt="" className="w-11 h-11 object-cover rounded-lg border border-slate-200" />
          : <span className="inline-flex w-11 h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-lg">🖼</span>}
        {count > 1 && <span className="absolute -bottom-1 -right-1 bg-blue-600 text-white text-[10px] font-bold rounded-full px-1.5 leading-4">{count}</span>}
      </button>
      {open && <Gallery item={item} onClose={() => setOpen(false)} />}
    </>
  )
}

function Gallery({ item, onClose }) {
  const [pics, setPics] = useState(item.imageCount ? null : [])
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!item.imageCount) return
    let live = true
    listSpareImages(item.id).then(l => live && setPics(l)).catch(e => { if (live) { setErr(e.message); setPics([]) } })
    return () => { live = false }
  }, [item.id, item.imageCount])
  const links = item.images || []
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[92vh] overflow-auto p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <p className="text-sm font-semibold text-slate-700">{item.name || item.itemName}{item.make ? ` · ${item.make}` : ''}</p>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>
        </div>
        {pics === null && <p className="text-sm text-slate-400">Loading photos…</p>}
        {err && <p className="text-xs text-red-600">Could not load the photos: {err}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(pics || []).map(p => <img key={p.id} src={p.data} alt={p.name} className="w-full rounded-lg border border-slate-200" />)}
        </div>
        {links.length > 0 && (
          <div className="text-xs space-y-1">
            <p className="font-semibold text-slate-500 uppercase tracking-wider">Photo links</p>
            {links.map((u, n) => isHttpLink(u)
              ? <a key={n} href={u} target="_blank" rel="noreferrer" className="block text-blue-600 hover:underline break-all">🖼 {u}</a>
              : <span key={n} className="block text-slate-500 break-all">🖼 {u}</span>)}
          </div>
        )}
      </div>
    </div>
  )
}
