// Import an items export (Zoho Books etc.) into the stock catalogue: creates / updates items, and sets stock on hand
// for goods in the chosen godown (both the Services "Stock Levels" figure and the Finance stock ledger's opening stock).
import React, { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { collection, doc, writeBatch } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { readSheetFile } from '../utils/readSheetFile.js'
import { parseItemsSheet, assignSkus, matchExisting } from '../utils/itemsImport.js'
import { fmtAmt, todayStr } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls, formInputCls, Badge } from './FinanceUI.jsx'

export default function ItemsSheetImport({ items, warehouses, stockLevels, onClose, onDone }) {
  const { user } = useAuth()
  const fileRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [whId, setWhId] = useState(warehouses.find(w => /central/i.test(w.name || ''))?.id || warehouses[0]?.id || '')
  const [asOn, setAsOn] = useState(todayStr())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    setErr(''); setResult(''); setFileName(f.name)
    try {
      const wb = await readSheetFile(f)
      const sheet = wb.Sheets[wb.SheetNames.find(n => /item/i.test(n)) || wb.SheetNames[0]]
      const { rows: r, error } = parseItemsSheet(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }))
      if (error) return setErr(error)
      setRows(assignSkus(r, items.map(i => i.sku).filter(Boolean)).map(x => ({ ...x, existing: matchExisting(x, items) })))
    } catch (ex) { setErr('Could not read that file: ' + ex.message) }
  }
  const flip = (i) => setRows(rs => rs.map((r, n) => n === i ? { ...r, isService: !r.isService, stock: r.isService ? r.stock : 0 } : r))

  const goods = rows?.filter(r => !r.isService) || []
  const sums = useMemo(() => rows ? { newItems: rows.filter(r => !r.existing).length, updated: rows.filter(r => r.existing).length, withStock: goods.filter(r => r.stock > 0).length, qty: goods.reduce((s, r) => s + r.stock, 0) } : null, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!rows?.length) return
    if (goods.some(r => r.stock > 0) && !whId) return setErr('Choose the godown that holds this stock.')
    setBusy(true); setErr('')
    try {
      const wh = warehouses.find(w => w.id === whId)
      const stockBySkuLoc = new Map(stockLevels.filter(s => s.sku).map(s => [`${String(s.sku).toLowerCase()}|${s.locationId}`, s]))
      let batch = writeBatch(db), ops = 0, created = 0, updated = 0, stockSet = 0
      const flush = async () => { if (ops) { await batch.commit(); batch = writeBatch(db); ops = 0 } }
      for (const r of rows) {
        const ref = r.existing ? doc(db, 'inventory_items', r.existing.id) : doc(collection(db, 'inventory_items'))
        const base = {
          name: r.name, sku: r.existing?.sku || r.sku, unit: r.unit, hsnCode: r.hsn, purchaseRate: r.purchaseRate, saleRate: r.saleRate, description: r.description,
          isService: r.isService, zohoItemId: r.zohoId || '', updatedBy: user?.uid || '', updatedAt: new Date().toISOString(),
        }
        if (!r.isService && r.stock > 0) Object.assign(base, { openingStock: { [whId]: { qty: r.stock, rate: r.purchaseRate } }, openingDate: asOn })
        if (r.existing) { batch.set(ref, base, { merge: true }); updated++ } else { batch.set(ref, { ...base, minStock: 0, createdBy: user?.uid || '', createdAt: new Date().toISOString() }); created++ }
        ops++
        if (!r.isService && whId) {          // Services → Stock Levels figure: the file's quantity replaces what was there
          const sku = base.sku
          const have = stockBySkuLoc.get(`${sku.toLowerCase()}|${whId}`)
          const sref = have ? doc(db, 'inventory_stocks', have.id) : doc(collection(db, 'inventory_stocks'))
          batch.set(sref, { itemName: r.name, sku, locationId: whId, locationName: wh?.name || whId, qty: r.stock, minStock: have?.minStock || 0, updatedAt: new Date().toISOString() }, { merge: true })
          ops++; stockSet++
        }
        if (ops >= 400) await flush()
      }
      await flush()
      setResult(`Done — ${created} item(s) created, ${updated} updated, stock set for ${stockSet} goods item(s) in ${wh?.name || 'the chosen godown'}.`)
      onDone?.()
    } catch (ex) { setErr('Import failed: ' + ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${cardCls} w-full max-w-5xl p-5 space-y-3 max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold text-slate-800">Import items from a spreadsheet</h3><p className="text-xs text-slate-400">Zoho Books items export or any sheet with Name, Purchase Rate, Rate, Stock On Hand, HSN/SAC, Usage Unit.</p></div><button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button></div>
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}
        {result && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{result}</div>}
        <div className="flex gap-3 items-end flex-wrap">
          <button className={btnGhost} onClick={() => fileRef.current?.click()}>{fileName || 'Choose .xlsx / .csv file'}</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          {rows && <>
            <label className="text-xs text-slate-500">Stock on hand is held in<select value={whId} onChange={e => setWhId(e.target.value)} className={`${formInputCls} mt-1`}>{warehouses.length === 0 && <option value="">(no godowns)</option>}{warehouses.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}</select></label>
            <label className="text-xs text-slate-500">Stock as on<input type="date" value={asOn} onChange={e => setAsOn(e.target.value)} className={`${formInputCls} mt-1`} /></label>
          </>}
        </div>
        {rows && (
          <>
            <p className="text-sm text-slate-600"><b>{rows.length}</b> rows: {sums.newItems} new, {sums.updated} already in the catalogue · {goods.length} goods, {rows.length - goods.length} services/charges (kept for invoicing, never counted as stock) · stock for {sums.withStock} goods item(s), {sums.qty} units in total. Click Goods / Service to correct a row.</p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[46vh]">
              <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase sticky top-0"><tr><th className="text-left px-2 py-2">Item</th><th className="text-left px-2">SKU</th><th className="px-2">Type</th><th className="text-left px-2">HSN/SAC</th><th className="px-2">Unit</th><th className="text-right px-2">Purchase ₹</th><th className="text-right px-2">Sale ₹</th><th className="text-right px-2">On hand</th><th className="px-2">Action</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{rows.map((r, i) => (
                  <tr key={i}><td className="px-2 py-1.5 max-w-xs truncate" title={r.name}>{r.name}</td><td className="px-2 font-mono">{r.existing?.sku || r.sku}{r.skuGenerated && !r.existing && <span className="text-slate-400" title="generated — the sheet had no SKU"> *</span>}</td>
                    <td className="px-2 text-center"><button onClick={() => flip(i)}><Badge color={r.isService ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}>{r.isService ? 'Service' : 'Goods'}</Badge></button></td>
                    <td className="px-2 font-mono">{r.hsn || <span className="text-amber-600">—</span>}</td><td className="px-2 text-center">{r.unit}</td><td className="px-2 text-right">{fmtAmt(r.purchaseRate)}</td><td className="px-2 text-right">{fmtAmt(r.saleRate)}</td>
                    <td className="px-2 text-right">{r.isService ? '—' : r.stock}</td><td className="px-2 text-center">{r.existing ? <Badge color="bg-amber-100 text-amber-700">update</Badge> : <Badge color="bg-green-100 text-green-700">new</Badge>}</td></tr>))}
                </tbody></table>
            </div>
            <p className="text-xs text-slate-400">* SKU generated from the source system's item id (the sheet had none) — you can rename SKUs later. GST rates are not in the sheet: set them on each item (or they default to 18% on invoices).</p>
            <div className="flex gap-2"><button className={btnPrimary} disabled={busy || !!result} onClick={run}>{busy ? 'Importing…' : `Import ${rows.length} items`}</button><button className={btnGhost} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button></div>
          </>
        )}
      </div>
    </div>
  )
}
