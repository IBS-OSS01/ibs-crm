// Payment, Receipt and Contra vouchers.
import React, { useMemo, useState } from 'react'
import { pendingBillsForParty } from '../utils/outstanding.js'
import { fyOf } from '../utils/financeConstants.js'
import { formInputCls, labelCls } from './FinanceUI.jsx'
import SearchSelect from './SearchSelect.jsx'
import AttachmentPanel, { useAttachmentDraft } from './AttachmentPanel.jsx'
import {
  Field, FormShell, HeaderFields, TdsBlock, finalTds, useVoucherSave, need, CostCentreSelect, useFx, CurrencyBar, groupFlag,
  cashBankOptions, customerOptions, vendorOptions, tdsSectionList,
  todayStr, normName, num, fmtAmt, fdOptions } from './formShared.jsx'
import { r2 } from '../utils/financeConstants.js'

// Fixed deposits, trust funds, investments: listed first wherever a ledger has to be picked.
export const isInvestmentName = (n) => (/deposit|\bfd\b|trust|invest|bond|mutual/i.test(n || '') ? 1 : 0)
const bankKeyOf = (code, id) => (code === '1110' ? (id ? `cash:${id}` : 'cash') : (id ? `bank:${id}` : 'bank-default'))

// ─── allocation table: tick bills and set how much of this payment goes to each ──
// In a foreign currency the bill shows what is still owed in that currency and the amounts you type are in it too.
const bookInr = (b, fcAmt) => (b.fcPending !== undefined && num(fcAmt) >= b.fcPending - 0.005 ? b.pending : r2(num(fcAmt) * num(b.fxRate)))

function AllocationTable({ bills, alloc, setAlloc, fx, noun = 'Bill' }) {
  const isFc = !!fx?.isFc
  if (!bills.length) return <p className="text-xs text-slate-400">{isFc ? `No pending ${fx.currency} ${noun.toLowerCase()}s for this party — the amount will be recorded as an advance / on-account.` : `No pending ${noun.toLowerCase()}s for this party — the amount will be recorded as an advance / on-account.`}</p>
  const setAmt = (b, v) => setAlloc({ ...alloc, [b.billKey]: v })
  const total = r2(bills.reduce((t, b) => t + num(alloc[b.billKey]), 0))
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase"><tr>
          <th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">{noun === 'Invoice' ? 'Invoice Number' : 'Bill#'}</th>
          <th className="text-right px-3 py-2">{noun} Amount</th>{isFc && <th className="text-right px-3 py-2">Booked at</th>}
          <th className="text-right px-3 py-2">Amount Due{isFc ? ` (${fx.symbol})` : ''}</th><th className="text-right px-3 py-2 w-36">Payment{isFc ? ` (${fx.symbol})` : ''}</th><th className="w-16" />
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {bills.map(b => {
            const max = isFc ? b.fcPending : b.pending
            return (
              <tr key={b.billKey}>
                <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{b.date}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{b.docNo}{b.externalRef ? <span className="text-slate-400"> ({b.externalRef})</span> : null}</td>
                <td className="px-3 py-1.5 text-right text-slate-500">{fmtAmt(b.original ?? b.pending)}</td>
                {isFc && <td className="px-3 py-1.5 text-right text-xs text-slate-500">@ {b.fxRate} = ₹{fmtAmt(b.pending)}</td>}
                <td className="px-3 py-1.5 text-right">{fmtAmt(max)}{b.daysOverdue > 0 && <span className="block text-[10px] text-red-600">overdue {b.daysOverdue}d · due {b.dueDate}</span>}</td>
                <td className="px-3 py-1.5"><input type="number" min="0" step="any" max={max} value={alloc[b.billKey] ?? ''} onChange={e => setAmt(b, e.target.value)} className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm text-right" /></td>
                <td className="px-1"><button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setAmt(b, max)}>full</button></td>
              </tr>
            )
          })}
        </tbody>
        <tfoot><tr className="bg-slate-50 font-semibold"><td className="px-3 py-2" colSpan={isFc ? 4 : 3}>Total :</td><td className="px-3 py-2 text-right">{fmtAmt(total)}</td><td colSpan={2} /></tr></tfoot>
      </table>
    </div>
  )
}

export const PAYMENT_MODES = ['Cash', 'Cheque', 'Bank Transfer', 'Bank Remittance', 'UPI', 'Card', 'Other']
const defaultMode = (bank) => (bank?.code === '1110' ? 'Cash' : 'Bank Transfer')

