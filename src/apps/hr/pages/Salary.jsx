import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function Salary() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const today = new Date()
  const [selYear, setSelYear] = useState(today.getFullYear())
  const [selMonth, setSelMonth] = useState(today.getMonth())
  const [employees, setEmployees] = useState([])
  const [slips, setSlips] = useState([])
  const [advances, setAdvances] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const monthKey = `${selYear}-${String(selMonth + 1).padStart(2, '0')}`

  useEffect(() => {
    getDocs(collection(db, 'hr_employees')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setEmployees(data.filter(e => e.active !== false))
    })
    getDocs(collection(db, 'hr_advances')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setAdvances(data)
    })
  }, [])

  useEffect(() => { loadSlips() }, [monthKey])

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
    if (!isAdmin) return
    const existing = new Set(slips.map(s => s.employeeId))
    const toCreate = employees.filter(e => !existing.has(e.id))
    if (toCreate.length === 0) { setSuccess('All employees already have slips for this month.'); return }
    setGenerating(true); setError(''); setSuccess('')
    try {
      const newSlips = []
      for (const emp of toCreate) {
        // Approved advances scheduled for this month
        const empAdvances = advances.filter(a => a.employeeId === emp.id && a.status === 'approved' && a.deductFromMonth === monthKey)
        const totalAdvanceDeduct = empAdvances.reduce((s, a) => s + (Number(a.amount) || 0), 0)
        const payload = {
          employeeId: emp.id,
          employeeName: emp.name || '',
          month: monthKey,
          baseSalary: Number(emp.salary) || 0,
          deductions: 0,
          advancesDeducted: totalAdvanceDeduct,
          netSalary: Math.max((Number(emp.salary) || 0) - totalAdvanceDeduct, 0),
          status: 'pending',
          createdAt: new Date().toISOString(),
          createdBy: user.uid,
        }
        const ref = await addDoc(collection(db, 'hr_salary_slips'), payload)
        newSlips.push({ id: ref.id, ...payload })
      }
      setSlips(prev => [...prev, ...newSlips])
      setSuccess(`Generated ${newSlips.length} salary slip(s).`)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setGenerating(false) }
  }

  const openEdit = (slip) => {
    setEditingId(slip.id)
    setEditForm({ deductions: slip.deductions ?? 0, advancesDeducted: slip.advancesDeducted ?? 0, notes: slip.notes || '' })
  }

  const saveEdit = async (slip) => {
    setSaving(true)
    try {
      const deductions = Number(editForm.deductions) || 0
      const advancesDeducted = Number(editForm.advancesDeducted) || 0
      const netSalary = Math.max((slip.baseSalary || 0) - deductions - advancesDeducted, 0)
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

  const totalNet = slips.reduce((s, sl) => s + (Number(sl.netSalary) || 0), 0)
  const paidCount = slips.filter(s => s.status === 'paid').length

  const years = [today.getFullYear(), today.getFullYear() - 1]

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
          {isAdmin && (
            <button onClick={generatePayroll} disabled={generating}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
              {generating ? 'Generating...' : '⚡ Generate Payroll'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

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
                <th className="text-right px-4 py-3">Base</th>
                <th className="text-right px-4 py-3">Deductions</th>
                <th className="text-right px-4 py-3">Advance</th>
                <th className="text-right px-4 py-3">Net Pay</th>
                <th className="text-center px-4 py-3">Status</th>
                {isAdmin && <th className="text-right px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {slips.map(slip => (
                <tr key={slip.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{slip.employeeName}</td>
                  <td className="px-4 py-3 text-right text-slate-600">₹{(slip.baseSalary || 0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right text-red-600">
                    {editingId === slip.id ? (
                      <input type="number" value={editForm.deductions} onChange={e => setEditForm(p => ({ ...p, deductions: e.target.value }))}
                        className="w-24 px-2 py-1 border rounded-lg text-xs text-right" />
                    ) : `₹${(slip.deductions || 0).toLocaleString('en-IN')}`}
                  </td>
                  <td className="px-4 py-3 text-right text-orange-600">
                    {editingId === slip.id ? (
                      <input type="number" value={editForm.advancesDeducted} onChange={e => setEditForm(p => ({ ...p, advancesDeducted: e.target.value }))}
                        className="w-24 px-2 py-1 border rounded-lg text-xs text-right" />
                    ) : `₹${(slip.advancesDeducted || 0).toLocaleString('en-IN')}`}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-800">₹{(slip.netSalary || 0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${slip.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {slip.status === 'paid' ? `✓ Paid ${slip.paidOn || ''}` : 'Pending'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      {editingId === slip.id ? (
                        <>
                          <button onClick={() => saveEdit(slip)} disabled={saving} className="text-green-600 hover:text-green-700 font-medium text-xs">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600 text-xs">Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => openEdit(slip)} className="text-blue-600 hover:text-blue-700 font-medium text-xs">✏️ Edit</button>
                          {slip.status !== 'paid' && (
                            <button onClick={() => markPaid(slip)} className="text-green-600 hover:text-green-700 font-medium text-xs">✔ Mark Paid</button>
                          )}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {slips.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">
                  No salary slips for {MONTHS[selMonth]} {selYear}.
                  {isAdmin && ' Click "Generate Payroll" to create them.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
