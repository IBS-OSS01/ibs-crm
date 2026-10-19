// Purchase voucher + Credit Note + Debit Note entry forms.
import React, { useEffect, useMemo, useState } from 'react'
import { computeVoucherTotals, supplyTypeOf } from '../utils/taxCalc.js'
import { isAccountingInvoice } from '../utils/ledger.js'
import { addDays } from '../utils/voucherEngine.js'
import { convertTotals } from '../utils/fx.js'
import ItemsEditor, { newLine, TotalsBox } from './ItemsEditor.jsx'
import { formInputCls, labelCls } from './FinanceUI.jsx'
import SearchSelect from './SearchSelect.jsx'
import { Band, Body, FRow, ReadBox, PartyBlock, SupplyChip, ItemCard, NotesTotals } from './DocLayout.jsx'
import AttachmentPanel, { useAttachmentDraft } from './AttachmentPanel.jsx'
import {
  Field, FormShell, HeaderFields, TdsBlock, finalTds, useVoucherSave, need, CostCentreSelect, useFx, CurrencyBar, groupFlag,
  vendorOptions, customerOptions, creditDaysFromTerms, companyStateCode, stateCodeFromName,
  todayStr, normName, num, gstinToStateCode, fmtAmt,
} from './formShared.jsx'

const cleanItems = (items) => items.filter(i => (i.description || '').trim() || num(i.rate) > 0)
const lineFrom = (i) => ({ description: i.description || '', hsnCode: i.hsnCode || '', qty: i.qty ?? 1, unit: i.unit || 'pcs', rate: i.rateFc ?? i.rate ?? '', discountPct: i.discountPct ?? 0, gstRate: i.gstRate ?? 18, stockItemId: i.stockItemId || '', sku: i.sku || '', accountCode: i.accountCode || '', ...(i.poLine !== undefined ? { poLine: i.poLine } : {}) })

