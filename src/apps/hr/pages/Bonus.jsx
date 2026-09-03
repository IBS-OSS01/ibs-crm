/**
 * Statutory Bonus — annual computation under the Code on Wages (which
 * replaced the Payment of Bonus Act, 1965, effective 21 Nov 2025).
 * Eligibility: Basic+DA ≤ ₹21,000/month and ≥30 days worked in the
 * financial year. Amount: 8.33% (the guaranteed statutory minimum — the
 * maximum is 20% but depends on the employer's allocable surplus for the
 * year, which this app has no visibility into) of bonus wages, itself
 * capped at ₹7,000/month regardless of actual pay.
 * The Act's coverage threshold (factories: 10+ employees, other
 * establishments: 20+) isn't checked here — confirm this company is
 * actually covered before relying on any "eligible" flag below.
 */
import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'
import { DEFAULT_SALARY_STRUCTURE, computeAnnualBonus } from '../utils/payrollCalc'

// Indian financial year: April (index 3) of `startYear` through March (index 2) of `startYear+1`.
function fyMonthKeys(startYear) {
  const keys = []
  for (let i = 0; i < 12; i++) {
    const y = i < 9 ? startYear : startYear + 1 // Apr(3)..Dec(11) -> startYear; Jan(0)..Mar(2) -> startYear+1
    const m = (3 + i) % 12
    keys.push(`${y}-${String(m + 1).padStart(2, '0')}`)
  }
  return keys
}

