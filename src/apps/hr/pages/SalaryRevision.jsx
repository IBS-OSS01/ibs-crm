/**
 * SalaryRevision — track and record salary revision history for all employees.
 * Collection: hr_salary_revisions (HR/admin-only read+write, same as every
 * other salary-related collection — see firestore.rules).
 * Adding a revision also updates the employee's current salary in
 * hr_salary_structures (Basic only — HR can re-run the Auto-calculate
 * split on that employee's Profile afterward if the full breakup needs updating).
 */
import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, addDoc, doc, setDoc, query, orderBy } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'
import { DEFAULT_SALARY_STRUCTURE, computeGross } from '../utils/payrollCalc'

const REASONS = [
  'Annual Increment', 'Promotion', 'Performance Bonus', 'Market Correction',
  'Probation Completion', 'Role Change', 'Management Decision', 'Other',
]

const emptyForm = {
  employeeId:      '',
  effectiveDate:   '',
  newSalary:       '',
  reason:          '',
  remarks:         '',
}

export default function SalaryRevision() {
  const { userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const isAdmin = ['admin'].includes(userProfile?.role)
  const hasHRAccess = isAdmin || canEdit('HR')

  const [employees,  setEmployees]  = useState([])
  const [salaryStructures, setSalaryStructures] = useState({}) // { employeeId: { salaryStructure, salary } }
  const [revisions,  setRevisions]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showForm,   setShowForm]   = useState(false)
  const [form,       setForm]       = useState(emptyForm)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [success,    setSuccess]    = useState('')
  const [filterEmp,  setFilterEmp]  = useState('')  // filter by employee

  useEffect(() => { if (hasHRAccess) load() }, [hasHRAccess])

  const load = async () => {
    setLoading(true)
    try {
      const [empSnap, revSnap, salSnap] = await Promise.all([
        getDocs(collection(db, 'hr_employees')),
        getDocs(query(collection(db, 'hr_salary_revisions'), orderBy('effectiveDate', 'desc'))),
        getDocs(collection(db, 'hr_salary_structures')),
      ])
      const emps = []
      empSnap.forEach(d => emps.push({ id: d.id, ...d.data() }))
      emps.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setEmployees(emps)

      const salMap = {}
      salSnap.forEach(d => { salMap[d.id] = d.data() })
      setSalaryStructures(salMap)

      const revs = []
      revSnap.forEach(d => revs.push({ id: d.id, ...d.data() }))
      setRevisions(revs)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // When employee changes, auto-fill their current salary as "previous"
  const selectedEmp = employees.find(e => e.id === form.employeeId)
  const previousSalary = selectedEmp ? (Number(salaryStructures[selectedEmp.id]?.salary) || 0) : 0

  const handleSave = async (ev) => {
    ev.preventDefault()
    setError(''); setSuccess('')
    if (!form.employeeId)    { setError('Select an employee.'); return }
    if (!form.effectiveDate) { setError('Effective date is required.'); return }
    if (!form.newSalary || Number(form.newSalary) <= 0) { setError('Enter a valid new salary.'); return }
    setSaving(true)
    try {
      const emp = employees.find(e => e.id === form.employeeId)
      const payload = {
        employeeId:      form.employeeId,
        employeeName:    emp?.name || '',
        effectiveDate:   form.effectiveDate,
        previousSalary:  previousSalary,
        newSalary:       Number(form.newSalary),
        increment:       Number(form.newSalary) - previousSalary,
        reason:          form.reason || 'Other',
        remarks:         form.remarks.trim(),
        revisedBy:       userProfile?.name || '',
        createdAt:       new Date().toISOString(),
      }
      // 1. Save revision record
      const ref = await addDoc(collection(db, 'hr_salary_revisions'), payload)
      // 2. Update employee's current salary — bump Basic to match the new
      // total, keeping other heads as they were (HR can re-run "Apply
      // Standard Split" on the Profile's Salary Structure tab afterward if
      // the full breakup should change too, not just the bottom line).
      const existing = salaryStructures[form.employeeId]?.salaryStructure || { ...DEFAULT_SALARY_STRUCTURE }
      const delta = Number(form.newSalary) - previousSalary
      const newStructure = { ...existing, basic: Math.max((Number(existing.basic) || 0) + delta, 0) }
      await setDoc(doc(db, 'hr_salary_structures', form.employeeId), {
        employeeId: form.employeeId, salaryStructure: newStructure, salary: computeGross(newStructure),
        updatedAt: new Date().toISOString(),
      }, { merge: true })
      setRevisions(prev => [{ id: ref.id, ...payload }, ...prev])
      setSalaryStructures(prev => ({ ...prev, [form.employeeId]: { salaryStructure: newStructure, salary: computeGross(newStructure) } }))
      setSuccess(`Salary revised for ${emp?.name} — effective ${form.effectiveDate}`)
      setForm(emptyForm)
      setShowForm(false)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const visible = useMemo(() =>
    filterEmp ? revisions.filter(r => r.employeeId === filterEmp) : revisions
  , [revisions, filterEmp])

  const incrementColor = (inc) =>
    inc > 0 ? 'text-green-600' : inc < 0 ? 'text-red-600' : 'text-slate-500'

  if (!hasHRAccess) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-400">
          🔒 Salary revisions are visible to HR managers and admins only.
        </div>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading…</div>

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Salary Revisions</h2>
          <p className="text-slate-500 text-sm">{revisions.length} revision{revisions.length !== 1 ? 's' : ''} recorded</p>
        </div>
        {hasHRAccess && (
          <button onClick={() => { setShowForm(!showForm); setForm(emptyForm); setError('') }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition">
            {showForm ? '✕ Cancel' : '+ Add Revision'}
          </button>
        )}
      </div>

      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm font-medium">{success}</div>}
      {error   && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>}

      {/* Add Form */}
      {showForm && hasHRAccess && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-bold text-slate-800 mb-4">Record Salary Revision</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Employee *</label>
              <select value={form.employeeId} onChange={e => set('employeeId', e.target.value)} required
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">— Select Employee —</option>
                {employees.filter(e => e.active !== false).map(e => (
                  <option key={e.id} value={e.id}>{e.name} — {e.designation || e.department}</option>
                ))}
              </select>
            </div>

            {/* Current salary preview */}
            {form.employeeId && (
              <div className="col-span-2">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm">
                  <span className="text-slate-500">Current Salary:</span>
                  <span className="font-bold text-slate-800">₹{previousSalary.toLocaleString('en-IN')}</span>
                  {form.newSalary && Number(form.newSalary) !== previousSalary && (
                    <>
                      <span className="text-slate-400">→</span>
                      <span className={`font-bold ${Number(form.newSalary) > previousSalary ? 'text-green-700' : 'text-red-700'}`}>
                        ₹{Number(form.newSalary).toLocaleString('en-IN')}
                      </span>
                      <span className={`text-xs font-semibold ${Number(form.newSalary) > previousSalary ? 'text-green-600' : 'text-red-600'}`}>
                        ({Number(form.newSalary) > previousSalary ? '+' : ''}
                        ₹{Math.abs(Number(form.newSalary) - previousSalary).toLocaleString('en-IN')})
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Monthly Salary (₹) *</label>
              <input type="number" value={form.newSalary} onChange={e => set('newSalary', e.target.value)} min="1" required
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Effective Date *</label>
              <input type="date" value={form.effectiveDate} onChange={e => set('effectiveDate', e.target.value)} required
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
              <select value={form.reason} onChange={e => set('reason', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">— Select Reason —</option>
                {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Remarks</label>
              <input type="text" value={form.remarks} onChange={e => set('remarks', e.target.value)}
                placeholder="Optional note…"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50">
                {saving ? 'Saving…' : 'Record Revision'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setForm(emptyForm) }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-48">
          <option value="">All Employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {filterEmp && (
          <button onClick={() => setFilterEmp('')} className="text-xs text-slate-500 hover:text-slate-700">✕ Clear filter</button>
        )}
      </div>

      {/* Revision list */}
      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-2xl mb-2">💰</p>
          <p className="text-sm">No salary revisions recorded yet.</p>
          {hasHRAccess && <p className="text-xs mt-1">Click "+ Add Revision" to record the first one.</p>}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Employee</th>
                <th className="text-left px-4 py-3">Effective Date</th>
                <th className="text-right px-4 py-3">Previous</th>
                <th className="text-right px-4 py-3">New Salary</th>
                <th className="text-right px-4 py-3">Change</th>
                <th className="text-left px-4 py-3">Reason</th>
                <th className="text-left px-4 py-3">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map(r => {
                const inc = r.increment ?? (r.newSalary - r.previousSalary)
                const pct = r.previousSalary > 0 ? ((inc / r.previousSalary) * 100).toFixed(1) : null
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.employeeName}</td>
                    <td className="px-4 py-3 text-slate-600">{r.effectiveDate}</td>
                    <td className="px-4 py-3 text-right text-slate-500">₹{(r.previousSalary || 0).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">₹{(r.newSalary || 0).toLocaleString('en-IN')}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${incrementColor(inc)}`}>
                      {inc > 0 ? '+' : ''}{inc.toLocaleString('en-IN')}
                      {pct && <span className="text-xs font-normal ml-1">({pct}%)</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-lg">{r.reason || '—'}</span>
                      {r.remarks && <p className="text-xs text-slate-400 mt-0.5">{r.remarks}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{r.revisedBy || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
