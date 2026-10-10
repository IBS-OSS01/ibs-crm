// Finance dashboard — every figure comes from the same derived ledger as the reports, so
// it always agrees with the Trial Balance, Balance Sheet and registers.
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { computeOutstanding } from '../utils/outstanding.js'
import { tradingPL, balanceUpTo } from '../utils/financialStatements.js'
import { fmtAmt, todayStr, r2 } from '../utils/financeConstants.js'
import { CompanyToggle, cardCls } from '../components/FinanceUI.jsx'

export default function FinanceDashboard() {
  const navigate = useNavigate()
  const { allLines, accounts, loading } = useFinanceData()
  const [company, setCompany] = useState('UIPL')
  const today = todayStr()
  const monthStart = today.slice(0, 8) + '01'

  const m = useMemo(() => {
    if (loading) return null
    const recv = computeOutstanding(allLines, { kind: 'receivable', company, asOf: today })
    const pay = computeOutstanding(allLines, { kind: 'payable', company, asOf: today })
    const month = tradingPL(allLines, accounts, { company, from: monthStart, to: today })
    const collected = r2(allLines.filter(l => l.company === company && l.accountCode === '1200' && l.sourceType === 'receipt' && l.date >= monthStart && l.date <= today).reduce((s, l) => s + (Number(l.credit) || 0), 0))
    const cash = r2(balanceUpTo(allLines, '1100', { company, asOf: today }) + balanceUpTo(allLines, '1110', { company, asOf: today }))
    const tds = r2(-balanceUpTo(allLines, '2500', { company, asOf: today }))
    const gst = r2(-['2401', '2402', '2403', '2404'].reduce((s, c) => s + balanceUpTo(allLines, c, { company, asOf: today }), 0) - ['1301', '1302', '1303'].reduce((s, c) => s + balanceUpTo(allLines, c, { company, asOf: today }), 0))
    const overdueRecv = recv.parties.reduce((s, p) => s + p.bills.filter(b => b.daysOverdue > 0).length, 0)
    const overduePay = pay.parties.reduce((s, p) => s + p.bills.filter(b => b.daysOverdue > 0).length, 0)
    return { recv, pay, month, collected, cash, tds, gst, overdueRecv, overduePay }
  }, [allLines, accounts, company, loading, today, monthStart])

  if (loading || !m) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  const cards = [
    { label: 'Cash & bank', value: m.cash, icon: '🏦', path: '/finance/cashbank' },
    { label: 'Receivables outstanding', value: m.recv.totals.total, icon: '📥', color: 'text-red-600', path: '/finance/outstanding/receivables', sub: m.overdueRecv ? `${m.overdueRecv} bill(s) overdue` : null },
    { label: 'Payables outstanding', value: m.pay.totals.total, icon: '🧾', color: m.overduePay ? 'text-red-600' : 'text-slate-700', path: '/finance/outstanding/payables', sub: m.overduePay ? `${m.overduePay} bill(s) overdue` : null },
    { label: 'Collected this month', value: m.collected, icon: '💳', color: 'text-green-600', path: '/finance/vouchers/receipt' },
    { label: 'Sales this month', value: m.month.sales, icon: '📈', color: 'text-blue-600', path: '/finance/registers/sales' },
    { label: 'TDS to deposit', value: m.tds, icon: '🏛️', color: m.tds > 0 ? 'text-amber-600' : 'text-slate-700', path: '/finance/tds/dashboard' },
    { label: 'GST payable (net of ITC)', value: m.gst, icon: '🧮', color: m.gst > 0 ? 'text-amber-600' : 'text-slate-700', path: '/finance/gst/gstr3b', sub: m.gst < 0 ? 'credit available' : null },
  ]
  const net = m.month.netProfit

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">💰 Finance Dashboard</h2>
          <p className="text-slate-500 text-sm">As of {today} · from the books (vouchers, invoices and opening balances)</p>
        </div>
        <CompanyToggle value={company} onChange={setCompany} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <button key={c.label} onClick={() => navigate(c.path)} className={`${cardCls} p-4 text-left hover:border-blue-300 transition`}>
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className={`text-lg font-bold ${c.color || 'text-slate-800'}`}>₹{fmtAmt(Math.abs(c.value))}{c.value < 0 ? ' Cr' : ''}</p>
            <p className="text-xs text-slate-500 mt-0.5">{c.label}</p>
            {c.sub && <p className="text-xs text-red-500">{c.sub}</p>}
          </button>
        ))}
      </div>

      <div className={`rounded-xl p-5 border ${net >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-medium text-slate-600">{net >= 0 ? 'Net profit' : 'Net loss'} this month</p>
            <p className={`text-3xl font-bold mt-1 ${net >= 0 ? 'text-green-700' : 'text-red-700'}`}>₹{fmtAmt(Math.abs(net))}</p>
            <p className="text-xs text-slate-500 mt-1">Sales ₹{fmtAmt(m.month.sales)} · cost of goods ₹{fmtAmt(m.month.cogs)} · other expenses ₹{fmtAmt(m.month.totalIndirect)}</p>
          </div>
          <button onClick={() => navigate('/finance/statements/trading')} className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition">View Trading &amp; P&amp;L →</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Receipt (F6)', '/finance/vouchers/receipt', '💰'], ['Payment (F5)', '/finance/vouchers/payment', '💸'], ['Purchase (F9)', '/finance/vouchers/purchase', '🛒'], ['Sales Invoice', '/finance/invoices', '🧾'],
          ['Day Book', '/finance/daybook', '📒'], ['GSTR-1 / 3B', '/finance/gst/gstr1', '🧮'], ['Stock Summary', '/finance/stock/summary', '📦'], ['All reports', '/finance/reports', '🗂️'],
        ].map(([label, path, icon]) => (
          <button key={label} onClick={() => navigate(path)} className={`${cardCls} p-3 text-sm text-slate-700 hover:border-blue-300 transition flex items-center gap-2`}><span>{icon}</span> {label}</button>
        ))}
      </div>
    </div>
  )
}
