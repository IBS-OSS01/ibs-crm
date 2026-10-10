// Purchase voucher + Credit Note + Debit Note entry forms.
import React, { useMemo, useState } from 'react'
import { computeVoucherTotals, supplyTypeOf } from '../utils/taxCalc.js'
import { isAccountingInvoice } from '../utils/ledger.js'
import { addDays } from '../utils/voucherEngine.js'
import ItemsEditor, { newLine, TotalsBox } from './ItemsEditor.jsx'
import { formInputCls, labelCls } from './FinanceUI.jsx'
import AttachmentPanel, { useAttachmentDraft } from './AttachmentPanel.jsx'
import {
  Field, FormShell, HeaderFields, TdsBlock, finalTds, useVoucherSave, need, CostCentreSelect,
  vendorOptions, customerOptions, creditDaysFromTerms, companyStateCode, stateCodeFromName,
  todayStr, normName, num, gstinToStateCode, fmtAmt,
} from './formShared.jsx'

const cleanItems = (items) => items.filter(i => (i.description || '').trim() || num(i.rate) > 0)
const lineFrom = (i) => ({ description: i.description || '', hsnCode: i.hsnCode || '', qty: i.qty ?? 1, unit: i.unit || 'pcs', rate: i.rate ?? '', discountPct: i.discountPct ?? 0, gstRate: i.gstRate ?? 18, stockItemId: i.stockItemId || '', sku: i.sku || '', accountCode: i.accountCode || '', ...(i.poLine !== undefined ? { poLine: i.poLine } : {}) })

