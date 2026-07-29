import React, { useState, useEffect } from 'react'
import { initializeApp, getApps } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth'
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { auth, db, firebaseConfig } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { ensureDefaultRoles } from '../defaultRoles'

// These map 1:1 to the module tiles in Layout.jsx
const MODULES = ['CRM', 'SERVICES', 'HR', 'PROJECTS', 'FINANCE', 'SALESENG']
const MODULE_LABELS = { CRM: 'CRM', SERVICES: 'Services', HR: 'HR', PROJECTS: 'Projects', FINANCE: 'Finance', SALESENG: 'Sales Eng' }

// Which company's data this user belongs to.
const COMPANIES = ['UIPL', 'Wayzim']

// 3-state access rights: none → view → edit (cycles on click)
const RIGHTS_CYCLE = ['none', 'view', 'edit']
const RIGHTS_DISPLAY = {
  none: { label: 'None', icon: '—', cls: 'bg-slate-100 text-slate-400 border-slate-200' },
  view: { label: 'View', icon: '👁', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  edit: { label: 'Edit', icon: '✏️', cls: 'bg-green-100 text-green-700 border-green-300' },
}

const DEFAULT_MODULE_RIGHTS = Object.fromEntries(MODULES.map(m => [m, 'none']))

// A second, independent Firebase app instance. Creating a user with the
// client SDK automatically signs in as that new user — running it through
// a secondary app keeps the admin's own session untouched.
function getSecondaryAuth() {
  const name = 'Secondary'
  const app = getApps().find(a => a.name === name) || initializeApp(firebaseConfig, name)
  return getAuth(app)
}

const emptyForm = { name: '', email: '', password: '', role: 'user', departments: [], companies: ['UIPL'], moduleRights: { ...DEFAULT_MODULE_RIGHTS } }

export default function UserManagement() {
  const { user, userProfile } = useAuth()
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [searchQ, setSearchQ] = useState('')

  const isAdmin = userProfile?.role === 'admin'

  useEffect(() => { if (isAdmin) { fetchUsers(); fetchRoles() } }, [isAdmin])

  const fetchUsers = async () => {
    try {
      const snap = await getDocs(collection(db, 'users'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''))
      setUsers(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  // Roles are managed on the Roles tab (organisation structure) — this just
  // reads whatever's there so the dropdown always reflects current roles.
  const fetchRoles = async () => {
    try {
      await ensureDefaultRoles(db)
      const snap = await getDocs(collection(db, 'roles'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setRoles(data)
    } catch (err) { console.error(err) }
  }

  const roleName = (roleId) => roles.find(r => r.id === roleId)?.name || roleId || 'User'

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleEdit = (u) => {
    setEditing(u.id)
    // Build moduleRights with backward compat: if no moduleRights stored, derive from departments (default 'edit')
    const existingRights = u.moduleRights || {}
    const moduleRights = Object.fromEntries(
      MODULES.map(m => [m, existingRights[m] || ((u.departments || []).includes(m) ? 'edit' : 'none')])
    )
    setForm({ name: u.name || '', email: u.email || '', password: '', role: u.role || 'user', departments: u.departments || [], companies: u.companies || ['UIPL'], moduleRights })
    setShowForm(true)
    setSuccess('')
  }

  // Cycle a single module's right: none → view → edit → none
  const cycleRight = (module) => {
    setForm(prev => {
      const cur = prev.moduleRights[module] || 'none'
      const next = RIGHTS_CYCLE[(RIGHTS_CYCLE.indexOf(cur) + 1) % RIGHTS_CYCLE.length]
      return { ...prev, moduleRights: { ...prev.moduleRights, [module]: next } }
    })
  }

  const toggleCompany = (company) => {
    setForm(prev => ({
      ...prev,
      companies: prev.companies.includes(company)
        ? prev.companies.filter(c => c !== company)
        : [...prev.companies, company],
    }))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!form.name || !form.email) { setError('Name and email are required.'); return }
    if (!editing && !form.password) { setError('A temporary password is required for new users.'); return }
    if (!editing && form.password.length < 6) { setError('Password must be at least 6 characters.'); return }

    // Duplicate name check
    const dupName = users.find(u => u.id !== editing && (u.name || '').trim().toLowerCase() === form.name.trim().toLowerCase())
    if (dupName) { setError(`A user named "${dupName.name}" already exists. Use a unique full name.`); return }
    // Email duplicate check in Firestore (Auth will also catch it)
    if (!editing) {
      const dupEmail = users.find(u => (u.email || '').toLowerCase() === form.email.trim().toLowerCase())
      if (dupEmail) { setError(`Email "${form.email}" is already used by ${dupEmail.name || 'another user'}.`); return }
    }

    setSaving(true)
    try {
      // Derive departments from moduleRights for backward compat with rest of app
      const departments = MODULES.filter(m => form.moduleRights[m] && form.moduleRights[m] !== 'none')
      if (editing) {
        await updateDoc(doc(db, 'users', editing), {
          name: form.name,
          role: form.role,
          departments,
          moduleRights: form.moduleRights,
          companies: form.companies,
          updatedAt: new Date().toISOString(),
        })
        setUsers(prev => prev.map(u => u.id === editing ? { ...u, name: form.name, role: form.role, departments, moduleRights: form.moduleRights, companies: form.companies } : u))
        setSuccess('User updated.')
      } else {
        const secondaryAuth = getSecondaryAuth()
        const cred = await createUserWithEmailAndPassword(secondaryAuth, form.email, form.password)
        const uid = cred.user.uid
        await signOut(secondaryAuth)

        const profile = {
          name: form.name,
          email: form.email,
          role: form.role,
          departments,
          moduleRights: form.moduleRights,
          companies: form.companies,
          active: true,
          createdAt: new Date().toISOString(),
        }
        await setDoc(doc(db, 'users', uid), profile)
        setUsers(prev => [...prev, { id: uid, ...profile }])
        setSuccess(`User created — share the email and temporary password with ${form.name} so they can sign in.`)
      }
      setShowForm(false)
      resetForm()
    } catch (err) {
      const friendly = err.code === 'auth/email-already-in-use' ? 'That email already has a login.' : err.message
      setError(friendly)
    } finally { setSaving(false) }
  }

  const handleToggleActive = async (u) => {
    const nextActive = u.active === false ? true : false
    if (!nextActive && !window.confirm(`Disable ${u.name || u.email}? They'll be signed out immediately and won't be able to log back in until re-enabled.`)) return
    setError('')
    try {
      await updateDoc(doc(db, 'users', u.id), { active: nextActive, updatedAt: new Date().toISOString() })
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, active: nextActive } : x))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleResetPassword = async (u) => {
    if (!u.email) { setError('This user has no email on file.'); return }
    if (!window.confirm(`Send a password reset link to ${u.email}?`)) return
    setError(''); setSuccess('')
    try {
      // Sent from Firebase's own no-reply address — doesn't touch the
      // admin's current session, just triggers an email to the user.
      await sendPasswordResetEmail(auth, u.email)
      setSuccess(`Reset link sent to ${u.email}.`)
    } catch (err) { setError('Error: ' + err.message) }
  }

  // Free-plan-safe deletion: the client SDK can only ever delete the
  // *currently signed-in* user's own Auth login — there is no way for an
  // admin to delete someone else's Auth login from the browser without a
  // Cloud Function, and Cloud Functions require the paid Blaze plan. So
  // this removes the user everywhere the app controls (their Firestore
  // profile, which immediately signs them out and blocks access), then
  // hands the admin a one-click reminder to finish removing the Auth
  // login in Firebase Console — a free, manual step that takes ~10 seconds.
  const handleDelete = async (u) => {
    if (!window.confirm(`Remove ${u.name || u.email} from the app? They'll be signed out immediately and lose all access. You'll get a reminder to also delete their login from Firebase Console (a free, manual step) right after.`)) return
    setError(''); setSuccess('')
    try {
      await deleteDoc(doc(db, 'users', u.id))
      setUsers(prev => prev.filter(x => x.id !== u.id))
      setSuccess(
        `${u.name || u.email} was removed from the app. To finish deleting their login too (free, manual step): `
        + `Firebase Console → Authentication → Users → find "${u.email}" → delete. UID: ${u.id}`
      )
    } catch (err) {
      setError('Error: ' + err.message)
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          <p className="text-4xl mb-3">🔒</p>
          <p>Only Admins can manage users.</p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Users</h2>
          <p className="text-slate-500 text-sm">{users.length} accounts</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Search box */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by name or email…"
              className="pl-8 pr-8 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-60" />
            {searchQ && (
              <button onClick={() => setSearchQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">✕</button>
            )}
          </div>
          <button
            onClick={() => { setShowForm(!showForm); resetForm() }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
          >
            {showForm && !editing ? '✕ Cancel' : '+ Add User'}
          </button>
        </div>
      </div>

      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit User' : 'Add New User'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} autoComplete="off"
                disabled={!!editing}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100" required />
            </div>
            {!editing && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Temporary Password *</label>
                <input type="text" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} autoComplete="off"
                  placeholder="Min 6 characters — share this with the user"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select
                value={form.role}
                onChange={e => {
                  const roleId = e.target.value
                  const matched = roles.find(r => r.id === roleId)
                  if (!editing && matched?.departments) {
                    // For new users, seed moduleRights from the role's default departments (grant 'edit')
                    const roleModuleRights = Object.fromEntries(
                      MODULES.map(m => [m, (matched.departments || []).includes(m) ? 'edit' : 'none'])
                    )
                    setForm(p => ({ ...p, role: roleId, moduleRights: roleModuleRights, departments: matched.departments || [] }))
                  } else {
                    setForm(p => ({ ...p, role: roleId }))
                  }
                }}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <p className="text-xs text-slate-400 mt-1">Need a different role? Add it on the Roles tab.</p>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">Module Access &amp; Rights</label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {MODULES.map(m => {
                  const right = form.moduleRights[m] || 'none'
                  const cfg = RIGHTS_DISPLAY[right]
                  return (
                    <button type="button" key={m} onClick={() => cycleRight(m)}
                      className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border text-xs font-medium transition select-none ${cfg.cls}`}>
                      <span className="text-base leading-none">{cfg.icon}</span>
                      <span className="font-semibold tracking-wide">{MODULE_LABELS[m] || m}</span>
                      <span className="opacity-80">{cfg.label}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">Click to cycle: None → View (read-only) → Edit (full access). Admins get all modules automatically.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Company Assignment</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {COMPANIES.map(c => (
                  <button type="button" key={c} onClick={() => toggleCompany(c)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${form.companies.includes(c) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                    {c}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1">Controls which company's CRM data this user can see and create. Assign both for cross-company staff.</p>
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update User' : 'Create User'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Module Access</th>
              <th className="text-left px-4 py-3">Companies</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.filter(u => !searchQ || (u.name || '').toLowerCase().includes(searchQ.toLowerCase()) || (u.email || '').toLowerCase().includes(searchQ.toLowerCase())).map(u => {
              const isSelf = u.id === user?.uid
              const isActive = u.active !== false
              return (
                <tr key={u.id} className={!isActive ? 'opacity-60' : ''}>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {u.name || '—'} {isSelf && <span className="text-xs text-slate-400">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{u.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-blue-100 text-blue-700">{roleName(u.role)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === 'admin' ? (
                      <span className="text-xs text-blue-700 font-medium">All ✏️</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {MODULES.filter(m => {
                          const r = u.moduleRights?.[m] || ((u.departments || []).includes(m) ? 'edit' : 'none')
                          return r !== 'none'
                        }).map(m => {
                          const r = u.moduleRights?.[m] || ((u.departments || []).includes(m) ? 'edit' : 'none')
                          return (
                            <span key={m} className={`px-1.5 py-0.5 rounded-lg text-xs font-medium ${r === 'edit' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {m} {r === 'edit' ? '✏️' : '👁'}
                            </span>
                          )
                        })}
                        {MODULES.every(m => (u.moduleRights?.[m] || ((u.departments || []).includes(m) ? 'edit' : 'none')) === 'none') && (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(u.companies || ['UIPL']).map(c => (
                        <span key={c} className={`px-2 py-0.5 rounded-lg text-xs font-bold ${c === 'Wayzim' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{c}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {isActive ? '● Active' : '● Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                    <button onClick={() => handleEdit(u)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                    <button onClick={() => handleResetPassword(u)} className="text-indigo-600 hover:text-indigo-700 font-medium">🔑 Reset Password</button>
                    <button
                      onClick={() => handleToggleActive(u)}
                      disabled={isSelf}
                      title={isSelf ? "You can't disable your own account." : ''}
                      className={`font-medium ${isSelf ? 'text-slate-300 cursor-not-allowed' : isActive ? 'text-amber-600 hover:text-amber-700' : 'text-green-600 hover:text-green-700'}`}
                    >
                      {isActive ? '⏸ Disable' : '▶ Enable'}
                    </button>
                    <button
                      onClick={() => handleDelete(u)}
                      disabled={isSelf}
                      title={isSelf ? "You can't delete your own account." : ''}
                      className={`font-medium ${isSelf ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:text-red-700'}`}
                    >
                      🗑️ Delete
                    </button>
                  </td>
                </tr>
              )
            })}
            {users.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-3">
        🗑️ Deleting a user here removes their app access immediately (they're signed out and locked out). To fully remove their login too, finish with the one manual step shown in the message above — done in Firebase Console, takes ~10 seconds, no extra cost.
      </div>
    </div>
  )
}
