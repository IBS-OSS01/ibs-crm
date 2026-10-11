// Purchase Order and Stock Journal forms.
//
// A Purchase Order commits nothing to the books — it is an order-tracking document.
// Stock and payables move only when the supplier's bill is entered as a Purchase
// voucher ("Create bill" on a pending order pre-fills it and links back, so the
// pending-quantity report stays right).
import React, { useMemo, useState } from 'react'
import { computeVoucherTotals, supplyTypeOf } from '../utils/taxCalc.js'
import { addDays } from '../utils/voucherEngine.js'
import ItemsEditor, { newLine, TotalsBox } from './ItemsEditor.jsx'
import SearchSelect from './SearchSelect.jsx'
import { formInputCls, labelCls } from './FinanceUI.jsx'
import {
  Field, FormShell, HeaderFields, useVoucherSave, need,
  vendorOptions, creditDaysFromTerms, companyStateCode, stateCodeFromName, gstinToStateCode, todayStr, num,
} from './formShared.jsx'

const lineFrom = (i) => ({ description: i.description || '', hsnCode: i.hsnCode || '', qty: i.qty ?? 1, unit: i.unit || 'pcs', rate: i.rate ?? '', discountPct: i.discountPct ?? 0, gstRate: i.gstRate ?? 18, stockItemId: i.stockItemId || '', sku: i.sku || '' })
const cleanItems = (items) => items.filter(i => (i.description || '').trim() || num(i.rate) > 0)

// ═══ PURCHASE ORDER ═════════════════════════════════════════════════════════
export function PurchaseOrderForm({ data, initial, onSaved, onCancel }) {
  const { raw } = data
  const [company, setCompany] = useState(initial?.company || 'UIPL')
  const [date, setDate] = useState(initial?.date || todayStr())
  const vendors = useMemo(() => vendorOptions(raw), [raw])
  const [vendorId, setVendorId] = useState(initial?.partyId || '')
  const vendor = vendors.find(v => v.id === vendorId)
  const [expected, setExpected] = useState(initial?.expectedDate || '')
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId || '')
  const [terms, setTerms] = useState(initial?.terms || '')
  const [applyGst, setApplyGst] = useState(initial ? initial.applyGst !== false : true)
  const [items, setItems] = useState(initial?.items?.length ? initial.items.map(lineFrom) : [newLine()])
  const [narration, setNarration] = useState(initial?.narration || '')
  const [closed, setClosed] = useState(!!initial?.closed)

  const compState = companyStateCode(raw, company)
  const vendorState = gstinToStateCode(vendor?.gstin) || stateCodeFromName(vendor?.state)
  const supplyType = supplyTypeOf(vendorState, compState)
  const totals = useMemo(() => computeVoucherTotals(items, { supplyType, applyGst }), [items, supplyType, applyGst])

  const { save, saving, error } = useVoucherSave({
    initial, onSaved,
    getPayload: () => {
      need(vendor, 'Select the vendor.')
      const lines = cleanItems(items)
      need(lines.length > 0, 'Add at least one item.')
      need(lines.every(l => num(l.qty) > 0), 'Every line needs a quantity.')
      const t = computeVoucherTotals(lines, { supplyType, applyGst })
      return {
        voucherType: 'purchase_order', company, date, partyType: 'vendor', partyId: vendor.id, partyName: vendor.name, partyGstin: vendor.gstin,
        expectedDate: expected, warehouseId, terms: terms.trim(), applyGst, supplyType,
        items: t.items, gstLines: t.gstLines, subTotal: t.subTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total, narration: narration.trim(), closed,
        creditDays: creditDaysFromTerms(vendor.paymentTerms), dueDate: addDays(expected || date, creditDaysFromTerms(vendor.paymentTerms)),
      }
    },
  })

  return (
    <FormShell title={initial && !initial._clone ? `Edit Purchase Order — ${initial.voucherNumber}` : 'Purchase Order'} subtitle="Order goods from a vendor. No accounting entry is made until you enter the vendor's bill." onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <HeaderFields company={company} setCompany={setCompany} date={date} setDate={setDate} locked={!!initial && !initial._clone}
        extra={<>
          <Field label="Vendor *"><SearchSelect value={vendorId} onChange={setVendorId} className={formInputCls} required placeholder="Type to search vendor…" options={vendors.map(v => ({ value: v.id, label: v.name }))} /></Field>
          <Field label="Expected delivery"><input type="date" value={expected} onChange={e => setExpected(e.target.value)} className={formInputCls} min={date} /></Field>
        </>} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(raw.warehouses || []).length > 0 && <Field label="Deliver to godown"><select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={formInputCls}><option value="">Default</option>{raw.warehouses.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}</select></Field>}
        <Field label="Terms / delivery notes" className="md:col-span-2"><input value={terms} onChange={e => setTerms(e.target.value)} className={formInputCls} placeholder="Payment terms, delivery address…" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applyGst} onChange={e => setApplyGst(e.target.checked)} />Show GST on this order</label>
      <ItemsEditor items={items} onChange={setItems} computed={totals.items} date={date} stockItems={raw.stockItems || []} hsnCodes={raw.hsnCodes || []} applyGst={applyGst} />
      <Field label="Narration"><input value={narration} onChange={e => setNarration(e.target.value)} className={formInputCls} /></Field>
      {initial && <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} />Close this order (stop expecting the pending balance)</label>}
      <TotalsBox totals={totals} />
    </FormShell>
  )
}

