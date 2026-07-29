import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

// A Site belongs to a Customer (one customer can have many sites/branches).
// Lifecycle: Lead (prospecting a new site) -> Project (order won, work in
// progress) -> Service Site (handed over, now on AMC/service). "Lost" covers
// leads that didn't convert.
const STATUS = [
  { id: 'lead', label: 'Lead', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  { id: 'project', label: 'Project', cls: 'bg-blue-100 text-blue-700 border-blue-300' },
  { id: 'service', label: 'Service Site', cls: 'bg-green-100 text-green-700 border-green-300' },
  { id: 'lost', label: 'Lost', cls: 'bg-red-100 text-red-700 border-red-300' },
]

const COMPANIES = ['UIPL', 'Wayzim']
const COMPANY_COLORS = { UIPL: 'bg-blue-100 text-blue-700', Wayzim: 'bg-purple-100 text-purple-700' }
const emptyForm = { customerId: '', siteName: '', address: '', contactPerson: '', phone: '', status: 'lead', notes: '', company: 'UIPL' }

export default function Sites() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const userCompanies = userProfile?.companies || ['UIPL']
  const canSelectCompany = isAdmin || userCompanies.length > 1
  const defaultCompany = userCompanies[0] || 'UIPL'
  const [searchParams, setSearchParams] = useSearchParams()
  const customerFilter = searchParams.get('customer') || ''

  const [sites, setSites] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [siteSnap, custSnap] = await Promise.all([
        getDocs(collection(db, 'crm_sites')),
        getDocs(collection(db, 'crm_customers')),
      ])
      const siteData = []
      siteSnap.forEach(d => siteData.push({ id: d.id, ...d.data() }))
      const custData = []
      custSnap.forEach(d => custData.push({ id: d.id, ...d.data() }))
      custData.sort((a, b) => (a.shopName || '').localeCompare(b.shopName || ''))
      siteData.sort((a, b) => (a.siteName || '').localeCompare(b.siteName || ''))
      setSites(siteData)
      // All active customers are available for site assignment regardless of role
      setCustomers(custData.filter(c => c.active !== false))
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm({ ...emptyForm, customerId: customerFilter, company: defaultCompany }); setEditing(null); setError('') }

  const openNewSite = () => {
    const prefillCust = customers.find(c => c.id === customerFilter)
    setForm({ ...emptyForm, customerId: customerFilter, company: prefillCust?.company || defaultCompany })
    setEditing(null)
    setShowForm(true)
  }

  const handleEdit = (s) => {
    setEditing(s.id)
    setForm({
      customerId: s.customerId || '', siteName: s.siteName || '', address: s.address || '',
      contactPerson: s.contactPerson || '', phone: s.phone || '', status: s.status || 'lead', notes: s.notes || '',
      company: s.company || defaultCompany,
    })
    setShowForm(true)
  }

  // Auto-inherit primary company when customer changes
  const handleCustomerChange = (customerId) => {
    const cust = customers.find(c => c.id === customerId)
    const custCompany = cust?.companies?.[0] || cust?.company || defaultCompany
    setForm(p => ({ ...p, customerId, company: custCompany }))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.siteName.trim()) { setError('Site name is required.'); return }
    if (!form.customerId) { setError('Please select a customer.'); return }
    // Duplicate check: same site name under the same customer
    const dupSite = sites.find(s =>
      s.id !== editing &&
      s.customerId === form.customerId &&
      (s.siteName || '').trim().toLowerCase() === form.siteName.trim().toLowerCase()
    )
    if (dupSite) { setError(`Duplicate: "${dupSite.siteName}" already exists for this customer.`); return }
    setSaving(true)
    try {
      const customer = customers.find(c => c.id === form.customerId)
      const payload = { ...form, customerName: customer?.shopName || '', company: form.company || defaultCompany }
      if (editing) {
        await updateDoc(doc(db, 'crm_sites', editing), { ...payload, updatedAt: new Date().toISOString() })
        setSites(prev => prev.map(s => s.id === editing ? { ...s, ...payload } : s))
      } else {
        const newSite = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'crm_sites'), newSite)
        setSites(prev => [...prev, { id: ref.id, ...newSite }])
      }
      setShowForm(false)
      resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (s) => {
    if (!window.confirm(`Delete the site "${s.siteName}"?`)) return
    try {
      await deleteDoc(doc(db, 'crm_sites', s.id))
      setSites(prev => prev.filter(x => x.id !== s.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const setStatus = async (site, status) => {
    if (!site || site.status === status) return
    try {
      await updateDoc(doc(db, 'crm_sites', site.id), { status, updatedAt: new Date().toISOString() })
      setSites(prev => prev.map(s => s.id === site.id ? { ...s, status } : s))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const clearCustomerFilter = () => setSearchParams({})

  const filtered = sites.filter(s => {
    // All CRM users can see and manage all sites — company field is for labelling, not access control
    if (customerFilter && s.customerId !== customerFilter) return false
    if (statusFilter && (s.status || 'lead') !== statusFilter) return false
    const q = search.toLowerCase()
    return !q || (s.siteName || '').toLowerCase().includes(q) || (s.customerName || '').toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q)
  })

  const filteredCustomerName = customerFilter ? customers.find(c => c.id === customerFilter)?.shopName : ''

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Sites</h2>
          <p className="text-slate-500 text-sm">
            {filteredCustomerName ? <>Showing sites for <span className="font-medium text-slate-700">{filteredCustomerName}</span></> : `${sites.length} sites across all customers`}
            {' '}· Lead → Project → Service Site
          </p>
        </div>
        <div className="flex items-center gap-2">
          {filteredCustomerName && (
            <button onClick={clearCustomerFilter} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm rounded-lg transition">
              ✕ Clear filter
            </button>
          )}
          <button onClick={() => { if (showForm) { setShowForm(false) } else { openNewSite() } }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ Add Site'}
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by site name, customer, or address..."
          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All statuses</option>
          {STATUS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Site' : 'Add New Site'}</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Customer *</label>
              <select value={form.customerId} onChange={e => handleCustomerChange(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                <option value="">Select a customer...</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.shopName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Site Name *</label>
              <input type="text" value={form.siteName} onChange={e => setForm(p => ({ ...p, siteName: e.target.value }))} autoComplete="off"
                placeholder="e.g. Hinjewadi Branch"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
              <input type="text" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Site Contact Person</label>
              <input type="text" value={form.contactPerson} onChange={e => setForm(p => ({ ...p, contactPerson: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {STATUS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <input type="text" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {canSelectCompany && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
                <select value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {(isAdmin ? COMPANIES : userCompanies).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <p className="text-xs text-slate-400 mt-1">Auto-set from customer — change only if needed.</p>
              </div>
            )}
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Site' : 'Add Site'}
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
              <th className="text-left px-4 py-3">Site</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Entity</th>
              <th className="text-left px-4 py-3">Address</th>
              <th className="text-left px-4 py-3">Contact</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(s => {
              const st = STATUS.find(x => x.id === (s.status || 'lead')) || STATUS[0]
              return (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{s.siteName}</td>
                  <td className="px-4 py-3 text-slate-600">{s.customerName || '—'}</td>
                  <td className="px-4 py-3">
                    {s.company && <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${COMPANY_COLORS[s.company] || 'bg-slate-100 text-slate-600'}`}>{s.company}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{s.address || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.contactPerson || '—'}{s.phone ? ` · ${s.phone}` : ''}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold border ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {s.status === 'lead' && (
                      <>
                        <button onClick={() => setStatus(s, 'project')} className="text-blue-600 hover:text-blue-700 font-medium text-xs">✔ Won → Project</button>
                        <button onClick={() => setStatus(s, 'lost')} className="text-red-500 hover:text-red-600 font-medium text-xs">✕ Lost</button>
                      </>
                    )}
                    {s.status === 'project' && (
                      <button onClick={() => setStatus(s, 'service')} className="text-green-600 hover:text-green-700 font-medium text-xs">📦 Handed Over → Service</button>
                    )}
                    {s.status === 'lost' && (
                      <button onClick={() => setStatus(s, 'lead')} className="text-slate-500 hover:text-slate-700 font-medium text-xs">↺ Reopen</button>
                    )}
                    <button onClick={() => handleEdit(s)} className="text-blue-600 hover:text-blue-700 font-medium">✏️</button>
                    {isAdmin && (
                      <button onClick={() => handleDelete(s)} className="text-red-600 hover:text-red-700 font-medium">🗑️</button>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">No sites found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
