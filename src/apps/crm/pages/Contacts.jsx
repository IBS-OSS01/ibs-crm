import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

// Contacts live in their own top-level 'crm_contacts' collection. Each contact
// carries a customerId (source of truth) plus a denormalized customerName so the
// table and search can avoid an extra lookup per row.
const emptyForm = { name: '', phone: '', email: '', designation: '', isPrimary: false, customerId: '' }
const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

export default function Contacts() {
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const [customers, setCustomers] = useState([])
  const [contacts, setContacts]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [migrating, setMigrating] = useState(false)

  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(emptyForm)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const [search, setSearch]             = useState('')
  const [customerFilter, setCustomerFilter] = useState('all')
  const formRef = useRef(null)

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (showForm) {
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    }
  }, [showForm, editing])

  const load = async () => {
    try {
      const [custSnap, contactSnap] = await Promise.all([
        getDocs(collection(db, 'crm_customers')),
        getDocs(collection(db, 'crm_contacts')),
      ])
      const custData = []
      custSnap.forEach(d => custData.push({ id: d.id, ...d.data() }))
      custData.sort((a, b) => (a.shopName || '').localeCompare(b.shopName || ''))
      setCustomers(custData)

      const contactData = []
      contactSnap.forEach(d => contactData.push({ id: d.id, ...d.data() }))
      contactData.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setContacts(contactData)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  // On-demand pull of the latest data — contacts added or edited by other users.
  const handleRefresh = async () => {
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const unsetOtherPrimaries = async (customerId, exceptId) => {
    const others = contacts.filter(c => c.customerId === customerId && c.isPrimary && c.id !== exceptId)
    await Promise.all(others.map(c => updateDoc(doc(db, 'crm_contacts', c.id), { isPrimary: false })))
  }

  const handleEdit = (c) => {
    setEditing(c.id)
    setForm({
      name: c.name || '', phone: c.phone || '', email: c.email || '',
      designation: c.designation || '', isPrimary: c.isPrimary || false,
      customerId: c.customerId || '',
    })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (!form.customerId) { setError('Please select a customer to link this contact to.'); return }
    const customer = customers.find(c => c.id === form.customerId)
    if (!customer) { setError('Selected customer could not be found.'); return }

    setSaving(true)
    try {
      const { customerId, ...rest } = form
      if (editing) {
        if (form.isPrimary) await unsetOtherPrimaries(customerId, editing)
        await updateDoc(doc(db, 'crm_contacts', editing), {
          ...rest, customerId, customerName: customer.shopName || '',
          updatedAt: new Date().toISOString(),
        })
        setContacts(prev => prev.map(c =>
          c.id === editing
            ? { ...c, ...rest, customerId, customerName: customer.shopName || '' }
            : (form.isPrimary && c.customerId === customerId ? { ...c, isPrimary: false } : c)
        ))
      } else {
        if (form.isPrimary) await unsetOtherPrimaries(customerId, null)
        const newContact = {
          ...rest, customerId, customerName: customer.shopName || '',
          addedBy: user.uid, addedByName: userProfile?.name || user.email || '',
          addedAt: new Date().toISOString(),
        }
        const ref = await addDoc(collection(db, 'crm_contacts'), newContact)
        setContacts(prev => [
          ...prev.map(c => (form.isPrimary && c.customerId === customerId ? { ...c, isPrimary: false } : c)),
          { id: ref.id, ...newContact },
        ])
      }
      setShowForm(false)
      resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (c) => {
    if (!window.confirm(`Remove contact "${c.name}"?`)) return
    try {
      await deleteDoc(doc(db, 'crm_contacts', c.id))
      setContacts(prev => prev.filter(x => x.id !== c.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleSetPrimary = async (c) => {
    try {
      const siblings = contacts.filter(x => x.customerId === c.customerId)
      await Promise.all(siblings.map(x => updateDoc(doc(db, 'crm_contacts', x.id), { isPrimary: x.id === c.id })))
      setContacts(prev => prev.map(x => x.customerId === c.customerId ? { ...x, isPrimary: x.id === c.id } : x))
    } catch (err) { setError('Error: ' + err.message) }
  }

  // One-time (safe to re-run) migration of legacy contacts embedded as
  // crm_customers.{id}.contacts[] into standalone crm_contacts docs.
  const handleMigrateLegacy = async () => {
    if (!window.confirm('Migrate any legacy contacts still embedded on customer records into the Contacts collection? Safe to run more than once.')) return
    setMigrating(true)
    try {
      const custSnap = await getDocs(collection(db, 'crm_customers'))
      let migrated = 0
      for (const docSnap of custSnap.docs) {
        const cust = { id: docSnap.id, ...docSnap.data() }
        const legacy = cust.contacts || []
        if (legacy.length === 0) continue
        for (const lc of legacy) {
          await addDoc(collection(db, 'crm_contacts'), {
            name: lc.name || '', phone: lc.phone || '', email: lc.email || '',
            designation: lc.designation || '', isPrimary: !!lc.isPrimary,
            customerId: cust.id, customerName: cust.shopName || '',
            addedBy: lc.addedBy || user.uid,
            addedByName: lc.addedByName || userProfile?.name || user.email || '',
            addedAt: lc.addedAt || new Date().toISOString(),
          })
          migrated++
        }
        await updateDoc(doc(db, 'crm_customers', cust.id), { contacts: deleteField() })
      }
      alert(migrated > 0 ? `Migrated ${migrated} contact(s).` : 'No legacy contacts found — nothing to migrate.')
      await load()
    } catch (err) { alert('Migration error: ' + err.message) }
    finally { setMigrating(false) }
  }

  const filtered = contacts.filter(c => {
    if (customerFilter !== 'all' && c.customerId !== customerFilter) return false
    const q = search.toLowerCase()
    return !q
      || (c.name || '').toLowerCase().includes(q)
      || (c.customerName || '').toLowerCase().includes(q)
      || (c.phone || '').toLowerCase().includes(q)
      || (c.email || '').toLowerCase().includes(q)
      || (c.designation || '').toLowerCase().includes(q)
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Contacts</h2>
          <p className="text-slate-500 text-sm">{contacts.length} contact{contacts.length !== 1 ? 's' : ''} across {customers.length} customers</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRefresh} disabled={refreshing}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition disabled:opacity-50"
            title="Pull the latest contact changes from other users">
            {refreshing ? '⏳ Refreshing…' : '🔄 Refresh'}
          </button>
          {isAdmin && (
            <button onClick={handleMigrateLegacy} disabled={migrating}
              title="One-time move of any contacts still embedded on customer records into this collection"
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition disabled:opacity-50">
              {migrating ? '⏳ Migrating…' : '↻ Migrate legacy contacts'}
            </button>
          )}
          <button onClick={() => { setShowForm(!showForm); resetForm() }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ Add Contact'}
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, customer, phone, or email..."
          className="flex-1 min-w-[220px] px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-64">
          <option value="all">All customers</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.shopName}</option>)}
        </select>
      </div>

      {showForm && (
        <div ref={formRef} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Contact' : 'Add New Contact'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={lbl}>Customer *</label>
              <select value={form.customerId} onChange={e => setForm(p => ({ ...p, customerId: e.target.value }))}
                className={inp} required>
                <option value="">— select an existing customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.shopName}</option>)}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                Don't see the customer? <button type="button" onClick={() => navigate('/crm/customers')} className="text-blue-600 hover:underline">Add them on the Customers tab</button> first, then come back here.
              </p>
            </div>
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
              <input type="checkbox" id="contact-primary" checked={form.isPrimary}
                onChange={e => setForm(p => ({ ...p, isPrimary: e.target.checked }))}
                className="accent-blue-600 w-4 h-4" />
              <label htmlFor="contact-primary" className="text-sm text-slate-600 cursor-pointer">Primary contact for this customer</label>
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Contact' : 'Add Contact'}
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
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Designation</th>
              <th className="text-left px-4 py-3">Phone</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Primary</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(c => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-3">
                  <button onClick={() => navigate(`/crm/customers?search=${encodeURIComponent(c.customerName || '')}`)}
                    className="text-indigo-600 hover:text-indigo-800 hover:underline">
                    {c.customerName || '—'}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-500 italic">{c.designation || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.phone || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.email || '—'}</td>
                <td className="px-4 py-3">
                  {c.isPrimary ? (
                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg">★ Primary</span>
                  ) : (
                    <button onClick={() => handleSetPrimary(c)} className="text-xs text-slate-400 hover:text-blue-600 font-medium">Set primary</button>
                  )}
                </td>
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  <button onClick={() => handleEdit(c)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                  <button onClick={() => handleDelete(c)} className="text-red-600 hover:text-red-700 font-medium">🗑️ Delete</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">No contacts found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
