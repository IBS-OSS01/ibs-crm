// HR → PF / ESIC: what was deducted and contributed for a month, plus the two files the portals want
// (EPFO ECR text file and the ESIC monthly contribution sheet).
import React, { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { mergeStatutory, payrollTotals, buildEcr, esicRows, contributionDue } from '../utils/statutory.js'
import { downloadXlsx } from '../../finance/utils/exportUtils.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`

export default function Statutory() {
  const d = new Date()
  const [year, setYear] = useState(d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear())
  const [month, setMonth] = useState(d.getMonth() === 0 ? 11 : d.getMonth() - 1)
  const [slips, setSlips] = useState([])
  const [employees, setEmployees] = useState({})
  const [s, setS] = useState(mergeStatutory())
  const [loading, setLoading] = useState(true)
  const ym = `${year}-${String(month + 1).padStart(2, '0')}`

  useEffect(() => {
    getDoc(doc(db, 'company_settings', 'UIPL')).then(x => setS(mergeStatutory(x.exists() ? x.data().statutory : null))).catch(() => {})
    getDocs(collection(db, 'hr_employees')).then(snap => { const m = {}; snap.forEach(x => { m[x.id] = { id: x.id, ...x.data() } }); setEmployees(m) })
  }, [])
  useEffect(() => {
    setLoading(true)
    getDocs(query(collection(db, 'hr_salary_slips'), where('month', '==', ym))).then(snap => { const a = []; snap.forEach(x => a.push({ id: x.id, ...x.data() })); setSlips(a) }).finally(() => setLoading(false))
  }, [ym])

  const members = slips.filter(x => (x.pfEmployee || 0) > 0 || (x.esicEmployer || 0) > 0)
  const t = useMemo(() => payrollTotals(slips, s), [slips, s])
  const ecr = useMemo(() => buildEcr(slips, employees, s), [slips, employees, s])
  const downloadEcr = () => {
    const url = URL.createObjectURL(new Blob([ecr.text], { type: 'text/plain' }))
    const a = document.createElement('a'); a.href = url; a.download = `ECR_${ym}.txt`; a.click(); URL.revokeObjectURL(url)
  }
  const downloadEsic = () => downloadXlsx(`ESIC contribution ${ym}`, [{ name: 'ESIC', rows: [['IP Number', 'IP Name', 'No of days for which wages paid', 'Total monthly wages', 'Reason code (0 if working)', 'Last working day'], ...esicRows(slips, employees).map(r => [r.ipNumber, r.name, r.days, r.wages, r.reason || 0, r.lastWorkingDay])] }])
  const card = 'bg-white rounded-2xl shadow-card border border-slate-200/70 p-4'

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="text-2xl font-bold text-slate-900 tracking-tight">PF / ESIC</h2>
          <p className="text-slate-500 text-sm">Contributions worked out on the salary slips for {MONTHS[month]} {year}. Due on {contributionDue(ym)}.</p></div>
        <div className="flex gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">{MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}</select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">{[d.getFullYear(), d.getFullYear() - 1].map(y => <option key={y}>{y}</option>)}</select>
        </div>
      </div>
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-xs">
        Switch PF / ESIC on for each person in <b>Employees → edit</b>, then run <b>Salary → Generate Payroll</b>. Posting the month to the accounts and recording payments is done in <b>Finance → Payroll</b>. Rates are editable there (Finance → Payroll → Statutory rates).
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['PF payable (all)', t.pfPayable], ['  of which employees', t.pfEmployee], ['ESIC payable (all)', t.esicPayable], ['Employer cost (PF + ESIC)', t.employerPf + t.pfCharges + t.esicEmployer]].map(([l, v]) => <div key={l} className={card}><p className="text-xs text-slate-400 uppercase">{l.trim()}</p><p className="text-xl font-bold text-slate-800">{inr(v)}</p></div>)}
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <button onClick={downloadEcr} disabled={!ecr.count} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40">⬇ EPFO ECR file ({ecr.count})</button>
        <button onClick={downloadEsic} disabled={!esicRows(slips, employees).length} className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg disabled:opacity-40">⬇ ESIC contribution sheet</button>
        <span className="text-xs text-slate-400">Upload the ECR on the EPFO unified portal; paste / upload the ESIC sheet on the ESIC employer portal.</span>
      </div>
      {ecr.problems.length > 0 && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm space-y-1"><b>Fix before uploading the ECR</b>{ecr.problems.map(p => <p key={p}>• {p}</p>)}</div>}
      {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
              <th className="text-left px-4 py-3">Employee</th><th className="text-left px-4 py-3">UAN / IP no.</th><th className="text-right px-4 py-3">Gross</th><th className="text-right px-4 py-3">PF wage</th>
              <th className="text-right px-4 py-3">PF (emp)</th><th className="text-right px-4 py-3">EPS</th><th className="text-right px-4 py-3">EPF (er)</th><th className="text-right px-4 py-3">EDLI</th>
              <th className="text-right px-4 py-3">ESIC (emp)</th><th className="text-right px-4 py-3">ESIC (er)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {members.map(x => { const e = employees[x.employeeId] || {}; return (
                <tr key={x.id}><td className="px-4 py-2.5 font-medium text-slate-800">{x.employeeName}</td><td className="px-4 py-2.5 font-mono text-xs text-slate-500">{e.uan || '—'}{e.esicIpNumber ? ` · ${e.esicIpNumber}` : ''}</td>
                  <td className="px-4 py-2.5 text-right">{inr(x.baseSalary)}</td><td className="px-4 py-2.5 text-right">{x.pfWage ? inr(x.pfWage) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">{inr(x.pfEmployee)}</td><td className="px-4 py-2.5 text-right">{inr(x.pfEmployerEps)}</td><td className="px-4 py-2.5 text-right">{inr(x.pfEmployerEpf)}</td><td className="px-4 py-2.5 text-right">{inr(x.pfEdli)}</td>
                  <td className="px-4 py-2.5 text-right">{inr(x.esicEmployee)}</td><td className="px-4 py-2.5 text-right">{inr(x.esicEmployer)}</td></tr>) })}
              {members.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-slate-400">No PF / ESIC members on the {MONTHS[month]} {year} slips. Generate payroll after switching PF / ESIC on for employees.</td></tr>}
            </tbody>
            {members.length > 0 && <tfoot><tr className="bg-slate-50 font-bold"><td className="px-4 py-2" colSpan={4}>Total · PF admin charge {inr(t.pfAdmin)}</td><td className="px-4 py-2 text-right">{inr(t.pfEmployee)}</td><td className="px-4 py-2 text-right">{inr(t.pfEmployerEps)}</td><td className="px-4 py-2 text-right">{inr(t.pfEmployerEpf)}</td><td className="px-4 py-2 text-right">{inr(t.pfEdli)}</td><td className="px-4 py-2 text-right">{inr(t.esicEmployee)}</td><td className="px-4 py-2 text-right">{inr(t.esicEmployer)}</td></tr></tfoot>}
          </table>
        </div>
      )}
    </div>
  )
}
