import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const CATEGORIES = ['Material', 'Labour', 'Subcontract', 'Logistics', 'Installation', 'Other']
const COST_STATUS = ['Budgeted', 'Committed', 'Actual']
const COST_STATUS_COLORS = {
  Budgeted: 'bg-slate-100 text-slate-600',
  Committed: 'bg-amber-100 text-amber-700',
  Actual: 'bg-green-100 text-green-700',
}

const emptyForm = { description: '', category: 'Material', amount: '', vendor: '', invoiceRef: '', status: 'Budgeted', notes: '' }

export default function ProjectCosts() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const userCompanies = userProfile?.companies || ['UIPL']

  const [projects, setProjects] = useState([])
  const [costs, setCosts] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingPo, setEditingPo] = useState(false)
  const [poDraft, setPoDraft] = useState('')
  const [savingPo, setSavingPo] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [projSnap, costSnap] = await Promise.all([
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'project_costs')),
      ])
      const projData = []
      projSnap.forEach(d => projData.push({ id: d.id, ...d.data() }))
      // Exclude the General Expense project from cost tracking; company isolation
      const visible = projData.filter(p =>
        !p.isGeneral &&
        (isAdmin || !p.company || p.company === 'BOTH' || userCompanies.includes(p.company))
      )
      visible.sort((a, b) => (b.projectNumber || '').localeCompare(a.projectNumber || ''))
      const costData = []
      costSnap.forEach(d => costData.push({ id: d.id, ...d.data() }))
      setProjects(visible)
      setCosts(costData)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const projectCosts = selectedProject ? costs.filter(c => c.projectId === selectedProject.id) : []
  const totalCost = projectCosts.reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const contractValue = Number(selectedProject?.contractValue) || 0
  const margin = contractValue - totalCost
  const marginPct = contractValue > 0 ? (margin / contractValue) * 100 : 0

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleSavePo = async () => {
    if (!selectedProject) return
    setSavingPo(true)
    try {
      await updateDoc(doc(db, 'projects', selectedProject.id), { poNumber: poDraft.trim(), updatedAt: new Date().toISOString() })
      setSelectedProject(p => ({ ...p, poNumber: poDraft.trim() }))
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? { ...p, poNumber: poDraft.trim() } : p))
      setEditingPo(false)
    } catch (err) { setError('Failed to save PO number: ' + err.message) }
    finally { setSavingPo(false) }
  }

  const handleEdit = (c) => {
    setEditing(c.id)
    setForm({
      description: c.description || '', category: c.category || 'Material',
      amount: c.amount ?? '', vendor: c.vendor || '', invoiceRef: c.invoiceRef || '',
      status: c.status || 'Budgeted', notes: c.notes || '',
    })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault(); setError('')
    if (!form.description.trim()) { setError('Description is required.'); return }
    if (!form.amount || Number(form.amount) <= 0) { setError('Enter a valid amount.'); return }
    if (!selectedProject) { setError('Select a project first.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form, amount: Number(form.amount),
        projectId: selectedProject.id,
        projectNumber: selectedProject.projectNumber,
        projectName: selectedProject.dealTitle,
      }
      if (editing) {
        await updateDoc(doc(db, 'project_costs', editing), { ...payload, updatedAt: new Date().toISOString() })
        setCosts(prev => prev.map(c => c.id === editing ? { ...c, ...payload } : c))
      } else {
        const nd = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'project_costs'), nd)
        setCosts(prev => [...prev, { id: ref.id, ...nd }])
      }
      setShowForm(false); resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (c) => {
    if (!window.confirm('Delete this cost line?')) return
    await deleteDoc(doc(db, 'project_costs', c.id))
    setCosts(prev => prev.filter(x => x.id !== c.id))
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Project Costs &amp; Margin</h2>
        <p className="text-slate-500 text-sm">Set up cost line items per project and calculate sales margin</p>
      </div>

      {/* Project selector */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">Select Project</label>
        <select
          value={selectedProject?.id || ''}
          onChange={e => {
            const p = projects.find(x => x.id === e.target.value)
            setSelectedProject(p || null)
            setShowForm(false); resetForm()
          }}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">-- Select a project --</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              [{p.projectNumber}] {p.dealTitle}{p.customerName ? ` · ${p.customerName}` : ''}
            </option>
          ))}
        </select>
        {projects.length === 0 && (
          <p className="text-xs text-slate-400 mt-2">Projects appear here when a CRM opportunity is marked Won.</p>
        )}
      </div>

      {selectedProject && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Project #</p>
              <p className="text-lg font-bold text-blue-700 mt-1 font-mono">{selectedProject.projectNumber}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{selectedProject.customerName || 'No customer'}</p>
              {selectedProject.siteName && <p className="text-xs text-slate-400 mt-0.5">📍 {selectedProject.siteName}</p>}
              {selectedProject.warehouseName && <p className="text-xs text-slate-400">🏭 {selectedProject.warehouseName}</p>}
              <div className="mt-2 border-t border-slate-100 pt-2">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">PO / Contract #</p>
                {editingPo ? (
                  <div className="flex gap-1">
                    <input type="text" value={poDraft} onChange={e => setPoDraft(e.target.value)} autoComplete="off"
                      placeholder="e.g. PO-2026-042"
                      className="flex-1 px-2 py-1 border border-blue-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <button onClick={handleSavePo} disabled={savingPo}
                      className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg disabled:opacity-50">✓</button>
                    <button onClick={() => setEditingPo(false)} className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-lg">✕</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-bold text-slate-700">{selectedProject.poNumber || '—'}</span>
                    <button onClick={() => { setPoDraft(selectedProject.poNumber || ''); setEditingPo(true) }}
                      className="text-xs text-blue-500 hover:text-blue-700">✏ Edit</button>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Contract Value</p>
              <p className="text-lg font-bold text-blue-700 mt-1">
                {contractValue > 0 ? `Rs.${contractValue.toLocaleString('en-IN')}` : 'Not set'}
              </p>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Total Cost</p>
              <p className="text-lg font-bold text-orange-700 mt-1">Rs.{totalCost.toLocaleString('en-IN')}</p>
            </div>
            <div className={`rounded-xl border p-4 ${margin >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Gross Margin</p>
              <p className={`text-lg font-bold mt-1 ${margin >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {contractValue > 0
                  ? `${marginPct.toFixed(1)}% (Rs.${Math.abs(margin).toLocaleString('en-IN')})`
                  : '—'}
              </p>
            </div>
          </div>

          {/* Category breakdown */}
          {projectCosts.length > 0 && (
            <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
              <p className="text-sm font-bold text-slate-700 mb-3">Cost by Category</p>
              <div className="flex flex-wrap gap-4">
                {CATEGORIES.map(cat => {
                  const catTotal = projectCosts
                    .filter(c => c.category === cat)
                    .reduce((s, c) => s + (Number(c.amount) || 0), 0)
                  if (!catTotal) return null
                  const pct = totalCost > 0 ? ((catTotal / totalCost) * 100).toFixed(0) : 0
                  return (
                    <div key={cat} className="text-center min-w-16">
                      <p className="text-xs text-slate-500">{cat}</p>
                      <p className="text-sm font-bold text-slate-700">Rs.{catTotal.toLocaleString('en-IN')}</p>
                      <p className="text-xs text-slate-400">{pct}%</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

          <div className="flex justify-end">
            <button onClick={() => { setShowForm(p => !p); resetForm() }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
              {showForm && !editing ? 'x Cancel' : '+ Add Cost Line'}
            </button>
          </div>

          {showForm && (
            <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
              <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Cost Line' : 'Add Cost Line'}</h3>
              <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                  <input type="text" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} autoComplete="off"
                    placeholder="e.g. Server hardware supply, Site installation labour"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Amount (Rs.) *</label>
                  <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} min="0" autoComplete="off"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Vendor / Supplier</label>
                  <input type="text" value={form.vendor} onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))} autoComplete="off"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Invoice / PO Ref</label>
                  <input type="text" value={form.invoiceRef} onChange={e => setForm(p => ({ ...p, invoiceRef: e.target.value }))} autoComplete="off"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {COST_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">Budgeted = planned, Committed = PO raised, Actual = invoice received</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <input type="text" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} autoComplete="off"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2 flex gap-3">
                  <button type="submit" disabled={saving}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                    {saving ? 'Saving...' : editing ? 'Update' : 'Add Cost Line'}
                  </button>
                  <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                    className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Cost lines table */}
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Description</th>
                  <th className="text-left px-4 py-3">Category</th>
                  <th className="text-left px-4 py-3">Vendor</th>
                  <th className="text-left px-4 py-3">PO / Invoice Ref</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projectCosts.map(c => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-medium text-slate-800">{c.description}</td>
                    <td className="px-4 py-3 text-slate-600">{c.category}</td>
                    <td className="px-4 py-3 text-slate-500">{c.vendor || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{c.invoiceRef || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${COST_STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">
                      Rs.{(Number(c.amount) || 0).toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button onClick={() => handleEdit(c)} className="text-blue-600 hover:text-blue-700 text-xs">Edit</button>
                      {isAdmin && <button onClick={() => handleDelete(c)} className="text-red-500 hover:text-red-700 text-xs">Del</button>}
                    </td>
                  </tr>
                ))}
                {projectCosts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400">
                      No cost lines yet. Add items to track project margin.
                    </td>
                  </tr>
                )}
                {projectCosts.length > 0 && (
                  <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
                    <td colSpan={5} className="px-4 py-3 text-slate-700">Total Cost</td>
                    <td className="px-4 py-3 text-right text-orange-700">Rs.{totalCost.toLocaleString('en-IN')}</td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
