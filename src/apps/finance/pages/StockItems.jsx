// Stock item master (finance view of inventory_items): HSN/GST, rates, valuation
// method, minimum stock and opening stock per godown.
import React, { useMemo, useState } from 'react'
import { addDoc, collection, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { OPENING_DEFAULT_DATE } from '../utils/stockEngine.js'
import { fmtAmt, gstRatesFor, todayStr, num } from '../utils/financeConstants.js'
import { UNITS } from '../components/ItemsEditor.jsx'
import { Field } from '../components/formShared.jsx'
import AttachmentPanel, { useAttachmentDraft } from '../components/AttachmentPanel.jsx'
import { uploadAttachments } from '../utils/attachments.js'
import ItemsSheetImport from '../components/ItemsSheetImport.jsx'
import { ReportShell, CompanyToggle, Badge, Empty, cardCls, btnPrimary, btnGhost, formInputCls, inputCls, useFinancePerms } from '../components/FinanceUI.jsx'

const blank = { name: '', sku: '', unit: 'pcs', hsnCode: '', gstRate: 18, purchaseRate: '', saleRate: '', minStock: 0, valuationMethod: 'avg', description: '', openingDate: '', opening: {} }

export default function StockItems() {
  const { canWrite, isAdmin } = useFinancePerms()
  const { user } = useAuth()
  const { raw, stock, loading, reload } = useFinanceData(['stockLevels', 'hsnCodes'])
  const [company, setCompany] = useState('UIPL')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)   // null | 'new' | item
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const draft = useAttachmentDraft()
  const [info, setInfo] = useState('')
  const [showImport, setShowImport] = useState(false)

  const items = raw?.stockItems || []
  const warehouses = raw?.warehouses || []
  const sumByItem = useMemo(() => Object.fromEntries(stock.summary.filter(s => s.company === company).map(s => [s.itemId, s])), [stock, company])
  const rows = useMemo(() => items.filter(i => !q || `${i.name || i.itemName} ${i.sku} ${i.hsnCode || ''}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (a.name || '').localeCompare(b.name || '')), [items, q])
  const opts = raw?.companySettings?.UIPL?.stockOptions || {}

  const open = (it) => {
    setError(''); draft.reset()
    if (it === 'new') { setForm(blank); setEdit('new'); return }
    setForm({
      name: it.name || it.itemName || '', sku: it.sku || '', unit: it.unit || 'pcs', hsnCode: it.hsnCode || '', gstRate: it.gstRate ?? 18, purchaseRate: it.purchaseRate ?? '', saleRate: it.saleRate ?? '',
      minStock: it.minStock ?? 0, valuationMethod: it.valuationMethod || 'avg', description: it.description || '', openingDate: it.openingDate || '',
      opening: Object.fromEntries(Object.entries(it.openingStock || {}).map(([k, v]) => [k, { qty: v.qty, rate: v.rate }])),
    })
    setEdit(it)
  }
  const setOpen = (whId, field, v) => setForm(f => ({ ...f, opening: { ...f.opening, [whId]: { ...(f.opening[whId] || {}), [field]: v } } }))

  const save = async () => {
    setError('')
    if (!form.name.trim() || !form.sku.trim()) return setError('Name and SKU are required.')
    const clash = items.find(i => i.id !== edit?.id && (i.sku || '').toLowerCase() === form.sku.trim().toLowerCase())
    if (clash) return setError(`SKU ${form.sku} is already used by "${clash.name}".`)
    const openingStock = {}
    Object.entries(form.opening).forEach(([k, v]) => { if (num(v.qty)) openingStock[k] = { qty: num(v.qty), rate: num(v.rate) } })
    if (Object.keys(openingStock).length && !form.openingDate) return setError('Give the opening stock an as-on date (usually 1 April of your first financial year).')
    const payload = {
      name: form.name.trim(), sku: form.sku.trim(), unit: form.unit, hsnCode: form.hsnCode.trim(), gstRate: num(form.gstRate), purchaseRate: num(form.purchaseRate), saleRate: num(form.saleRate),
      minStock: num(form.minStock), valuationMethod: form.valuationMethod, description: form.description, openingStock, openingDate: form.openingDate || '',
    }
    setSaving(true)
    try {
      let itemId = edit.id
      if (edit === 'new') itemId = (await addDoc(collection(db, 'inventory_items'), { ...payload, createdBy: user?.uid || '', createdAt: new Date().toISOString() })).id
      else await updateDoc(doc(db, 'inventory_items', edit.id), { ...payload, updatedBy: user?.uid || '', updatedAt: new Date().toISOString() })
      if (draft.pending.length) await uploadAttachments(draft.pending, { entityType: 'stock_item', entityId: itemId, company: '', user })
      draft.reset()
      invalidateFinanceCache(); reload(); setEdit(null)
    } catch (e) { setError(e.code === 'permission-denied' ? 'You do not have permission to change stock items.' : 'Could not save: ' + e.message) }
    finally { setSaving(false) }
  }

  const adoptSnapshot = async () => {
    const date = prompt('Use the quantities currently in Services → Stock Levels as OPENING stock.\nThis replaces any opening stock already entered.\n\nAs-on date (YYYY-MM-DD):', OPENING_DEFAULT_DATE.slice(0, 4) === '2000' ? `${new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0)}-04-01` : OPENING_DEFAULT_DATE)
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    setBusy('snapshot'); setInfo('')
    try {
      const snaps = raw.stockLevels || []
      let batch = writeBatch(db), n = 0, total = 0
      for (const it of items) {
        const mine = snaps.filter(s => s.sku && it.sku && String(s.sku).toLowerCase() === String(it.sku).toLowerCase() && num(s.qty))
        if (!mine.length) continue
        const openingStock = {}
        mine.forEach(s => { openingStock[s.locationId] = { qty: num(s.qty), rate: num(it.purchaseRate) } })
        batch.update(doc(db, 'inventory_items', it.id), { openingStock, openingDate: date })
        n++; total++
        if (n === 400) { await batch.commit(); batch = writeBatch(db); n = 0 }
      }
      if (n) await batch.commit()
      invalidateFinanceCache(); reload()
      setInfo(`Opening stock set for ${total} item(s) as on ${date}. Items with no purchase rate are valued at ₹0 — fill in rates so Stock in Hand is meaningful.`)
    } catch (e) { setInfo('Failed: ' + e.message) }
    finally { setBusy('') }
  }

  const toggleReceive = async (v) => {
    setBusy('opt')
    try { await setDoc(doc(db, 'company_settings', 'UIPL'), { stockOptions: { ...opts, includeServicesReceive: v } }, { merge: true }); invalidateFinanceCache(); reload() }
    catch (e) { setInfo('Could not change setting: ' + e.message) }
    finally { setBusy('') }
  }

  const missingRate = items.filter(i => !num(i.purchaseRate)).length
  const gstRates = gstRatesFor(todayStr())

  return (
    <ReportShell title="Stock Items" loading={loading} subtitle="Item master with HSN, GST, rates, valuation method and opening stock. New items can also be added from Services → Items Catalog."
      exportBar={canWrite ? <div className="flex gap-2"><button onClick={() => open('new')} className={btnPrimary}>+ New item</button></div> : null}
      filters={<><CompanyToggle value={company} onChange={setCompany} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, SKU, HSN…" className={`${inputCls} w-64`} /></>}>
      {info && <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">{info}</div>}
      {canWrite && (
        <div className={`${cardCls} p-3 flex gap-3 items-center flex-wrap text-sm`}>
          <button onClick={() => setShowImport(true)} className={btnPrimary}>⬆ Import items from spreadsheet</button>
          <button onClick={adoptSnapshot} disabled={!!busy} className={btnGhost}>{busy === 'snapshot' ? 'Working…' : 'Use Services Stock Levels as opening stock'}</button>
          {isAdmin && <label className="flex items-center gap-2 text-slate-600" title="Receive Stock entries in Services have no price. Count them only if you do NOT also enter the same goods as Purchase vouchers, or stock will double up.">
            <input type="checkbox" checked={!!opts.includeServicesReceive} disabled={busy === 'opt'} onChange={e => toggleReceive(e.target.checked)} />Count Services “Receive Stock” entries as inward stock
          </label>}
          {missingRate > 0 && <span className="text-amber-600 text-xs">{missingRate} item(s) have no purchase rate</span>}
        </div>
      )}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
            <th className="text-left px-4 py-3">SKU</th><th className="text-left px-4 py-3">Item</th><th className="text-left px-4 py-3">HSN</th><th className="text-right px-4 py-3">GST</th>
            <th className="text-right px-4 py-3">Purchase rate</th><th className="text-right px-4 py-3">Sale rate</th><th className="text-left px-4 py-3">Valuation</th>
            <th className="text-right px-4 py-3">On hand</th><th className="text-right px-4 py-3">Value</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(it => { const s = sumByItem[it.id]; return (
              <tr key={it.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{it.sku}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{it.name || it.itemName}{it.isService && <span className="ml-2"><Badge color="bg-purple-100 text-purple-700">service</Badge></span>}{!it.hsnCode && <span className="ml-2"><Badge color="bg-amber-100 text-amber-700">no HSN</Badge></span>}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{it.hsnCode || '—'}</td>
                <td className="px-4 py-2.5 text-right">{it.gstRate !== undefined && it.gstRate !== '' ? `${it.gstRate}%` : '—'}</td>
                <td className="px-4 py-2.5 text-right">{it.purchaseRate ? fmtAmt(it.purchaseRate) : '—'}</td>
                <td className="px-4 py-2.5 text-right">{it.saleRate ? fmtAmt(it.saleRate) : '—'}</td>
                <td className="px-4 py-2.5 text-slate-500">{it.valuationMethod === 'fifo' ? 'FIFO' : 'Wtd. average'}</td>
                <td className={`px-4 py-2.5 text-right ${s?.negative ? 'text-red-600 font-semibold' : ''}`}>{s ? `${s.qty} ${it.unit || ''}` : '—'}</td>
                <td className="px-4 py-2.5 text-right">{s ? fmtAmt(s.value) : '—'}</td>
                <td className="px-4 py-2.5 text-right">{canWrite && <button onClick={() => open(it)} className="text-blue-600 hover:underline text-xs">Edit</button>}</td>
              </tr>) })}
            {rows.length === 0 && <tr><td colSpan={10}><Empty>No stock items.</Empty></td></tr>}
          </tbody>
        </table>
      </div>

      {showImport && <ItemsSheetImport items={items} warehouses={warehouses} stockLevels={raw?.stockLevels || []} onClose={() => setShowImport(false)} onDone={() => { invalidateFinanceCache(); reload() }} />}
      {edit && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEdit(null)}>
          <div className={`${cardCls} w-full max-w-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800">{edit === 'new' ? 'New stock item' : `Edit — ${form.name}`}</h3>
            {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Name *" className="col-span-2"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={formInputCls} /></Field>
              <Field label="SKU *"><input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} className={formInputCls} /></Field>
              <Field label="Unit"><select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className={formInputCls}>{[...new Set([...UNITS, form.unit])].map(u => <option key={u}>{u}</option>)}</select></Field>
              <Field label="HSN / SAC"><input value={form.hsnCode} onChange={e => setForm(f => ({ ...f, hsnCode: e.target.value }))} list="hsn-master" className={formInputCls} /></Field>
              <Field label="GST %"><select value={form.gstRate} onChange={e => setForm(f => ({ ...f, gstRate: e.target.value }))} className={formInputCls}>{[...new Set([...gstRates, Number(form.gstRate)])].sort((a, b) => a - b).map(r => <option key={r} value={r}>{r}%</option>)}</select></Field>
              <Field label="Purchase rate (₹)"><input type="number" min="0" step="any" value={form.purchaseRate} onChange={e => setForm(f => ({ ...f, purchaseRate: e.target.value }))} className={formInputCls} /></Field>
              <Field label="Sale rate (₹)"><input type="number" min="0" step="any" value={form.saleRate} onChange={e => setForm(f => ({ ...f, saleRate: e.target.value }))} className={formInputCls} /></Field>
              <Field label="Minimum stock"><input type="number" min="0" value={form.minStock} onChange={e => setForm(f => ({ ...f, minStock: e.target.value }))} className={formInputCls} /></Field>
              <Field label="Valuation" className="col-span-2"><select value={form.valuationMethod} onChange={e => setForm(f => ({ ...f, valuationMethod: e.target.value }))} className={formInputCls}><option value="avg">Weighted average (moving)</option><option value="fifo">FIFO</option></select></Field>
            </div>
            <datalist id="hsn-master">{(raw?.hsnCodes || []).map(h => <option key={h.id} value={h.code}>{h.description}</option>)}</datalist>
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-500 uppercase">Opening stock</p>
                <label className="text-xs text-slate-500 flex items-center gap-2">As on <input type="date" value={form.openingDate} onChange={e => setForm(f => ({ ...f, openingDate: e.target.value }))} className="px-2 py-1 border border-slate-300 rounded-md text-sm" /></label></div>
              {warehouses.length === 0 && <p className="text-xs text-amber-600">No godowns defined (Services → Warehouses). Add one first to enter opening stock.</p>}
              {warehouses.map(w => (
                <div key={w.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                  <span className="col-span-5 text-slate-600">{w.name || w.id}{w.company ? ` (${w.company})` : ''}</span>
                  <input type="number" step="any" placeholder="Qty" value={form.opening[w.id]?.qty ?? ''} onChange={e => setOpen(w.id, 'qty', e.target.value)} className={`${formInputCls} col-span-3 text-right`} />
                  <input type="number" step="any" placeholder="Rate ₹" value={form.opening[w.id]?.rate ?? ''} onChange={e => setOpen(w.id, 'rate', e.target.value)} className={`${formInputCls} col-span-3 text-right`} />
                </div>
              ))}
              <p className="text-xs text-slate-400">Opening stock value is posted to the books against Opening Balance Equity. Don't also book it as a manual journal.</p>
            </div>
            <AttachmentPanel entityType="stock_item" entityId={edit === 'new' ? undefined : edit.id} company="" draft={draft} label="Item photos / spec sheet / datasheet" hint="Photo of the item, datasheet or supplier catalogue page." />
            <div className="flex gap-2"><button onClick={save} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button><button onClick={() => setEdit(null)} className={btnGhost}>Cancel</button></div>
          </div>
        </div>
      )}
    </ReportShell>
  )
}