// ═══ STOCK JOURNAL ══════════════════════════════════════════════════════════
const JTYPES = [
  ['transfer', 'Transfer between godowns', 'Move stock from one godown/site to another. No effect on value.'],
  ['adjust', 'Physical count / adjustment', 'Correct quantities after a stock-take, or write off damaged / lost items.'],
  ['manufacture', 'Manufacturing / assembly', 'Consume raw materials and produce finished goods — the finished goods carry the cost of the materials.'],
]

// Module-level so inputs keep focus between keystrokes (components declared inside a render would remount).
const ItemSel = ({ items, v, on }) => <select value={v} onChange={e => on(e.target.value)} className={formInputCls}><option value="">— item —</option>{items.map(i => <option key={i.id} value={i.id}>{i.sku ? `${i.sku} · ` : ''}{i.name || i.itemName}</option>)}</select>
const WhSel = ({ whs, v, on }) => <select value={v} onChange={e => on(e.target.value)} className={formInputCls}>{whs.length === 0 && <option value="">Default</option>}{whs.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}</select>
const Qty = ({ v, on, ph = 'Qty' }) => <input type="number" step="any" value={v} onChange={e => on(e.target.value)} placeholder={ph} className={`${formInputCls} text-right`} />
const X = ({ onClick }) => <button type="button" onClick={onClick} className="text-slate-300 hover:text-red-500">✕</button>

