/**
 * RequestUserModal — "I need this person added to the system" form.
 *
 * Any team member can open this (typically via UserSelector's "Can't find
 * them?" action) when the person they need isn't in the users cache yet.
 * It captures a full profile, NOT just a name, so the admin doesn't have to
 * re-interview the requester later.
 *
 * Writes one doc to `team_member_requests` with status: 'pending'.
 * Company is intentionally NOT shown here — it's fixed to 'Wayzim' by
 * default, and only becomes editable on the admin's approval screen.
 *
 * Props
 * ─────
 * initialName   {string}  Prefill for the name field (e.g. what they typed into search)
 * dealId        {string}  Optional — the opportunity that prompted this request
 * dealTitle     {string}  Optional — for display/context on the admin side
 * onClose       {fn}      Called with no args to dismiss
 * onSubmitted   {fn}      Called after a successful save
 */

import React, { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

// System-wide roles a requester may suggest. 'admin' is deliberately excluded —
// admin accounts should only ever be created directly by an existing admin.
export const REQUESTABLE_ROLES = [
  { value: 'sales_manager',        label: 'Sales Manager' },
  { value: 'sales_director',       label: 'Sales Director' },
  { value: 'sales_engineer',       label: 'Sales Engineer' },
  { value: 'sales_assistant',      label: 'Sales Assistant' },
  { value: 'project_manager',      label: 'Project Manager' },
  { value: 'solution_manager',     label: 'Solution Manager' },
  { value: 'bid_coordinator',      label: 'Bid Coordinator' },
  { value: 'service_engineer',     label: 'Service Engineer' },
  { value: 'inventory_warehouses', label: 'Warehouse / Inventory' },
  { value: 'accounts',             label: 'Accounts' },
  { value: 'hr',                   label: 'HR' },
]

const DEFAULT_COMPANY = 'Wayzim'   // hidden here; admin can change it before approving

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

const emptyForm = { name: '', email: '', phone: '', department: '', role: '', reason: '' }

export default function RequestUserModal({ initialName = '', dealId = '', dealTitle = '', onClose, onSubmitted }) {
  const { user, userProfile } = useAuth()
  const [form, setForm]     = useState({ ...emptyForm, name: initialName })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [done, setDone]     = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim())  { setError('Name is required.'); return }
    if (!form.role)         { setError('Please select the role this person should have.'); return }
    setSaving(true); setError('')
    try {
      await addDoc(collection(db, 'team_member_requests'), {
        name:       form.name.trim(),
        email:      form.email.trim(),
        phone:      form.phone.trim(),
        department: form.department.trim(),
        role:       form.role,
        reason:     form.reason.trim(),
        company:    DEFAULT_COMPANY,   // requester never sets this — admin can change on approval
        dealId, dealTitle,
        requestedBy:     user?.uid || '',
        requestedByName: userProfile?.name || user?.email || '',
        status:    'pending',
        createdAt: new Date().toISOString(),
      })
      setDone(true)
      onSubmitted?.()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-800">
            {done ? 'Request Sent' : 'Request to Add Team Member'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none font-light">×</button>
        </div>

        {done ? (
          <div className="p-6 text-center space-y-3">
            <p className="text-3xl">✅</p>
            <p className="text-sm text-slate-600">
              Sent to your admin for approval. Once approved, {form.name.split(' ')[0] || 'they'} will show up
              in search right away.
            </p>
            <button onClick={onClose}
              className="mt-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            {dealTitle && (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Requested for opportunity: <span className="font-medium text-slate-700">{dealTitle}</span>
              </p>
            )}
            {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">{error}</div>}

            <div>
              <label className={lbl}>Full Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                autoComplete="off" placeholder="e.g. Priya Sharma" className={inp} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Email</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  autoComplete="off" className={inp} />
              </div>
              <div>
                <label className={lbl}>Phone</label>
                <input type="text" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  autoComplete="off" className={inp} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Role *</label>
                <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} className={inp} required>
                  <option value="">— select —</option>
                  {REQUESTABLE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Department</label>
                <input type="text" value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))}
                  autoComplete="off" placeholder="e.g. Sales" className={inp} />
              </div>
            </div>
            <div>
              <label className={lbl}>Why do you need them added? (optional)</label>
              <textarea value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                rows={2} className={inp} placeholder="A short note helps admin approve faster" />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Sending...' : 'Send Request'}
              </button>
              <button type="button" onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
