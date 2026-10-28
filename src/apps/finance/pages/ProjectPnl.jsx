// Project P&L: every project of the Projects register is a cost centre here. Set its budget (contract value + cost budget per expense account),
// tag purchases / expenses / payments / sales invoices / journal lines with the project, and this page shows budget vs actual and the profit.
import React, { useMemo, useState } from 'react'
import { doc, updateDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/app-config'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { projectPnl, untaggedTotals } from '../utils/projectPnl.js'
import { fmtAmt, fyRange, fyList, num } from '../utils/financeConstants.js'
import { downloadXlsx } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, ExportBar, Badge, Empty, cardCls, inputCls, thCls, btnPrimary, btnGhost, useFinancePerms } from '../components/FinanceUI.jsx'

const pct = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`)
const tone = (n) => (n >= 0 ? 'text-green-700' : 'text-red-600')

export default function ProjectPnl() {
  const { canWrite } = useFinancePerms()
  const { raw, allLines, accounts, loading, reload } = useFinanceData(['costCentres', 'projects'])
  const [company, setCompany] = useState('UIPL')
  const [fy, setFy] = useState('all')
  const [open, setOpen] = useState('')
  const [q, setQ] = useState('')
  const period = fy === 'all' ? {} : fyRange(fy)

  const projects = raw?.projects || []
  const centres = (raw?.costCentres || []).filter(c => c.projectId)
  const results = useMemo(() => centres.map(c => projectPnl(allLines, accounts, c, projects.find(p => p.id === c.projectId), { company, ...period }))
    .sort((a, b) => (b.centre.code || '').localeCompare(a.centre.code || '')), [centres, allLines, accounts, projects, company, fy]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = results.filter(r => !q || `${r.centre.name} ${r.project?.customerName || ''}`.toLowerCase().includes(q.toLowerCase()))
  const untagged = useMemo(() => untaggedTotals(allLines, accounts, { company, ...period }), [allLines, accounts, company, fy]) // eslint-disable-line react-hooks/exhaustive-deps
  const tot = shown.reduce((t, r) => ({ contract: t.contract + r.contractValue, billed: t.billed + r.billed, budget: t.budget + r.budgetCost, cost: t.cost + r.actualCost }), { contract: 0, billed: 0, budget: 0, cost: 0 })

  const exportSummary = () => downloadXlsx(`Project P&L ${company} ${fy}`, [
    { name: 'Projects', rows: [['Project code', 'Project', 'Customer', 'Contract value', 'Billed', 'Cost budget', 'Actual cost', 'Cost used %', 'Profit to date', 'Expected profit', 'Expected margin %'],
      ...shown.map(r => [r.centre.code, r.project?.projectName || r.centre.name, r.project?.customerName || '', r.contractValue, r.billed, r.budgetCost, r.actualCost, r.costPct ?? '', r.profitToDate, r.expectedProfit ?? '', r.expectedMargin ?? ''])] },
    ...shown.filter(r => r.rows.length || r.incomeRows.length).map(r => ({ name: (r.centre.code || r.centre.name).replace(/[\\/?*[\]:]/g, '-').slice(0, 30), rows: [
      ['Account', 'Budget', 'Actual', 'Remaining'], ...r.rows.map(x => [`${x.code} ${x.name}`, x.budget, x.actual, x.remaining]), [],
      ['Date', 'Document', 'Description', 'Account', 'Income / cost', 'Amount'], ...r.docs.map(d => [d.date, d.doc, d.description, `${d.account.code} ${d.account.name}`, d.kind === 'income' ? 'Income' : 'Cost', d.amount])] })),
  ])

  return (
    <ReportShell title="Project P&L" loading={loading}
      subtitle="Budget, billing, cost and profit for every project of the Projects register. A purchase, expense, payment, sales invoice or journal line counts for a project when you choose the project on it."
      exportBar={<ExportBar onXlsx={exportSummary} />}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <select value={fy} onChange={e => setFy(e.target.value)} className={inputCls}><option value="all">All time (whole project life)</option>{fyList().map(f => <option key={f} value={f}>FY {f}</option>)}</select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search project / customer" className={`${inputCls} w-60`} />
      </>}>
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80"><tr>
            <th className={`${thCls} text-left`}>Project</th><th className={`${thCls} text-right`}>Contract value</th><th className={`${thCls} text-right`}>Billed</th>
            <th className={`${thCls} text-right`}>Cost budget</th><th className={`${thCls} text-right`}>Actual cost</th><th className={`${thCls} text-right`}>Cost used</th>
            <th className={`${thCls} text-right`}>Profit to date</th><th className={`${thCls} text-right`}>Expected profit</th><th className={`${thCls} text-right`}>Margin</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map(r => (
              <React.Fragment key={r.centre.id}>
                <tr className="hover:bg-slate-50/60 cursor-pointer" onClick={() => setOpen(open === r.centre.id ? '' : r.centre.id)}>
                  <td className="px-3 py-2"><div className="font-mono text-xs font-bold text-blue-700">{r.centre.code}</div><div className="font-medium">{r.project?.projectName || r.centre.name}</div>{r.project?.customerName && <div className="text-xs text-slate-400">{r.project.customerName}</div>}</td>
                  <td className="px-3 py-2 text-right">{fmtAmt(r.contractValue)}</td>
                  <td className="px-3 py-2 text-right">{fmtAmt(r.billed)}{r.billedPct !== null && <div className="text-xs text-slate-400">{pct(r.billedPct)}</div>}</td>
                  <td className="px-3 py-2 text-right">{r.hasBudget ? fmtAmt(r.budgetCost) : <Badge>no budget</Badge>}</td>
                  <td className="px-3 py-2 text-right">{fmtAmt(r.actualCost)}</td>
                  <td className={`px-3 py-2 text-right ${r.costPct > 100 ? 'text-red-600 font-semibold' : ''}`}>{pct(r.costPct)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${tone(r.profitToDate)}`}>{fmtAmt(r.profitToDate)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${r.expectedProfit === null ? '' : tone(r.expectedProfit)}`}>{r.expectedProfit === null ? '—' : fmtAmt(r.expectedProfit)}</td>
                  <td className={`px-3 py-2 text-right ${r.expectedMargin === null ? '' : tone(r.expectedMargin)}`}>{pct(r.expectedMargin)}</td>
                </tr>
                {open === r.centre.id && <tr><td colSpan={9} className="bg-slate-50/60 p-4"><ProjectDetail r={r} accounts={accounts} canWrite={canWrite} onSaved={() => { invalidateFinanceCache(); reload() }} /></td></tr>}
              </React.Fragment>
            ))}
            {shown.length === 0 && <tr><td colSpan={9}><Empty>{centres.length ? 'No project matches.' : 'No projects yet. Projects created from won deals in the Projects register appear here automatically (open Finance again after creating one).'}</Empty></td></tr>}
          </tbody>
          {shown.length > 0 && <tfoot><tr className="bg-slate-50 font-bold"><td className="px-3 py-2">Total ({shown.length} projects)</td><td className="px-3 py-2 text-right">{fmtAmt(tot.contract)}</td><td className="px-3 py-2 text-right">{fmtAmt(tot.billed)}</td><td className="px-3 py-2 text-right">{fmtAmt(tot.budget)}</td><td className="px-3 py-2 text-right">{fmtAmt(tot.cost)}</td><td /><td className={`px-3 py-2 text-right ${tone(tot.billed - tot.cost)}`}>{fmtAmt(tot.billed - tot.cost)}</td><td /><td /></tr></tfoot>}
        </table>
      </div>
      <div className="text-xs text-slate-500 space-y-1">
        <p><b>Not tagged to any project</b> in this period: income {fmtAmt(untagged.income)}, expenses {fmtAmt(untagged.expense)} (overheads such as rent and office salaries stay here). Project figures + these = the company's own Profit &amp; Loss.</p>
        <p>Billed = sales invoices tagged to the project (excluding GST). Expected profit = contract value − the larger of the cost budget and the actual cost so far. Profit to date = billed − actual cost.</p>
      </div>
    </ReportShell>
  )
}

function ProjectDetail({ r, accounts, canWrite, onSaved }) {
  const expenseAccounts = accounts.filter(a => a.type === 'expense' && a.isActive !== false)
  const saved = r.centre.budget || {}
  const [contract, setContract] = useState(saved.contractValue ?? (r.project?.contractValue || ''))
  const [lines, setLines] = useState((saved.lines || []).map(l => ({ ...l })))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const dirty = JSON.stringify({ c: num(contract), l: lines.filter(l => l.accountCode).map(l => [l.accountCode, num(l.amount)]) }) !== JSON.stringify({ c: num(saved.contractValue ?? r.project?.contractValue), l: (saved.lines || []).map(l => [l.accountCode, num(l.amount)]) })
  const used = new Set(lines.map(l => l.accountCode))

  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const clean = lines.filter(l => l.accountCode && num(l.amount) > 0).map(l => ({ accountCode: l.accountCode, amount: num(l.amount) }))
      await updateDoc(doc(db, 'finance_cost_centres', r.centre.id), { budget: { contractValue: num(contract), lines: clean, updatedAt: new Date().toISOString() } })
      setMsg('Budget saved.'); onSaved()
    } catch (e) { setMsg('Could not save: ' + e.message) }
    setBusy(false)
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className={`${cardCls} p-3 space-y-3`}>
        <h4 className="font-bold text-slate-700 text-sm">Budget</h4>
        <label className="block text-xs text-slate-500">Contract value (revenue, excl. GST)
          <input type="number" min="0" value={contract} onChange={e => setContract(e.target.value)} disabled={!canWrite} className={`${inputCls} w-full mt-1`} />
        </label>
        <table className="w-full text-sm"><thead><tr><th className={`${thCls} text-left`}>Cost head</th><th className={`${thCls} text-right`}>Budget</th><th /></tr></thead><tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1 pr-2"><select value={l.accountCode} disabled={!canWrite} onChange={e => setLines(p => p.map((x, j) => j === i ? { ...x, accountCode: e.target.value } : x))} className={`${inputCls} w-full`}>
                <option value="">— choose —</option>{expenseAccounts.filter(a => a.code === l.accountCode || !used.has(a.code)).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></td>
              <td className="py-1"><input type="number" min="0" value={l.amount} disabled={!canWrite} onChange={e => setLines(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className={`${inputCls} w-32 text-right`} /></td>
              <td className="py-1 pl-2">{canWrite && <button className="text-slate-300 hover:text-red-500" onClick={() => setLines(p => p.filter((_, j) => j !== i))}>✕</button>}</td>
            </tr>
          ))}
        </tbody></table>
        {canWrite && <div className="flex items-center gap-2 flex-wrap">
          <button className={btnGhost} onClick={() => setLines(p => [...p, { accountCode: '', amount: '' }])}>+ Cost head</button>
          <button className={btnPrimary} disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save budget'}</button>
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
        </div>}
        {lines.length > 0 && <p className="text-xs text-slate-500">Total cost budget {fmtAmt(lines.reduce((s, l) => s + num(l.amount), 0))}{num(contract) > 0 && <> · planned margin {fmtAmt(num(contract) - lines.reduce((s, l) => s + num(l.amount), 0))} ({pct((num(contract) - lines.reduce((s, l) => s + num(l.amount), 0)) * 100 / num(contract))})</>}</p>}
      </div>

      <div className={`${cardCls} p-3 space-y-3`}>
        <h4 className="font-bold text-slate-700 text-sm">Budget vs actual</h4>
        <table className="w-full text-sm"><thead><tr><th className={`${thCls} text-left`}>Cost head</th><th className={`${thCls} text-right`}>Budget</th><th className={`${thCls} text-right`}>Actual</th><th className={`${thCls} text-right`}>Remaining</th></tr></thead><tbody className="divide-y divide-slate-100">
          {r.rows.map(x => <tr key={x.code} className={x.over ? 'bg-red-50/60' : ''}><td className="py-1.5">{x.name}{x.over && <span className="ml-2"><Badge>{x.budget ? 'over budget' : 'not budgeted'}</Badge></span>}</td><td className="py-1.5 text-right">{fmtAmt(x.budget)}</td><td className="py-1.5 text-right">{fmtAmt(x.actual)}</td><td className={`py-1.5 text-right ${x.remaining < 0 ? 'text-red-600 font-semibold' : ''}`}>{fmtAmt(x.remaining)}</td></tr>)}
          {r.rows.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-slate-400">No cost booked or budgeted yet.</td></tr>}
        </tbody>
        {r.rows.length > 0 && <tfoot><tr className="font-bold"><td className="pt-2">Total cost</td><td className="pt-2 text-right">{fmtAmt(r.budgetCost)}</td><td className="pt-2 text-right">{fmtAmt(r.actualCost)}</td><td className="pt-2 text-right">{fmtAmt(r.budgetCost - r.actualCost)}</td></tr></tfoot>}
        </table>
        {r.incomeRows.length > 0 && <table className="w-full text-sm"><thead><tr><th className={`${thCls} text-left`}>Income</th><th className={`${thCls} text-right`}>Amount</th></tr></thead><tbody>{r.incomeRows.map(x => <tr key={x.code}><td className="py-1">{x.name}</td><td className="py-1 text-right">{fmtAmt(x.amount)}</td></tr>)}</tbody></table>}
      </div>

      <div className={`${cardCls} p-3 lg:col-span-2`}>
        <h4 className="font-bold text-slate-700 text-sm mb-2">Entries counted in this project ({r.docs.length})</h4>
        <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-white"><tr><th className={`${thCls} text-left`}>Date</th><th className={`${thCls} text-left`}>Document</th><th className={`${thCls} text-left`}>Details</th><th className={`${thCls} text-left`}>Account</th><th className={`${thCls} text-right`}>Amount</th></tr></thead><tbody className="divide-y divide-slate-100">
          {r.docs.map((d, i) => <tr key={i}><td className="py-1 pr-3 whitespace-nowrap">{d.date}</td><td className="py-1 pr-3 font-mono text-xs">{d.doc}</td><td className="py-1 pr-3 text-slate-600">{d.description}</td><td className="py-1 pr-3">{d.account.name}</td><td className={`py-1 text-right ${d.kind === 'income' ? 'text-green-700' : ''}`}>{d.kind === 'income' ? '+' : '−'} {fmtAmt(Math.abs(d.amount))}</td></tr>)}
          {r.docs.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-slate-400">Nothing is tagged to this project yet — choose it in the Cost centre / Project field when you enter a bill, payment, invoice or journal.</td></tr>}
        </tbody></table></div>
      </div>
    </div>
  )
}