export function StockJournalForm({ data, initial, onSaved, onCancel }) {
  const { raw } = data
  const items = raw.stockItems || [], whs = raw.warehouses || []
  const [company, setCompany] = useState(initial?.company || 'UIPL')
  const [date, setDate] = useState(initial?.date || todayStr())
  const [type, setType] = useState(initial?.type || 'transfer')
  const [lines, setLines] = useState(initial?.type !== 'manufacture' ? (initial?.lines?.length ? initial.lines : [{ itemId: '', qty: '', fromWarehouseId: whs[0]?.id || '', toWarehouseId: whs[1]?.id || '', warehouseId: whs[0]?.id || '', mode: 'delta', rate: '' }]) : [{ itemId: '', qty: '', fromWarehouseId: '', toWarehouseId: '', warehouseId: whs[0]?.id || '', mode: 'delta', rate: '' }])
  const [consume, setConsume] = useState(initial?.consume?.length ? initial.consume : [{ itemId: '', qty: '', warehouseId: whs[0]?.id || '' }])
  const [produce, setProduce] = useState(initial?.produce?.length ? initial.produce : [{ itemId: '', qty: '', warehouseId: whs[0]?.id || '' }])
  const [narration, setNarration] = useState(initial?.narration || '')

  const upd = (arr, set, i, patch) => set(arr.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const { save, saving, error } = useVoucherSave({
    initial, onSaved,
    getPayload: () => {
      const base = { voucherType: 'stock_journal', company, date, type, narration: narration.trim(), total: 0 }
      if (type === 'manufacture') {
        const c = consume.filter(l => l.itemId && num(l.qty) > 0), p = produce.filter(l => l.itemId && num(l.qty) > 0)
        need(c.length && p.length, 'Add at least one material consumed and one product made.')
        return { ...base, consume: c, produce: p }
      }
      const l = lines.filter(x => x.itemId && num(x.qty) !== 0)
      need(l.length, 'Add at least one item with a quantity.')
      if (type === 'transfer') l.forEach(x => { need(x.fromWarehouseId !== x.toWarehouseId, 'Source and destination godown must differ.'); need(num(x.qty) > 0, 'Transfer quantity must be positive.') })
      return { ...base, lines: l }
    },
  })

  return (
    <FormShell title={initial && !initial._clone ? `Edit Stock Journal — ${initial.voucherNumber}` : 'Stock Journal'} subtitle={JTYPES.find(t => t[0] === type)[2]} onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <HeaderFields company={company} setCompany={setCompany} date={date} setDate={setDate} locked={!!initial && !initial._clone}
        extra={<Field label="Type"><select value={type} onChange={e => setType(e.target.value)} disabled={!!initial} className={formInputCls}>{JTYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>} />
      {whs.length === 0 && <p className="text-xs text-amber-600">No godowns exist yet — add them under Services → Warehouses. Movements are recorded against the default godown.</p>}

      {type === 'transfer' && <div className="space-y-2">
        {lines.map((l, i) => <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-4"><ItemSel items={items} v={l.itemId} on={v => upd(lines, setLines, i, { itemId: v })} /></div>
          <div className="col-span-2"><Qty v={l.qty} on={v => upd(lines, setLines, i, { qty: v })} /></div>
          <div className="col-span-3"><WhSel whs={whs} v={l.fromWarehouseId} on={v => upd(lines, setLines, i, { fromWarehouseId: v })} /></div>
          <div className="col-span-2"><WhSel whs={whs} v={l.toWarehouseId} on={v => upd(lines, setLines, i, { toWarehouseId: v })} /></div>
          <X onClick={() => setLines(lines.filter((_, x) => x !== i))} />
        </div>)}
        <p className="text-xs text-slate-400">Item · quantity · from godown · to godown</p>
        <button type="button" onClick={() => setLines([...lines, { itemId: '', qty: '', fromWarehouseId: whs[0]?.id || '', toWarehouseId: whs[1]?.id || '' }])} className="text-sm text-blue-600 hover:underline">+ Add line</button>
      </div>}

      {type === 'adjust' && <div className="space-y-2">
        {lines.map((l, i) => <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-4"><ItemSel items={items} v={l.itemId} on={v => upd(lines, setLines, i, { itemId: v })} /></div>
          <div className="col-span-2"><select value={l.mode || 'delta'} onChange={e => upd(lines, setLines, i, { mode: e.target.value })} className={formInputCls}><option value="delta">+/− by</option><option value="set">Set to</option></select></div>
          <div className="col-span-2"><Qty v={l.qty} on={v => upd(lines, setLines, i, { qty: v })} ph={l.mode === 'set' ? 'Counted qty' : '+ add / − remove'} /></div>
          <div className="col-span-2"><WhSel whs={whs} v={l.warehouseId} on={v => upd(lines, setLines, i, { warehouseId: v })} /></div>
          <div className="col-span-1"><Qty v={l.rate || ''} on={v => upd(lines, setLines, i, { rate: v })} ph="Rate" /></div>
          <X onClick={() => setLines(lines.filter((_, x) => x !== i))} />
        </div>)}
        <p className="text-xs text-slate-400">Rate is only used when adding stock; leave blank to value at the current average cost. Write-offs go to cost of goods (Stock Adjustment).</p>
        <button type="button" onClick={() => setLines([...lines, { itemId: '', qty: '', warehouseId: whs[0]?.id || '', mode: 'delta', rate: '' }])} className="text-sm text-blue-600 hover:underline">+ Add line</button>
      </div>}

      {type === 'manufacture' && <div className="grid md:grid-cols-2 gap-5">
        {[['Materials consumed', consume, setConsume], ['Products made', produce, setProduce]].map(([title, arr, set]) => (
          <div key={title} className="space-y-2">
            <label className={labelCls}>{title}</label>
            {arr.map((l, i) => <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-6"><ItemSel items={items} v={l.itemId} on={v => upd(arr, set, i, { itemId: v })} /></div>
              <div className="col-span-3"><Qty v={l.qty} on={v => upd(arr, set, i, { qty: v })} /></div>
              <div className="col-span-2"><WhSel whs={whs} v={l.warehouseId} on={v => upd(arr, set, i, { warehouseId: v })} /></div>
              <X onClick={() => set(arr.filter((_, x) => x !== i))} />
            </div>)}
            <button type="button" onClick={() => set([...arr, { itemId: '', qty: '', warehouseId: whs[0]?.id || '' }])} className="text-sm text-blue-600 hover:underline">+ Add line</button>
          </div>
        ))}
      </div>}
      <Field label="Narration"><input value={narration} onChange={e => setNarration(e.target.value)} className={formInputCls} /></Field>
    </FormShell>
  )
}