const TERMS = [['Due on Receipt', 0], ['Net 15', 15], ['Net 30', 30], ['Net 45', 45], ['Net 60', 60]]

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
  const [subject, setSubject] = useState(seed?.subject || '')
  const [applyGst, setApplyGst] = useState(seed ? (seed.gstLines || []).length > 0 || seed.applyGst !== false : true)
  const [rcm, setRcm] = useState(!!seed?.rcm)
  const [itcEligible, setItcEligible] = useState(seed?.itcEligible !== false)
  const [items, setItems] = useState(seed?.items?.length ? seed.items.map(lineFrom) : [newLine()])
  const [tds, setTds] = useState(initial?.tds?.applicable ? { applicable: true, section: initial.tds.section, rate: initial.tds.rate, baseOverride: initial.tds.base } : { applicable: false })
  const [warehouseId, setWarehouseId] = useState(seed?.warehouseId || '')
  const draft = useAttachmentDraft()
  const fx = useFx(raw, date, seed)
  const [costCentreId, setCostCentreId] = useState(seed?.costCentreId || '')
  const [narration, setNarration] = useState(seed?.narration || '')
  const [roundEdit, setRoundEdit] = useState(seed?.roundOffManual ? String(seed.roundOff) : '')      // '' = automatic nearest rupee

  const compState = companyStateCode(raw, company)
  const vendorState = gstinToStateCode(vendor?.gstin) || stateCodeFromName(vendor?.state)
  const supplyType = supplyTypeOf(vendorState, compState)
  const totals = useMemo(() => computeVoucherTotals(items, { supplyType, applyGst, rcm, rounding: !fx.isFc, roundOff: fx.isFc ? '' : roundEdit }), [items, supplyType, applyGst, rcm, fx.isFc, roundEdit])
  // foreign currency: every ledger amount is the rupee value at the booking-date rate
  const inr = useMemo(() => (fx.isFc && fx.rate > 0 ? convertTotals(totals, fx.rate, fx.currency) : totals), [totals, fx.isFc, fx.rate, fx.currency])
  const tdsFinal = finalTds(tds, inr.subTotal)
  useEffect(() => { const s = initial; if (s && !s._clone && s.roundOff !== undefined && Math.abs((Number(s.roundOff) || 0) - totals.roundOff) > 0.005) setRoundEdit(String(s.roundOff)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
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
      need(!fx.isFc || fx.rate > 0, `Enter the exchange rate for ${fx.currency}.`)
      const tFc = computeVoucherTotals(lines, { supplyType, applyGst, rcm, rounding: !fx.isFc, roundOff: fx.isFc ? '' : roundEdit })
      const t = fx.isFc ? convertTotals(tFc, fx.rate, fx.currency) : tFc
      need(t.total > 0, 'Invoice total is zero.')
      return {
        voucherType: 'purchase', company, date, partyType: 'vendor', partyId: vendor.id, partyName: vendor.name, partyGstin: vendor.gstin,
        partyState: vendor.state, partyStateCode: vendorState, placeOfSupplyCode: compState, companyStateCode: compState, supplyType,
        refNumber: refNumber.trim(), refDate, subject: subject.trim(), creditDays: num(creditDays), dueDate: addDays(date, creditDays),
        applyGst, rcm, itcEligible, purchaseAccountCode: '5000', warehouseId, costCentreId, ...(seed?.purchaseOrderId ? { purchaseOrderId: seed.purchaseOrderId, purchaseOrderNumber: seed.purchaseOrderNumber || '' } : {}),
        items: t.items.map(i => ({ ...i, accountCode: i.accountCode || '5000' })), gstLines: t.gstLines, subTotal: t.subTotal, taxTotal: t.taxTotal,
        roundOff: t.roundOff, roundOffManual: !fx.isFc && roundEdit !== '', total: t.total, tds: finalTds(tds, t.subTotal), narration: narration.trim(),
        currency: fx.currency, fxRate: fx.isFc ? fx.rate : 1, fc: fx.isFc ? t.fc : null,
      }
    },
  })

  return (
    <FormShell title={initial && !initial._clone ? `Edit Purchase — ${initial.voucherNumber}` : 'Purchase Voucher'} subtitle="Records a vendor bill with input tax credit; the vendor's payable is raised automatically." bands onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <Band>
        <PartyBlock label="Vendor Name" options={vendors.map(v => ({ value: v.id, label: v.name }))} value={vendorId} onPick={pickVendor} name={vendor?.name} gstin={vendor?.gstin} pan={vendor?.pan} master={vendor?.raw} currency={fx.isFc ? fx.currency : 'INR'} />
        <FRow label="Destination of Supply" hint={vendor ? `Source of Supply: ${vendor.state || '—'}${vendor.gstin ? '' : ' · unregistered supplier — usually no GST, unless reverse charge applies'}` : ''}>
          <div className="flex items-center"><ReadBox>{raw?.companySettings?.[company]?.state || '—'}</ReadBox><SupplyChip ready={!!vendor} supplyType={supplyType} /></div>
          {!compState && <p className="text-xs text-amber-600 mt-1">Set your own state in Company Settings so CGST/SGST vs IGST is right.</p>}
        </FRow>
      </Band>
      <Body>
        <FRow label="Bill#" req><ReadBox mono>{initial && !initial._clone ? initial.voucherNumber : 'Assigned when saved'}</ReadBox></FRow>
        <FRow label="Order Number" hint="The vendor's own invoice / order number"><input value={refNumber} onChange={e => setRefNumber(e.target.value)} className={`${formInputCls} max-w-sm`} /></FRow>
        <FRow label="Bill Date" req>
          <div className="flex items-center gap-4 flex-wrap">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${formInputCls} max-w-[11rem]`} required />
            <span className="text-sm text-slate-700">Due Date</span><div className={`${formInputCls} max-w-[11rem] bg-slate-100`}>{addDays(date, creditDays) || '—'}</div>
          </div>
        </FRow>
        <FRow label="Payment Terms">
          <div className="flex items-center gap-3 flex-wrap">
            <select value={TERMS.some(t => t[1] === num(creditDays)) ? String(num(creditDays)) : 'custom'} onChange={e => e.target.value !== 'custom' && setCreditDays(Number(e.target.value))} className={`${formInputCls} max-w-[11rem]`}>
              {TERMS.map(([l, d]) => <option key={l} value={d}>{l}</option>)}
              {!TERMS.some(t => t[1] === num(creditDays)) && <option value="custom">Custom ({num(creditDays)} days)</option>}
            </select>
            <span className="text-xs text-slate-400">or credit days</span><input type="number" min="0" value={creditDays} onChange={e => setCreditDays(e.target.value)} className={`${formInputCls} max-w-[6rem]`} />
          </div>
        </FRow>
        <FRow label="Subject"><input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Enter a subject within 250 characters" maxLength={250} className={`${formInputCls} max-w-xl`} /></FRow>
        <FRow label="Vendor invoice date"><input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className={`${formInputCls} max-w-[11rem]`} /></FRow>
        <hr className="border-slate-200" />
        <div className="flex gap-5 flex-wrap text-sm text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={applyGst} onChange={e => { setApplyGst(e.target.checked); if (!e.target.checked) setRcm(false) }} />GST applicable</label>
          <label className="flex items-center gap-2" title="Buyer pays the GST directly to the government (unregistered supplier / notified services)"><input type="checkbox" checked={rcm} disabled={!applyGst} onChange={e => setRcm(e.target.checked)} />Reverse charge (RCM)</label>
          <label className="flex items-center gap-2" title="Untick for blocked credits under section 17(5): motor vehicles, food, club memberships, etc."><input type="checkbox" checked={itcEligible} onChange={e => setItcEligible(e.target.checked)} />Input tax credit eligible</label>
        </div>
        <CurrencyBar fx={fx} date={date} totalFc={totals.total} />
        <div className="grid md:grid-cols-2 gap-3">
          <CostCentreSelect raw={raw} value={costCentreId} onChange={setCostCentreId} />
          {(raw.warehouses || []).length > 0 && (raw.stockItems || []).length > 0 && (
            <Field label="Receive stock into godown"><select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={formInputCls}><option value="">Default godown</option>{raw.warehouses.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}</select></Field>
          )}
        </div>
        <ItemCard>
          <ItemsEditor items={items} onChange={setItems} computed={totals.items} date={date} stockItems={stockItems} hsnCodes={raw.hsnCodes || []} symbol={fx.symbol}
            accounts={expenseAccounts} accountLabel="Purchase ledger" defaultAccountCode="5000" applyGst={applyGst} />
        </ItemCard>
        <NotesTotals
          left={<>
            <Field label="Notes"><textarea value={narration} onChange={e => setNarration(e.target.value)} className={`${formInputCls} h-20 resize-none`} placeholder="Optional note" /></Field>
            <TdsBlock raw={raw} vendor={vendor} date={date} base={inr.subTotal} tds={tds} setTds={setTds} fy={date ? `${String(Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0)).slice(2)}-${String(Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0) + 1).slice(2)}` : ''}
              partyId={vendor?.id} currentDocId={initial?.id} />
            <AttachmentPanel entityType="purchase" entityId={initial?.id} company={company} draft={draft} label="Attach file(s) to this bill" />
          </>}
          right={<TotalsBox totals={totals} rcm={rcm} tds={fx.isFc ? null : tdsFinal} symbol={fx.symbol} inr={fx.isFc ? inr : null} roundEdit={roundEdit} onRoundEdit={fx.isFc ? undefined : setRoundEdit}
            extra={applyGst && itcEligible && inr.taxTotal > 0 && <div className="flex justify-between text-green-700 text-xs"><span>ITC claimable (₹)</span><span>{fmtAmt(inr.taxTotal)}</span></div>} />} />
      </Body>
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
  const [refNumber, setRefNumber] = useState(initial?.refNumber || '')
  const [items, setItems] = useState(initial?.items?.length ? initial.items.map(lineFrom) : [newLine()])
  const [applyGst, setApplyGst] = useState(initial ? initial.applyGst !== false : true)
  const [supplyType, setSupplyType] = useState(initial?.supplyType || 'intra')
  const [itcEligible, setItcEligible] = useState(initial?.itcEligible !== false)
  const [narration, setNarration] = useState(initial?.narration || '')
  const [costCentreId, setCostCentreId] = useState(initial?.costCentreId || '')
  const draft = useAttachmentDraft()
  const fx = useFx(raw, date, initial)

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
    // a note against a foreign-currency document keeps that document's currency and booking rate
    const oc = o.fx?.currency || o.currency
    if (oc && oc !== 'INR') { fx.setCurrency(oc); fx.setRate(String(o.fx?.rate || o.fxRate || '')) } else fx.setCurrency('INR')
  }

  const [roundEdit, setRoundEdit] = useState(initial?.roundOffManual ? String(initial.roundOff) : '')      // '' = automatic nearest rupee
  const totals = useMemo(() => computeVoucherTotals(items, { supplyType, applyGst, rounding: !fx.isFc, roundOff: fx.isFc ? '' : roundEdit }), [items, supplyType, applyGst, fx.isFc, roundEdit])
  const inr = useMemo(() => (fx.isFc && fx.rate > 0 ? convertTotals(totals, fx.rate, fx.currency) : totals), [totals, fx.isFc, fx.rate, fx.currency])
  useEffect(() => { const s = initial; if (s && !s._clone && s.roundOff !== undefined && Math.abs((Number(s.roundOff) || 0) - totals.roundOff) > 0.005) setRoundEdit(String(s.roundOff)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { save, saving, error } = useVoucherSave({
    initial, onSaved, draft,
    getPayload: () => {
      need(party, `Select the ${isCredit ? 'customer' : 'vendor'}.`)
      const lines = cleanItems(items)
      need(lines.length > 0, 'Add at least one line.')
      need(!fx.isFc || fx.rate > 0, `Enter the exchange rate for ${fx.currency}.`)
      const tFc = computeVoucherTotals(lines, { supplyType, applyGst, rounding: !fx.isFc, roundOff: fx.isFc ? '' : roundEdit })
      const t = fx.isFc ? convertTotals(tFc, fx.rate, fx.currency) : tFc
      need(t.total > 0, 'Note value is zero.')
      const origTotal = fx.isFc ? num(original?.fx?.total ?? original?.fc?.total) : num(original?.total)
      if (original && isCredit && origTotal) need(tFc.total <= origTotal + 0.5, `Credit note (${fmtAmt(tFc.total)}) exceeds the original invoice (${fmtAmt(origTotal)}).`)
      return {
        voucherType: type, company, date, partyType: isCredit ? 'customer' : 'vendor', partyId: party.id, partyName: party.name, partyGstin: party.gstin,
        ...(isCredit && company === 'UIPL' ? groupFlag(raw, party.name) : { interCompany: null }),
        ...(isCredit
          ? { refInvoiceId: original?.id || '', refInvoiceNumber: original?.invoiceNumber || '', refInvoiceDate: original?.invoiceDate || '', placeOfSupplyCode: original?.posStateCode || '' }
          : { refPurchaseId: original?.id || '', refInvoiceNumber: original?.refNumber || original?.voucherNumber || '', refInvoiceDate: original?.refDate || original?.date || '' }),
        refNumber: refNumber.trim(), reasonCode, reason: CN_REASONS.find(r => r[0] === reasonCode)?.[1] || '', applyGst, supplyType, itcEligible, costCentreId,
        companyStateCode: companyStateCode(raw, company),
        items: t.items, gstLines: t.gstLines, subTotal: t.subTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, roundOffManual: !fx.isFc && roundEdit !== '', total: t.total, narration: narration.trim(),
        currency: fx.currency, fxRate: fx.isFc ? fx.rate : 1, fc: fx.isFc ? t.fc : null,
      }
    },
  })

  const label = isCredit ? 'Credit Note' : 'Debit Note'
  return (
    <FormShell title={initial && !initial._clone ? `Edit ${label} — ${initial.voucherNumber}` : `${label} Voucher`}
      subtitle={isCredit ? 'Issued to a customer for sales returns, post-sale discounts or invoice corrections — reduces what they owe and your output GST.'
        : 'Issued to a vendor for purchase returns or rate differences — reduces what you owe and reverses the input tax credit.'}
      bands onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <Band>
        <PartyBlock label={isCredit ? 'Customer Name' : 'Vendor Name'} options={parties.map(p => ({ value: p.key, label: p.name }))} value={partyKey} onPick={v => { setPartyKey(v); setRefId('') }}
          name={party?.name} gstin={party?.gstin} master={isCredit ? (raw.customers || []).find(c => c.id === party?.id) : (raw.vendors || []).find(v => v.id === party?.id)} currency={fx.isFc ? fx.currency : 'INR'} />
        <FRow label={isCredit ? 'Against Invoice#' : 'Against Bill#'} hint={original ? 'Items, GST rates and supply type loaded from the original — reduce quantities to the returned amount, or replace with a single "post-sale discount" line.' : (partyKey ? 'GST law expects a credit / debit note to refer to the original document' : '')}>
          <select value={refId} onChange={e => loadOriginal(e.target.value)} className={`${formInputCls} max-w-xl`} disabled={!partyKey}>
            <option value="">{partyKey ? (originals.length ? '— none (not recommended) —' : 'No documents found for this party') : 'Select a party first'}</option>
            {originals.map(o => isCredit
              ? <option key={o.id} value={o.id}>{o.invoiceNumber} · {o.invoiceDate} · {o.fx?.currency && o.fx.currency !== 'INR' ? `${o.fx.currency} ${fmtAmt(o.fx.total)}` : `₹${fmtAmt(o.total)}`}</option>
              : <option key={o.id} value={o.id}>{o.voucherNumber}{o.refNumber ? ` (${o.refNumber})` : ''} · {o.date} · {o.fc?.currency ? `${o.fc.currency} ${fmtAmt(o.fc.total)}` : `₹${fmtAmt(o.total)}`}</option>)}
          </select>
        </FRow>
        <FRow label="Reason"><select value={reasonCode} onChange={e => setReasonCode(e.target.value)} className={`${formInputCls} max-w-sm`}>{CN_REASONS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></FRow>
      </Band>
      <Body>
        <FRow label={`${label}#`} req><ReadBox mono>{initial && !initial._clone ? initial.voucherNumber : 'Assigned when saved'}</ReadBox></FRow>
        <FRow label="Reference#"><input value={refNumber} onChange={e => setRefNumber(e.target.value)} className={`${formInputCls} max-w-sm`} /></FRow>
        <FRow label={`${label} Date`} req><input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${formInputCls} max-w-[11rem]`} required /></FRow>
        <hr className="border-slate-200" />
        <div className="flex gap-5 flex-wrap items-center text-sm text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={applyGst} onChange={e => setApplyGst(e.target.checked)} />GST applicable</label>
          <label className="flex items-center gap-2">Supply
            <select value={supplyType} onChange={e => setSupplyType(e.target.value)} className="px-2 py-1 border border-slate-300 rounded-md text-sm"><option value="intra">Intra-state (CGST+SGST)</option><option value="inter">Inter-state (IGST)</option></select>
          </label>
          {!isCredit && <label className="flex items-center gap-2"><input type="checkbox" checked={itcEligible} onChange={e => setItcEligible(e.target.checked)} />ITC was claimed on original</label>}
        </div>
        <CurrencyBar fx={fx} date={date} totalFc={totals.total} />
        <CostCentreSelect raw={raw} value={costCentreId} onChange={setCostCentreId} />
        <ItemCard>
          <ItemsEditor items={items} onChange={setItems} computed={totals.items} date={date} stockItems={raw.stockItems || []} hsnCodes={raw.hsnCodes || []} applyGst={applyGst} symbol={fx.symbol} />
        </ItemCard>
        <NotesTotals
          left={<>
            <Field label="Notes"><textarea value={narration} onChange={e => setNarration(e.target.value)} className={`${formInputCls} h-20 resize-none`} /></Field>
            <AttachmentPanel entityType={type} entityId={initial?.id} company={company} draft={draft} label="Supporting document" />
          </>}
          right={<TotalsBox totals={totals} symbol={fx.symbol} inr={fx.isFc ? inr : null} roundEdit={roundEdit} onRoundEdit={fx.isFc ? undefined : setRoundEdit} />} />
      </Body>
    </FormShell>
  )
}