// Pay the oldest bills first with a typed amount (Zoho does this when "Payment Made / Amount Received" is typed); the rest is an advance.
function autoAllocate(bills, amount, isFc) {
  let left = num(amount); const alloc = {}
  for (const b of [...bills].sort((x, y) => (x.date || '').localeCompare(y.date || ''))) {
    if (left <= 0) break
    const max = isFc ? b.fcPending : b.pending
    const t = Math.min(left, max)
    if (t > 0) { alloc[b.billKey] = String(r2(t)); left = r2(left - t) }
  }
  return { alloc, rest: left > 0.004 ? String(r2(left)) : '' }
}

// Shared by payment / receipt: bills for the chosen party, with the voucher's own
// current allocation added back when editing so its amounts can be changed.
// Bills in another currency only appear when the voucher is in that currency (and vice versa).
function useBills({ allLines, kind, company, party, date, initial, fx }) {
  return useMemo(() => {
    if (!party) return []
    const bills = pendingBillsForParty(allLines, { kind, company, partyName: party.name, partyId: party.id, asOf: '9999-12-31' })
    const own = {}, ownFc = {}
    ;(initial?.allocations || []).forEach(a => { own[a.billKey] = (own[a.billKey] || 0) + num(a.amount); ownFc[a.billKey] = (ownFc[a.billKey] || 0) + num(a.fcAmount) })
    const today = new Date(todayStr() + 'T00:00:00')
    return bills
      .filter(b => (fx?.isFc ? b.currency === fx.currency : !b.currency))
      .map(b => ({ ...b, pending: r2(b.pending + (own[b.billKey] || 0)), ...(b.fcPending !== undefined ? { fcPending: r2(b.fcPending + (ownFc[b.billKey] || 0)) } : {}), daysOverdue: Math.round((today - new Date(b.dueDate + 'T00:00:00')) / 86400000) }))
  }, [allLines, kind, company, party, initial, fx?.isFc, fx?.currency])
}

const initAlloc = (initial) => Object.fromEntries((initial?.allocations || []).map(a => [a.billKey, a.fcAmount ?? a.amount]))

// Rupee figures for a settlement. In INR everything is as typed; in a foreign currency the bills clear at their own
// booking rate, the money actually moves at this voucher's rate, and the difference is the exchange gain / loss.
function settlement({ fx, bills, alloc, onAccount, accLines }) {
  const rows = bills.filter(b => num(alloc[b.billKey]) > 0).map(b => {
    const typed = num(alloc[b.billKey])
    return fx.isFc
      ? { b, typed, amount: bookInr(b, typed), fcAmount: typed, billRate: b.fxRate }
      : { b, typed, amount: r2(typed) }
  })
  const allocInr = r2(rows.reduce((s, r) => s + r.amount, 0))
  const allocFc = r2(rows.reduce((s, r) => s + (r.fcAmount || 0), 0))
  const onAccInr = fx.isFc ? r2(num(onAccount) * fx.rate) : r2(num(onAccount))
  const lines = accLines.filter(l => num(l.amount) > 0).map(l => ({ ...l, ...(fx.isFc ? { amountFc: num(l.amount), amount: r2(num(l.amount) * fx.rate) } : { amount: num(l.amount) }) }))
  const accSum = r2(lines.reduce((s, l) => s + l.amount, 0))
  const partyAmount = r2(allocInr + onAccInr)
  const partyMoney = fx.isFc ? r2(r2(allocFc * fx.rate) + onAccInr) : partyAmount        // rupees that really change hands for the party part
  return { rows, partyAmount, partyMoney, onAccInr, lines, accSum, fxDiff: r2(partyMoney - partyAmount) }
}

function AccountLines({ lines, setLines, accounts, label, symbol }) {
  const upd = (i, patch) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between"><label className={labelCls}>{label}</label>
        <button type="button" onClick={() => setLines([...lines, { accountCode: '', amount: '', description: '' }])} className="text-sm text-blue-600 hover:underline">+ Add ledger</button></div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <select value={l.accountCode} onChange={e => upd(i, { accountCode: e.target.value })} className={`${formInputCls} col-span-5`}>
            <option value="">— ledger —</option>{accounts.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
          </select>
          <input value={l.description} onChange={e => upd(i, { description: e.target.value })} placeholder="Description" className={`${formInputCls} col-span-4`} />
          <input type="number" min="0" step="any" value={l.amount} onChange={e => upd(i, { amount: e.target.value })} placeholder={symbol && symbol !== '₹' ? `Amount (${symbol})` : 'Amount'} className={`${formInputCls} col-span-2 text-right`} />
          <button type="button" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500">✕</button>
        </div>
      ))}
    </div>
  )
}

const SumRow = ({ label, value, strong, tone = '' }) => (
  <div className={`flex justify-between ${strong ? 'font-bold border-t border-slate-200 pt-1.5 text-slate-800' : 'text-slate-600'} ${tone}`}><span>{label}</span><span>{fmtAmt(value)}</span></div>
)

