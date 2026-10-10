// Payment, Receipt and Contra vouchers.
import React, { useMemo, useState } from 'react'
import { pendingBillsForParty } from '../utils/outstanding.js'
import { fyOf } from '../utils/financeConstants.js'
import { formInputCls, labelCls } from './FinanceUI.jsx'
import AttachmentPanel, { useAttachmentDraft } from './AttachmentPanel.jsx'
import {
  Field, FormShell, HeaderFields, TdsBlock, finalTds, useVoucherSave, need, CostCentreSelect,
  cashBankOptions, customerOptions, vendorOptions, tdsSectionList,
  todayStr, normName, num, fmtAmt,
} from './formShared.jsx'
import { r2 } from '../utils/financeConstants.js'

// Fixed deposits, trust funds, investments: listed first wherever a ledger has to be picked.
export const isInvestmentName = (n) => (/deposit|\bfd\b|trust|invest|bond|mutual/i.test(n || '') ? 1 : 0)
const bankKeyOf = (code, id) => (code === '1110' ? (id ? `cash:${id}` : 'cash') : (id ? `bank:${id}` : 'bank-default'))

// ─── allocation table: tick bills and set how much of this payment goes to each ──
function AllocationTable({ bills, alloc, setAlloc }) {
  if (!bills.length) return <p className="text-xs text-slate-400">No pending bills for this party — the amount will be recorded as an advance / on-account.</p>
  const setAmt = (b, v) => setAlloc({ ...alloc, [b.billKey]: v })
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase"><tr>
          <th className="text-left px-3 py-2">Bill</th><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Due</th>
          <th className="text-right px-3 py-2">Pending</th><th className="text-right px-3 py-2 w-36">Settle now</th><th className="w-16" />
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {bills.map(b => (
            <tr key={b.billKey}>
              <td className="px-3 py-1.5 font-mono text-xs">{b.docNo}{b.externalRef ? <span className="text-slate-400"> ({b.externalRef})</span> : null}</td>
              <td className="px-3 py-1.5 text-slate-500">{b.date}</td>
              <td className={`px-3 py-1.5 ${b.daysOverdue > 0 ? 'text-red-600' : 'text-slate-500'}`}>{b.dueDate}{b.daysOverdue > 0 ? ` (${b.daysOverdue}d)` : ''}</td>
              <td className="px-3 py-1.5 text-right">{fmtAmt(b.pending)}</td>
              <td className="px-3 py-1.5"><input type="number" min="0" step="any" max={b.pending} value={alloc[b.billKey] ?? ''} onChange={e => setAmt(b, e.target.value)} className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm text-right" /></td>
              <td className="px-1"><button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setAmt(b, b.pending)}>full</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Shared by payment / receipt: bills for the chosen party, with the voucher's own
// current allocation added back when editing so its amounts can be changed.
function useBills({ allLines, kind, company, party, date, initial }) {
  return useMemo(() => {
    if (!party) return []
    const bills = pendingBillsForParty(allLines, { kind, company, partyName: party.name, partyId: party.id, asOf: '9999-12-31' })
    const own = {}
    ;(initial?.allocations || []).forEach(a => { own[a.billKey] = (own[a.billKey] || 0) + num(a.amount) })
    const today = new Date(todayStr() + 'T00:00:00')
    return bills.map(b => ({ ...b, pending: r2(b.pending + (own[b.billKey] || 0)), daysOverdue: Math.round((today - new Date(b.dueDate + 'T00:00:00')) / 86400000) }))
  }, [allLines, kind, company, party, initial])
}

const initAlloc = (initial) => Object.fromEntries((initial?.allocations || []).map(a => [a.billKey, a.amount]))

function AccountLines({ lines, setLines, accounts, label }) {
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
          <input type="number" min="0" step="any" value={l.amount} onChange={e => upd(i, { amount: e.target.value })} placeholder="Amount" className={`${formInputCls} col-span-2 text-right`} />
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
export function PaymentForm({ data, initial, onSaved, onCancel }) {
  const { raw, accounts, allLines } = data
  const [company, setCompany] = useState(initial?.company || 'UIPL')
  const [date, setDate] = useState(initial?.date || todayStr())
  const [mode, setMode] = useState(initial ? (initial.partyName ? 'vendor' : 'expense') : 'vendor')
  const vendors = useMemo(() => vendorOptions(raw), [raw])
  const [vendorId, setVendorId] = useState(initial?.partyId || '')
  const vendor = vendors.find(v => v.id === vendorId) || (initial?.partyName && !initial.partyId ? { id: '', name: initial.partyName, pan: '' } : null)
  const banks = useMemo(() => cashBankOptions(raw, company), [raw, company])
  const [bankKey, setBankKey] = useState(initial ? bankKeyOf(initial.bankAccountCode, initial.bankAccountId) : banks[0]?.key)
  const bank = banks.find(b => b.key === bankKey) || banks[0]
  const [refNumber, setRefNumber] = useState(initial?.refNumber || '')
  const [narration, setNarration] = useState(initial?.narration || '')
  const [costCentreId, setCostCentreId] = useState(initial?.costCentreId || '')
  const draft = useAttachmentDraft()
  const bills = useBills({ allLines, kind: 'payable', company, party: mode === 'vendor' ? vendor : null, date, initial })
  const [alloc, setAlloc] = useState(initAlloc(initial))
  const [onAccount, setOnAccount] = useState(() => {
    if (!initial) return ''
    const allocated = (initial.allocations || []).reduce((s, a) => s + num(a.amount), 0)
    return r2(num(initial.partyAmount) - allocated) || ''
  })
  const [accLines, setAccLines] = useState(initial?.accountLines?.length ? initial.accountLines : [{ accountCode: '', amount: '', description: '' }])
  const [tds, setTds] = useState(initial?.tds?.applicable ? { applicable: true, section: initial.tds.section, rate: initial.tds.rate, baseOverride: initial.tds.base } : { applicable: false })

  const allocTotal = r2(Object.values(alloc).reduce((s, v) => s + num(v), 0))
  const partyAmount = mode === 'vendor' ? r2(allocTotal + num(onAccount)) : 0
  const accSum = r2(accLines.reduce((s, l) => s + num(l.amount), 0))
  const tdsFinal = finalTds(tds, partyAmount + (mode === 'expense' ? accSum : 0))
  const bankAmt = r2(partyAmount + accSum - tdsFinal.amount)
  const payAccounts = useMemo(() => accounts.filter(a => ['expense', 'asset', 'liability'].includes(a.type) && !['1100', '1110', '1200', '2100', '2500'].includes(a.code)), [accounts])

  const { save, saving, error } = useVoucherSave({
    initial, onSaved, draft,
    getPayload: () => {
      need(bank, 'Select the bank / cash account paying.')
      const lines = accLines.filter(l => num(l.amount) > 0)
      lines.forEach(l => need(l.accountCode, 'Pick a ledger for every expense line that has an amount.'))
      if (mode === 'vendor') need(vendor, 'Select a vendor.')
      need(partyAmount + lines.reduce((s, l) => s + num(l.amount), 0) > 0, 'Enter an amount to pay.')
      const allocations = bills.filter(b => num(alloc[b.billKey]) > 0).map(b => {
        need(num(alloc[b.billKey]) <= b.pending + 0.005, `${b.docNo}: settling more than the pending ${fmtAmt(b.pending)}.`)
        return { billKey: b.billKey, docNumber: b.docNo, amount: r2(num(alloc[b.billKey])) }
      })
      if (tds.applicable) need(tds.section, 'Choose a TDS section or untick Deduct TDS.')
      const tdsF = finalTds(tds, partyAmount + (mode === 'expense' ? accSum : 0))
      need(r2(partyAmount + accSum - tdsF.amount) > 0, 'TDS cannot exceed the payment.')
      return {
        voucherType: 'payment', company, date,
        ...(mode === 'vendor' ? { partyType: 'vendor', partyId: vendor.id, partyName: vendor.name } : {}),
        partyAmount, allocations, accountLines: lines, tds: tdsF,
        bankAccountCode: bank.code, bankAccountId: bank.id, refNumber: refNumber.trim(), narration: narration.trim(), amount: bankAmt, costCentreId,
      }
    },
  })

  return (
    <FormShell title={initial ? `Edit Payment — ${initial.voucherNumber}` : 'Payment Voucher'} subtitle="Money going out — settle vendor bills, pay direct expenses, deduct TDS." onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <HeaderFields company={company} setCompany={c => { setCompany(c); setBankKey(undefined) }} date={date} setDate={setDate} locked={!!initial}
        extra={<>
          <Field label="Paid from *"><select value={bank?.key || ''} onChange={e => setBankKey(e.target.value)} className={formInputCls}>{banks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
          <Field label="Cheque / UTR no."><input value={refNumber} onChange={e => setRefNumber(e.target.value)} className={formInputCls} /></Field>
        </>} />
      <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm w-fit">
        {[['vendor', 'Pay a vendor'], ['expense', 'Direct expense / other']].map(([k, l]) => <button type="button" key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 font-medium ${mode === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
      </div>
      {mode === 'vendor' && (
        <>
          <Field label="Vendor *"><select value={vendorId} onChange={e => { setVendorId(e.target.value); setAlloc({}) }} className={formInputCls}><option value="">— select vendor —</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          {vendor && <>
            <label className={labelCls}>Against pending bills</label>
            <AllocationTable bills={bills} alloc={alloc} setAlloc={setAlloc} />
            <Field label="Advance / on account (₹)" className="max-w-xs"><input type="number" min="0" step="any" value={onAccount} onChange={e => setOnAccount(e.target.value)} className={formInputCls} /></Field>
          </>}
        </>
      )}
      <AccountLines lines={accLines} setLines={setAccLines} accounts={payAccounts} label={mode === 'vendor' ? 'Other charges paid in the same payment (optional)' : 'Expense / ledger being paid'} />
      <TdsBlock raw={raw} vendor={vendor} date={date} base={partyAmount + (mode === 'expense' ? accSum : 0)} tds={tds} setTds={setTds} fy={fyOf(date)}
        partyId={vendor?.id} currentDocId={initial?.id} />
      <CostCentreSelect raw={raw} value={costCentreId} onChange={setCostCentreId} />
      <AttachmentPanel entityType="payment" entityId={initial?.id} company={company} draft={draft} label="Bill / receipt for this payment or expense" />
      <Field label="Narration"><input value={narration} onChange={e => setNarration(e.target.value)} className={formInputCls} /></Field>
      <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
        {mode === 'vendor' && <SumRow label="To vendor (gross)" value={partyAmount} />}
        {accSum > 0 && <SumRow label="Other ledgers" value={accSum} />}
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
  const draft = useAttachmentDraft()
  const bills = useBills({ allLines, kind: 'receivable', company, party: customer, date, initial })
  const [alloc, setAlloc] = useState(initAlloc(initial))
  const [onAccount, setOnAccount] = useState(() => {
    if (!initial) return ''
    const allocated = (initial.allocations || []).reduce((s, a) => s + num(a.amount), 0)
    return r2(num(initial.partyAmount) - allocated) || ''
  })
  const [accLines, setAccLines] = useState(initial?.accountLines?.length ? initial.accountLines : [{ accountCode: '', amount: '', description: '' }])
  const [tdsOn, setTdsOn] = useState(!!initial?.tdsReceivable?.applicable)
  const [tdsSection, setTdsSection] = useState(initial?.tdsReceivable?.section || '')
  const [tdsAmount, setTdsAmount] = useState(initial?.tdsReceivable?.amount || '')
  const sections = tdsSectionList(raw)
  // everything a receipt can credit: income, liabilities, equity and assets such as Fixed Deposits or Trust funds (principal coming back)
  const incomeAccounts = useMemo(() => accounts.filter(a => ['income', 'liability', 'equity', 'asset'].includes(a.type) && !['1100', '1110', '1200', '2100', '1310', '2500'].includes(a.code)).sort((x, y) => (isInvestmentName(y.name) - isInvestmentName(x.name)) || x.code.localeCompare(y.code)), [accounts])

  const allocTotal = r2(Object.values(alloc).reduce((s, v) => s + num(v), 0))
  const partyAmount = mode === 'customer' ? r2(allocTotal + num(onAccount)) : 0
  const accSum = r2(accLines.reduce((s, l) => s + num(l.amount), 0))
  const tdsAmt = tdsOn ? r2(num(tdsAmount)) : 0
  const bankAmt = r2(partyAmount - tdsAmt + accSum)

  const { save, saving, error } = useVoucherSave({
    initial, onSaved, draft,
    getPayload: () => {
      need(bank, 'Select the bank / cash account receiving.')
      if (mode === 'customer') need(customer, 'Select a customer.')
      const lines = accLines.filter(l => num(l.amount) > 0)
      lines.forEach(l => need(l.accountCode, 'Pick a ledger for every line that has an amount.'))
      need(partyAmount + accSum > 0, mode === 'customer' ? 'Enter the amount received.' : 'Add the ledger(s) this money is for and the amount.')
      const allocations = bills.filter(b => num(alloc[b.billKey]) > 0).map(b => {
        need(num(alloc[b.billKey]) <= b.pending + 0.005, `${b.docNo}: settling more than the pending ${fmtAmt(b.pending)}.`)
        return { billKey: b.billKey, docNumber: b.docNo, amount: r2(num(alloc[b.billKey])) }
      })
      if (tdsOn) { need(tdsSection, 'Choose the TDS section the customer deducted under.'); need(tdsAmt > 0, 'Enter the TDS amount deducted by the customer.'); need(tdsAmt < partyAmount + accSum, 'TDS cannot exceed the amount received.') }
      return {
        voucherType: 'receipt', company, date, ...(customer ? { partyType: 'customer', partyId: customer.id, partyName: customer.name } : {}),
        partyAmount, allocations, accountLines: lines,
        tdsReceivable: tdsOn ? { applicable: true, section: tdsSection, amount: tdsAmt } : { applicable: false },
        bankAccountCode: bank.code, bankAccountId: bank.id, refNumber: refNumber.trim(), narration: narration.trim(), amount: bankAmt,
      }
    },
  })

  return (
    <FormShell title={initial ? `Edit Receipt — ${initial.voucherNumber}` : 'Receipt Voucher'} subtitle="Money coming in — settle customer invoices, record advances, and book TDS the customer deducted." onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <HeaderFields company={company} setCompany={c => { setCompany(c); setBankKey(undefined); setCustomerId(''); setAlloc({}) }} date={date} setDate={setDate} locked={!!initial}
        extra={<>
          <Field label="Received in *"><select value={bank?.key || ''} onChange={e => setBankKey(e.target.value)} className={formInputCls}>{banks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
          <Field label="Cheque / UTR no."><input value={refNumber} onChange={e => setRefNumber(e.target.value)} className={formInputCls} /></Field>
        </>} />
      <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm w-fit">
        {[['customer', 'From a customer'], ['other', 'Other (FD maturity, interest, refund)']].map(([k, l]) => <button type="button" key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 font-medium ${mode === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
      </div>
      {mode === 'customer' && <Field label="Customer *"><select value={customerId} onChange={e => { setCustomerId(e.target.value); setAlloc({}) }} className={formInputCls}><option value="">— select customer —</option>{customers.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></Field>}
      {mode === 'other' && <p className="text-xs text-slate-500 -mt-2">Pick the ledgers below: for example credit the Fixed Deposit account for the principal that came back and Interest Income for the interest. If the bank deducted TDS, tick the TDS box and enter the amount.</p>}
      {customer && <>
        <label className={labelCls}>Against pending invoices</label>
        <AllocationTable bills={bills} alloc={alloc} setAlloc={setAlloc} />
        <Field label="Advance / on account (₹)" className="max-w-xs"><input type="number" min="0" step="any" value={onAccount} onChange={e => setOnAccount(e.target.value)} className={formInputCls} /></Field>
      </>}
      <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/50">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={tdsOn} onChange={e => setTdsOn(e.target.checked)} />{mode === 'customer' ? 'Customer deducted TDS' : 'TDS deducted before paying me (e.g. bank on FD interest)'} (credited to my Form 26AS — TDS receivable)</label>
        {tdsOn && <div className="grid grid-cols-2 gap-3 max-w-lg">
          <Field label="Section"><select value={tdsSection} onChange={e => setTdsSection(e.target.value)} className={formInputCls}><option value="">— select —</option>{sections.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}</select></Field>
          <Field label="TDS amount (₹)"><input type="number" min="0" step="any" value={tdsAmount} onChange={e => setTdsAmount(e.target.value)} className={formInputCls} /></Field>
        </div>}
      </div>
      <AccountLines lines={accLines} setLines={setAccLines} accounts={incomeAccounts} label={mode === 'customer' ? 'Other income / ledgers received in the same receipt (optional)' : 'Ledgers this money belongs to (principal, interest...)'} />
      <AttachmentPanel entityType="receipt" entityId={initial?.id} company={company} draft={draft} label="Proof of receipt (bank advice, cheque photo)" />
      <Field label="Narration"><input value={narration} onChange={e => setNarration(e.target.value)} className={formInputCls} /></Field>
      <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
        {mode === 'customer' && <SumRow label="Settled (customer account)" value={partyAmount} />}
        {accSum > 0 && <SumRow label="Other ledgers" value={accSum} />}
        {tdsAmt > 0 && <SumRow label="Less: TDS deducted at source" value={-tdsAmt} tone="text-red-600" />}
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
    const skip = new Set(['1100', '1110', '1200', '2100', '1310', '1400', '2500', '3200'])
    const others = (data.accounts || []).filter(a => ['asset', 'liability', 'equity'].includes(a.type) && !skip.has(a.code) && !/^13/.test(a.code) && !/^24/.test(a.code))
      .sort((x, y) => (isInvestmentName(y.name) - isInvestmentName(x.name)) || x.code.localeCompare(y.code))
      .map(a => ({ key: 'acct:' + a.code, label: `${a.code} ${a.name}${isInvestmentName(a.name) ? ' *' : ''}`, code: a.code, id: '', other: true }))
    return [...cb, ...others]
  }, [raw, company, data.accounts])
  const keyOf2 = (code, id) => (['1100', '1110'].includes(code) ? bankKeyOf(code, id) : 'acct:' + code)
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
        fromAccountCode: from.code, fromBankAccountId: from.id, toAccountCode: to.code, toBankAccountId: to.id,
        refNumber: refNumber.trim(), narration: narration.trim(),
      }
    },
  })

  return (
    <FormShell title={initial ? `Edit Contra — ${initial.voucherNumber}` : 'Contra Voucher'} subtitle="Cash deposited / withdrawn, a transfer between your own bank accounts, or money moved to / from a Fixed Deposit or Trust account (marked *). No profit effect; record interest separately as a Receipt (Other)." onSubmit={save} onCancel={onCancel} saving={saving} error={error}>
      <HeaderFields company={company} setCompany={c => { setCompany(c); setFromKey(''); setToKey('') }} date={date} setDate={setDate} locked={!!initial} />
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
