import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, getDoc, updateDoc, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'
import { DEFAULT_SALARY_STRUCTURE, computePayrollBreakup } from '../utils/payrollCalc'
import { amountInWords } from '../../finance/utils/indiaConstants.js'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function countSundays(year, month) {
  let n = 0
  const days = daysInMonth(year, month)
  for (let d = 1; d <= days; d++) if (new Date(year, month, d).getDay() === 0) n++
  return n
}

function buildPayslipHtml({ slip, employee, seller }) {
  const period = `${MONTHS[Number(slip.month.split('-')[1]) - 1]} ${slip.month.split('-')[0]}`
  const e = slip.earnings || {}
  const d = slip.deductions || {}
  const earningRows = [
    ['Basic', e.basic], ['Dearness Allowance', e.dearnessAllowance], ['HRA', e.hra], ['Conveyance', e.conveyance],
    ['Medical', e.medical], ['Special Allowance', e.specialAllowance],
  ].filter(([, v]) => v).map(([label, v]) => `<tr><td style="padding:6px 8px">${label}</td><td style="padding:6px 8px;text-align:right">${Number(v).toLocaleString('en-IN')}</td></tr>`).join('')
  const deductionRows = [
    ['Provident Fund (PF)', d.pf], ['ESI', d.esi], ['Professional Tax', d.professionalTax],
    ['TDS (estimate)', d.tds], ['Advance Recovery', slip.advancesDeducted], ['Other', d.other],
  ].filter(([, v]) => v).map(([label, v]) => `<tr><td style="padding:6px 8px">${label}</td><td style="padding:6px 8px;text-align:right">${Number(v).toLocaleString('en-IN')}</td></tr>`).join('')
  const totalEarnings = slip.grossProrated ?? slip.baseSalary ?? 0
  const totalDeductions = (d.pf||0)+(d.esi||0)+(d.professionalTax||0)+(d.tds||0)+(slip.advancesDeducted||0)+(d.other||0)
  const att = slip.attendanceSummary || {}

  return `<!DOCTYPE html><html><head><title>Payslip - ${employee?.name || ''} - ${period}</title>
  <style>body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:0;padding:20px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a56db;padding-bottom:10px;margin-bottom:14px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:14px 0;font-size:12px}
  table{width:100%;border-collapse:collapse}
  th{background:#f0f4ff;padding:6px 8px;text-align:left;font-size:12px;border-bottom:2px solid #1a56db}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}
  .total-row{font-weight:bold;border-top:2px solid #1a56db}
  .net{margin-top:14px;padding:10px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;display:flex;justify-content:space-between;align-items:center}
  .net .amt{font-size:20px;font-weight:bold;color:#15803d}
  .words{margin-top:8px;font-size:12px;font-style:italic;color:#555}
  .att{margin-top:12px;font-size:11px;color:#666}
  @media print{body{padding:8px}}</style></head><body>
  <div class="hdr">
    <div>
      <div style="font-size:18px;font-weight:bold;color:#1a56db">${seller?.legalName || employee?.appointedCompany || ''}</div>
      <div style="font-size:12px;color:#555;margin-top:2px">${[seller?.address, seller?.city, seller?.state, seller?.pincode].filter(Boolean).join(', ')}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:20px;font-weight:bold;color:#1a56db;text-transform:uppercase">Payslip</div>
      <div style="margin-top:6px;font-size:12px"><b>Pay Period:</b> ${period}</div>
    </div>
  </div>
  <div class="info-grid">
    <div><b>Employee:</b> ${employee?.name || slip.employeeName || ''}<br/>
      <b>Designation:</b> ${employee?.designation || '—'}<br/>
      <b>Department:</b> ${employee?.department || '—'}</div>
    <div><b>Employee #:</b> ${employee?.employeeNumber || '—'}<br/>
      <b>Bank A/C:</b> ${employee?.bankAccountNo || '—'}<br/>
      <b>PAN:</b> ${employee?.panNumber || '—'}</div>
  </div>
  <div class="cols">
    <div><table><tr><th>Earnings</th><th style="text-align:right">Amount (₹)</th></tr>${earningRows}
      <tr class="total-row"><td style="padding:6px 8px">Gross</td><td style="padding:6px 8px;text-align:right">${totalEarnings.toLocaleString('en-IN')}</td></tr></table></div>
    <div><table><tr><th>Deductions</th><th style="text-align:right">Amount (₹)</th></tr>${deductionRows || '<tr><td style="padding:6px 8px" colspan="2">—</td></tr>'}
      <tr class="total-row"><td style="padding:6px 8px">Total Deductions</td><td style="padding:6px 8px;text-align:right">${totalDeductions.toLocaleString('en-IN')}</td></tr></table></div>
  </div>
  <div class="net"><span>Net Pay</span><span class="amt">₹${(slip.netSalary || 0).toLocaleString('en-IN')}</span></div>
  <div class="words">${amountInWords(slip.netSalary || 0)}</div>
  ${att.totalDaysInMonth ? `<div class="att">Payable days: ${att.payableDays ?? '—'} / ${att.totalDaysInMonth} (Present: ${att.presentDays ?? 0}, Half-day: ${att.halfDays ?? 0}, Paid leave: ${att.paidLeaveDays ?? 0}, Holidays: ${att.holidayDays ?? 0}, Sundays: ${att.sundays ?? 0})</div>` : ''}
  ${slip.employerContributions ? `<div class="att">Employer's PF contribution this month (not deducted from you): ₹${(slip.employerContributions.pf?.total || 0).toLocaleString('en-IN')} · Employer's ESI contribution: ₹${(slip.employerContributions.esi || 0).toLocaleString('en-IN')}</div>` : ''}
  <div class="att" style="margin-top:10px">This is a system-generated payslip. TDS shown is an estimate — refer to Form 16 for the final annual figure.</div>
  </body></html>`
}

