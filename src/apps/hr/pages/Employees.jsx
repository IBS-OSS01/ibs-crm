import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { invalidatePeopleCache } from '../../../lib/usePeople'
import { useNavigate } from 'react-router-dom'

const DEPARTMENTS = ['Sales', 'Delivery', 'Warehouse', 'Admin', 'Accounts', 'Management', 'Other']
const emptyForm = {
  name: '', designation: '', department: 'Sales', phone: '', email: '',
  address: '', emergencyContact: '', joinDate: '', salary: '', active: true,
}

export default function Employees() {
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const [employees, setEmployees] = useState([])
  const [userEmailSet, setUserEmailSet] = useState(new Set())  // emails with app accounts
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [empSnap, userSnap] = await Promise.all([
        getDocs(collection(db, 'hr_employees')),
        getDocs(collection(db, 'users')),
      ])
      const data = []
      empSnap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setEmployees(data)
      const emails = new Set()
      userSnap.forEach(d => { const e = (d.data().email || '').toLowerCase(); if (e) emails.add(e) })
      setUserEmailSet(emails)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleEdit = (e) => {
    setEditing(e.id)
    setForm({
      name: e.name || '', designation: e.designation || '', department: e.department || 'Sales',
      phone: e.phone || '', email: e.email || '', address: e.address || '',
      emergencyContact: e.emergencyContact || '', joinDate: e.joinDate || '',
      salary: e.salary ?? '', active: e.active !== false,
    })
    setShowForm(true)
  }

  const handleSave = async (ev) => {
    ev.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Employee name is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, salary: Number(form.salary) || 0 }
      if (editing) {
        await updateDoc(doc(db, 'hr_employees', editing), { ...payload, updatedAt: new Date().toISOString() })
        setEmployees(prev => prev.map(e => e.id === editing ? { ...e, ...payload } : e))
      } else {
        const newEmp = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'hr_employees'), newEmp)
        setEmployees(prev => [...prev, { id: ref.id, ...newEmp }].sort((a, b) => a.name.localeCompare(b.name)))
      }
      setShowForm(false); resetForm()
      invalidatePeopleCache()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (e) => {
    if (!window.confirm(`Remove "${e.name}" permanently? This also removes their attendance and leave history.`)) return
    try {
      await deleteDoc(doc(db, 'hr_employees', e.id))
      setEmployees(prev => prev.filter(x => x.id !== e.id))
      invalidatePeopleCache()
    } catch (err) { setError('Error: ' + err.message) }
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const filtered = employees.filter(e => {
    const q = search.toLowerCase()
    const matchQ = !q || (e.name || '').toLowerCase().includes(q) || (e.designation || '').toLowerCase().includes(q) || (e.phone || '').includes(q)
    const matchDept = !deptFilter || e.department === deptFilter
    return matchQ && matchDept
  })

  const active = filtered.filter(e => e.active !== false)
  const inactive = filtered.filter(e => e.active === false)

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Employees</h2>
          <p className="text-slate-500 text-sm">{employees.filter(e => e.active !== false).length} active · {employees.length} total</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm() }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm && !editing ? '✕ Cancel' : '+ Add Employee'}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, designation, phone..."
          className="flex-1 min-w-48 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Departments</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Employee' : 'Add New Employee'}</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Designation</label>
              <input type="text" value={form.designation} onChange={e => set('designation', e.target.value)} autoComplete="off"
                placeholder="e.g. Sales Rep, Driver"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
              <select value={form.department} onChange={e => set('department', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Emergency Contact</label>
              <input type="text" value={form.emergencyContact} onChange={e => set('emergencyContact', e.target.value)} autoComplete="off"
                placeholder="Name & number"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
              <input type="text" value={form.address} onChange={e => set('address', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Joining Date</label>
              <input type="date" value={form.joinDate} onChange={e => set('joinDate', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Monthly Salary (₹)</label>
              <input type="number" value={form.salary} onChange={e => set('salary', e.target.value)} autoComplete="off" min="0"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} id="emp-active" />
              <label htmlFor="emp-active" className="text-sm text-slate-700">Active employee</label>
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Employee' : 'Add Employee'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {[{ label: 'Active', list: active }, { label: 'Inactive', list: inactive }].map(({ label, list }) =>
        list.length === 0 ? null : (
          <div key={label}>
            {inactive.length > 0 && <p className="text-xs font-bold text-slate-400 uppercase mb-2">{label}</p>}
            <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3">Dept / Designation</th>
                    <th className="text-left px-4 py-3">Phone</th>
                    <th className="text-left px-4 py-3">Joined</th>
                    <th className="text-right px-4 py-3">Salary</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map(e => {
                    const hasUserAccount = e.email && userEmailSet.has(e.email.toLowerCase())
                    return (
                    <tr key={e.id} className={e.active === false ? 'opacity-60' : ''}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{e.name}</span>
                          {hasUserAccount && (
                            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-lg font-medium" title="Has IBS app login">👤 App User</span>
                          )}
                        </div>
                        {e.email && <p className="text-xs text-slate-400 mt-0.5">{e.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg mr-2">{e.department || '—'}</span>
                        {e.designation || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{e.phone || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{e.joinDate || '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-700 font-medium">₹{(Number(e.salary) || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                        <button onClick={() => navigate(`/hr/employee/${e.id}`)} className="text-purple-600 hover:text-purple-700 font-medium">📋 Profile</button>
                        <button onClick={() => handleEdit(e)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                        {isAdmin && <button onClick={() => handleDelete(e)} className="text-red-600 hover:text-red-700 font-medium">🗑️</button>}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
      {filtered.length === 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">No employees found.</div>
      )}
    </div>
  )
}