// ═══ PAYMENT ════════════════════════════════════════════════════════════════
export function PaymentForm({ data, initial, onSaved, onCancel, startMode }) {
  const { raw, accounts, allLines } = data
  const [company, setCompany] = useState(initial?.company || 'UIPL')
  const [date, setDate] = useState(initial?.date || todayStr())
  const [mode, setMode] = useState(initial ? (initial.partyName ? 'vendor' : 'expense') : (startMode || 'vendor'))
  const vendors = useMemo(() => vendorOptions(raw), [raw])
  const [vendorId, setVendorId] = useState(initial?.partyId || '')
  const vendor = vendors.find(v => v.id === vendorId) || (initial?.partyName && !initial.partyId ? { id: '', name: initial.partyName, pan: '' } : null)
  const banks = useMemo(() => cashBankOptions(raw, company), [raw, company])
  const [bankKey, setBankKey] = useState(initial ? bankKeyOf(initial.bankAccountCode, initial.bankAccountId) : banks[0]?.key)
  const bank = banks.find(b => b.key === bankKey) || banks[0]
  const [refNumber, setRefNumber] = useState(initial?.refNumber || '')
  const [narration, setNarration] = useState(initial?.narration || '')
  const [costCentreId, setCostCentreId] = useState(initial?.costCentreId || '')
  const [payMode, setPayMode] = useState(initial?.paymentMode || '')
  const [expVendor, setExpVendor] = useState(initial?.expenseVendor || '')
  const [expInvoice, setExpInvoice] = useState(initial?.invoiceNo || '')
  const [expType, setExpType] = useState(initial?.expenseType || 'Services')
  const [expSac, setExpSac] = useState(initial?.sacCode || '')
  const [topTyped, setTopTyped] = useState(null)          // the "Payment Made" amount as typed; null = show what the table adds up to
  const draft = useAttachmentDraft()
  const fx = useFx(raw, date, initial)
  const bills = useBills({ allLines, kind: 'payable', company, party: mode === 'vendor' ? vendor : null, date, initial, fx })
  const [alloc, setAlloc] = useState(initAlloc(initial))
  const [onAccount, setOnAccount] = useState(() => {
    if (!initial) return ''
    if (initial.currency && initial.currency !== 'INR') return initial.onAccountFc || ''
    const allocated = (initial.allocations || []).reduce((s, a) => s + num(a.amount), 0)
    return r2(num(initial.partyAmount) - allocated) || ''
  })
  const [accLines, setAccLines] = useState(initial?.accountLines?.length ? initial.accountLines.map(l => ({ ...l, amount: l.amountFc ?? l.amount })) : [{ accountCode: '', amount: '', description: '' }])
  const [tds, setTds] = useState(initial?.tds?.applicable ? { applicable: true, section: initial.tds.section, rate: initial.tds.rate, baseOverride: initial.tds.base } : { applicable: false })

  const st = useMemo(() => settlement({ fx, bills: mode === 'vendor' ? bills : [], alloc, onAccount: mode === 'vendor' ? onAccount : 0, accLines }), [fx.isFc, fx.rate, bills, alloc, onAccount, accLines, mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const partyAmount = mode === 'vendor' ? st.partyAmount : 0
  const accSum = st.accSum
  const typedTotal = r2(bills.reduce((t, b) => t + num(alloc[b.billKey]), 0) + num(onAccount))
  const setAllocManual = (a) => { setTopTyped(null); setAlloc(a) }
  const onTopAmount = (v) => { setTopTyped(v); const r = autoAllocate(bills, v, fx.isFc); setAlloc(r.alloc); setOnAccount(r.rest) }
  const tdsFinal = finalTds(tds, partyAmount + (mode === 'expense' ? accSum : 0))
  const bankAmt = r2(st.partyMoney + accSum - tdsFinal.amount)      // what really leaves the bank (rupees)
  const payAccounts = useMemo(() => accounts.filter(a => ['expense', 'asset', 'liability'].includes(a.type) && !['1100', '1110', '1200', '2100', '2500'].includes(a.code)), [accounts])

  const { save, saving, error } = useVoucherSave({
    initial, onSaved, draft,
    getPayload: () => {
      need(bank, 'Select the bank / cash account paying.')
      need(!fx.isFc || fx.rate > 0, `Enter the exchange rate for ${fx.currency}.`)
      const lines = st.lines
      lines.forEach(l => need(l.accountCode, 'Pick a ledger for every expense line that has an amount.'))
      if (mode === 'vendor') need(vendor, 'Select a vendor.')
      need(partyAmount + accSum + (mode === 'vendor' ? st.onAccInr : 0) > 0, 'Enter an amount to pay.')
      st.rows.forEach(r => need(r.typed <= (fx.isFc ? r.b.fcPending : r.b.pending) + 0.005, `${r.b.docNo}: settling more than the pending ${fmtAmt(fx.isFc ? r.b.fcPending : r.b.pending)}.`))
      const allocations = mode === 'vendor' ? st.rows.map(r => ({ billKey: r.b.billKey, docNumber: r.b.docNo, amount: r.amount, ...(fx.isFc ? { fcAmount: r.fcAmount, billRate: r.billRate } : {}) })) : []
      if (tds.applicable) need(tds.section, 'Choose a TDS section or untick Deduct TDS.')
      const tdsF = finalTds(tds, partyAmount + (mode === 'expense' ? accSum : 0))
      need(r2(st.partyMoney + accSum - tdsF.amount) > 0, 'TDS cannot exceed the payment.')
      return {
        voucherType: 'payment', company, date,
        ...(mode === 'vendor' ? { partyType: 'vendor', partyId: vendor.id, partyName: vendor.name } : {}),
        partyAmount, allocations, accountLines: lines, tds: tdsF, paymentMode: payMode || defaultMode(bank),
        ...(mode === 'expense' ? { expenseVendor: expVendor.trim(), invoiceNo: expInvoice.trim(), expenseType: expType, sacCode: expSac.trim() } : {}),
        bankAccountCode: bank.code, bankAccountId: bank.id, refNumber: refNumber.trim(), narration: narration.trim(), amount: bankAmt, costCentreId,
        currency: fx.currency, fxRate: fx.isFc ? fx.rate : 1, ...(fx.isFc ? { bankAmountInr: bankAmt, onAccountFc: mode === 'vendor' ? num(onAccount) : 0 } : { bankAmountInr: null, onAccountFc: 0 }),
      }
    },
  })

  return (
    <FormShell title={initial && !initial._clone ? `Edit Payment — ${initial.voucherNumber}` : 'Payment Voucher'} subtitle="Money going out — settle vendor bills, pay direct expenses, deduct TDS." onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm w-fit">
        {[['vendor', 'Payment Made (vendor)'], ['expense', 'Expense']].map(([k, l]) => <button type="button" key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 font-medium ${mode === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
      </div>
      {mode === 'vendor' && <Field label="Vendor Name *" className="max-w-xl"><SearchSelect value={vendorId} onChange={v => { setVendorId(v); setAlloc({}); setTopTyped(null) }} className={formInputCls} placeholder="Select Vendor" options={vendors.map(v => ({ value: v.id, label: v.name }))} /></Field>}
      <HeaderFields dateLabel="Payment Date" company={company} setCompany={c => { setCompany(c); setBankKey(undefined) }} date={date} setDate={setDate} locked={!!initial && !initial._clone}
        extra={<>
          <Field label="Payment #"><div className={`${formInputCls} bg-slate-100 text-slate-500`}>{initial && !initial._clone ? initial.voucherNumber : 'Auto-numbered on save'}</div></Field>
          {mode === 'vendor' && <Field label={`Payment Made (${fx.symbol}) *`}><input type="number" min="0" step="any" value={topTyped ?? (typedTotal > 0 ? String(typedTotal) : '')} onChange={e => onTopAmount(e.target.value)} disabled={!vendor} placeholder={vendor ? '' : 'select a vendor'} className={formInputCls} /></Field>}
          <Field label="Payment Mode"><select value={payMode || defaultMode(bank)} onChange={e => setPayMode(e.target.value)} className={formInputCls}>{PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Paid Through *"><select value={bank?.key || ''} onChange={e => { setBankKey(e.target.value); setPayMode('') }} className={formInputCls}>{banks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
          <Field label="Reference#"><input value={refNumber} onChange={e => setRefNumber(e.target.value)} className={formInputCls} /></Field>
        </>} />
      <CurrencyBar fx={fx} date={date} label="Paying in" />
      {mode === 'vendor' && vendor && <>
        <label className={labelCls}>Bills for this vendor</label>
        <AllocationTable bills={bills} alloc={alloc} setAlloc={setAllocManual} fx={fx} noun="Bill" />
        <Field label={`Amount in excess — advance / on account (${fx.symbol})`} className="max-w-xs"><input type="number" min="0" step="any" value={onAccount} onChange={e => { setTopTyped(null); setOnAccount(e.target.value) }} className={formInputCls} /></Field>
      </>}
      {mode === 'expense' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Vendor"><input value={expVendor} onChange={e => setExpVendor(e.target.value)} placeholder="who was paid (optional)" className={formInputCls} /></Field>
          <Field label="Invoice#"><input value={expInvoice} onChange={e => setExpInvoice(e.target.value)} className={formInputCls} /></Field>
          <Field label="Expense Type"><select value={expType} onChange={e => setExpType(e.target.value)} className={formInputCls}><option>Goods</option><option>Services</option></select></Field>
          <Field label={expType === 'Goods' ? 'HSN Code' : 'SAC'}><input value={expSac} onChange={e => setExpSac(e.target.value)} className={formInputCls} /></Field>
        </div>
      )}
      <AccountLines symbol={fx.symbol} lines={accLines} setLines={setAccLines} accounts={payAccounts} label={mode === 'vendor' ? 'Other charges paid in the same payment (optional)' : 'Expense Account and Amount *'} />
      <TdsBlock raw={raw} vendor={vendor} date={date} base={partyAmount + (mode === 'expense' ? accSum : 0)} tds={tds} setTds={setTds} fy={fyOf(date)}
        partyId={vendor?.id} currentDocId={initial?.id} />
      <CostCentreSelect raw={raw} value={costCentreId} onChange={setCostCentreId} />
      <AttachmentPanel entityType="payment" entityId={initial?.id} company={company} draft={draft} label="Bill / receipt for this payment or expense" />
      <Field label="Notes (internal use, not visible to the vendor)"><input value={narration} onChange={e => setNarration(e.target.value)} className={formInputCls} /></Field>
      <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
        {mode === 'vendor' && <SumRow label={fx.isFc ? 'Bills cleared (₹ at booking rate)' : 'To vendor (gross)'} value={partyAmount} />}
        {fx.isFc && mode === 'vendor' && <SumRow label={`Paid to vendor (₹ at ${fx.rate})`} value={st.partyMoney} />}
        {fx.isFc && Math.abs(st.fxDiff) > 0.004 && <SumRow label={st.fxDiff > 0 ? 'Exchange loss' : 'Exchange gain'} value={Math.abs(st.fxDiff)} tone={st.fxDiff > 0 ? 'text-red-600' : 'text-green-700'} />}
        {accSum > 0 && <SumRow label="Other ledgers (₹)" value={accSum} />}
        {tdsFinal.amount > 0 && <SumRow label={`Less: TDS ${tdsFinal.section} deducted`} value={-tdsFinal.amount} tone="text-red-600" />}
        <SumRow label="Paid from bank / cash" value={bankAmt} strong />
      </div>
    </FormShell>
  )
}

// ═══ RECEIPT ════════════════════════════════════════════════════════════════
export function ReceiptForm({ data, initial, onSaved, onCancel }) {
  const { raw, accounts, allLines } = data
  const [company, setCompany] = useState(initial?.company || 'UIPL')
  const [date, setDate] = useState(initial?.date || todayStr())
  // CRM customers plus anyone who only exists as the bill-to name on an invoice (free-typed customers) — keyed by id, or 'n:name' when there is no master record.
  const customers = useMemo(() => {
    const list = customerOptions(raw, company).map(c => ({ ...c, key: c.id }))
    const have = new Set(list.map(c => normName(c.name)))
    ;(raw.invoices || []).filter(i => i.company === company && i.invoiceType !== 'PI' && i.invoiceType !== 'SO' && i.billToName).forEach(i => {
      const k = normName(i.billToName); if (have.has(k)) return; have.add(k)
      list.push({ id: '', key: 'n:' + k, name: i.billToName, gstin: i.billToGstin || '' })
    })
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [raw, company])
  const [mode, setMode] = useState(initial ? (initial.partyName ? 'customer' : 'other') : 'customer')   // 'other' = no customer: FD maturity, interest, refunds...
  const [customerId, setCustomerId] = useState(initial ? (initial.partyId || 'n:' + normName(initial.partyName)) : '')
  const customer = mode !== 'customer' ? null : (customers.find(c => c.key === customerId) || (initial?.partyName ? { id: initial.partyId || '', name: initial.partyName } : null))
  const banks = useMemo(() => cashBankOptions(raw, company), [raw, company])
  const [bankKey, setBankKey] = useState(initial ? bankKeyOf(initial.bankAccountCode, initial.bankAccountId) : banks[0]?.key)
  const bank = banks.find(b => b.key === bankKey) || banks[0]
  const [refNumber, setRefNumber] = useState(initial?.refNumber || '')
  const [narration, setNarration] = useState(initial?.narration || '')
  const [payMode, setPayMode] = useState(initial?.paymentMode || '')
  const [bankCharges, setBankCharges] = useState(initial?.bankCharges || '')
  const [topTyped, setTopTyped] = useState(null)
  const draft = useAttachmentDraft()
  const fx = useFx(raw, date, initial)
  const bills = useBills({ allLines, kind: 'receivable', company, party: customer, date, initial, fx })
  const [alloc, setAlloc] = useState(initAlloc(initial))
  const [onAccount, setOnAccount] = useState(() => {
    if (!initial) return ''
    if (initial.currency && initial.currency !== 'INR') return initial.onAccountFc || ''
    const allocated = (initial.allocations || []).reduce((s, a) => s + num(a.amount), 0)
    return r2(num(initial.partyAmount) - allocated) || ''
  })
  const [accLines, setAccLines] = useState(initial?.accountLines?.length ? initial.accountLines.map(l => ({ ...l, amount: l.amountFc ?? l.amount })) : [{ accountCode: '', amount: '', description: '' }])
  const [tdsOn, setTdsOn] = useState(!!initial?.tdsReceivable?.applicable)
  const [tdsSection, setTdsSection] = useState(initial?.tdsReceivable?.section || '')
  const [tdsAmount, setTdsAmount] = useState(initial?.tdsReceivable?.amount || '')
  const sections = tdsSectionList(raw)
  // everything a receipt can credit: income, liabilities, equity and assets such as Fixed Deposits or Trust funds (principal coming back)
  const incomeAccounts = useMemo(() => accounts.filter(a => ['income', 'liability', 'equity', 'asset'].includes(a.type) && !['1100', '1110', '1200', '2100', '1310', '2500'].includes(a.code)).sort((x, y) => (isInvestmentName(y.name) - isInvestmentName(x.name)) || x.code.localeCompare(y.code)), [accounts])

  const st = useMemo(() => settlement({ fx, bills: mode === 'customer' ? bills : [], alloc, onAccount: mode === 'customer' ? onAccount : 0, accLines }), [fx.isFc, fx.rate, bills, alloc, onAccount, accLines, mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const partyAmount = mode === 'customer' ? st.partyAmount : 0
  const accSum = st.accSum
  const tdsAmt = tdsOn ? r2(num(tdsAmount)) : 0
  const bankChg = r2(num(bankCharges))
  const typedTotal = r2(bills.reduce((t, b) => t + num(alloc[b.billKey]), 0) + num(onAccount))
  const setAllocManual = (a) => { setTopTyped(null); setAlloc(a) }
  const onTopAmount = (v) => { setTopTyped(v); const r = autoAllocate(bills, v, fx.isFc); setAlloc(r.alloc); setOnAccount(r.rest) }
  const bankAmt = r2(st.partyMoney - tdsAmt + accSum - bankChg)      // rupees that really arrive in the bank

  const { save, saving, error } = useVoucherSave({
    initial, onSaved, draft,
    getPayload: () => {
      need(bank, 'Select the bank / cash account receiving.')
      if (mode === 'customer') need(customer, 'Select a customer.')
      need(!fx.isFc || fx.rate > 0, `Enter the exchange rate for ${fx.currency}.`)
      const lines = st.lines
      lines.forEach(l => need(l.accountCode, 'Pick a ledger for every line that has an amount.'))
      need(partyAmount + accSum > 0, mode === 'customer' ? 'Enter the amount received.' : 'Add the ledger(s) this money is for and the amount.')
      st.rows.forEach(r => need(r.typed <= (fx.isFc ? r.b.fcPending : r.b.pending) + 0.005, `${r.b.docNo}: settling more than the pending ${fmtAmt(fx.isFc ? r.b.fcPending : r.b.pending)}.`))
      const allocations = mode === 'customer' ? st.rows.map(r => ({ billKey: r.b.billKey, docNumber: r.b.docNo, amount: r.amount, ...(fx.isFc ? { fcAmount: r.fcAmount, billRate: r.billRate } : {}) })) : []
      if (tdsOn) { need(tdsSection, 'Choose the TDS section the customer deducted under.'); need(tdsAmt > 0, 'Enter the TDS amount deducted by the customer.'); need(tdsAmt < partyAmount + accSum, 'TDS cannot exceed the amount received.') }
      return {
        voucherType: 'receipt', company, date, ...(customer ? { partyType: 'customer', partyId: customer.id, partyName: customer.name } : {}), ...(company === 'UIPL' && customer ? groupFlag(raw, customer.name) : { interCompany: null }),
        partyAmount, allocations, accountLines: lines,
        tdsReceivable: tdsOn ? { applicable: true, section: tdsSection, amount: tdsAmt } : { applicable: false },
        bankCharges: bankChg, paymentMode: payMode || defaultMode(bank),
        bankAccountCode: bank.code, bankAccountId: bank.id, refNumber: refNumber.trim(), narration: narration.trim(), amount: bankAmt,
        currency: fx.currency, fxRate: fx.isFc ? fx.rate : 1, ...(fx.isFc ? { bankAmountInr: bankAmt, onAccountFc: mode === 'customer' ? num(onAccount) : 0 } : { bankAmountInr: null, onAccountFc: 0 }),
      }
    },
  })

  return (
    <FormShell title={initial && !initial._clone ? `Edit Receipt — ${initial.voucherNumber}` : 'Receipt Voucher'} subtitle="Money coming in — settle customer invoices, record advances, and book TDS the customer deducted." onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm w-fit">
        {[['customer', 'Payment Received (customer)'], ['other', 'Other receipt (FD maturity, interest, refund)']].map(([k, l]) => <button type="button" key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 font-medium ${mode === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
      </div>
      {mode === 'customer' && <Field label="Customer Name *" className="max-w-xl"><SearchSelect value={customerId} onChange={v => { setCustomerId(v); setAlloc({}); setTopTyped(null) }} className={formInputCls} placeholder="Select Customer" options={customers.map(c => ({ value: c.key, label: c.name }))} /></Field>}
      {mode === 'other' && <p className="text-xs text-slate-500 -mt-2">Pick the ledgers below: for example credit the Fixed Deposit account for the principal that came back and Interest Income for the interest. If the bank deducted TDS, choose "Yes, TDS" and enter the amount.</p>}
      <HeaderFields dateLabel="Payment Date" company={company} setCompany={c => { setCompany(c); setBankKey(undefined); setCustomerId(''); setAlloc({}) }} date={date} setDate={setDate} locked={!!initial && !initial._clone}
        extra={<>
          <Field label="Payment #"><div className={`${formInputCls} bg-slate-100 text-slate-500`}>{initial && !initial._clone ? initial.voucherNumber : 'Auto-numbered on save'}</div></Field>
          {mode === 'customer' && <Field label={`Amount Received (${fx.symbol}) *`}><input type="number" min="0" step="any" value={topTyped ?? (typedTotal > 0 ? String(typedTotal) : '')} onChange={e => onTopAmount(e.target.value)} disabled={!customer} placeholder={customer ? '' : 'select a customer'} className={formInputCls} /></Field>}
          <Field label="Bank Charges (if any)"><input type="number" min="0" step="any" value={bankCharges} onChange={e => setBankCharges(e.target.value)} className={formInputCls} /></Field>
          <Field label="Payment Mode"><select value={payMode || defaultMode(bank)} onChange={e => setPayMode(e.target.value)} className={formInputCls}>{PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Deposit To *"><select value={bank?.key || ''} onChange={e => { setBankKey(e.target.value); setPayMode('') }} className={formInputCls}>{banks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
          <Field label="Reference#"><input value={refNumber} onChange={e => setRefNumber(e.target.value)} className={formInputCls} /></Field>
        </>} />
      <CurrencyBar fx={fx} date={date} label="Received in" />
      {customer && <>
        <label className={labelCls}>Invoices for this customer</label>
        <AllocationTable bills={bills} alloc={alloc} setAlloc={setAllocManual} fx={fx} noun="Invoice" />
        <Field label={`Amount in excess — advance / on account (${fx.symbol})`} className="max-w-xs"><input type="number" min="0" step="any" value={onAccount} onChange={e => { setTopTyped(null); setOnAccount(e.target.value) }} className={formInputCls} /></Field>
      </>}
      <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/50">
        <label className={labelCls}>Tax deducted?</label>
        <div className="flex gap-5 text-sm text-slate-700">
          <label className="flex items-center gap-2"><input type="radio" name="taxded" checked={!tdsOn} onChange={() => setTdsOn(false)} />No Tax deducted</label>
          <label className="flex items-center gap-2"><input type="radio" name="taxded" checked={tdsOn} onChange={() => setTdsOn(true)} />Yes, TDS (Income Tax){mode !== 'customer' ? ' — deducted before paying me, e.g. by the bank on FD interest' : ''} <span className="text-xs text-slate-400">(credited to my Form 26AS — TDS receivable)</span></label>
        </div>
        {tdsOn && <div className="grid grid-cols-2 gap-3 max-w-lg">
          <Field label="Section"><select value={tdsSection} onChange={e => setTdsSection(e.target.value)} className={formInputCls}><option value="">— select —</option>{sections.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}</select></Field>
          <Field label="TDS amount (₹)"><input type="number" min="0" step="any" value={tdsAmount} onChange={e => setTdsAmount(e.target.value)} className={formInputCls} /></Field>
        </div>}
      </div>
      <AccountLines symbol={fx.symbol} lines={accLines} setLines={setAccLines} accounts={incomeAccounts} label={mode === 'customer' ? 'Other income / ledgers received in the same receipt (optional)' : 'Ledgers this money belongs to (principal, interest...)'} />
      <AttachmentPanel entityType="receipt" entityId={initial?.id} company={company} draft={draft} label="Proof of receipt (bank advice, cheque photo)" />
      <Field label="Notes (internal use, not visible to the customer)"><input value={narration} onChange={e => setNarration(e.target.value)} className={formInputCls} /></Field>
      <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
        {mode === 'customer' && <SumRow label={fx.isFc ? 'Invoices cleared (₹ at booking rate)' : 'Settled (customer account)'} value={partyAmount} />}
        {fx.isFc && mode === 'customer' && <SumRow label={`Received from customer (₹ at ${fx.rate})`} value={st.partyMoney} />}
        {fx.isFc && Math.abs(st.fxDiff) > 0.004 && <SumRow label={st.fxDiff > 0 ? 'Exchange gain' : 'Exchange loss'} value={Math.abs(st.fxDiff)} tone={st.fxDiff > 0 ? 'text-green-700' : 'text-red-600'} />}
        {accSum > 0 && <SumRow label="Other ledgers (₹)" value={accSum} />}
        {tdsAmt > 0 && <SumRow label="Less: TDS deducted at source" value={-tdsAmt} tone="text-red-600" />}
        {bankChg > 0 && <SumRow label="Less: Bank charges" value={-bankChg} tone="text-red-600" />}
        <SumRow label="Received in bank / cash" value={bankAmt} strong />
      </div>
    </FormShell>
  )
}

// ═══ CONTRA ═════════════════════════════════════════════════════════════════
export function ContraForm({ data, initial, onSaved, onCancel }) {
  const { raw } = data
  const [company, setCompany] = useState(initial?.company || 'UIPL')
  const [date, setDate] = useState(initial?.date || todayStr())
  // cash / bank accounts first, then any other balance-sheet ledger (Fixed Deposit, Trust fund, loan...) so money can move to and from them
  const banks = useMemo(() => {
    const cb = cashBankOptions(raw, company)
    const skip = new Set(['1100', '1110', '1520', '1200', '2100', '1310', '1400', '2500', '3200'])
    const others = (data.accounts || []).filter(a => ['asset', 'liability', 'equity'].includes(a.type) && !skip.has(a.code) && !/^13/.test(a.code) && !/^24/.test(a.code))
      .sort((x, y) => (isInvestmentName(y.name) - isInvestmentName(x.name)) || x.code.localeCompare(y.code))
      .map(a => ({ key: 'acct:' + a.code, label: `${a.code} ${a.name}${isInvestmentName(a.name) ? ' *' : ''}`, code: a.code, id: '', other: true }))
    return [...cb, ...fdOptions(raw, company), ...others]
  }, [raw, company, data.accounts])
  const keyOf2 = (code, id) => (code === '1520' && id ? 'fd:' + id : ['1100', '1110'].includes(code) ? bankKeyOf(code, id) : 'acct:' + code)
  const [fromKey, setFromKey] = useState(initial ? keyOf2(initial.fromAccountCode, initial.fromBankAccountId) : '')
  const [toKey, setToKey] = useState(initial ? keyOf2(initial.toAccountCode, initial.toBankAccountId) : '')
  const [amount, setAmount] = useState(initial?.amount || '')
  const [refNumber, setRefNumber] = useState(initial?.refNumber || '')
  const [narration, setNarration] = useState(initial?.narration || '')
  const from = banks.find(b => b.key === fromKey), to = banks.find(b => b.key === toKey)

  const { save, saving, error } = useVoucherSave({
    initial, onSaved,
    getPayload: () => {
      need(from && to, 'Choose both the source and destination accounts.')
      need(from.key !== to.key, 'Source and destination are the same account.')
      need(num(amount) > 0, 'Enter the amount transferred.')
      return {
        voucherType: 'contra', company, date, amount: r2(num(amount)),
        fromAccountCode: from.code, fromBankAccountId: from.id, toAccountCode: to.code, toBankAccountId: to.id, fromAccountName: from.label.replace(/ \*$/, ''), toAccountName: to.label.replace(/ \*$/, ''),
        refNumber: refNumber.trim(), narration: narration.trim(),
      }
    },
  })

  return (
    <FormShell title={initial && !initial._clone ? `Edit Contra — ${initial.voucherNumber}` : 'Contra Voucher'} subtitle="Cash deposited / withdrawn, a transfer between your own bank accounts, or money moved to / from a Fixed Deposit or Trust account (marked *). No profit effect; record interest separately as a Receipt (Other)." onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <HeaderFields company={company} setCompany={c => { setCompany(c); setFromKey(''); setToKey('') }} date={date} setDate={setDate} locked={!!initial && !initial._clone} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="From (credit) *"><select value={fromKey} onChange={e => setFromKey(e.target.value)} className={formInputCls}><option value="">— select —</option>{banks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
        <Field label="To (debit) *"><select value={toKey} onChange={e => setToKey(e.target.value)} className={formInputCls}><option value="">— select —</option>{banks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
        <Field label="Amount (₹) *"><input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} className={formInputCls} /></Field>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Reference"><input value={refNumber} onChange={e => setRefNumber(e.target.value)} className={formInputCls} /></Field>
        <Field label="Narration"><input value={narration} onChange={e => setNarration(e.target.value)} className={formInputCls} /></Field>
      </div>
    </FormShell>
  )
}
