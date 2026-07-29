import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { SE_TO_CRM } from '../../../lib/stageMapping'

// ── DAP Workflow ──────────────────────────────────────────────────────────────
const DAP_STEPS = [
  { id: 'concept',    label: 'Concept Review',      desc: 'Internal review of project requirements & scope' },
  { id: 'design',     label: 'Design Preparation',  desc: 'Engineering team prepares drawings & BOQ' },
  { id: 'internal',   label: 'Internal Approval',   desc: 'Manager/Director sign-off on design package' },
  { id: 'submission', label: 'Customer Submission',  desc: 'Design documents sent to client' },
  { id: 'customer',   label: 'Customer Approval',    desc: 'Client reviews and approves the design' },
  { id: 'final',      label: 'Final Sign-off',       desc: 'All parties confirm — design locked' },
]
const DAP_STATUS = [
  { id: 'pending',    label: 'Pending',     color: 'bg-slate-100 text-slate-500',  dot: 'bg-slate-400' },
  { id: 'in_progress',label: 'In Progress', color: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500' },
  { id: 'approved',   label: 'Approved',    color: 'bg-green-100 text-green-700',  dot: 'bg-green-500' },
  { id: 'rejected',   label: 'Rejected',    color: 'bg-red-100 text-red-600',      dot: 'bg-red-500' },
  { id: 'na',         label: 'N/A',         color: 'bg-slate-100 text-slate-400',  dot: 'bg-slate-300' },
]

// ── SE Kanban stages ──────────────────────────────────────────────────────────
// SE covers New Business and Upgradation of existing systems.
// Spares Supply and Service/AMC are out of SE scope.
const SE_DEAL_TYPES = ['new_business', 'upgradation']

const SE_STAGES = [
  { id: 'concept_scoping',    label: 'Concept & Scoping',   icon: '💡', color: 'border-t-slate-500',  header: 'bg-slate-800',   tag: 'bg-slate-100 text-slate-700',   accent: '#64748B' },
  { id: 'layout_estimation',  label: 'Layout & Estimation', icon: '📐', color: 'border-t-blue-500',   header: 'bg-blue-800',    tag: 'bg-blue-100 text-blue-700',     accent: '#1D4ED8' },
  { id: 'technical_proposal', label: 'Technical Proposal',  icon: '📝', color: 'border-t-amber-500',  header: 'bg-amber-700',   tag: 'bg-amber-100 text-amber-700',   accent: '#B45309' },
  { id: 'solution_signoff',   label: 'Solution Sign-off',   icon: '✅', color: 'border-t-purple-500', header: 'bg-purple-800',  tag: 'bg-purple-100 text-purple-700', accent: '#7C3AED' },
  { id: 'commercial_handoff', label: 'Commercial Handoff',  icon: '🤝', color: 'border-t-emerald-500',header: 'bg-emerald-800', tag: 'bg-emerald-100 text-emerald-700',accent: '#065F46' },
]
const SE_STAGE_DEFAULT = 'concept_scoping'

const OPEN_STAGES   = ['lead', 'prebid', 'bid', 'closing']
const STAGE_LABELS  = { lead: 'Lead', prebid: 'Pre-bid', bid: 'Bid', closing: 'Closing', won: 'Won', lost: 'Lost', rejected: 'Rejected', nobid: 'No Bid' }
const STAGE_COLORS  = { lead: 'bg-slate-100 text-slate-600', prebid: 'bg-blue-100 text-blue-700', bid: 'bg-amber-100 text-amber-700', closing: 'bg-purple-100 text-purple-700', won: 'bg-green-100 text-green-700', lost: 'bg-red-100 text-red-600', rejected: 'bg-orange-100 text-orange-700', nobid: 'bg-slate-200 text-slate-500' }

const valINR  = (d) => d.valueINR ?? Number(d.value) ?? 0
const fmtINR  = (n) => n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`
const statusObj = (id) => DAP_STATUS.find(s => s.id === id) || DAP_STATUS[0]
const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

// ── Engineering Scope constants ───────────────────────────────────────────────
const SCOPE_CATEGORIES = [
  'Conveyor System', 'Cross Belt Sorter', 'Pivot Wheel Sorter',
  'Barcode Scanner', 'Weigh Scale / DWS', 'PLC / Controls',
  'Software Integration', 'Racking / Storage', 'Installation Services',
  'Civil Works', 'Other',
]
const SCOPE_UNITS = ['Nos', 'Sets', 'Mtrs', 'Kgs', 'Lots', 'Lump Sum']
const ENG_STATUSES = [
  { id: 'pending',   label: 'Pending',   color: 'bg-slate-100 text-slate-500' },
  { id: 'in_design', label: 'In Design', color: 'bg-blue-100 text-blue-700' },
  { id: 'approved',  label: 'Approved',  color: 'bg-green-100 text-green-700' },
  { id: 'on_hold',   label: 'On Hold',   color: 'bg-amber-100 text-amber-700' },
]
const DAP_OVERALL_STATUSES = [
  { id: 'draft',        label: 'Draft',        color: 'bg-slate-100 text-slate-600'   },
  { id: 'under_review', label: 'Under Review', color: 'bg-amber-100 text-amber-700'  },
  { id: 'approved',     label: 'Approved',     color: 'bg-green-100 text-green-700'  },
]
const engStatusObj  = (id) => ENG_STATUSES.find(s => s.id === id) || ENG_STATUSES[0]
const dapStatusObj  = (id) => DAP_OVERALL_STATUSES.find(s => s.id === id) || DAP_OVERALL_STATUSES[0]
const emptyItem = () => ({
  id: genId(), category: '', description: '', specification: '', quantity: 1, unit: 'Nos', engStatus: 'pending',
})
const defaultDAPDoc = (deal, uid) => ({
  dealId:     deal.id,
  customerId: deal.customerId || '',
  companyId:  deal.company    || 'UIPL',
  version:    1,
  status:     'draft',
  steps:      DAP_STEPS.map(s => ({ id: s.id, status: 'pending', assignee: '', date: '', notes: '' })),
  scopeItems: [],
  createdBy:  uid || '',
  createdAt:  new Date().toISOString(),
})

// Legacy compat: defaultDAP kept so old embedded deal.dap refs still work during read
const defaultDAP = () => ({
  steps: DAP_STEPS.map(s => ({ id: s.id, status: 'pending', assignee: '', date: '', notes: '' })),
  status: 'in_progress',
  startedAt: new Date().toISOString(),
})

// ── DAP Step Card ─────────────────────────────────────────────────────────────
const DAP_STEP_ICONS = ['🔍','✏️','✅','📤','🤝','🔒']
function DAPStepCard({ step, stepIdx, data, onChange, canEdit }) {
  const [expanded, setExpanded] = useState(false)
  const st = statusObj(data.status)
  const borderCls = data.status === 'approved' ? 'border-green-300 bg-green-50'
    : data.status === 'rejected' ? 'border-red-300 bg-red-50'
    : data.status === 'in_progress' ? 'border-blue-300 bg-blue-50/40'
    : 'border-slate-200 bg-white'
  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${borderCls}`}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none" onClick={() => setExpanded(p => !p)}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 font-bold
          ${data.status === 'approved' ? 'bg-green-500 text-white' : data.status === 'rejected' ? 'bg-red-500 text-white' : data.status === 'in_progress' ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
          {data.status === 'approved' ? '✓' : data.status === 'rejected' ? '✕' : stepIdx + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">{step.label}</p>
          <p className="text-xs text-slate-500 truncate">{step.desc}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {data.assignee && <span className="text-xs text-slate-500 hidden sm:block">{data.assignee}</span>}
          {data.date && <span className="text-xs text-slate-400 hidden sm:block">{data.date}</span>}
          {canEdit ? (
            <select value={data.status} onClick={e => e.stopPropagation()}
              onChange={e => onChange({ ...data, status: e.target.value })}
              className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer outline-none ${st.color}`}>
              {DAP_STATUS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          ) : (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${st.color}`}>{st.label}</span>
          )}
          <span className="text-slate-400 text-xs ml-1">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className={`px-4 pb-4 pt-2 border-t ${data.status === 'approved' ? 'border-green-200' : data.status === 'rejected' ? 'border-red-200' : 'border-slate-200'}`}>
          {canEdit ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Assignee</label>
                <input type="text" value={data.assignee} placeholder="Name"
                  onChange={e => onChange({ ...data, assignee: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Target Date</label>
                <input type="date" value={data.date}
                  onChange={e => onChange({ ...data, date: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-500 mb-1 block">Notes / Comments</label>
                <textarea value={data.notes} rows={2} placeholder="Comments, blockers, decisions…"
                  onChange={e => onChange({ ...data, notes: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white" />
              </div>
            </div>
          ) : data.notes ? (
            <p className="text-xs text-slate-600 leading-relaxed">{data.notes}</p>
          ) : (
            <p className="text-xs text-slate-400 italic">No notes added.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── DAP Panel v2 — reads/writes sales_engineering_dap/{deal.id} ───────────────
function DAPPanel({ deal, user, onUpdate, canEdit }) {
  const [dap, setDap]           = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)
  const [error, setError]       = useState('')
  const [dapTab, setDapTab]     = useState('scope')   // 'scope' | 'workflow'

  // Scope item inline edit/add state
  const [editingId, setEditingId]     = useState(null)
  const [editForm, setEditForm]       = useState(null)
  const [showAdd, setShowAdd]         = useState(false)
  const [addForm, setAddForm]         = useState(emptyItem())

  // ── Load DAP lazily (called once when panel mounts) ────────────────────────
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'sales_engineering_dap', deal.id))
        if (cancelled) return
        if (snap.exists()) {
          setDap(snap.data())
        } else if (deal.dap) {
          // Migrate old embedded crm_deals.dap → new structure (save on next edit)
          setDap({
            ...defaultDAPDoc(deal, user?.uid),
            steps:  deal.dap.steps || [],
            status: deal.dap.status === 'approved' ? 'approved' : 'draft',
          })
          setDirty(true)
        } else {
          setDap(defaultDAPDoc(deal, user?.uid))
        }
      } catch (e) { if (!cancelled) setError('Load failed: ' + e.message) }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [deal.id])

  // ── Persist to sales_engineering_dap + patch crm_deals refs ───────────────
  const save = async (overrideDoc) => {
    setSaving(true); setError('')
    const payload = overrideDoc || dap
    try {
      const now = new Date().toISOString()
      const toWrite = {
        ...payload,
        dealId:     deal.id,
        customerId: deal.customerId || '',
        companyId:  deal.company    || 'UIPL',
        updatedBy:  user?.uid || '',
        updatedAt:  now,
        createdBy:  payload.createdBy || user?.uid || '',
        createdAt:  payload.createdAt || now,
      }
      // One write to the DAP collection (doc ID = dealId — zero scan needed)
      await setDoc(doc(db, 'sales_engineering_dap', deal.id), toWrite)
      // Patch quick-reference fields on the deal — no data duplicated, just IDs + status
      await updateDoc(doc(db, 'crm_deals', deal.id), {
        dapId:     deal.id,
        dapStatus: toWrite.status,
        updatedAt: now,
      })
      setDap(toWrite)
      setDirty(false)
      onUpdate({ ...deal, dapId: deal.id, dapStatus: toWrite.status })
    } catch (e) {
      setError(e.message?.includes('permission') ? 'Permission denied.' : 'Save failed: ' + e.message)
    } finally { setSaving(false) }
  }

  // ── Workflow steps helpers ─────────────────────────────────────────────────
  const updateStep = (idx, newData) => {
    const steps = dap.steps.map((s, i) => i === idx ? newData : s)
    setDap(prev => ({ ...prev, steps }))
    setDirty(true)
  }
  const stepApprovedCount = dap ? dap.steps.filter(s => s.status === 'approved' || s.status === 'na').length : 0
  const stepPct = dap ? Math.round((stepApprovedCount / dap.steps.length) * 100) : 0

  // ── Scope item helpers ─────────────────────────────────────────────────────
  const addItem = () => {
    if (!addForm.category.trim() && !addForm.description.trim()) return
    const updated = { ...dap, scopeItems: [...(dap.scopeItems || []), { ...addForm, id: genId() }] }
    setDap(updated); setDirty(true); setShowAdd(false); setAddForm(emptyItem())
  }
  const startEdit = (item) => { setEditingId(item.id); setEditForm({ ...item }) }
  const saveEdit = () => {
    const updated = { ...dap, scopeItems: dap.scopeItems.map(i => i.id === editingId ? editForm : i) }
    setDap(updated); setDirty(true); setEditingId(null); setEditForm(null)
  }
  const deleteItem = (id) => {
    if (!window.confirm('Remove this scope item?')) return
    const updated = { ...dap, scopeItems: dap.scopeItems.filter(i => i.id !== id) }
    setDap(updated); setDirty(true)
  }

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) return <div className="py-8 text-center text-slate-400 text-sm">Loading DAP…</div>

  const overallSt = dapStatusObj(dap.status)

  return (
    <div className="space-y-3">
      {/* ── Header: overall status + save ── */}
      <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">DAP Status</span>
          {canEdit ? (
            <select
              value={dap.status}
              onChange={e => { setDap(prev => ({ ...prev, status: e.target.value })); setDirty(true) }}
              className={`text-xs font-bold px-3 py-1.5 rounded-full border-0 outline-none cursor-pointer ${overallSt.color}`}
            >
              {DAP_OVERALL_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          ) : (
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${overallSt.color}`}>{overallSt.label}</span>
          )}
          <span className="text-xs text-slate-400">v{dap.version || 1} · {(dap.scopeItems || []).length} items</span>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-600">⚠ {error}</span>}
          {canEdit && dirty && (
            <button onClick={() => save()} disabled={saving}
              className="text-xs px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 font-semibold transition">
              {saving ? 'Saving…' : '💾 Save DAP'}
            </button>
          )}
        </div>
      </div>

      {/* ── Sub-tabs ── */}
      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
        {[
          { id: 'scope',    label: `📦 Scope Items (${(dap.scopeItems || []).length})` },
          { id: 'workflow', label: `✅ Approval Workflow (${stepPct}%)` },
        ].map(t => (
          <button key={t.id} onClick={() => setDapTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
              dapTab === t.id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Scope Items tab ── */}
      {dapTab === 'scope' && (
        <div className="space-y-2">
          {/* Items table */}
          {(dap.scopeItems || []).length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2.5">Category</th>
                    <th className="text-left px-3 py-2.5">Description</th>
                    <th className="text-left px-3 py-2.5 hidden sm:table-cell">Specification</th>
                    <th className="text-center px-3 py-2.5 w-16">Qty</th>
                    <th className="text-center px-3 py-2.5 w-16">Unit</th>
                    <th className="text-center px-3 py-2.5 w-24">Eng Status</th>
                    {canEdit && <th className="px-3 py-2.5 w-20"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dap.scopeItems.map(item => (
                    editingId === item.id ? (
                      <tr key={item.id} className="bg-blue-50">
                        <td className="px-2 py-2">
                          <select value={editForm.category} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                            className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white">
                            <option value="">Select…</option>
                            {SCOPE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                            className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </td>
                        <td className="px-2 py-2 hidden sm:table-cell">
                          <input value={editForm.specification} onChange={e => setEditForm(p => ({ ...p, specification: e.target.value }))}
                            className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min="0" value={editForm.quantity} onChange={e => setEditForm(p => ({ ...p, quantity: Number(e.target.value) }))}
                            className="w-14 text-xs border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 text-center" />
                        </td>
                        <td className="px-2 py-2">
                          <select value={editForm.unit} onChange={e => setEditForm(p => ({ ...p, unit: e.target.value }))}
                            className="text-xs border border-slate-300 rounded-lg px-1 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white">
                            {SCOPE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select value={editForm.engStatus} onChange={e => setEditForm(p => ({ ...p, engStatus: e.target.value }))}
                            className="text-xs border border-slate-300 rounded-lg px-1 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white">
                            {ENG_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex gap-1">
                            <button onClick={saveEdit} className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">✓</button>
                            <button onClick={() => { setEditingId(null); setEditForm(null) }} className="px-2 py-1 bg-slate-200 text-slate-600 text-xs rounded-lg">✕</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-medium text-slate-700">{item.category || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-600">{item.description || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-500 hidden sm:table-cell">{item.specification || '—'}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-700">{item.quantity}</td>
                        <td className="px-3 py-2.5 text-center text-slate-500">{item.unit}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${engStatusObj(item.engStatus).color}`}>
                            {engStatusObj(item.engStatus).label}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="px-3 py-2.5">
                            <div className="flex gap-1">
                              <button onClick={() => startEdit(item)} className="text-xs text-blue-600 hover:text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50">Edit</button>
                              <button onClick={() => deleteItem(item.id)} className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50">✕</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state */}
          {(dap.scopeItems || []).length === 0 && !showAdd && (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
              <p className="text-slate-400 text-sm">No scope items added yet.</p>
              {canEdit && <p className="text-xs text-slate-400 mt-1">Click "Add Item" to define the engineering scope.</p>}
            </div>
          )}

          {/* Add item form */}
          {showAdd && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-green-700 uppercase tracking-wide">New Scope Item</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Category *</label>
                  <select value={addForm.category} onChange={e => setAddForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 bg-white">
                    <option value="">Select category…</option>
                    {SCOPE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Description</label>
                  <input value={addForm.description} onChange={e => setAddForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="e.g. Main sorting loop"
                    className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Specification</label>
                  <input value={addForm.specification} onChange={e => setAddForm(p => ({ ...p, specification: e.target.value }))}
                    placeholder="e.g. 5000 PPH, 24V DC"
                    className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Quantity</label>
                  <input type="number" min="0" value={addForm.quantity} onChange={e => setAddForm(p => ({ ...p, quantity: Number(e.target.value) }))}
                    className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 text-center" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Unit</label>
                  <select value={addForm.unit} onChange={e => setAddForm(p => ({ ...p, unit: e.target.value }))}
                    className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 bg-white">
                    {SCOPE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Eng Status</label>
                  <select value={addForm.engStatus} onChange={e => setAddForm(p => ({ ...p, engStatus: e.target.value }))}
                    className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 bg-white">
                    {ENG_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={addItem}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition">
                  + Add Item
                </button>
                <button onClick={() => { setShowAdd(false); setAddForm(emptyItem()) }}
                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {canEdit && !showAdd && (
            <button onClick={() => setShowAdd(true)}
              className="w-full text-xs text-slate-500 hover:text-green-700 hover:bg-green-50 border border-dashed border-slate-300 hover:border-green-400 py-2 rounded-xl transition font-medium">
              + Add Scope Item
            </button>
          )}
        </div>
      )}

      {/* ── Approval Workflow tab ── */}
      {dapTab === 'workflow' && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
            <span className="text-xs font-semibold text-slate-600">Workflow Progress</span>
            <span className={`text-xs font-bold ${stepPct === 100 ? 'text-green-600' : 'text-blue-600'}`}>{stepPct}% complete</span>
          </div>
          <div className="bg-slate-200 rounded-full h-2 mx-0.5 overflow-hidden">
            <div className={`h-2 rounded-full transition-all ${stepPct === 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${stepPct}%` }} />
          </div>
          {dap.steps.map((s, i) => (
            <DAPStepCard key={s.id} step={DAP_STEPS[i]} stepIdx={i} data={s}
              onChange={d => updateStep(i, d)} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── SE Kanban Card ────────────────────────────────────────────────────────────
function KanbanCard({ deal, canEdit, onStageChange }) {
  const [moving, setMoving] = useState(false)
  const stageCls = STAGE_COLORS[deal.stage || 'lead']
  const currentSEIdx = SE_STAGES.findIndex(s => s.id === (deal.seStage || SE_STAGE_DEFAULT))

  const moveStage = async (newStageId) => {
    if (!canEdit) return
    setMoving(true)
    try {
      // Won deals: only update SE stage — never touch the CRM stage
      const isWon = ['won', 'lost', 'rejected', 'nobid'].includes(deal.stage)
      const update = { seStage: newStageId, updatedAt: new Date().toISOString() }
      if (!isWon) update.stage = SE_TO_CRM[newStageId] || 'lead'
      await updateDoc(doc(db, 'crm_deals', deal.id), update)
      onStageChange(deal.id, newStageId, isWon ? null : update.stage)
    } catch (e) { console.error(e) }
    finally { setMoving(false) }
  }

  const val = valINR(deal)
  const overdue = deal.closingDate && deal.closingDate < new Date().toISOString().slice(0,10)

  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 hover:shadow-md transition-shadow overflow-hidden">
      {/* Top accent bar */}
      <div className={`h-1 w-full ${stageCls.includes('slate') ? 'bg-slate-400' : stageCls.includes('blue') ? 'bg-blue-500' : stageCls.includes('amber') ? 'bg-amber-500' : stageCls.includes('purple') ? 'bg-purple-500' : 'bg-green-500'}`} />
      <div className="p-3 space-y-2.5">
        {/* Title */}
        <p className="font-semibold text-slate-800 text-sm leading-snug">{deal.title}</p>

        {/* Tags */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${stageCls}`}>
            {STAGE_LABELS[deal.stage] || deal.stage}
          </span>
          {deal.company && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${deal.company === 'UIPL' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
              {deal.company}
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="space-y-1">
          {deal.customerName && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="text-slate-400">🏬</span>
              <span className="truncate">{deal.customerName}</span>
            </div>
          )}
          {deal.endCustomerName && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>↳</span><span className="truncate">{deal.endCustomerName}</span>
            </div>
          )}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-sm font-bold text-slate-800">{val > 0 ? fmtINR(val) : '—'}</span>
            {deal.closingDate && (
              <span className={`text-xs font-medium ${overdue ? 'text-red-600' : 'text-slate-400'}`}>
                {overdue ? '⚠️ ' : ''}{deal.closingDate}
              </span>
            )}
          </div>
        </div>

        {/* Move stage */}
        {canEdit && (
          <select
            value={deal.seStage || SE_STAGE_DEFAULT}
            onChange={e => moveStage(e.target.value)}
            disabled={moving}
            className="w-full text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-600 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 font-medium"
          >
            {SE_STAGES.map(s => (
              <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

// ── SE Kanban Board ───────────────────────────────────────────────────────────
function SEKanban({ deals, canEdit, onStageChange, search }) {
  const filtered = deals.filter(d =>
    !search ||
    d.title?.toLowerCase().includes(search.toLowerCase()) ||
    d.customerName?.toLowerCase().includes(search.toLowerCase())
  )

  const byStage = SE_STAGES.map(col => ({
    ...col,
    cards: filtered.filter(d => (d.seStage || SE_STAGE_DEFAULT) === col.id),
  }))

  const totalValue = (cards) => cards.reduce((sum, d) => sum + valINR(d), 0)

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[60vh]">
      {byStage.map(col => (
        <div key={col.id} className={`flex-shrink-0 w-64 flex flex-col rounded-xl overflow-hidden border border-slate-200 shadow-sm border-t-4 ${col.color}`}>
          {/* Column header */}
          <div className="bg-white px-3 pt-3 pb-2.5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className="text-base">{col.icon}</span>
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">{col.label}</p>
              </div>
              <span className="text-xs font-bold bg-slate-100 text-slate-600 w-6 h-6 rounded-full flex items-center justify-center">
                {col.cards.length}
              </span>
            </div>
            {col.cards.length > 0 && (
              <p className="text-xs font-semibold text-slate-500">{fmtINR(totalValue(col.cards))}</p>
            )}
          </div>

          {/* Cards */}
          <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[70vh] bg-slate-50">
            {col.cards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-300">
                <span className="text-2xl mb-1">{col.icon}</span>
                <span className="text-xs">No opportunities</span>
              </div>
            ) : (
              col.cards.map(d => (
                <KanbanCard key={d.id} deal={d} canEdit={canEdit} onStageChange={onStageChange} />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SalesEngineering() {
  const { user, userProfile } = useAuth()
  const navigate   = useNavigate()
  const isAdmin    = userProfile?.role === 'admin'
  const role       = userProfile?.role || ''
  const canEdit    = isAdmin || ['sales_engineer', 'solution_manager', 'sales_manager'].includes(role)

  const [deals, setDeals]     = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('kanban')   // 'kanban' | 'active' | 'dap'
  const [search, setSearch]   = useState('')
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'crm_deals'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setDeals(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const handleUpdate = (updated) => {
    setDeals(prev => prev.map(d => d.id === updated.id ? updated : d))
  }

  const handleStageChange = (dealId, newStageId, crmStage) => {
    setDeals(prev => prev.map(d =>
      d.id === dealId ? { ...d, seStage: newStageId, ...(crmStage ? { stage: crmStage } : {}) } : d
    ))
  }

  const uid = user?.uid || ''

  const visibleDeals = useMemo(() => deals.filter(d => {
    if (!isAdmin) {
      const ids = d.assignedUserIds || (d.assignedToId ? [d.assignedToId] : [])
      const isWideViewer = ['solution_manager', 'sales_director'].includes(role)
      if (isWideViewer) return true
      return ids.includes(uid)
    }
    return true
  }), [deals, isAdmin, uid, role])

  const activeDeals = useMemo(() => visibleDeals.filter(d =>
    OPEN_STAGES.includes(d.stage || 'lead') &&
    SE_DEAL_TYPES.includes(d.dealType || 'new_business') &&
    (d.company || 'UIPL') === 'Wayzim' &&
    (!search || d.title?.toLowerCase().includes(search.toLowerCase()) || d.customerName?.toLowerCase().includes(search.toLowerCase()))
  ), [visibleDeals, search])

  const dapDeals = useMemo(() => visibleDeals.filter(d =>
    d.stage === 'won' &&
    SE_DEAL_TYPES.includes(d.dealType || 'new_business') &&
    (d.company || 'UIPL') === 'Wayzim' &&
    (!search || d.title?.toLowerCase().includes(search.toLowerCase()) || d.customerName?.toLowerCase().includes(search.toLowerCase()))
  ), [visibleDeals, search])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-4xl mb-3">⚙️</div>
        <p className="text-slate-400 text-sm">Loading Sales Engineering…</p>
      </div>
    </div>
  )

  const totalActive = activeDeals.length
  const totalActiveVal = activeDeals.reduce((s, d) => s + valINR(d), 0)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Hero Header ── */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-6 pt-6 pb-5">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <span className="text-2xl">⚙️</span>
              <h2 className="text-xl font-bold text-white tracking-tight">Sales Engineering</h2>
            </div>
            <p className="text-slate-400 text-sm">Technical support for active opportunities · Design Approval Process for won projects</p>
          </div>
          <button onClick={() => navigate('/crm/pipeline')}
            className="text-xs font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-400 px-3 py-1.5 rounded-xl transition">
            ← Pipeline
          </button>
        </div>

        {/* Stats row */}
        <div className="flex gap-4 flex-wrap">
          <div className="bg-white/10 backdrop-blur rounded-xl px-4 py-2.5 text-center min-w-[90px]">
            <p className="text-2xl font-bold text-white">{totalActive}</p>
            <p className="text-xs text-slate-400 mt-0.5">Active</p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl px-4 py-2.5 text-center min-w-[90px]">
            <p className="text-lg font-bold text-white">{totalActiveVal > 0 ? fmtINR(totalActiveVal) : '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">Pipeline Value</p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl px-4 py-2.5 text-center min-w-[90px]">
            <p className="text-2xl font-bold text-white">{dapDeals.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">DAP Projects</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* ── Tab bar + Search ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 bg-white rounded-2xl shadow-card border border-slate-200/70 p-1">
            {[
              { id: 'kanban', icon: '🗂️', label: 'SE Kanban', count: null },
              { id: 'active', icon: '⚡', label: 'Active', count: activeDeals.length, countCls: 'bg-blue-100 text-blue-700' },
              { id: 'dap',    icon: '📋', label: 'DAP',    count: dapDeals.length, countCls: 'bg-green-100 text-green-700' },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  tab === t.id
                    ? 'bg-slate-800 text-white shadow'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}>
                <span>{t.icon}</span>
                <span>{t.label}</span>
                {t.count != null && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === t.id ? 'bg-white/20 text-white' : t.countCls}`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search opportunities…"
              className="pl-8 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 bg-white shadow-sm" />
          </div>
        </div>

        {/* ── Kanban tab ── */}
        {tab === 'kanban' && (
          <SEKanban
            deals={visibleDeals.filter(d =>
              OPEN_STAGES.includes(d.stage || 'lead') &&
              SE_DEAL_TYPES.includes(d.dealType || 'new_business') &&
              (d.company || 'UIPL') === 'Wayzim'
            )}
            canEdit={canEdit}
            onStageChange={handleStageChange}
            search={search}
          />
        )}

        {/* ── Active list tab ── */}
        {tab === 'active' && (
          activeDeals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-16 text-center">
              <p className="text-4xl mb-3">⚡</p>
              <p className="text-slate-600 font-semibold">No active opportunities</p>
              <p className="text-slate-400 text-sm mt-1">Wayzim new business &amp; upgradation opportunities will appear here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeDeals.map(d => {
                const isExpanded = expandedId === d.id
                const stageCls   = STAGE_COLORS[d.stage || 'lead']
                const seStage    = SE_STAGES.find(s => s.id === (d.seStage || SE_STAGE_DEFAULT))
                const overdue    = d.closingDate && d.closingDate < new Date().toISOString().slice(0,10)

                return (
                  <div key={d.id} className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
                    <div className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : d.id)}>
                      {/* Left accent dot for SE stage */}
                      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: seStage?.accent || '#94A3B8' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-800">{d.title}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${stageCls}`}>
                            {STAGE_LABELS[d.stage] || d.stage}
                          </span>
                          {seStage && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${seStage.tag}`}>
                              {seStage.icon} {seStage.label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-slate-500">
                          {d.customerName && <span>🏬 {d.customerName}</span>}
                          {d.endCustomerName && <span className="text-slate-400">↳ {d.endCustomerName}</span>}
                          {d.salesManagerName && <span>👤 {d.salesManagerName}</span>}
                          <span className="font-bold text-slate-700">{fmtINR(valINR(d))}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {d.closingDate && (
                          <span className={`text-xs font-medium ${overdue ? 'text-red-600' : 'text-slate-400'}`}>
                            {overdue ? '⚠️ ' : ''}{d.closingDate}
                          </span>
                        )}
                        <span className="text-slate-300 text-lg">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          <div className="space-y-3">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Opportunity Details</p>
                            {d.notes && <p className="text-slate-600 bg-white border border-slate-200 rounded-xl p-3 text-xs leading-relaxed">{d.notes}</p>}
                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                              {d.identifiedDate && <span>📅 Identified: {d.identifiedDate}</span>}
                              {d.closingDate && <span>🎯 Close by: {d.closingDate}</span>}
                              {d.dealType && <span>🏷️ {d.dealType.replace(/_/g,' ')}</span>}
                            </div>
                            {(d.competitors || []).length > 0 && (
                              <div>
                                <p className="text-xs font-bold text-slate-500 mb-1.5">Competitors</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {d.competitors.map(c => (
                                    <span key={c.id} className="text-xs bg-red-50 text-red-700 px-2.5 py-1 rounded-full font-medium">{c.name}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Team</p>
                            {d.salesManagerName && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-semibold">⭐ {d.salesManagerName}</span>
                              </div>
                            )}
                            {(d.teamMembers || []).length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {d.teamMembers.map(t => (
                                  <span key={t.userId} className="text-xs bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full font-medium">{t.name}</span>
                                ))}
                              </div>
                            )}

                            {/* SE Stage control */}
                            {canEdit && (
                              <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 mt-2">SE Stage</p>
                                <select
                                  value={d.seStage || SE_STAGE_DEFAULT}
                                  onChange={async e => {
                                    const newStage = e.target.value
                                    const isClosed = ['won', 'lost', 'rejected', 'nobid'].includes(d.stage)
                                    const update = { seStage: newStage, updatedAt: new Date().toISOString() }
                                    if (!isClosed) update.stage = SE_TO_CRM[newStage] || 'lead'
                                    await updateDoc(doc(db, 'crm_deals', d.id), update)
                                    handleStageChange(d.id, newStage, isClosed ? null : update.stage)
                                  }}
                                  className="text-xs border border-slate-300 rounded-xl px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                >
                                  {SE_STAGES.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* ── DAP tab ── */}
        {tab === 'dap' && (
          dapDeals.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-16 text-center text-slate-400">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-sm">No won opportunities requiring DAP.</p>
              <p className="text-xs mt-1 max-w-xs mx-auto">
                DAP applies only to <strong>Wayzim · New Business</strong> won orders. Spare supply and
                Service/AMC orders do not require a Design Approval Process.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {dapDeals.map(d => {
                const isExpanded = expandedId === d.id
                const pct = d.dap
                  ? Math.round((d.dap.steps.filter(s => s.status === 'approved' || s.status === 'na').length / DAP_STEPS.length) * 100)
                  : 0
                return (
                  <div key={d.id} className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
                    <div className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : d.id)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-800">{d.title}</p>
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-100 text-green-700">Won</span>
                          {d.projectNumber && (
                            <span className="text-xs font-mono font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">📋 {d.projectNumber}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-slate-500">
                          {d.customerName && <span>🏬 {d.customerName}</span>}
                          {d.endCustomerName && <span>→ {d.endCustomerName}</span>}
                          {d.salesManagerName && <span>👤 {d.salesManagerName}</span>}
                          <span className="font-semibold text-slate-700">{fmtINR(valINR(d))}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <div className="w-32 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-green-600 font-medium">{pct}% DAP complete</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {d.closingDate && <span className="text-xs text-slate-400">{d.closingDate}</span>}
                        <span className="text-slate-300 text-lg">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-100 px-5 py-4">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                          Design Approval Process — {d.title}
                        </p>
                        <DAPPanel deal={d} user={user} onUpdate={handleUpdate} canEdit={canEdit} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </div>
  )
}