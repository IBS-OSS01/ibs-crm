// Finance dashboard — every figure comes from the same derived ledger as the reports, so
// it always agrees with the Trial Balance, Balance Sheet and registers.
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { computeOutstanding } from '../utils/outstanding.js'
import { tradingPL, balanceUpTo } from '../utils/financialStatements.js'
import { deductionRows, monthlyPosition } from '../utils/tdsReports.js'
import { fmtAmt, todayStr, r2, currentFY } from '../utils/financeConstants.js'
import { CompanyToggle, cardCls } from '../components/FinanceUI.jsx'

export default function FinanceDashboard() {
  const navigate = useNavigate()
  const { raw, allLines, accounts, stock, loading } = useFinanceData(['tdsChallans'])
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

  const [hideSetup, setHideSetup] = useState(() => { try { return localStorage.getItem('finance.setup.hidden') === '1' } catch { return false } })
  const cs = raw?.companySettings?.[company] || {}
  const gstRegistered = company === 'UIPL'
  const setup = useMemo(() => !raw ? [] : [
    { label: 'Company details (GSTIN, state)', done: !gstRegistered || !!(cs.gstin && cs.stateCode), path: '/finance/settings', hint: 'Needed for CGST/SGST vs IGST and returns' },
    { label: 'TAN for TDS', done: !!cs.tan, path: '/finance/settings', hint: 'Needed for TDS statements' },
    { label: 'Add a bank account', done: (raw.bankAccounts || []).some(b => b.company === company), path: '/finance/banking', hint: 'With its opening balance' },
    { label: 'Add your vendors', done: (raw.vendors || []).length > 0, path: '/finance/vendors', hint: 'Name, GSTIN, PAN' },
    { label: 'Add your customers', done: (raw.customers || []).length > 0 || (raw.invoices || []).length > 1, path: '/finance/parties', hint: 'Credit days and opening balances' },
    { label: 'Record your first voucher', done: (raw.vouchers || []).length > 0, path: '/finance/vouchers/purchase?new=1', hint: 'Press + New, or F9 for a purchase' },
  ], [raw, company, cs, gstRegistered])
  const setupDone = setup.filter(x => x.done).length

  const alerts = useMemo(() => {
    if (!raw || !m) return []
    const a = []
    if (m.overdueRecv) a.push({ tone: 'red', icon: '📥', text: `${m.overdueRecv} customer bill(s) overdue`, path: '/finance/outstanding/receivables', cta: 'Chase' })
    if (m.overduePay) a.push({ tone: 'red', icon: '🧾', text: `${m.overduePay} vendor bill(s) overdue`, path: '/finance/outstanding/payables', cta: 'Pay' })
    const fy = currentFY()
    const pos = monthlyPosition(deductionRows(raw.vouchers, raw.vendors, { company }).filter(d => d.fy === fy), (raw.tdsChallans || []).filter(c => c.company === company && c.fy === fy), { company, fy, asOf: today })
    const late = pos.filter(x => x.status === 'overdue'), due = pos.filter(x => x.status === 'pending')
    if (late.length) a.push({ tone: 'red', icon: '🏛️', text: `TDS ₹${fmtAmt(late.reduce((t, x) => t + x.pending, 0))} not deposited past the due date`, path: '/finance/tds/dashboard', cta: 'Deposit' })
    else if (due.length) a.push({ tone: 'amber', icon: '🏛️', text: `TDS ₹${fmtAmt(due.reduce((t, x) => t + x.pending, 0))} to deposit by ${due[0].due}`, path: '/finance/tds/dashboard', cta: 'Record' })
    if (gstRegistered && cs.gstin) {
      const d = new Date(today + 'T00:00:00'), day = d.getDate()
      const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleString('en-IN', { month: 'long' })
      if (day <= 11) a.push({ tone: day >= 8 ? 'amber' : 'blue', icon: '📤', text: `GSTR-1 for ${prev} is due on the 11th`, path: '/finance/gst/gstr1', cta: 'Prepare' })
      if (day <= 20) a.push({ tone: day >= 15 ? 'amber' : 'blue', icon: '🧮', text: `GSTR-3B for ${prev} is due on the 20th`, path: '/finance/gst/gstr3b', cta: 'Prepare' })
    }
    const neg = (stock?.summary || []).filter(x => x.company === company && x.negative).length
    if (neg) a.push({ tone: 'amber', icon: '📦', text: `${neg} item(s) have negative stock`, path: '/finance/stock/summary', cta: 'Check' })
    return a
  }, [raw, m, company, today, gstRegistered, cs.gstin, stock])
  const tones = { red: 'bg-red-50 border-red-200 text-red-800', amber: 'bg-amber-50 border-amber-200 text-amber-800', blue: 'bg-blue-50 border-blue-200 text-blue-800' }

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
  const wayzim = company === 'Wayzim'
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

      {!wayzim && setupDone < setup.length && !hideSetup && (
        <div className={`${cardCls} p-4`}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div><p className="font-semibold text-slate-800">Get set up <span className="text-slate-400 font-normal">· {setupDone} of {setup.length} done</span></p>
              <div className="w-48 h-1.5 bg-slate-100 rounded mt-1.5"><div className="h-1.5 bg-blue-500 rounded" style={{ width: `${setupDone * 100 / setup.length}%` }} /></div></div>
            <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => { setHideSetup(true); try { localStorage.setItem('finance.setup.hidden', '1') } catch { /* ignore */ } }}>Hide</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {setup.map(x => (
              <button key={x.label} onClick={() => navigate(x.path)} className={`flex items-start gap-2.5 text-left p-2 rounded-lg hover:bg-slate-50 ${x.done ? 'opacity-60' : ''}`}>
                <span className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${x.done ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300'}`}>{x.done ? '✓' : ''}</span>
                <span><span className={`block text-sm ${x.done ? 'line-through text-slate-400' : 'text-slate-800 font-medium'}`}>{x.label}</span>{!x.done && <span className="block text-xs text-slate-400">{x.hint}</span>}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!wayzim && alerts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Needs your attention</p>
          {alerts.map(x => (
            <div key={x.text} className={`flex items-center gap-3 border rounded-xl px-4 py-2.5 text-sm ${tones[x.tone]}`}>
              <span>{x.icon}</span><span className="flex-1">{x.text}</span>
              <button onClick={() => navigate(x.path)} className="text-xs font-semibold underline underline-offset-2 whitespace-nowrap">{x.cta} →</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.filter(c => !wayzim || ['Cash & bank', 'Receivables outstanding', 'Payables outstanding', 'Collected this month', 'Sales this month'].includes(c.label)).map(c => (
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
          ['Receipt (F6)', '/finance/vouchers/receipt', '💰'], ['Sales Invoice', '/finance/invoices', '🧾'], ['Credit note', '/finance/vouchers/credit_note', '↩️'], ['Day Book', '/finance/daybook', '📒'],
          ...(wayzim ? [['Who owes me', '/finance/outstanding/receivables', '📥'], ['Sales analysis', '/finance/analysis/sales-party', '🧮'], ['Profit & loss', '/finance/statements/trading', '📈'], ['All reports', '/finance/reports', '🗂️']]
            : [['Payment (F5)', '/finance/vouchers/payment', '💸'], ['Purchase (F9)', '/finance/vouchers/purchase', '🛒'], ['GSTR-1 / 3B', '/finance/gst/gstr1', '🧮'], ['Stock Summary', '/finance/stock/summary', '📦']]),
        ].map(([label, path, icon]) => (
          <button key={label} onClick={() => navigate(path)} className={`${cardCls} p-3 text-sm text-slate-700 hover:border-blue-300 transition flex items-center gap-2`}><span>{icon}</span> {label}</button>
        ))}
      </div>
    </div>
  )
}
