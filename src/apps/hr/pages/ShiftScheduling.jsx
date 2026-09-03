/**
 * Shift Scheduling / Roster — kept intentionally simple: a weekly
 * recurring pattern per employee (not a full date-by-date calendar).
 * Two sections: manage shift templates (small CRUD, admin-only), and a
 * roster grid (employees × Mon–Sun, each cell a shift picker).
 */
import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'
import { ensureDefaultShiftTemplates } from '../defaultShiftTemplates'

const DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
]
const emptyTemplateForm = { name: '', startTime: '09:00', endTime: '18:00' }

export default function ShiftScheduling() {
  const { user, userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const hasHRAccess = userProfile?.role === 'admin' || canEdit('HR')

  const [tab, setTab] = useState('roster') // 'roster' | 'templates'
  const [employees, setEmployees] = useState([])
  const [templates, setTemplates] = useState([])
  const [rosters, setRosters] = useState({}) // { employeeId: { weeklyPattern } }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(new Set())
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Template form
  const [showTplForm, setShowTplForm] = useState(false)
  const [editingTpl, setEditingTpl] = useState(null)
  const [tplForm, setTplForm] = useState(emptyTemplateForm)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      await ensureDefaultShiftTemplates(db)
      const [empSnap, tplSnap, rosterSnap] = await Promise.all([
        getDocs(collection(db, 'hr_employees')),
        getDocs(collection(db, 'hr_shift_templates')),
        getDocs(collection(db, 'hr_rosters')),
      ])
      const emps = []; empSnap.forEach(d => { const e = d.data(); if (e.active !== false) emps.push({ id: d.id, name: e.name || d.id }) })
      emps.sort((a, b) => a.name.localeCompare(b.name))
      setEmployees(emps)
      const tpls = []; tplSnap.forEach(d => tpls.push({ id: d.id, ...d.data() }))
      tpls.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
      setTemplates(tpls)
      const ros = {}; rosterSnap.forEach(d => { ros[d.id] = d.data() })
      setRosters(ros)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  // ── Roster grid ──────────────────────────────────────────────────────
  const setCell = (employeeId, dayKey, shiftId) => {
    setRosters(prev => ({
      ...prev,
      [employeeId]: {
        ...(prev[employeeId] || { employeeId, weeklyPattern: {} }),
        weeklyPattern: { ...(prev[employeeId]?.weeklyPattern || {}), [dayKey]: shiftId },
      },
    }))
    setDirty(prev => new Set(prev).add(employeeId))
  }

  const saveRosters = async () => {
    if (dirty.size === 0) return
    setSaving(true); setError(''); setSuccess('')
    try {
      for (const employeeId of dirty) {
        const r = rosters[employeeId] || { weeklyPattern: {} }
        await setDoc(doc(db, 'hr_rosters', employeeId), {
          employeeId, weeklyPattern: r.weeklyPattern || {},
          updatedAt: new Date().toISOString(), updatedBy: user.uid,
        })
      }
      setDirty(new Set())
      setSuccess('Roster saved.')
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const templateById = Object.fromEntries(templates.map(t => [t.id, t]))

  // ── Template CRUD ────────────────────────────────────────────────────
  const resetTplForm = () => { setTplForm(emptyTemplateForm); setEditingTpl(null) }

  const handleEditTpl = (t) => {
    setEditingTpl(t.id)
    setTplForm({ name: t.name || '', startTime: t.startTime || '09:00', endTime: t.endTime || '18:00' })
    setShowTplForm(true)
  }

  const handleSaveTpl = async (e) => {
    e.preventDefault()
    if (!tplForm.name.trim()) { setError('Shift name is required.'); return }
    setSaving(true); setError('')
    try {
      const id = editingTpl || tplForm.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const payload = { name: tplForm.name.trim(), startTime: tplForm.startTime, endTime: tplForm.endTime, isSystem: templateById[id]?.isSystem || false }
      await setDoc(doc(db, 'hr_shift_templates', id), payload)
      setTemplates(prev => {
        const others = prev.filter(t => t.id !== id)
        return [...others, { id, ...payload }].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
      })
      setShowTplForm(false); resetTplForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDeleteTpl = async (t) => {
    const inUse = Object.values(rosters).some(r => Object.values(r.weeklyPattern || {}).includes(t.id))
    if (inUse && !window.confirm(`"${t.name}" is still assigned in the roster. Delete it anyway? Those cells will show as unassigned.`)) return
    if (!inUse && !window.confirm(`Delete shift template "${t.name}"?`)) return
    try {
      await deleteDoc(doc(db, 'hr_shift_templates', t.id))
      setTemplates(prev => prev.filter(x => x.id !== t.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">🕐 Shift Scheduling</h2>
          <p className="text-slate-500 text-sm">Weekly recurring roster — not a date-by-date calendar</p>
        </div>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {[{ k: 'roster', label: 'Roster' }, { k: 'templates', label: 'Shift Templates' }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${tab === t.k ? 'bg-white text-blue-700 shadow' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {!hasHRAccess && <p className="text-xs text-slate-400">🔒 View-only — only HR/admin can edit shifts and the roster.</p>}

      {/* ── Roster tab ── */}
      {tab === 'roster' && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 sticky left-0 bg-slate-50/80">Employee</th>
                  {DAYS.map(d => <th key={d.key} className="text-center px-2 py-3">{d.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map(e => {
                  const pattern = rosters[e.id]?.weeklyPattern || {}
                  return (
                    <tr key={e.id}>
                      <td className="px-4 py-2 font-medium text-slate-800 whitespace-nowrap sticky left-0 bg-white">{e.name}</td>
                      {DAYS.map(d => (
                        <td key={d.key} className="px-1 py-2 text-center">
                          <select value={pattern[d.key] || 'off'} disabled={!hasHRAccess}
                            onChange={ev => setCell(e.id, d.key, ev.target.value)}
                            className="text-xs px-1.5 py-1 border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400">
                            <option value="off">Off</option>
                            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {employees.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">No active employees.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {hasHRAccess && (
            <div className="p-3 border-t border-slate-100 flex items-center gap-3">
              <button onClick={saveRosters} disabled={dirty.size === 0 || saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : '💾 Save Roster'}
              </button>
              {dirty.size > 0 && <span className="text-xs text-amber-600">{dirty.size} row(s) with unsaved changes</span>}
            </div>
          )}
          <div className="px-4 pb-3 flex gap-3 flex-wrap text-xs text-slate-400">
            {templates.map(t => <span key={t.id}>{t.name}: {t.startTime}–{t.endTime}</span>)}
          </div>
        </div>
      )}

      {/* ── Templates tab ── */}
      {tab === 'templates' && (
        <div className="space-y-4">
          {hasHRAccess && (
            <button onClick={() => { setShowTplForm(!showTplForm); resetTplForm() }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
              {showTplForm && !editingTpl ? '✕ Cancel' : '+ Add Shift Template'}
            </button>
          )}
          {showTplForm && hasHRAccess && (
            <form onSubmit={handleSaveTpl} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 grid grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Name</label>
                <input value={tplForm.name} onChange={e => setTplForm(p => ({ ...p, name: e.target.value }))} className={inp} required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Start Time</label>
                <input type="time" value={tplForm.startTime} onChange={e => setTplForm(p => ({ ...p, startTime: e.target.value }))} className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">End Time</label>
                <input type="time" value={tplForm.endTime} onChange={e => setTplForm(p => ({ ...p, endTime: e.target.value }))} className={inp} />
              </div>
              <div className="col-span-3">
                <button type="submit" disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                  {saving ? 'Saving…' : editingTpl ? 'Update Template' : 'Add Template'}
                </button>
              </div>
            </form>
          )}
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                <tr><th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">Start</th><th className="text-left px-4 py-3">End</th><th className="text-right px-4 py-3">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {templates.map(t => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 font-medium text-slate-800">{t.name}{t.isSystem && <span className="ml-2 text-xs text-slate-400">(default)</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{t.startTime}</td>
                    <td className="px-4 py-3 text-slate-600">{t.endTime}</td>
                    <td className="px-4 py-3 text-right space-x-3">
                      {hasHRAccess && <button onClick={() => handleEditTpl(t)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>}
                      {hasHRAccess && <button onClick={() => handleDeleteTpl(t)} className="text-red-600 hover:text-red-700 font-medium">🗑️</button>}
                    </td>
                  </tr>
                ))}
                {templates.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-slate-400">No shift templates yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