export default function Salary() {
  const { user, userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const isAdmin = userProfile?.role === 'admin'
  // Matches firestore.rules' hasHRWriteAccess() — payroll generation/edits
  // are HR-generated records, not self-service.
  const hasHRAccess = isAdmin || canEdit('HR')

  const today = new Date()
  const [selYear, setSelYear] = useState(today.getFullYear())
  const [selMonth, setSelMonth] = useState(today.getMonth())
  const [employees, setEmployees] = useState([])
  const [slips, setSlips] = useState([])
  const [advances, setAdvances] = useState([])
  const [holidays, setHolidays] = useState([])
  const [salaryStructures, setSalaryStructures] = useState({}) // { employeeId: { salaryStructure, salary } }
  const [sellers, setSellers] = useState({})
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [expandedId, setExpandedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const monthKey = `${selYear}-${String(selMonth + 1).padStart(2, '0')}`

  useEffect(() => {
    if (!hasHRAccess) return
    getDocs(collection(db, 'hr_employees')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setEmployees(data.filter(e => e.active !== false))
    })
    getDocs(collection(db, 'hr_advances')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setAdvances(data)
    })
    getDocs(collection(db, 'hr_holidays')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setHolidays(data)
    })
    // Salary lives in its own HR/admin-only collection (see firestore.rules).
    getDocs(collection(db, 'hr_salary_structures')).then(snap => {
      const map = {}; snap.forEach(d => { map[d.id] = d.data() })
      setSalaryStructures(map)
    })
    Promise.all([getDoc(doc(db, 'company_settings', 'UIPL')), getDoc(doc(db, 'company_settings', 'Wayzim'))]).then(([u, w]) => {
      setSellers({ UIPL: u.exists() ? u.data() : {}, Wayzim: w.exists() ? w.data() : {} })
    })
  }, [hasHRAccess])

  useEffect(() => { if (hasHRAccess) loadSlips() }, [monthKey, hasHRAccess])

  const loadSlips = async () => {
    setLoading(true); setError('')
    try {
      const q = query(collection(db, 'hr_salary_slips'), where('month', '==', monthKey))
      const snap = await getDocs(q)
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setSlips(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const generatePayroll = async () => {
    if (!hasHRAccess) return
    const existing = new Set(slips.map(s => s.employeeId))
    const toCreate = employees.filter(e => !existing.has(e.id))
    if (toCreate.length === 0) { setSuccess('All employees already have slips for this month.'); return }
    setGenerating(true); setError(''); setSuccess('')
    try {
      // Pull this month's attendance for every employee in one query, grouped client-side.
      const attSnap = await getDocs(query(collection(db, 'hr_attendance'), where('month', '==', monthKey)))
      const attByEmp = {}
      attSnap.forEach(d => {
        const { employeeId, status } = d.data()
        const bucket = attByEmp[employeeId] || (attByEmp[employeeId] = { present: 0, half: 0, paidLeave: 0 })
        if (status === 'present') bucket.present++
        else if (status === 'half-day') bucket.half++
        else if (status === 'paid-leave') bucket.paidLeave++
      })
      const totalDaysInMonth = daysInMonth(selYear, selMonth)
      const sundays = countSundays(selYear, selMonth)
      const holidayDays = holidays.filter(h => h.date && h.date.startsWith(monthKey)).length

      const newSlips = []
      const noAttendanceNames = []
      for (const emp of toCreate) {
        const empAdvances = advances.filter(a => a.employeeId === emp.id && a.status === 'approved' && a.deductFromMonth === monthKey)
        const totalAdvanceDeduct = empAdvances.reduce((s, a) => s + (Number(a.amount) || 0), 0)
        // gender lives on hr_employees (KYC), not the salary-structure doc — merged in
        // here since Professional Tax (Maharashtra) needs it for the exemption slab.
        const structure = { ...(salaryStructures[emp.id]?.salaryStructure || DEFAULT_SALARY_STRUCTURE), gender: emp.gender }
        const att = attByEmp[emp.id] || { present: 0, half: 0, paidLeave: 0 }
        if (att.present === 0 && att.half === 0 && att.paidLeave === 0) noAttendanceNames.push(emp.name || 'Unnamed')
        const breakup = computePayrollBreakup({
          structure,
          attendance: { presentDays: att.present, halfDays: att.half, paidLeaveDays: att.paidLeave, holidayDays, sundays, totalDaysInMonth },
          monthIndex: selMonth,
          otherDeductions: 0,
        })
        const netSalary = Math.max(breakup.netSalary - totalAdvanceDeduct, 0)
        const payload = {
          employeeId: emp.id,
          employeeName: emp.name || '',
          month: monthKey,
          earnings: breakup.earnings,
          grossProrated: breakup.grossProrated,
          baseSalary: breakup.grossProrated, // kept for backward-compat with anything still reading the old field name
          deductions: breakup.deductions,
          employerContributions: breakup.employerContributions, // PF/ESI employer-side outflow — not deducted from the employee, kept for statutory-cost visibility and return prep
          advancesDeducted: totalAdvanceDeduct,
          netSalary,
          attendanceSummary: { ...att, payableDays: breakup.payableDays, holidayDays, sundays, totalDaysInMonth,
            presentDays: att.present, halfDays: att.half, paidLeaveDays: att.paidLeave },
          status: 'pending',
          createdAt: new Date().toISOString(),
          createdBy: user.uid,
        }
        const ref = await addDoc(collection(db, 'hr_salary_slips'), payload)
        newSlips.push({ id: ref.id, ...payload })
      }
      setSlips(prev => [...prev, ...newSlips])
      const warning = noAttendanceNames.length > 0
        ? ` ⚠️ No attendance was marked at all for ${noAttendanceNames.join(', ')} this month — their gross was prorated down to just Sundays/holidays (near-zero), not their real salary. Mark attendance on the Attendance page and regenerate (delete the slip first) once it's filled in.`
        : ''
      setSuccess(`Generated ${newSlips.length} salary slip(s) with full statutory breakup (PF/ESI/PT/TDS, attendance-prorated).${warning}`)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setGenerating(false) }
  }

  const openEdit = (slip) => {
    setEditingId(slip.id)
    setEditForm({ other: slip.deductions?.other ?? 0, advancesDeducted: slip.advancesDeducted ?? 0, notes: slip.notes || '' })
  }

  const saveEdit = async (slip) => {
    setSaving(true)
    try {
      const other = Number(editForm.other) || 0
      const advancesDeducted = Number(editForm.advancesDeducted) || 0
      const statutory = (slip.deductions?.pf || 0) + (slip.deductions?.esi || 0) + (slip.deductions?.professionalTax || 0) + (slip.deductions?.tds || 0)
      const gross = slip.grossProrated ?? slip.baseSalary ?? 0
      const netSalary = Math.max(gross - statutory - other - advancesDeducted, 0)
      const deductions = { ...(slip.deductions || {}), other }
      const update = { deductions, advancesDeducted, netSalary, notes: editForm.notes, updatedAt: new Date().toISOString() }
      await updateDoc(doc(db, 'hr_salary_slips', slip.id), update)
      setSlips(prev => prev.map(s => s.id === slip.id ? { ...s, ...update } : s))
      setEditingId(null)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const markPaid = async (slip) => {
    if (!window.confirm(`Mark ${slip.employeeName}'s salary as paid?`)) return
    try {
      await updateDoc(doc(db, 'hr_salary_slips', slip.id), { status: 'paid', paidOn: new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString() })
      setSlips(prev => prev.map(s => s.id === slip.id ? { ...s, status: 'paid', paidOn: new Date().toISOString().slice(0, 10) } : s))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handlePayslip = (slip) => {
    const employee = employees.find(e => e.id === slip.employeeId)
    const seller = sellers[employee?.appointedCompany] || {}
    const html = buildPayslipHtml({ slip, employee, seller })
    const w = window.open('', '_blank', 'width=800,height=960')
    if (!w) { setError('Payslip window was blocked by your browser — allow pop-ups for this site and try again.'); return }
    w.document.write(html); w.document.close()
    setTimeout(() => { w.print() }, 400)
  }

  const totalNet = slips.reduce((s, sl) => s + (Number(sl.netSalary) || 0), 0)
  const paidCount = slips.filter(s => s.status === 'paid').length

  const years = [today.getFullYear(), today.getFullYear() - 1]

  if (!hasHRAccess) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          🔒 Salary and payroll are visible to HR managers and admins only.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Salary / Payroll</h2>
          <p className="text-slate-500 text-sm">{paidCount} of {slips.length} paid for {MONTHS[selMonth]} {selYear}</p>
        </div>
        <div className="flex gap-2">
          <select value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={selYear} onChange={e => setSelYear(Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {hasHRAccess && (
            <button onClick={generatePayroll} disabled={generating}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
              {generating ? 'Generating...' : '⚡ Generate Payroll'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}
      <p className="text-xs text-slate-400">
        PF, ESI, professional tax, and TDS are computed automatically from each employee's Salary Structure (set on their Profile page)
        and this month's Attendance. TDS is an estimate — verify with your accountant before the first real payroll run.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 text-center">
          <p className="text-2xl font-bold text-slate-900 tracking-tight">₹{totalNet.toLocaleString('en-IN')}</p>
          <p className="text-xs text-slate-500 mt-1">Total Payroll ({MONTHS[selMonth]})</p>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{paidCount}</p>
          <p className="text-xs text-slate-500 mt-1">Salaries Paid</p>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{slips.length - paidCount}</p>
          <p className="text-xs text-slate-500 mt-1">Pending Payment</p>
        </div>
      </div>

      {loading ? <div className="text-slate-400 text-sm">Loading...</div> : (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Employee</th>
                <th className="text-right px-4 py-3">Gross</th>
                <th className="text-right px-4 py-3">Deductions</th>
                <th className="text-right px-4 py-3">Net Pay</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {slips.map(slip => {
                const gross = slip.grossProrated ?? slip.baseSalary ?? 0
                const d = slip.deductions || {}
                const totalDeductions = (d.pf||0)+(d.esi||0)+(d.professionalTax||0)+(d.tds||0)+(slip.advancesDeducted||0)+(d.other||0)
                const att = slip.attendanceSummary
                const noAttendanceMarked = att && (att.presentDays || 0) === 0 && (att.halfDays || 0) === 0 && (att.paidLeaveDays || 0) === 0
                return (
                <React.Fragment key={slip.id}>
                <tr>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {slip.employeeName}
                    <button onClick={() => setExpandedId(expandedId === slip.id ? null : slip.id)} className="ml-2 text-xs text-blue-500 hover:underline">
                      {expandedId === slip.id ? 'hide breakup' : 'view breakup'}
                    </button>
                    {noAttendanceMarked && (
                      <span title="No attendance marked this month — gross is prorated down to just Sundays/holidays, not the real salary."
                        className="ml-2 text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded-lg font-bold">⚠️ No attendance</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">₹{gross.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right text-red-600">₹{totalDeductions.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-800">₹{(slip.netSalary || 0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${slip.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {slip.status === 'paid' ? `✓ Paid ${slip.paidOn || ''}` : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    <button onClick={() => handlePayslip(slip)} className="text-purple-600 hover:text-purple-700 font-medium text-xs">🧾 Payslip</button>
                    {hasHRAccess && slip.status !== 'paid' && (
                      <button onClick={() => markPaid(slip)} className="text-green-600 hover:text-green-700 font-medium text-xs">✔ Mark Paid</button>
                    )}
                    {hasHRAccess && <button onClick={() => openEdit(slip)} className="text-blue-600 hover:text-blue-700 font-medium text-xs">✏️ Adjust</button>}
                  </td>
                </tr>
                {editingId === slip.id && (
                  <tr className="bg-blue-50/50">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Other Deduction (₹)</label>
                          <input type="number" value={editForm.other} onChange={e => setEditForm(p => ({ ...p, other: e.target.value }))}
                            className="w-28 px-2 py-1.5 border rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Advance Recovery (₹)</label>
                          <input type="number" value={editForm.advancesDeducted} onChange={e => setEditForm(p => ({ ...p, advancesDeducted: e.target.value }))}
                            className="w-28 px-2 py-1.5 border rounded-lg text-sm" />
                        </div>
                        <div className="flex-1 min-w-40">
                          <label className="block text-xs text-slate-500 mb-1">Notes</label>
                          <input type="text" value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
                            className="w-full px-2 py-1.5 border rounded-lg text-sm" />
                        </div>
                        <button onClick={() => saveEdit(slip)} disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg">Save</button>
                        <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-lg">Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
                {expandedId === slip.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="grid grid-cols-3 gap-6 text-xs">
                        <div>
                          <p className="font-bold text-slate-600 mb-1">Earnings</p>
                          {['basic','dearnessAllowance','hra','conveyance','medical','specialAllowance'].map(k => (
                            (slip.earnings?.[k] || 0) > 0 &&
                            <div key={k} className="flex justify-between py-0.5"><span className="text-slate-500 capitalize">{k.replace(/([A-Z])/g, ' $1')}</span><span>₹{(slip.earnings[k]||0).toLocaleString('en-IN')}</span></div>
                          ))}
                        </div>
                        <div>
                          <p className="font-bold text-slate-600 mb-1">Employee Deductions</p>
                          {[['pf','PF'],['esi','ESI'],['professionalTax','Professional Tax'],['tds','TDS (est.)'],['other','Other']].map(([k,label]) => (
                            (d[k] || 0) > 0 && <div key={k} className="flex justify-between py-0.5"><span className="text-slate-500">{label}</span><span>₹{(d[k]||0).toLocaleString('en-IN')}</span></div>
                          ))}
                          {(slip.advancesDeducted || 0) > 0 && <div className="flex justify-between py-0.5"><span className="text-slate-500">Advance Recovery</span><span>₹{slip.advancesDeducted.toLocaleString('en-IN')}</span></div>}
                        </div>
                        <div>
                          <p className="font-bold text-slate-600 mb-1">Employer Cost (not deducted)</p>
                          {slip.employerContributions ? (
                            <>
                              <div className="flex justify-between py-0.5"><span className="text-slate-500">PF — EPS</span><span>₹{(slip.employerContributions.pf?.eps||0).toLocaleString('en-IN')}</span></div>
                              <div className="flex justify-between py-0.5"><span className="text-slate-500">PF — EPF</span><span>₹{(slip.employerContributions.pf?.epf||0).toLocaleString('en-IN')}</span></div>
                              <div className="flex justify-between py-0.5"><span className="text-slate-500">PF — EDLI</span><span>₹{(slip.employerContributions.pf?.edli||0).toLocaleString('en-IN')}</span></div>
                              <div className="flex justify-between py-0.5"><span className="text-slate-500">PF — Admin Charges</span><span>₹{(slip.employerContributions.pf?.adminCharges||0).toLocaleString('en-IN')}</span></div>
                              <div className="flex justify-between py-0.5"><span className="text-slate-500">ESI (employer)</span><span>₹{(slip.employerContributions.esi||0).toLocaleString('en-IN')}</span></div>
                              <div className="flex justify-between py-0.5 font-semibold border-t border-slate-200 mt-1 pt-1"><span className="text-slate-600">Total CTC this month</span><span>₹{(slip.employerContributions.totalEmployerCost||0).toLocaleString('en-IN')}</span></div>
                            </>
                          ) : <p className="text-slate-400">Generated before employer-contribution tracking was added — regenerate to see this.</p>}
                        </div>
                      </div>
                      {slip.attendanceSummary?.totalDaysInMonth && (
                        <p className="text-xs text-slate-400 mt-2">
                          Payable days: {slip.attendanceSummary.payableDays} / {slip.attendanceSummary.totalDaysInMonth}
                          {' '}(Present {slip.attendanceSummary.presentDays}, Half-day {slip.attendanceSummary.halfDays}, Paid leave {slip.attendanceSummary.paidLeaveDays}, Holidays {slip.attendanceSummary.holidayDays}, Sundays {slip.attendanceSummary.sundays})
                        </p>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              )})}
              {slips.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">
                  No salary slips for {MONTHS[selMonth]} {selYear}.
                  {hasHRAccess && ' Click "Generate Payroll" to create them.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