// ═══ PURCHASE ═══════════════════════════════════════════════════════════════
export function PurchaseForm({ data, initial, prefill, onSaved, onCancel }) {
  const { raw, accounts } = data
  const seed = initial || prefill   // prefill = pending lines of a purchase order
  const [company, setCompany] = useState(seed?.company || 'UIPL')
  const [date, setDate] = useState(seed?.date || todayStr())
  const vendors = useMemo(() => vendorOptions(raw), [raw])
  const [vendorId, setVendorId] = useState(seed?.partyId || '')
  const vendor = vendors.find(v => v.id === vendorId)
  const [refNumber, setRefNumber] = useState(seed?.refNumber || '')
  const [refDate, setRefDate] = useState(seed?.refDate || '')
  const [creditDays, setCreditDays] = useState(seed?.creditDays ?? 0)
  const [applyGst, setApplyGst] = useState(seed ? (seed.gstLines || []).length > 0 || seed.applyGst !== false : true)
  const [rcm, setRcm] = useState(!!seed?.rcm)
  const [itcEligible, setItcEligible] = useState(seed?.itcEligible !== false)
  const [items, setItems] = useState(seed?.items?.length ? seed.items.map(lineFrom) : [newLine()])
  const [tds, setTds] = useState(initial?.tds?.applicable ? { applicable: true, section: initial.tds.section, rate: initial.tds.rate, baseOverride: initial.tds.base } : { applicable: false })
  const [warehouseId, setWarehouseId] = useState(seed?.warehouseId || '')
  const draft = useAttachmentDraft()
  const [costCentreId, setCostCentreId] = useState(seed?.costCentreId || '')
  const [narration, setNarration] = useState(seed?.narration || '')

  const compState = companyStateCode(raw, company)
  const vendorState = gstinToStateCode(vendor?.gstin) || stateCodeFromName(vendor?.state)
  const supplyType = supplyTypeOf(vendorState, compState)
  const totals = useMemo(() => computeVoucherTotals(items, { supplyType, applyGst, rcm }), [items, supplyType, applyGst, rcm])
  const tdsFinal = finalTds(tds, totals.subTotal)
  const expenseAccounts = useMemo(() => accounts.filter(a => a.type === 'expense' || a.code === '1500' || a.code === '1900'), [accounts])
  const stockItems = raw.stockItems || []

  const pickVendor = (id) => {
    setVendorId(id)
    const v = vendors.find(x => x.id === id)
    if (!v) return
    setCreditDays(creditDaysFromTerms(v.paymentTerms))
    setApplyGst(!!v.gstin)
    const sec = v.raw?.tdsSection
    if (sec) setTds({ applicable: true, section: sec, rate: v.raw?.tdsRate ?? '' })
  }

  const { save, saving, error } = useVoucherSave({
    initial, onSaved, draft,
    getPayload: () => {
      need(vendor, 'Select a vendor (add one under Parties → Vendors if it is new).')
      const lines = cleanItems(items)
      need(lines.length > 0, 'Add at least one line item with a rate.')
      need(!(rcm && !applyGst), 'Reverse charge needs GST to be applied.')
      const t = computeVoucherTotals(lines, { supplyType, applyGst, rcm })
      need(t.total > 0, 'Invoice total is zero.')
      return {
        voucherType: 'purchase', company, date, partyType: 'vendor', partyId: vendor.id, partyName: vendor.name, partyGstin: vendor.gstin,
        partyState: vendor.state, partyStateCode: vendorState, placeOfSupplyCode: compState, companyStateCode: compState, supplyType,
        refNumber: refNumber.trim(), refDate, creditDays: num(creditDays), dueDate: addDays(date, creditDays),
        applyGst, rcm, itcEligible, purchaseAccountCode: '5000', warehouseId, costCentreId, ...(seed?.purchaseOrderId ? { purchaseOrderId: seed.purchaseOrderId, purchaseOrderNumber: seed.purchaseOrderNumber || '' } : {}),
        items: t.items.map(i => ({ ...i, accountCode: i.accountCode || '5000' })), gstLines: t.gstLines, subTotal: t.subTotal, taxTotal: t.taxTotal,
        roundOff: t.roundOff, total: t.total, tds: finalTds(tds, t.subTotal), narration: narration.trim(),
      }
    },
  })

  return (
    <FormShell title={initial ? `Edit Purchase — ${initial.voucherNumber}` : 'Purchase Voucher'} subtitle="Records a vendor bill with input tax credit; the vendor's payable is raised automatically." onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <HeaderFields company={company} setCompany={setCompany} date={date} setDate={setDate} locked={!!initial}
        extra={<>
          <Field label="Vendor *">
            <select value={vendorId} onChange={e => pickVendor(e.target.value)} className={formInputCls} required>
              <option value="">— select vendor —</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Vendor invoice no."><input value={refNumber} onChange={e => setRefNumber(e.target.value)} className={formInputCls} /></Field>
        </>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Vendor invoice date"><input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className={formInputCls} /></Field>
        <Field label="Credit days"><input type="number" min="0" value={creditDays} onChange={e => setCreditDays(e.target.value)} className={formInputCls} /></Field>
        <Field label="Due date"><div className={`${formInputCls} bg-slate-100`}>{addDays(date, creditDays) || '—'}</div></Field>
        <Field label="Supply"><div className={`${formInputCls} bg-slate-100`}>{vendor ? (supplyType === 'intra' ? 'Intra-state → CGST + SGST' : 'Inter-state → IGST') : '—'}</div></Field>
      </div>
      {vendor && <p className="text-xs text-slate-500 -mt-2">GSTIN {vendor.gstin || <span className="text-amber-600">not on file (unregistered supplier — usually no GST, unless reverse charge applies)</span>} · {vendor.state || 'state not set'}{!compState && <span className="text-amber-600"> · set your own state in Company Settings so CGST/SGST vs IGST is right</span>}</p>}
      <CostCentreSelect raw={raw} value={costCentreId} onChange={setCostCentreId} />
      {(raw.warehouses || []).length > 0 && (raw.stockItems || []).length > 0 && (
        <Field label="Receive stock into godown" className="max-w-xs"><select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={formInputCls}><option value="">Default godown</option>{raw.warehouses.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}</select></Field>
      )}
      <div className="flex gap-5 flex-wrap text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={applyGst} onChange={e => { setApplyGst(e.target.checked); if (!e.target.checked) setRcm(false) }} />GST applicable</label>
        <label className="flex items-center gap-2" title="Buyer pays the GST directly to the government (unregistered supplier / notified services)"><input type="checkbox" checked={rcm} disabled={!applyGst} onChange={e => setRcm(e.target.checked)} />Reverse charge (RCM)</label>
        <label className="flex items-center gap-2" title="Untick for blocked credits under section 17(5): motor vehicles, food, club memberships, etc."><input type="checkbox" checked={itcEligible} onChange={e => setItcEligible(e.target.checked)} />Input tax credit eligible</label>
      </div>
      <ItemsEditor items={items} onChange={setItems} computed={totals.items} date={date} stockItems={stockItems} hsnCodes={raw.hsnCodes || []}
        accounts={expenseAccounts} accountLabel="Purchase ledger" defaultAccountCode="5000" applyGst={applyGst} />
      <TdsBlock raw={raw} vendor={vendor} date={date} base={totals.subTotal} tds={tds} setTds={setTds} fy={date ? `${String(Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0)).slice(2)}-${String(Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0) + 1).slice(2)}` : ''}
        partyId={vendor?.id} currentDocId={initial?.id} />
      <AttachmentPanel entityType="purchase" entityId={initial?.id} company={company} draft={draft} label="Vendor bill / challan" />
      <Field label="Narration"><input value={narration} onChange={e => setNarration(e.target.value)} className={formInputCls} placeholder="Optional note" /></Field>
      <TotalsBox totals={totals} rcm={rcm} tds={tdsFinal}
        extra={applyGst && itcEligible && totals.taxTotal > 0 && <div className="flex justify-between text-green-700 text-xs"><span>ITC claimable</span><span>{fmtAmt(totals.taxTotal)}</span></div>} />
    </FormShell>
  )
}

// ═══ CREDIT NOTE (to customer) / DEBIT NOTE (to vendor) ═════════════════════
export const CN_REASONS = [
  ['01', 'Sales return'], ['02', 'Post-sale discount'], ['03', 'Deficiency in services'], ['04', 'Correction in invoice'],
  ['05', 'Change in place of supply'], ['06', 'Finalization of provisional assessment'], ['07', 'Others'],
]

export function NoteForm({ type, data, initial, onSaved, onCancel }) {
  const isCredit = type === 'credit_note'
  const { raw } = data
  const [company, setCompany] = useState(initial?.company || 'UIPL')
  const [date, setDate] = useState(initial?.date || todayStr())
  const [partyKey, setPartyKey] = useState(initial ? normName(initial.partyName) : '')
  const [refId, setRefId] = useState(initial?.refInvoiceId || initial?.refPurchaseId || '')
  const [reasonCode, setReasonCode] = useState(initial?.reasonCode || '01')
  const [items, setItems] = useState(initial?.items?.length ? initial.items.map(lineFrom) : [newLine()])
  const [applyGst, setApplyGst] = useState(initial ? initial.applyGst !== false : true)
  const [supplyType, setSupplyType] = useState(initial?.supplyType || 'intra')
  const [itcEligible, setItcEligible] = useState(initial?.itcEligible !== false)
  const [narration, setNarration] = useState(initial?.narration || '')
  const [costCentreId, setCostCentreId] = useState(initial?.costCentreId || '')
  const draft = useAttachmentDraft()

  // Parties that actually have documents to refer back to, plus master parties.
  const invoices = useMemo(() => (raw.invoices || []).filter(i => isAccountingInvoice(i) && i.invoiceDate && i.company === company), [raw, company])
  const purchases = useMemo(() => (raw.vouchers || []).filter(v => v.voucherType === 'purchase' && v.status !== 'cancelled' && v.company === company), [raw, company])
  const parties = useMemo(() => {
    const m = {}
    if (isCredit) {
      customerOptions(raw, company).forEach(c => { m[normName(c.name)] = { key: normName(c.name), name: c.name, id: c.id, gstin: c.gstin } })
      invoices.forEach(i => { const k = normName(i.billToName); if (k && !m[k]) m[k] = { key: k, name: i.billToName, id: i.customerId || '', gstin: i.billToGstin || '' } })
    } else {
      vendorOptions(raw).forEach(v => { m[normName(v.name)] = { key: normName(v.name), name: v.name, id: v.id, gstin: v.gstin } })
    }
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name))
  }, [raw, company, invoices, isCredit])
  const party = parties.find(p => p.key === partyKey)

  const originals = useMemo(() => isCredit
    ? invoices.filter(i => normName(i.billToName) === partyKey).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))
    : purchases.filter(v => normName(v.partyName) === partyKey).sort((a, b) => b.date.localeCompare(a.date)), [isCredit, invoices, purchases, partyKey])
  const original = originals.find(o => o.id === refId)

  const loadOriginal = (id) => {
    setRefId(id)
    const o = originals.find(x => x.id === id)
    if (!o) return
    if (isCredit) {
      setApplyGst(o.applyGst !== false)
      setSupplyType(supplyTypeOf(o.sellerStateCode, o.posStateCode))
    } else {
      setApplyGst((o.gstLines || []).length > 0); setSupplyType(o.supplyType || 'intra'); setItcEligible(o.itcEligible !== false)
    }
    setItems((o.items || []).map(lineFrom).concat([]).length ? (o.items || []).map(lineFrom) : [newLine()])
  }

  const totals = useMemo(() => computeVoucherTotals(items, { supplyType, applyGst }), [items, supplyType, applyGst])

  const { save, saving, error } = useVoucherSave({
    initial, onSaved, draft,
    getPayload: () => {
      need(party, `Select the ${isCredit ? 'customer' : 'vendor'}.`)
      const lines = cleanItems(items)
      need(lines.length > 0, 'Add at least one line.')
      const t = computeVoucherTotals(lines, { supplyType, applyGst })
      need(t.total > 0, 'Note value is zero.')
      if (original && isCredit) need(t.total <= num(original.total) + 0.5, `Credit note (${fmtAmt(t.total)}) exceeds the original invoice (${fmtAmt(original.total)}).`)
      return {
        voucherType: type, company, date, partyType: isCredit ? 'customer' : 'vendor', partyId: party.id, partyName: party.name, partyGstin: party.gstin,
        ...(isCredit
          ? { refInvoiceId: original?.id || '', refInvoiceNumber: original?.invoiceNumber || '', refInvoiceDate: original?.invoiceDate || '', placeOfSupplyCode: original?.posStateCode || '' }
          : { refPurchaseId: original?.id || '', refInvoiceNumber: original?.refNumber || original?.voucherNumber || '', refInvoiceDate: original?.refDate || original?.date || '' }),
        reasonCode, reason: CN_REASONS.find(r => r[0] === reasonCode)?.[1] || '', applyGst, supplyType, itcEligible, costCentreId,
        companyStateCode: companyStateCode(raw, company),
        items: t.items, gstLines: t.gstLines, subTotal: t.subTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total, narration: narration.trim(),
      }
    },
  })

  const label = isCredit ? 'Credit Note' : 'Debit Note'
  return (
    <FormShell title={initial ? `Edit ${label} — ${initial.voucherNumber}` : `${label} Voucher`}
      subtitle={isCredit ? 'Issued to a customer for sales returns, post-sale discounts or invoice corrections — reduces what they owe and your output GST.'
        : 'Issued to a vendor for purchase returns or rate differences — reduces what you owe and reverses the input tax credit.'}
      onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <HeaderFields company={company} setCompany={c => { setCompany(c); setPartyKey(''); setRefId('') }} date={date} setDate={setDate} locked={!!initial}
        extra={<>
          <Field label={`${isCredit ? 'Customer' : 'Vendor'} *`}>
            <select value={partyKey} onChange={e => { setPartyKey(e.target.value); setRefId('') }} className={formInputCls} required>
              <option value="">— select —</option>{parties.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Reason">
            <select value={reasonCode} onChange={e => setReasonCode(e.target.value)} className={formInputCls}>{CN_REASONS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
          </Field>
        </>} />
      <div>
        <label className={labelCls}>Against original {isCredit ? 'invoice' : 'purchase voucher'} {partyKey && !original && <span className="text-amber-600 normal-case font-normal"> — GST law expects a credit/debit note to refer to the original document</span>}</label>
        <select value={refId} onChange={e => loadOriginal(e.target.value)} className={formInputCls} disabled={!partyKey}>
          <option value="">{partyKey ? (originals.length ? '— none (not recommended) —' : 'No documents found for this party') : 'Select a party first'}</option>
          {originals.map(o => isCredit
            ? <option key={o.id} value={o.id}>{o.invoiceNumber} · {o.invoiceDate} · ₹{fmtAmt(o.total)}</option>
            : <option key={o.id} value={o.id}>{o.voucherNumber}{o.refNumber ? ` (${o.refNumber})` : ''} · {o.date} · ₹{fmtAmt(o.total)}</option>)}
        </select>
        {original && <p className="text-xs text-slate-400 mt-1">Items, GST rates and supply type loaded from the original — reduce quantities to the returned amount, or replace with a single "post-sale discount" line.</p>}
      </div>
      <CostCentreSelect raw={raw} value={costCentreId} onChange={setCostCentreId} />
      <div className="flex gap-5 flex-wrap text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={applyGst} onChange={e => setApplyGst(e.target.checked)} />GST applicable</label>
        <label className="flex items-center gap-2">Supply
          <select value={supplyType} onChange={e => setSupplyType(e.target.value)} className="px-2 py-1 border border-slate-300 rounded-md text-sm"><option value="intra">Intra-state (CGST+SGST)</option><option value="inter">Inter-state (IGST)</option></select>
        </label>
        {!isCredit && <label className="flex items-center gap-2"><input type="checkbox" checked={itcEligible} onChange={e => setItcEligible(e.target.checked)} />ITC was claimed on original</label>}
      </div>
      <ItemsEditor items={items} onChange={setItems} computed={totals.items} date={date} stockItems={raw.stockItems || []} hsnCodes={raw.hsnCodes || []} applyGst={applyGst} />
      <AttachmentPanel entityType={type} entityId={initial?.id} company={company} draft={draft} label="Supporting document" />
      <Field label="Narration"><input value={narration} onChange={e => setNarration(e.target.value)} className={formInputCls} /></Field>
      <TotalsBox totals={totals} />
    </FormShell>
  )
}
