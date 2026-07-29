import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const STATUS_COLORS = {
  lead:    'bg-slate-100 text-slate-600',
  project: 'bg-amber-100 text-amber-700',
  service: 'bg-green-100 text-green-700',
}

const STATUS_LABELS = {
  lead:    '🔍 Lead',
  project: '🚧 In Project',
  service: '✅ Service',
}

const SERVICE_FREQ = ['Monthly', 'Bi-monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'On-call']
const today = () => new Date().toISOString().slice(0, 10)

export default function ServiceSites() {
  const { userProfile } = useAuth()
  const isAdmin = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)
  const userCompanies = userProfile?.companies || ['UIPL']
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')       // 'all' | 'project' | 'service'
  const [search, setSearch] = useState('')
  const [editSite, setEditSite] = useState(null)    // site being moved to service
  const [serviceForm, setServiceForm] = useState({
    serviceStartDate: today(), serviceEndDate: '', amcValue: '',
    serviceFrequency: 'Quarterly', notes: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'crm_sites'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      // show only project + service phase sites
      const visible = data.filter(s => {
        const st = s.status || 'lead'
        if (st === 'lead') return false
        const isAdmin_ = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)
        if (!isAdmin_ && s.company && !userCompanies.includes(s.company)) return false
        return true
      })
      visible.sort((a, b) => (a.name || a.siteName || '').localeCompare(b.name || b.siteName || ''))
      setSites(visible)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const openMoveToService = (site) => {
    setEditSite(site)
    setServiceForm({
      serviceStartDate: today(),
      serviceEndDate: '',
      amcValue: site.amcValue || '',
      serviceFrequency: site.serviceFrequency || 'Quarterly',
      notes: site.notes || '',
    })
  }

  const handleMoveToService = async () => {
    if (!editSite) return
    setSaving(true)
    try {
      const upd = {
        status: 'service',
        serviceStartDate: serviceForm.serviceStartDate,
        serviceEndDate: serviceForm.serviceEndDate || null,
        amcValue: Number(serviceForm.amcValue) || 0,
        serviceFrequency: serviceForm.serviceFrequency,
        notes: serviceForm.notes,
        serviceUpdatedAt: new Date().toISOString(),
      }
      await updateDoc(doc(db, 'crm_sites', editSite.id), upd)
      setSites(prev => prev.map(s => s.id === editSite.id ? { ...s, ...upd } : s))
      setEditSite(null)
    } catch (e) { alert('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  const handleMoveBackToProject = async (site) => {
    if (!window.confirm(`Move "${site.name || site.siteName}" back to Project phase?`)) return
    try {
      await updateDoc(doc(db, 'crm_sites', site.id), { status: 'project', updatedAt: new Date().toISOString() })
      setSites(prev => prev.map(s => s.id === site.id ? { ...s, status: 'project' } : s))
    } catch (e) { alert('Error: ' + e.message) }
  }

  const filtered = sites.filter(s => {
    const st = s.status || 'project'
    if (filter !== 'all' && st !== filter) return false
    const q = search.toLowerCase()
    return !q ||
      (s.name || s.siteName || '').toLowerCase().includes(q) ||
      (s.customerName || '').toLowerCase().includes(q) ||
      (s.address || '').toLowerCase().includes(q) ||
      (s.projectNumber || '').toLowerCase().includes(q)
  })

  const serviceSites  = sites.filter(s => s.status === 'service').length
  const projectSites  = sites.filter(s => s.status === 'project').length

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Service Sites</h2>
        <p className="text-slate-500 text-sm">Customer sites in project or active service / AMC phase</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Active Service Sites</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{serviceSites}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Sites in Project Phase</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{projectSites}</p>
        </div>
        <div className="bg-white border border-slate-200/70 rounded-2xl shadow-card p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Total</p>
          <p className="text-2xl font-bold text-slate-700 mt-1">{sites.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search site name, customer, project#…"
          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden">
          {[['all', 'All'], ['project', '🚧 Project'], ['service', '✅ Service']].map(([val, label]) => (
            <button key={val} onClick={() => setFilter(val)}
              className={`px-4 py-2 text-sm font-medium transition ${filter === val ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Move to Service dialog */}
      {editSite && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div>
              <h3 className="font-bold text-slate-800 text-lg">Move to Active Service</h3>
              <p className="text-sm text-slate-500">{editSite.name || editSite.siteName} · {editSite.customerName}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">AMC / Service Start Date</label>
                <input type="date" value={serviceForm.serviceStartDate}
                  onChange={e => setServiceForm(p => ({ ...p, serviceStartDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">AMC End Date <span className="text-slate-400">(optional)</span></label>
                <input type="date" value={serviceForm.serviceEndDate}
                  onChange={e => setServiceForm(p => ({ ...p, serviceEndDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">AMC Value (₹)</label>
                <input type="number" min={0} value={serviceForm.amcValue}
                  onChange={e => setServiceForm(p => ({ ...p, amcValue: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Service Frequency</label>
                <select value={serviceForm.serviceFrequency}
                  onChange={e => setServiceForm(p => ({ ...p, serviceFrequency: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {SERVICE_FREQ.map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea value={serviceForm.notes} onChange={e => setServiceForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm h-16 resize-none focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleMoveToService} disabled={saving}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving…' : '✅ Move to Active Service'}
              </button>
              <button onClick={() => setEditSite(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sites table */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Site Name</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Project #</th>
              <th className="text-left px-4 py-3">Entity</th>
              <th className="text-center px-4 py-3">Phase</th>
              <th className="text-left px-4 py-3">AMC / Service Info</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(s => {
              const st = s.status || 'project'
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{s.name || s.siteName || '—'}</div>
                    {s.address && <div className="text-xs text-slate-400">{s.address}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.customerName || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-blue-700">{s.projectNumber || '—'}</td>
                  <td className="px-4 py-3">
                    {s.company && (
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${s.company === 'UIPL' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {s.company}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${STATUS_COLORS[st] || 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABELS[st] || st}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {st === 'service' ? (
                      <div>
                        <div>{s.serviceFrequency || '—'} service</div>
                        {s.amcValue > 0 && <div>₹{Number(s.amcValue).toLocaleString('en-IN')}/yr</div>}
                        {s.serviceEndDate && <div>Ends: {s.serviceEndDate}</div>}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                    {st === 'project' && (
                      <button onClick={() => openMoveToService(s)}
                        className="text-green-600 hover:text-green-700 font-medium text-xs">
                        ✅ Move to Service
                      </button>
                    )}
                    {st === 'service' && isAdmin && (
                      <button onClick={() => handleMoveBackToProject(s)}
                        className="text-amber-600 hover:text-amber-700 font-medium text-xs">
                        🚧 Back to Project
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-slate-400">
                  {sites.length === 0
                    ? 'No sites in project or service phase yet. Win a CRM opportunity to create a project site.'
                    : 'No sites match your filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
