// Cost centres (projects / departments / sites): master + income-expense summary.
// A cost centre is chosen on Purchase, Debit/Credit Note and Payment vouchers; the
// summary adds up only the income and expense lines carrying that tag.
import React, { useMemo, useState } from 'react'
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { costCentreSummary } from '../utils/financialStatements.js'
import { fmtAmt, fyRange, currentFY } from '../utils/financeConstants.js'
import { downloadXlsx } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, DateRange, ExportBar, Badge, Empty, cardCls, inputCls, thCls, btnPrimary, useFinancePerms } from '../components/FinanceUI.jsx'

export default function CostCentres() {
  const { canWrite } = useFinancePerms()
  const { user } = useAuth()
  const { raw, allLines, accounts, loading, reload } = useFinanceData(['costCentres'])
  const [company, setCompany] = useState('UIPL')
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const [name, setName] = useState('')
  const [open, setOpen] = useState('')
  const [err, setErr] = useState('')
  const centres = raw?.costCentres || []
  const summary = useMemo(() => costCentreSummary(allLines, accounts, { company, from: period.from, to: period.to }), [allLines, accounts, company, period])
  const byId = Object.fromEntries(summary.map(s => [s.id, s]))
  const rows = centres.map(c => ({ c, s: byId[c.id] || { income: 0, expense: 0, net: 0, byAccount: {} } }))
  const total = rows.reduce((t, r) => ({ income: t.income + r.s.income, expense: t.expense + r.s.expense }), { income: 0, expense: 0 })

  const add = async () => {
    setErr('')
    if (!name.trim()) return
    if (centres.some(c => c.name.toLowerCase() === name.trim().toLowerCase())) return setErr('A cost centre with this name already exists.')
    try {
      await addDoc(collection(db, 'finance_cost_centres'), { name: name.trim(), active: true, createdAt: new Date().toISOString(), createdBy: user?.uid || '' })
      setName(''); invalidateFinanceCache(); reload()
    } catch (e) { setErr(e.message) }
  }
  const toggle = async (c) => { await updateDoc(doc(db, 'finance_cost_centres', c.id), { active: c.active === false }); invalidateFinanceCache(); reload() }

  return (
    <ReportShell title="Cost Centres" loading={loading} subtitle="Track income and expense by project, site or department."
      exportBar={<ExportBar onXlsx={() => downloadXlsx(`Cost centres ${company}`, [{ name: 'Summary', rows: [['Cost centre', 'Income', 'Expense', 'Net'], ...rows.map(r => [r.c.name, r.s.income, r.s.expense, r.s.net])] }])} />}
      filters={<><CompanyToggle value={company} onChange={setCompany} /><DateRange from={period.from} to={period.to} onChange={setPeriod} /></>}>
      {canWrite && (
        <div className={`${cardCls} p-3 flex gap-2 items-center flex-wrap`}>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="New cost centre name (e.g. Pune site, R&D)" className={`${inputCls} w-72`} />
          <button className={btnPrimary} onClick={add}>Add</button>{err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      )}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm"><thead className="bg-slate-50/80"><tr><th className={`${thCls} text-left`}>Cost centre</th><th className={`${thCls} text-right`}>Income</th><th className={`${thCls} text-right`}>Expense</th><th className={`${thCls} text-right`}>Net</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ c, s }) => (
              <React.Fragment key={c.id}>
                <tr className="hover:bg-slate-50/60 cursor-pointer" onClick={() => setOpen(open === c.id ? '' : c.id)}>
                  <td className="px-3 py-2 font-medium">{c.name}{c.active === false && <span className="ml-2"><Badge>inactive</Badge></span>}</td>
                  <td className="px-3 py-2 text-right">{fmtAmt(s.income)}</td><td className="px-3 py-2 text-right">{fmtAmt(s.expense)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${s.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtAmt(s.net)}</td>
                  <td className="px-3 py-2 text-right">{canWrite && <button className="text-xs text-blue-600 hover:underline" onClick={e => { e.stopPropagation(); toggle(c) }}>{c.active === false ? 'Activate' : 'Deactivate'}</button>}</td>
                </tr>
                {open === c.id && Object.entries(s.byAccount).map(([code, amt]) => (
                  <tr key={code} className="bg-slate-50/50 text-slate-600"><td className="px-3 py-1.5 pl-8">{accounts.find(a => a.code === code)?.name || code}</td><td colSpan={2} /><td className="px-3 py-1.5 text-right">{fmtAmt(amt)}</td><td /></tr>
                ))}
              </React.Fragment>
            ))}
            {rows.length === 0 && <tr><td colSpan={5}><Empty>No cost centres yet.</Empty></td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="bg-slate-50 font-bold"><td className="px-3 py-2">Total tagged</td><td className="px-3 py-2 text-right">{fmtAmt(total.income)}</td><td className="px-3 py-2 text-right">{fmtAmt(total.expense)}</td><td className="px-3 py-2 text-right">{fmtAmt(total.income - total.expense)}</td><td /></tr></tfoot>}
        </table>
      </div>
      <p className="text-xs text-slate-400">Only vouchers tagged with a cost centre are counted (Purchase, Debit/Credit Note, Payment). Sales invoices from the Invoices page can't be tagged yet, so project income appears under Finance → Project Costs instead.</p>
    </ReportShell>
  )
}