export default function Bonus() {
  const { user, userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const hasHRAccess = userProfile?.role === 'admin' || canEdit('HR')

  const today = new Date()
  // FY start year: if we're in Jan-Mar, the current FY started last calendar year.
  const currentFYStart = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear()
  const [fyStart, setFyStart] = useState(currentFYStart)
  const [employees, setEmployees] = useState([])
  const [salaryStructures, setSalaryStructures] = useState({})
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const fyLabel = `${fyStart}-${String(fyStart + 1).slice(-2)}`

  useEffect(() => {
    if (!hasHRAccess) return
    getDocs(collection(db, 'hr_employees')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setEmployees(data)
    })
    getDocs(collection(db, 'hr_salary_structures')).then(snap => {
      const map = {}; snap.forEach(d => { map[d.id] = d.data() })
      setSalaryStructures(map)
    })
  }, [hasHRAccess])

  useEffect(() => { if (hasHRAccess) loadRecords() }, [fyStart, hasHRAccess])

  const loadRecords = async () => {
    setLoading(true); setError('')
    try {
      const q = query(collection(db, 'hr_bonus_records'), where('financialYear', '==', fyLabel))
      const snap = await getDocs(q)
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setRecords(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const generateBonus = async () => {
    if (!hasHRAccess) return
    const existing = new Set(records.map(r => r.employeeId))
    const toCreate = employees.filter(e => !existing.has(e.id))
    if (toCreate.length === 0) { setSuccess('All employees already have a bonus record for this year.'); return }
    setGenerating(true); setError(''); setSuccess('')
    try {
      const months = fyMonthKeys(fyStart)
      // Count attendance entries across the whole FY, per employee — a
      // reasonable proxy for "days worked" (each present/half-day/paid-leave
      // entry counts as one day worked toward the 30-day eligibility test).
      const attByEmp = {}
      for (const m of months) {
        const snap = await getDocs(query(collection(db, 'hr_attendance'), where('month', '==', m)))
        snap.forEach(d => {
          const { employeeId, status } = d.data()
          if (['present', 'half-day', 'paid-leave'].includes(status)) {
            attByEmp[employeeId] = (attByEmp[employeeId] || 0) + 1
          }
        })
      }

      const newRecords = []
      for (const emp of toCreate) {
        const structure = salaryStructures[emp.id]?.salaryStructure || { ...DEFAULT_SALARY_STRUCTURE }
        const basicPlusDA = (Number(structure.basic) || 0) + (Number(structure.dearnessAllowance) || 0)
        const daysWorkedInYear = attByEmp[emp.id] || 0
        const result = computeAnnualBonus({ basicPlusDA, daysWorkedInYear })
        const payload = {
          employeeId: emp.id,
          employeeName: emp.name || '',
          financialYear: fyLabel,
          basicPlusDAUsed: basicPlusDA,
          daysWorkedInYear,
          eligible: result.eligible,
          bonusWageMonthly: result.bonusWageMonthly,
          amount: result.amount,
          status: 'pending',
          createdAt: new Date().toISOString(),
          createdBy: user.uid,
        }
        const ref = await addDoc(collection(db, 'hr_bonus_records'), payload)
        newRecords.push({ id: ref.id, ...payload })
      }
      setRecords(prev => [...prev, ...newRecords])
      setSuccess(`Computed bonus for ${newRecords.length} employee(s) — using their CURRENT salary structure as a stand-in for FY ${fyLabel}'s actual monthly Basic+DA (adjust manually below if pay changed mid-year).`)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setGenerating(false) }
  }

  const markPaid = async (r) => {
    if (!window.confirm(`Mark ${r.employeeName}'s bonus (₹${r.amount.toLocaleString('en-IN')}) as paid?`)) return
    try {
      await updateDoc(doc(db, 'hr_bonus_records', r.id), { status: 'paid', paidOn: new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString() })
      setRecords(prev => prev.map(x => x.id === r.id ? { ...x, status: 'paid', paidOn: new Date().toISOString().slice(0, 10) } : x))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const eligibleRecords = records.filter(r => r.eligible)
  const totalBonus = eligibleRecords.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const paidCount = eligibleRecords.filter(r => r.status === 'paid').length

  if (!hasHRAccess) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          🔒 Statutory bonus is visible to HR managers and admins only.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">🎁 Statutory Bonus</h2>
          <p className="text-slate-500 text-sm">FY {fyLabel} · {paidCount} of {eligibleRecords.length} eligible employees paid</p>
        </div>
        <div className="flex gap-2">
          <select value={fyStart} onChange={e => setFyStart(Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {[currentFYStart, currentFYStart - 1].map(y => <option key={y} value={y}>FY {y}-{String(y + 1).slice(-2)}</option>)}
          </select>
          <button onClick={generateBonus} disabled={generating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
            {generating ? 'Computing...' : '⚡ Compute Bonus'}
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}
      <p className="text-xs text-slate-400">
        Eligibility: Basic+DA ≤ ₹21,000/month and ≥30 days worked in the year. Amount: 8.33% of bonus wages (capped ₹7,000/month) —
        the guaranteed statutory minimum. Verify this company meets the Act's coverage threshold (10+ employees for a factory,
        20+ for other establishments) and get your accountant's sign-off before disbursing.
      </p>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 text-center">
          <p className="text-2xl font-bold text-slate-900 tracking-tight">₹{totalBonus.toLocaleString('en-IN')}</p>
          <p className="text-xs text-slate-500 mt-1">Total Bonus Payable</p>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{paidCount}</p>
          <p className="text-xs text-slate-500 mt-1">Paid</p>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{eligibleRecords.length - paidCount}</p>
          <p className="text-xs text-slate-500 mt-1">Pending</p>
        </div>
      </div>

      {loading ? <div className="text-slate-400 text-sm">Loading...</div> : (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Employee</th>
                <th className="text-right px-4 py-3">Basic+DA/mo</th>
                <th className="text-right px-4 py-3">Days Worked</th>
                <th className="text-center px-4 py-3">Eligible</th>
                <th className="text-right px-4 py-3">Bonus Amount</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{r.employeeName}</td>
                  <td className="px-4 py-3 text-right text-slate-600">₹{(r.basicPlusDAUsed || 0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.daysWorkedInYear || 0}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${r.eligible ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {r.eligible ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-800">₹{(r.amount || 0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-center">
                    {r.eligible ? (
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${r.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.status === 'paid' ? `✓ Paid ${r.paidOn || ''}` : 'Pending'}
                      </span>
                    ) : <span className="text-slate-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.eligible && r.status !== 'paid' && (
                      <button onClick={() => markPaid(r)} className="text-green-600 hover:text-green-700 font-medium text-xs">✔ Mark Paid</button>
                    )}
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">
                  No bonus records for FY {fyLabel} yet. Click "Compute Bonus" to generate them (best run near financial year-end,
                  once the year's attendance is complete).
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
