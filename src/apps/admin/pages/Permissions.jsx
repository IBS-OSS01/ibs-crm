import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const MODULES = ['CRM', 'SERVICES', 'HR', 'PROJECTS', 'FINANCE', 'SALESENG']
const MODULE_LABELS = { CRM: 'CRM', SERVICES: 'Services', HR: 'HR', PROJECTS: 'Projects', FINANCE: 'Finance', SALESENG: 'Sales Eng' }
const COMPANIES = ['UIPL', 'Wayzim']

const RIGHTS_CYCLE = ['none', 'view', 'edit']
const RIGHTS_CFG = {
  none: { label: 'None', cls: 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200', icon: '—' },
  view: { label: 'View', cls: 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200', icon: '👁' },
  edit: { label: 'Edit', cls: 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200', icon: '✏️' },
}

export default function Permissions() {
  const { userProfile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({}) // userId → true while saving
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const isAdmin = userProfile?.role === 'admin'

  useEffect(() => { if (isAdmin) fetchUsers() }, [isAdmin])

  const fetchUsers = async () => {
    try {
      const snap = await getDocs(collection(db, 'users'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''))
      setUsers(data)
    } catch (err) { setError('Failed to load users: ' + err.message) }
    finally { setLoading(false) }
  }

  // Get the effective right for a user+module (backward compat with legacy departments)
  const getRight = (u, module) => {
    if (u.moduleRights?.[module]) return u.moduleRights[module]
    return (u.departments || []).includes(module) ? 'edit' : 'none'
  }

  // Cycle right and save immediately
  const cycleRight = async (userId, module) => {
    const u = users.find(x => x.id === userId)
    if (!u) return
    const cur = getRight(u, module)
    const next = RIGHTS_CYCLE[(RIGHTS_CYCLE.indexOf(cur) + 1) % RIGHTS_CYCLE.length]

    // Optimistic update
    const newModuleRights = {
      ...Object.fromEntries(MODULES.map(m => [m, getRight(u, m)])),
      [module]: next,
    }
    const newDepartments = MODULES.filter(m => newModuleRights[m] !== 'none')
    setUsers(prev => prev.map(x => x.id === userId
      ? { ...x, moduleRights: newModuleRights, departments: newDepartments }
      : x
    ))

    setSaving(prev => ({ ...prev, [userId]: true }))
    try {
      await updateDoc(doc(db, 'users', userId), {
        moduleRights: newModuleRights,
        departments: newDepartments,
        updatedAt: new Date().toISOString(),
      })
      setSuccess(`Saved ${u.name || u.email} – ${module}: ${next}`)
      setTimeout(() => setSuccess(''), 2500)
    } catch (err) {
      setError('Save failed: ' + err.message)
      // Revert
      setUsers(prev => prev.map(x => x.id === userId ? u : x))
    } finally {
      setSaving(prev => ({ ...prev, [userId]: false }))
    }
  }

  // Toggle company access and save
  const toggleCompany = async (userId, company) => {
    const u = users.find(x => x.id === userId)
    if (!u) return
    const cur = u.companies || ['UIPL']
    const next = cur.includes(company) ? cur.filter(c => c !== company) : [...cur, company]

    setUsers(prev => prev.map(x => x.id === userId ? { ...x, companies: next } : x))
    setSaving(prev => ({ ...prev, [`${userId}_co`]: true }))
    try {
      await updateDoc(doc(db, 'users', userId), { companies: next, updatedAt: new Date().toISOString() })
      setSuccess(`Saved ${u.name || u.email} – Companies: ${next.join(', ') || 'None'}`)
      setTimeout(() => setSuccess(''), 2500)
    } catch (err) {
      setError('Save failed: ' + err.message)
      setUsers(prev => prev.map(x => x.id === userId ? u : x))
    } finally {
      setSaving(prev => ({ ...prev, [`${userId}_co`]: false }))
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          <p className="text-4xl mb-3">🔒</p>
          <p>Only Admins can manage permissions.</p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  const nonAdmins = users.filter(u => u.role !== 'admin')
  const admins = users.filter(u => u.role === 'admin')

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Permissions Matrix</h2>
        <p className="text-slate-500 text-sm mt-0.5">Click any cell to cycle: None → View (read-only) → Edit (full access). Changes save instantly.</p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">⚠️ {error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {/* Legend */}
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span className="font-medium">Rights:</span>
        {Object.entries(RIGHTS_CFG).map(([k, v]) => (
          <span key={k} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border ${v.cls}`}>
            {v.icon} {v.label}
          </span>
        ))}
      </div>

      {/* Module rights matrix */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3 w-48">User</th>
              <th className="text-left px-4 py-3 w-32">Role</th>
              {MODULES.map(m => (
                <th key={m} className="text-center px-3 py-3">{MODULE_LABELS[m] || m}</th>
              ))}
              <th className="text-center px-3 py-3">Companies</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {/* Admin rows — all access, read-only */}
            {admins.map(u => (
              <tr key={u.id} className="bg-blue-50/40">
                <td className="px-4 py-3 font-medium text-slate-800">
                  {u.name || u.email}
                  <span className="ml-1.5 text-xs text-slate-400">👑</span>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-blue-100 text-blue-700">Admin</span>
                </td>
                {MODULES.map(m => (
                  <td key={m} className="px-3 py-3 text-center">
                    <span className="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg border text-xs font-medium bg-green-100 text-green-700 border-green-200 opacity-70 cursor-default" title="Admins always have full access">
                      ✏️ Edit
                    </span>
                  </td>
                ))}
                <td className="px-3 py-3 text-center">
                  <span className="text-xs text-slate-500">All</span>
                </td>
              </tr>
            ))}

            {/* Non-admin rows — editable */}
            {nonAdmins.map(u => {
              const isSaving = saving[u.id]
              return (
                <tr key={u.id} className={u.active === false ? 'opacity-50' : ''}>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {u.name || u.email}
                    {u.active === false && <span className="ml-1.5 text-xs text-red-500">Disabled</span>}
                    {isSaving && <span className="ml-1.5 text-xs text-slate-400 animate-pulse">saving…</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600">{u.role || 'user'}</span>
                  </td>
                  {MODULES.map(m => {
                    const right = getRight(u, m)
                    const cfg = RIGHTS_CFG[right]
                    return (
                      <td key={m} className="px-3 py-3 text-center">
                        <button
                          onClick={() => cycleRight(u.id, m)}
                          title={`Click to change ${m} access for ${u.name}`}
                          className={`inline-flex items-center gap-0.5 px-2 py-1 rounded-lg border text-xs font-medium transition cursor-pointer ${cfg.cls}`}
                        >
                          {cfg.icon} {cfg.label}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3 py-3 text-center">
                    <div className="flex justify-center gap-1 flex-wrap">
                      {COMPANIES.map(c => {
                        const active = (u.companies || ['UIPL']).includes(c)
                        return (
                          <button
                            key={c}
                            onClick={() => toggleCompany(u.id, c)}
                            title={`Toggle ${c} access`}
                            className={`px-1.5 py-0.5 rounded-lg text-xs font-medium border transition ${
                              active
                                ? c === 'Wayzim' ? 'bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200' : 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200'
                                : 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'
                            }`}
                          >
                            {c}
                          </button>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              )
            })}
            {nonAdmins.length === 0 && (
              <tr><td colSpan={MODULES.length + 3} className="text-center py-8 text-slate-400">No non-admin users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Company toggles control which company's CRM data the user can see and create records for.
        Module rights control which sidebar modules appear — View shows the module read-only, Edit gives full create/update access.
      </p>
    </div>
  )
}
