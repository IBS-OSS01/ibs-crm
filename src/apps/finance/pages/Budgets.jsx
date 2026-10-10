// Budgets: yearly amount per income/expense account (optionally per cost centre) and a
// budget-vs-actual report pro-rated to the months in the chosen period.
import React, { useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { budgetVsActual } from '../utils/financialStatements.js'
import { fmtAmt, fyRange, fyList, currentFY, num } from '../utils/financeConstants.js'
import { downloadXlsx } from '../utils/exportUtils.js'
import { Field } from '../components/formShared.jsx'
import { ReportShell, CompanyToggle, DateRange, ExportBar, Empty, cardCls, inputCls, formInputCls, thCls, btnPrimary, useFinancePerms } from '../components/FinanceUI.jsx'

export default function Budgets() {
  const { canWrite } = useFinancePerms()
  const { user } = useAuth()
  const { raw, allLines, accounts, loading, reload } = useFinanceData(['budgets', 'costCentres'])
  const [company, setCompany] = useState('UIPL')
  const [fy, setFy] = useState(currentFY())
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const [f, setF] = useState({ accountCode: '', amount: '', costCentreId: '' })
  const [err, setErr] = useState('')
  const plAccounts = accounts.filter(a => ['income', 'expense'].includes(a.type))
  const budgets = useMemo(() => (raw?.budgets || []).filter(b => b.company === company && b.fy === fy), [raw, company, fy])
  const report = useMemo(() => budgetVsActual(allLines, accounts, budgets, { company, from: period.from, to: period.to }), [allLines, accounts, budgets, company, period])
  const ccName = (id) => (raw?.costCentres || []).find(c => c.id === id)?.name

  const add = async () => {
    setErr('')
    if (!f.accountCode || num(f.amount) <= 0) return setErr('Choose an account and enter the yearly amount.')
    if (budgets.some(b => b.accountCode === f.accountCode && (b.costCentreId || '') === f.costCentreId)) return setErr('A budget for that account / cost centre already exists — remove it first.')
    await addDoc(collection(db, 'finance_budgets'), { company, fy, accountCode: f.accountCode, costCentreId: f.costCentreId, amount: num(f.amount), createdAt: new Date().toISOString(), createdBy: user?.uid || '' })
    setF({ accountCode: '', amount: '', costCentreId: '' }); invalidateFinanceCache(); reload()
  }
  const del = async (id) => { await deleteDoc(doc(db, 'finance_budgets', id)); invalidateFinanceCache(); reload() }

  return (
    <ReportShell title="Budgets" loading={loading} subtitle="Set a yearly budget per account and compare it with actuals."
      exportBar={<ExportBar onXlsx={() => downloadXlsx(`Budget vs actual ${company} ${fy}`, [{ name: 'Budget', rows: [['Account', 'Cost centre', 'Budget (pro-rata)', 'Actual', 'Variance', 'Variance %'], ...report.map(r => [r.account.name, ccName(r.costCentreId) || '', r.budget, r.actual, r.variance, r.pct ?? ''])] }])} />}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <select value={fy} onChange={e => { setFy(e.target.value); setPeriod(fyRange(e.target.value)) }} className={inputCls}>{fyList().map(x => <option key={x} value={x}>FY 20{x.slice(0, 2)}-{x.slice(3)}</option>)}</select>
        <DateRange from={period.from} to={period.to} onChange={setPeriod} />
      </>}>
      {canWrite && (
        <div className={`${cardCls} p-3 grid grid-cols-2 md:grid-cols-5 gap-3 items-end`}>
          <Field label="Account" className="md:col-span-2"><select value={f.accountCode} onChange={e => setF({ ...f, accountCode: e.target.value })} className={formInputCls}><option value="">— income / expense account —</option>{plAccounts.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></Field>
          <Field label="Cost centre"><select value={f.costCentreId} onChange={e => setF({ ...f, costCentreId: e.target.value })} className={formInputCls}><option value="">All</option>{(raw?.costCentres || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Yearly amount (₹)"><input type="number" min="0" step="any" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} className={formInputCls} /></Field>
          <button className={btnPrimary} onClick={add}>Add budget</button>{err && <p className="col-span-full text-sm text-red-600">{err}</p>}
        </div>
      )}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm"><thead className="bg-slate-50/80"><tr><th className={`${thCls} text-left`}>Account</th><th className={`${thCls} text-left`}>Cost centre</th><th className={`${thCls} text-right`}>Yearly</th><th className={`${thCls} text-right`}>Budget (period)</th><th className={`${thCls} text-right`}>Actual</th><th className={`${thCls} text-right`}>Variance</th><th className={`${thCls} text-right`}>%</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {report.map(r => {
              const bad = r.account.type === 'expense' ? r.variance > 0 : r.variance < 0
              return (
                <tr key={r.id}><td className="px-3 py-2 font-medium">{r.account.name}</td><td className="px-3 py-2 text-slate-500">{ccName(r.costCentreId) || 'All'}</td><td className="px-3 py-2 text-right">{fmtAmt(r.amount)}</td><td className="px-3 py-2 text-right">{fmtAmt(r.budget)}</td><td className="px-3 py-2 text-right">{fmtAmt(r.actual)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${bad ? 'text-red-600' : 'text-green-700'}`}>{fmtAmt(r.variance)}</td><td className="px-3 py-2 text-right">{r.pct === null ? '—' : `${r.pct}%`}</td>
                  <td className="px-3 py-2 text-right">{canWrite && <button className="text-xs text-red-500 hover:underline" onClick={() => del(r.id)}>Remove</button>}</td></tr>
              )
            })}
            {report.length === 0 && <tr><td colSpan={8}><Empty>No budgets for this year.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Red = overspend on an expense (or shortfall on income). The budget for a part-year is the yearly amount × months in the period ÷ 12.</p>
    </ReportShell>
  )
}
