import React, { useState, useEffect, useMemo } from 'react'
import { initializeApp, getApps } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth'
import { collection, getDocs, addDoc, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { auth, db, firebaseConfig } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { invalidatePeopleCache } from '../../../lib/usePeople'
import { useNavigate } from 'react-router-dom'
import { ensureDefaultRoles } from '../../admin/defaultRoles'
import { ensureDefaultDepartments } from '../../admin/defaultDepartments'
import { buildEmployeeFromUser } from '../../../lib/employeeSync'

// ── HR-side constants ─────────────────────────────────────────────────────
const COMPANIES = ['UIPL', 'Wayzim']
const COMPANY_LABELS = { UIPL: 'UIPL', Wayzim: 'Wayzim Technology Co Ltd' }

// ── Login-side constants (folded in from what used to be Admin > Users) ──
const MODULES = ['CRM', 'SERVICES', 'HR', 'PROJECTS', 'FINANCE', 'SALESENG']
const MODULE_LABELS = { CRM: 'CRM', SERVICES: 'Services', HR: 'HR', PROJECTS: 'Projects', FINANCE: 'Finance', SALESENG: 'Sales Eng' }
const RIGHTS_CYCLE = ['none', 'view', 'edit']
const RIGHTS_DISPLAY = {
  none: { label: 'None', icon: '—', cls: 'bg-slate-100 text-slate-400 border-slate-200' },
  view: { label: 'View', icon: '👁', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  edit: { label: 'Edit', icon: '✏️', cls: 'bg-green-100 text-green-700 border-green-300' },
}
const DEFAULT_MODULE_RIGHTS = Object.fromEntries(MODULES.map(m => [m, 'none']))

const emptyForm = {
  // HR fields
  name: '', designation: '', department: 'Sales', phone: '', email: '',
  address: '', emergencyContact: '', joinDate: '', salary: '', active: true,
  reportingManagerId: '', employeeNumber: '', appointedCompany: '',
  // Login fields — only used when granting/editing app access (admin only)
  grantLogin: false, password: '', role: 'user',
  moduleRights: { ...DEFAULT_MODULE_RIGHTS }, loginCompanies: ['UIPL'],
}

// A second, independent Firebase app instance. Creating a user with the
// client SDK automatically signs in as that new user — running it through
// a secondary app keeps the admin's own session untouched.
function getSecondaryAuth() {
  const name = 'Secondary'
  const app = getApps().find(a => a.name === name) || initializeApp(firebaseConfig, name)
  return getAuth(app)
}

const inp = 'w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function Employees() {
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const [employees, setEmployees] = useState([])
  const [appUsers, setAppUsers] = useState([])            // full users collection — login accounts
  const [roles, setRoles] = useState([])
  const [departments, setDepartments] = useState([])
  const [userEmailSet, setUserEmailSet] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      await Promise.all([ensureDefaultRoles(db), ensureDefaultDepartments(db)])
      const [empSnap, userSnap, roleSnap, deptSnap] = await Promise.all([
        getDocs(collection(db, 'hr_employees')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'roles')),
        getDocs(collection(db, 'departments')),
      ])
      const data = []
      empSnap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setEmployees(data)
      const emails = new Set()
      const usersData = []
      userSnap.forEach(d => {
        const u = { id: d.id, ...d.data() }
        usersData.push(u)
        const e = (u.email || '').toLowerCase(); if (e) emails.add(e)
      })
      setAppUsers(usersData)
      setUserEmailSet(emails)
      const rolesData = []
      roleSnap.forEach(d => rolesData.push({ id: d.id, ...d.data() }))
      setRoles(rolesData)
      const deptData = []
      deptSnap.forEach(d => deptData.push({ id: d.id, ...d.data() }))
      deptData.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setDepartments(deptData)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const roleName = (roleId) => roles.find(r => r.id === roleId)?.name || roleId || ''

  const usersById = useMemo(() => Object.fromEntries(appUsers.map(u => [u.id, u])), [appUsers])
  const linkedUserOf = (emp) => (emp?.importedFromUserId ? usersById[emp.importedFromUserId] : null)

  // ── One-time backfill: link/create hr_employees for real app users that
  // predate this unified form (kept as a fallback safety net — going
  // forward every new login is created from this same page/form). ────────
  const employeesByEmail = useMemo(
    () => Object.fromEntries(employees.filter(e => e.email).map(e => [e.email.toLowerCase(), e])),
    [employees]
  )
  const usersWithoutEmployeeRecord = useMemo(
    () => appUsers.filter(u => u.email && !employeesByEmail[u.email.toLowerCase()]),
    [appUsers, employeesByEmail]
  )
  const usersNeedingLinkBackfill = useMemo(
    () => appUsers.filter(u => {
      if (!u.email) return false
      const match = employeesByEmail[u.email.toLowerCase()]
      return match && match.importedFromUserId !== u.id
    }),
    [appUsers, employeesByEmail]
  )

  const handleImportFromUsers = async () => {
    const toCreate = usersWithoutEmployeeRecord
    const toLink = usersNeedingLinkBackfill
    if (toCreate.length === 0 && toLink.length === 0) return
    const lines = [
      toCreate.length > 0 ? `Create ${toCreate.length} new employee record(s):\n${toCreate.map(u => u.name || u.email).join('\n')}` : '',
      toLink.length > 0 ? `Link ${toLink.length} existing employee(s) to their login:\n${toLink.map(u => u.name || u.email).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')
    if (!window.confirm(`${lines}\n\nYou can fill in phone, employee number, and reporting manager afterward.`)) return
    setImporting(true); setError('')
    try {
      const created = []
      for (const u of toCreate) {
        const newEmp = { ...buildEmployeeFromUser(u, roleName(u.role)), createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'hr_employees'), newEmp)
        created.push({ id: ref.id, ...newEmp })
      }
      const linked = []
      for (const u of toLink) {
        const match = employeesByEmail[u.email.toLowerCase()]
        const patch = {
          importedFromUserId: u.id,
          appointedCompany: match.appointedCompany || u.companies?.[0] || '',
          designation: match.designation || roleName(u.role),
        }
        await updateDoc(doc(db, 'hr_employees', match.id), { ...patch, updatedAt: new Date().toISOString() })
        linked.push({ id: match.id, ...patch })
      }
      setEmployees(prev => {
        const byId = Object.fromEntries(prev.map(e => [e.id, e]))
        linked.forEach(l => { byId[l.id] = { ...byId[l.id], ...l } })
        return [...Object.values(byId), ...created].sort((a, b) => a.name.localeCompare(b.name))
      })
      invalidatePeopleCache()
    } catch (err) { setError('Import error: ' + err.message) }
    finally { setImporting(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError(''); setSuccess('') }

  const handleEdit = (e) => {
    setEditing(e.id)
    const linked = linkedUserOf(e)
    // Backward compat: logins created before per-module rights existed only
    // have `departments` — derive an equivalent moduleRights so editing
    // never silently wipes access a person actually has.
    const existingRights = linked?.moduleRights || {}
    const moduleRights = Object.fromEntries(
      MODULES.map(m => [m, existingRights[m] || ((linked?.departments || []).includes(m) ? 'edit' : 'none')])
    )
    setForm({
      name: e.name || '', designation: e.designation || '', department: e.department || 'Sales',
      phone: e.phone || '', email: e.email || '', address: e.address || '',
      emergencyContact: e.emergencyContact || '', joinDate: e.joinDate || '',
      salary: e.salary ?? '', active: e.active !== false,
      reportingManagerId: e.reportingManagerId || '',
      employeeNumber: e.employeeNumber || '', appointedCompany: e.appointedCompany || '',
      grantLogin: !!linked,
      password: '',
      role: linked?.role || 'user',
      moduleRights: linked ? moduleRights : { ...DEFAULT_MODULE_RIGHTS },
      loginCompanies: linked?.companies || [e.appointedCompany || 'UIPL'],
    })
    setShowForm(true)
    setSuccess('')
  }

  const cycleRight = (module) => {
    setForm(prev => {
      const cur = prev.moduleRights[module] || 'none'
      const next = RIGHTS_CYCLE[(RIGHTS_CYCLE.indexOf(cur) + 1) % RIGHTS_CYCLE.length]
      return { ...prev, moduleRights: { ...prev.moduleRights, [module]: next } }
    })
  }

  const toggleLoginCompany = (company) => {
    setForm(prev => ({
      ...prev,
      loginCompanies: prev.loginCompanies.includes(company)
        ? prev.loginCompanies.filter(c => c !== company)
        : [...prev.loginCompanies, company],
    }))
  }

  const handleSave = async (ev) => {
    ev.preventDefault()
    setError(''); setSuccess('')
    if (!form.name.trim()) { setError('Employee name is required.'); return }

    const existingEmp = editing ? employees.find(x => x.id === editing) : null
    const alreadyLinked = existingEmp ? linkedUserOf(existingEmp) : null
    const isGrantingNewLogin = isAdmin && form.grantLogin && !alreadyLinked

    if (isGrantingNewLogin) {
      if (!form.email.trim()) { setError('Email is required to grant app login access.'); return }
      if (!form.password || form.password.length < 6) { setError('A temporary password (min 6 characters) is required to grant login access.'); return }
      const dupEmail = appUsers.find(u => (u.email || '').toLowerCase() === form.email.trim().toLowerCase())
      if (dupEmail) { setError(`Email "${form.email}" is already used by ${dupEmail.name || 'another login'}.`); return }
    }

    setSaving(true)
    try {
      const hrPayload = {
        name: form.name, designation: form.designation, department: form.department,
        phone: form.phone, email: form.email, address: form.address,
        emergencyContact: form.emergencyContact, joinDate: form.joinDate,
        salary: Number(form.salary) || 0, active: form.active,
        reportingManagerId: form.reportingManagerId,
        employeeNumber: form.employeeNumber, appointedCompany: form.appointedCompany,
      }
      const loginDepartments = MODULES.filter(m => form.moduleRights[m] && form.moduleRights[m] !== 'none')

      let linkedUserId = alreadyLinked?.id || null

      if (isGrantingNewLogin) {
        const secondaryAuth = getSecondaryAuth()
        const cred = await createUserWithEmailAndPassword(secondaryAuth, form.email, form.password)
        linkedUserId = cred.user.uid
        await signOut(secondaryAuth)
        const profile = {
          name: form.name, email: form.email, role: form.role,
          departments: loginDepartments, moduleRights: form.moduleRights,
          companies: form.loginCompanies, active: true, createdAt: new Date().toISOString(),
        }
        await setDoc(doc(db, 'users', linkedUserId), profile)
        setAppUsers(prev => [...prev, { id: linkedUserId, ...profile }])
        hrPayload.importedFromUserId = linkedUserId
        setSuccess(`Login created — share the email and temporary password with ${form.name} so they can sign in.`)
      } else if (alreadyLinked && isAdmin) {
        // Editing an already-linked login's access rights alongside their HR details.
        const patch = {
          name: form.name, role: form.role, departments: loginDepartments,
          moduleRights: form.moduleRights, companies: form.loginCompanies,
          updatedAt: new Date().toISOString(),
        }
        await updateDoc(doc(db, 'users', alreadyLinked.id), patch)
        setAppUsers(prev => prev.map(u => u.id === alreadyLinked.id ? { ...u, ...patch } : u))
      }

      if (editing) {
        await updateDoc(doc(db, 'hr_employees', editing), { ...hrPayload, updatedAt: new Date().toISOString() })
        setEmployees(prev => prev.map(e => e.id === editing ? { ...e, ...hrPayload } : e))
      } else {
        const newEmp = { ...hrPayload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'hr_employees'), newEmp)
        setEmployees(prev => [...prev, { id: ref.id, ...newEmp }].sort((a, b) => a.name.localeCompare(b.name)))
      }
      setShowForm(false); resetForm()
      invalidatePeopleCache()
    } catch (err) {
      const friendly = err.code === 'auth/email-already-in-use' ? 'That email already has a login.' : err.message
      setError(friendly)
    } finally { setSaving(false) }
  }

  const handleDelete = async (e) => {
    const linked = linkedUserOf(e)
    const warn = linked
      ? `Remove "${e.name}" permanently? They still have an app login (${linked.email}) — this only removes their HR record, not their login. Manage that from the Actions column instead.`
      : `Remove "${e.name}" permanently? This also removes their attendance and leave history.`
    if (!window.confirm(warn)) return
    try {
      await deleteDoc(doc(db, 'hr_employees', e.id))
      setEmployees(prev => prev.filter(x => x.id !== e.id))
      invalidatePeopleCache()
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleResetPassword = async (linked) => {
    if (!linked?.email) return
    if (!window.confirm(`Send a password reset link to ${linked.email}?`)) return
    setError(''); setSuccess('')
    try {
      // Sent from Firebase's own no-reply address — doesn't touch the
      // admin's current session, just triggers an email to the user.
      await sendPasswordResetEmail(auth, linked.email)
      setSuccess(`Reset link sent to ${linked.email}.`)
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleToggleLoginActive = async (linked) => {
    if (!linked) return
    if (linked.id === user?.uid) { setError("You can't disable your own login."); return }
    const nextActive = linked.active === false ? true : false
    if (!nextActive && !window.confirm(`Disable ${linked.name || linked.email}'s login? They'll be signed out immediately.`)) return
    setError('')
    try {
      await updateDoc(doc(db, 'users', linked.id), { active: nextActive, updatedAt: new Date().toISOString() })
      setAppUsers(prev => prev.map(u => u.id === linked.id ? { ...u, active: nextActive } : u))
    } catch (err) { setError('Error: ' + err.message) }
  }

  // Free-plan-safe: the client SDK can only ever delete the *currently
  // signed-in* user's own Auth login, so there's no way to remove someone
  // else's Auth login from the browser without a Cloud Function (paid
  // plan). This removes their Firestore login profile — which immediately
  // signs them out and blocks access — then hands back a one-click
  // reminder to finish deleting the Auth login in Firebase Console (free,
  // ~10 seconds). Their HR record (attendance, salary, org chart position)
  // is untouched — only the login link is cleared.
  const handleDeleteLogin = async (linked, emp) => {
    if (!linked) return
    if (linked.id === user?.uid) { setError("You can't remove your own login."); return }
    if (!window.confirm(`Remove ${linked.name || linked.email}'s app login? They'll be signed out immediately and lose all access. Their HR record stays — only the login is removed. You'll get a reminder to also delete their Auth login from Firebase Console (a free, manual step) right after.`)) return
    setError(''); setSuccess('')
    try {
      await deleteDoc(doc(db, 'users', linked.id))
      setAppUsers(prev => prev.filter(u => u.id !== linked.id))
      if (emp?.id) {
        await updateDoc(doc(db, 'hr_employees', emp.id), { importedFromUserId: null, updatedAt: new Date().toISOString() })
        setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, importedFromUserId: null } : e))
      }
      setSuccess(
        `${linked.name || linked.email}'s login was removed. To finish deleting their Auth login too (free, manual step): `
        + `Firebase Console → Authentication → Users → find "${linked.email}" → delete. UID: ${linked.id}`
      )
    } catch (err) { setError('Error: ' + err.message) }
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const employeesById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees])

  const filtered = employees.filter(e => {
    const q = search.toLowerCase()
    const matchQ = !q || (e.name || '').toLowerCase().includes(q) || (e.designation || '').toLowerCase().includes(q) || (e.phone || '').includes(q)
    const matchDept = !deptFilter || e.department === deptFilter
    return matchQ && matchDept
  })

  const active = filtered.filter(e => e.active !== false)
  const inactive = filtered.filter(e => e.active === false)

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  const editingLinked = editing ? linkedUserOf(employees.find(x => x.id === editing)) : null

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Employees</h2>
          <p className="text-slate-500 text-sm">{employees.filter(e => e.active !== false).length} active · {employees.length} total</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (usersWithoutEmployeeRecord.length > 0 || usersNeedingLinkBackfill.length > 0) && (
            <button onClick={handleImportFromUsers} disabled={importing}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition disabled:opacity-50">
              {importing ? 'Importing…' : `🔗 Import from App Users (${usersWithoutEmployeeRecord.length + usersNeedingLinkBackfill.length})`}
            </button>
          )}
          <button onClick={() => { setShowForm(!showForm); resetForm() }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ Add Employee'}
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, designation, phone..."
          className="flex-1 min-w-48 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setShowForm(false); resetForm() }}>
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/70 p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800">{editing ? 'Edit Employee' : 'Add New Employee'}</h3>
            <button type="button" onClick={() => { setShowForm(false); resetForm() }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
          </div>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} autoComplete="off" className={inp} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Designation</label>
                <input type="text" value={form.designation} onChange={e => set('designation', e.target.value)} autoComplete="off"
                  placeholder="e.g. Sales Rep, Driver" className={inp} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Employee Number</label>
                <input type="text" value={form.employeeNumber} onChange={e => set('employeeNumber', e.target.value)} autoComplete="off"
                  placeholder="e.g. EMP-014" className={inp} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Appointed Company</label>
                <select value={form.appointedCompany} onChange={e => set('appointedCompany', e.target.value)} className={inp}>
                  <option value="">— Select —</option>
                  {COMPANIES.map(c => <option key={c} value={c}>{COMPANY_LABELS[c]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
                <select value={form.department} onChange={e => set('department', e.target.value)} className={inp}>
                  {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reporting Manager</label>
                <select value={form.reportingManagerId} onChange={e => set('reportingManagerId', e.target.value)} className={inp}>
                  <option value="">— None (top of org chart) —</option>
                  {employees.filter(e => e.id !== editing).map(e => (
                    <option key={e.id} value={e.id}>{e.name}{e.designation ? ` — ${e.designation}` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone (Mobile)</label>
                <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} autoComplete="off" className={inp} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email {form.grantLogin && '*'}</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} autoComplete="off"
                  disabled={!!editingLinked} className={`${inp} disabled:bg-slate-100`} />
                {editingLinked && <p className="text-xs text-slate-400 mt-1">Login email can't be changed here once granted.</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Emergency Contact</label>
                <input type="text" value={form.emergencyContact} onChange={e => set('emergencyContact', e.target.value)} autoComplete="off"
                  placeholder="Name & number" className={inp} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                <input type="text" value={form.address} onChange={e => set('address', e.target.value)} autoComplete="off" className={inp} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Joining Date</label>
                <input type="date" value={form.joinDate} onChange={e => set('joinDate', e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Monthly Salary (₹)</label>
                <input type="number" value={form.salary} onChange={e => set('salary', e.target.value)} autoComplete="off" min="0" className={inp} />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} id="emp-active" />
                <label htmlFor="emp-active" className="text-sm text-slate-700">Active employee</label>
              </div>
            </div>

            {/* ── App Login Access — folded in so this one form covers both HR and access-control ── */}
            {isAdmin && (
              <div className="border-t border-slate-200 pt-4">
                {editingLinked ? (
                  <>
                    <h4 className="font-bold text-slate-700 text-sm mb-3">🔐 App Login Access — linked to {editingLinked.email}</h4>
                  </>
                ) : (
                  <label className="flex items-center gap-2 mb-3 cursor-pointer">
                    <input type="checkbox" checked={form.grantLogin} onChange={e => set('grantLogin', e.target.checked)} />
                    <span className="font-bold text-slate-700 text-sm">🔐 Grant login access to this app</span>
                  </label>
                )}

                {(form.grantLogin || editingLinked) && (
                  <div className="space-y-4 pl-1">
                    {!editingLinked && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Temporary Password *</label>
                        <input type="text" value={form.password} onChange={e => set('password', e.target.value)} autoComplete="off"
                          placeholder="Min 6 characters — share this with the user" className={inp} />
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                      <select value={form.role} onChange={e => {
                        const roleId = e.target.value
                        const matched = roles.find(r => r.id === roleId)
                        if (!editingLinked && matched?.departments) {
                          const roleModuleRights = Object.fromEntries(MODULES.map(m => [m, (matched.departments || []).includes(m) ? 'edit' : 'none']))
                          setForm(p => ({ ...p, role: roleId, moduleRights: roleModuleRights }))
                        } else {
                          setForm(p => ({ ...p, role: roleId }))
                        }
                      }} className={inp}>
                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div>
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
                      <p className="text-xs text-slate-400 mt-1.5">Click to cycle: None → View → Edit. Admins get all modules automatically.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Data Access — Companies</label>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {COMPANIES.map(c => (
                          <button type="button" key={c} onClick={() => toggleLoginCompany(c)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${form.loginCompanies.includes(c) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                            {c}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Which company's CRM/Finance data this login can see and create. Separate from "Appointed Company" above.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Employee' : 'Add Employee'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
          </div>
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
                    <th className="text-left px-4 py-3">Emp # / Company</th>
                    <th className="text-left px-4 py-3">Dept / Designation</th>
                    <th className="text-left px-4 py-3">Phone</th>
                    <th className="text-left px-4 py-3">Joined</th>
                    <th className="text-right px-4 py-3">Salary</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map(e => {
                    const linkedUser = linkedUserOf(e)
                    const hasUserAccount = !!linkedUser || (e.email && userEmailSet.has(e.email.toLowerCase()))
                    const isSelf = linkedUser?.id === user?.uid
                    const loginActive = linkedUser ? linkedUser.active !== false : null
                    return (
                    <tr key={e.id} className={e.active === false ? 'opacity-60' : ''}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-slate-800">{e.name}</span>
                          {hasUserAccount && (
                            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-lg font-medium"
                              title={linkedUser ? `Linked to login: ${linkedUser.email}` : 'Has IBS app login (matched by email)'}>
                              👤 App User
                            </span>
                          )}
                          {linkedUser && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-lg font-bold ${loginActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {loginActive ? '● Login Active' : '● Login Disabled'}
                            </span>
                          )}
                        </div>
                        {e.email && <p className="text-xs text-slate-400 mt-0.5">{e.email}</p>}
                        {e.reportingManagerId && employeesById[e.reportingManagerId] && (
                          <p className="text-xs text-slate-400 mt-0.5">↳ Reports to {employeesById[e.reportingManagerId].name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <p className="font-mono text-xs">{e.employeeNumber || '—'}</p>
                        {e.appointedCompany && (
                          <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-lg inline-block mt-1">{COMPANY_LABELS[e.appointedCompany] || e.appointedCompany}</span>
                        )}
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
                        {isAdmin && linkedUser && (
                          <>
                            <button onClick={() => handleResetPassword(linkedUser)} className="text-indigo-600 hover:text-indigo-700 font-medium">🔑 Reset</button>
                            <button onClick={() => handleToggleLoginActive(linkedUser)} disabled={isSelf}
                              title={isSelf ? "You can't disable your own login." : ''}
                              className={`font-medium ${isSelf ? 'text-slate-300 cursor-not-allowed' : loginActive ? 'text-amber-600 hover:text-amber-700' : 'text-green-600 hover:text-green-700'}`}>
                              {loginActive ? '⏸ Disable' : '▶ Enable'}
                            </button>
                            <button onClick={() => handleDeleteLogin(linkedUser, e)} disabled={isSelf}
                              title={isSelf ? "You can't remove your own login." : 'Remove app login — HR record stays'}
                              className={`font-medium ${isSelf ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:text-red-700'}`}>
                              🚫 Login
                            </button>
                          </>
                        )}
                        {isAdmin && <button onClick={() => handleDelete(e)} title="Delete HR record" className="text-red-600 hover:text-red-700 font-medium">🗑️</button>}
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
