import React, { useState } from 'react'
import { collection, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const emptyContact = { name: '', phone: '', email: '', designation: '', isPrimary: false }
const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

// Contacts now live in their own top-level 'crm_contacts' collection, each with a
// customerId pointer back to crm_customers. This modal is scoped to one customer:
// `contacts` is the pre-filtered slice for this customer, and `onContactsChange`
// reports the new slice back up so the parent can merge it into its global list.
export default function CustomerContactsModal({ customer, contacts, onClose, onContactsChange }) {
  const { user, userProfile } = useAuth()
  const [form, setForm]       = useState(emptyContact)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const resetForm = () => { setForm(emptyContact); setEditingId(null); setError('') }

  // Unset isPrimary on every other contact for this customer (Firestore has no
  // "only one primary" constraint, so we enforce it with individual updates).
  const unsetOtherPrimaries = async (exceptId) => {
    const others = contacts.filter(c => c.isPrimary && c.id !== exceptId)
    await Promise.all(others.map(c => updateDoc(doc(db, 'crm_contacts', c.id), { isPrimary: false })))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      let updated
      if (editingId) {
        if (form.isPrimary) await unsetOtherPrimaries(editingId)
        await updateDoc(doc(db, 'crm_contacts', editingId), { ...form, updatedAt: new Date().toISOString() })
        updated = contacts.map(c =>
          c.id === editingId ? { ...c, ...form } : form.isPrimary ? { ...c, isPrimary: false } : c
        )
      } else {
        if (form.isPrimary) await unsetOtherPrimaries(null)
        const newContact = {
          ...form,
          customerId:   customer.id,
          customerName: customer.shopName || '',
          addedBy:     user.uid,
          addedByName: userProfile?.name || user.email || '',
          addedAt:     new Date().toISOString(),
        }
        const ref = await addDoc(collection(db, 'crm_contacts'), newContact)
        const withId = { id: ref.id, ...newContact }
        updated = form.isPrimary
          ? [...contacts.map(c => ({ ...c, isPrimary: false })), withId]
          : [...contacts, withId]
      }
      onContactsChange(updated)
      resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleEdit = (c) => {
    setEditingId(c.id)
    setForm({ name: c.name || '', phone: c.phone || '', email: c.email || '', designation: c.designation || '', isPrimary: c.isPrimary || false })
  }

  const handleDelete = async (contactId) => {
    if (!window.confirm('Remove this contact?')) return
    try {
      await deleteDoc(doc(db, 'crm_contacts', contactId))
      onContactsChange(contacts.filter(c => c.id !== contactId))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleSetPrimary = async (contactId) => {
    try {
      await Promise.all(contacts.map(c => updateDoc(doc(db, 'crm_contacts', c.id), { isPrimary: c.id === contactId })))
      onContactsChange(contacts.map(c => ({ ...c, isPrimary: c.id === contactId })))
    } catch (err) { setError('Error: ' + err.message) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Contacts — {customer.shopName}</h2>
            <p className="text-xs text-slate-500">{contacts.length} contact{contacts.length !== 1 ? 's' : ''} on file</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none font-light">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Contact list */}
          {contacts.length > 0 ? (
            <div className="space-y-2">
              {contacts.map(c => (
                <div key={c.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border ${c.isPrimary ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{c.name}</span>
                      {c.isPrimary && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg">★ Primary</span>}
                      {c.designation && <span className="text-xs text-slate-500 italic">{c.designation}</span>}
                    </div>
                    <div className="flex gap-4 mt-1 flex-wrap">
                      {c.phone && <span className="text-xs text-slate-600">📞 {c.phone}</span>}
                      {c.email && <span className="text-xs text-slate-600">✉️ {c.email}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                    {!c.isPrimary && (
                      <button onClick={() => handleSetPrimary(c.id)} title="Set as primary"
                        className="text-xs text-slate-400 hover:text-blue-600 font-medium">★</button>
                    )}
                    <button onClick={() => handleEdit(c)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Edit</button>
                    <button onClick={() => handleDelete(c.id)} className="text-xs text-red-500 hover:text-red-700">✕</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-3">No contacts yet. Add one below.</p>
          )}

          {/* Add / Edit form */}
          <div className="border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-700 text-sm mb-3">{editingId ? 'Edit Contact' : '+ Add Contact'}</h3>
            {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">{error}</div>}
            <form onSubmit={handleSave} className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={lbl}>Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  autoComplete="off" placeholder="e.g. Rajesh Kumar" className={inp} required />
              </div>
              <div>
                <label className={lbl}>Designation / Role</label>
                <input type="text" value={form.designation} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))}
                  autoComplete="off" placeholder="e.g. Purchase Manager" className={inp} />
              </div>
              <div>
                <label className={lbl}>Phone</label>
                <input type="text" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  autoComplete="off" className={inp} />
              </div>
              <div>
                <label className={lbl}>Email</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  autoComplete="off" className={inp} />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" id="isPrimary" checked={form.isPrimary}
                  onChange={e => setForm(p => ({ ...p, isPrimary: e.target.checked }))}
                  className="accent-blue-600 w-4 h-4" />
                <label htmlFor="isPrimary" className="text-sm text-slate-600 cursor-pointer">Primary contact</label>
              </div>
              <div className="col-span-2 flex gap-2 pt-1">
                <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                  {saving ? 'Saving...' : editingId ? 'Update Contact' : 'Add Contact'}
                </button>
                {editingId && (
                  <button type="button" onClick={resetForm}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}
