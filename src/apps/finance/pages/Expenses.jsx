// Expenses (Zoho "Expenses" tab): what the business spends to run itself, kept apart from what it buys to deliver sales.
// "Purchases for sales" = purchase / subcontractor / stock / freight / EOR cost heads; everything else is an expense.
// An expense is either a direct payment (no vendor bill: bank charges, lunch, fuel…) or a vendor bill booked to an expense head.
import React, { useMemo, useState } from 'react'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { groupBySource } from '../utils/statements.js'
import { fmtAmt, num, r2 } from '../utils/financeConstants.js'
import { PaymentForm } from '../components/SettlementForms.jsx'
import { useVoucherModal } from '../components/useVoucherModal.jsx'
import { ReportShell, CompanyToggle, Badge, Empty, cardCls, btnPrimary, inputCls, useFinancePerms } from '../components/FinanceUI.jsx'

// cost heads that belong to delivering sales — not "just expenses"
const SALES_COST = new Set(['5000', '5010', '5105', '5195', '5200'])

export default function Expenses() {
  const { canWrite } = useFinancePerms()
  const data = useFinanceData(['hsnCodes', 'tdsSections', 'costCentres'])
  const { raw, loading, reload, accounts, allLines } = data
  const { open, modal } = useVoucherModal({ raw, allLines, reload })
  const [company, setCompany] = useState('UIPL')
  const [q, setQ] = useState('')
  const [acct, setAcct] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [creating, setCreating] = useState(false)

  const expenseCodes = useMemo(() => new Set((accounts || []).filter(a => a.type === 'expense').map(a => a.code)), [accounts])
  const nameOf = useMemo(() => Object.fromEntries((accounts || []).map(a => [a.code, a.name])), [accounts])

  const rows = useMemo(() => {
    if (!raw || !allLines) return []
    const grouped = groupBySource(allLines)
    const voucherById = new Map((raw.vouchers || []).map(v => [v.id, v]))
    const out = []
    buildVoucherIndex(raw).forEach(e => {
      if (e.company !== company || e.cancelled || e.mirror) return
      if (!['payment', 'purchase', 'expense'].includes(e.kind)) return
      const v = e.collection === 'finance_vouchers' ? voucherById.get(e.id) : null
      const lines = (grouped.get(e.lineKey) || []).filter(l => num(l.debit) > 0 && expenseCodes.has(l.accountCode))
      if (e.kind === 'payment' && (!v || v.partyId)) return                         // vendor payments settle bills; only direct payments are expenses
      if (e.kind === 'purchase' && !lines.length) return                              // stock / asset bills have no expense head
      if (lines.some(l => SALES_COST.has(l.accountCode))) return                      // a bill that books purchases / subcontract cost is a purchase for sales
      if (!lines.length && e.kind !== 'expense') return
      const byAcct = new Map()
      lines.forEach(l => byAcct.set(l.accountCode, r2((byAcct.get(l.accountCode) || 0) + num(l.debit) - num(l.credit))))
      const amount = lines.length ? r2([...byAcct.values()].reduce((s, x) => s + x, 0)) : e.amount
      out.push({
        ...e, amount, codes: [...byAcct.keys()], paidTo: v?.expenseVendor || e.partyName || '',
        type: e.kind === 'purchase' ? 'Bill' : 'Paid', invoiceNo: v?.invoiceNo || '',
      })
    })
    return out
  }, [raw, allLines, company, expenseCodes])

  const shown = useMemo(() => rows
    .filter(r => (!acct || r.codes.includes(acct)) && (!from || r.date >= from) && (!to || r.date <= to)
      && (!q || `${r.number} ${r.paidTo} ${r.narration} ${r.codes.map(c => nameOf[c]).join(' ')}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.number).localeCompare(String(a.number))), [rows, acct, from, to, q, nameOf])

  const byAccount = useMemo(() => {
    const m = new Map()
    shown.forEach(r => {
      const each = r.codes.length ? r.amount / r.codes.length : 0                    // multi-head entries are split evenly for this summary only
      r.codes.forEach(c => m.set(c, r2((m.get(c) || 0) + each)))
    })
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [shown])
  const total = r2(shown.reduce((s, r) => s + r.amount, 0))
  const usedCodes = useMemo(() => [...new Set(rows.flatMap(r => r.codes))].sort(), [rows])

  if (creating && raw) {
    return <div className="max-w-5xl"><PaymentForm data={data} startMode="expense" onSaved={() => { invalidateFinanceCache(); reload(); setCreating(false) }} onCancel={() => setCreating(false)} /></div>
  }

  return (
    <ReportShell title="Expenses" loading={loading}
      subtitle="Running costs of the business — direct payments and vendor bills booked to an expense head. Purchases, subcontract, stock, freight and EOR costs stay under Purchase bills."
      exportBar={canWrite ? <button onClick={() => setCreating(true)} className={btnPrimary}>+ New Expense</button> : null}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <select value={acct} onChange={e => setAcct(e.target.value)} className={inputCls}>
          <option value="">All expense accounts</option>
          {usedCodes.map(c => <option key={c} value={c}>{c} · {nameOf[c] || c}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} title="From" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} title="To" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className={`${inputCls} w-48`} />
      </>}>
      {byAccount.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {byAccount.slice(0, 8).map(([c, amt]) => (
            <button key={c} onClick={() => setAcct(acct === c ? '' : c)} className={`${cardCls} px-3 py-2 text-left text-sm ${acct === c ? 'ring-2 ring-blue-500' : 'hover:bg-slate-50'}`}>
              <div className="text-xs text-slate-500">{nameOf[c] || c}</div><div className="font-semibold text-slate-800">{fmtAmt(amt)}</div>
            </button>))}
        </div>)}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
            <th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Expense account</th><th className="text-left px-4 py-3">Paid to</th>
            <th className="text-left px-4 py-3">Ref #</th><th className="text-left px-4 py-3">Notes</th><th className="text-left px-4 py-3">Type</th><th className="text-right px-4 py-3">Amount</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map(r => (
              <tr key={r.key} onClick={() => open(r)} className="cursor-pointer hover:bg-blue-50/40">
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.date}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.codes.map(c => nameOf[c] || c).join(', ') || '—'}</td>
                <td className="px-4 py-2.5 text-slate-700">{r.paidTo || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.number}{r.invoiceNo ? ` · ${r.invoiceNo}` : ''}</td>
                <td className="px-4 py-2.5 text-slate-500 truncate max-w-xs">{r.narration}</td>
                <td className="px-4 py-2.5"><Badge color={r.type === 'Bill' ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700'}>{r.type === 'Bill' ? 'Vendor bill' : 'Paid'}</Badge></td>
                <td className="px-4 py-2.5 text-right font-medium">{fmtAmt(r.amount)}</td>
              </tr>))}
            {shown.length === 0 && <tr><td colSpan={7}><Empty>No expenses for {company} in this view.{canWrite ? ' Click “New Expense” to record one.' : ''}</Empty></td></tr>}
          </tbody>
          {shown.length > 0 && <tfoot><tr className="bg-slate-50 font-semibold"><td colSpan={6} className="px-4 py-2.5 text-right text-slate-600">Total ({shown.length})</td><td className="px-4 py-2.5 text-right">{fmtAmt(total)}</td></tr></tfoot>}
        </table>
      </div>
      {modal}
    </ReportShell>
  )
}
