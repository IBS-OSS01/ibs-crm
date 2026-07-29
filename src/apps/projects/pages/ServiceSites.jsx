import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useNavigate } from 'react-router-dom'

export default function ServiceSites() {
  const navigate = useNavigate()
  const [sites, setSites] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [logForm, setLogForm] = useState({ date: new Date().toISOString().slice(0, 10), type: 'Maintenance', notes: '' })
  const [loggingFor, setLoggingFor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const [siteSnap, logSnap] = await Promise.all([
          getDocs(collection(db, 'crm_sites')),
          getDocs(collection(db, 'project_service_logs')),
        ])
        const s = []; siteSnap.forEach(d => s.push({ id: d.id, ...d.data() }))
        setSites(s.filter(x => x.status === 'service').sort((a, b) => (b.handoverDate || '').localeCompare(a.handoverDate || '')))
        const l = []; logSnap.forEach(d => l.push({ id: d.id, ...d.data() }))
        setLogs(l.sort((a, b) => (b.date || '').localeCompare(a.date || '')))
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const siteLogs = (siteId) => logs.filter(l => l.siteId === siteId)

  const addServiceLog = async (site) => {
    if (!logForm.notes.trim()) { setError('Enter service notes.'); return }
    setSaving(true); setError('')
    try {
      const payload = { siteId: site.id, siteName: site.siteName, customerName: site.customerName || '', ...logForm, createdAt: new Date().toISOString() }
      const ref = await addDoc(collection(db, 'project_service_logs'), payload)
      setLogs(prev => [{ id: ref.id, ...payload }, ...prev])
      setLoggingFor(null)
      setLogForm({ date: new Date().toISOString().slice(0, 10), type: 'Maintenance', notes: '' })
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const reopenAsProject = async (site) => {
    if (!window.confirm(`Reopen "${site.siteName}" as an active project?`)) return
    try {
      await updateDoc(doc(db, 'crm_sites', site.id), { status: 'project', updatedAt: new Date().toISOString() })
      setSites(prev => prev.filter(s => s.id !== site.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const filtered = sites.filter(s => {
    const q = search.toLowerCase()
    return !q || (s.siteName || '').toLowerCase().includes(q) || (s.customerName || '').toLowerCase().includes(q)
  })

  const SERVICE_TYPES = ['Maintenance', 'Complaint', 'Inspection', 'Upgrade', 'Other']

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Service Sites</h2>
          <p className="text-slate-500 text-sm">{sites.length} sites handed over · {logs.length} service logs</p>
        </div>
        <button onClick={() => navigate('/crm/sites')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">CRM → Sites</button>
      </div>

      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search site or customer..."
        className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          No service sites yet. Mark a project as "Handed Over" to move it here.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(s => {
            const sl = siteLogs(s.id)
            const isExpanded = expanded === s.id
            const isLogging = loggingFor === s.id
            return (
              <div key={s.id} className="bg-white rounded-2xl shadow-card border border-slate-200/70">
                <div className="p-4 flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800">{s.siteName}</h3>
                    <p className="text-sm text-slate-500">{s.customerName} {s.address ? `· ${s.address}` : ''}</p>
                    <div className="mt-1 flex gap-4 text-xs text-slate-400 flex-wrap">
                      {s.handoverDate && <span>Handed over: {s.handoverDate}</span>}
                      {s.contactPerson && <span>Contact: {s.contactPerson} {s.phone ? `(${s.phone})` : ''}</span>}
                      <span>{sl.length} service log(s)</span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => setLoggingFor(isLogging ? null : s.id)}
                      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">
                      + Log Service
                    </button>
                    <button onClick={() => setExpanded(isExpanded ? null : s.id)}
                      className="px-3 py-1.5 text-xs border border-slate-300 hover:bg-slate-50 rounded-lg text-slate-600 transition">
                      {isExpanded ? '▲ Hide' : `▼ Logs (${sl.length})`}
                    </button>
                    <button onClick={() => reopenAsProject(s)}
                      className="px-3 py-1.5 text-xs border border-amber-300 hover:bg-amber-50 rounded-lg text-amber-700 transition">
                      ↺ Reopen
                    </button>
                  </div>
                </div>

                {isLogging && (
                  <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                    <h4 className="text-sm font-bold text-slate-700 mb-3">Add Service Log</h4>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                        <input type="date" value={logForm.date} onChange={e => setLogForm(p => ({ ...p, date: e.target.value }))}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                        <select value={logForm.type} onChange={e => setLogForm(p => ({ ...p, type: e.target.value }))}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm">
                          {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="flex items-end">
                        <button onClick={() => addServiceLog(s)} disabled={saving}
                          className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                          {saving ? '...' : 'Save'}
                        </button>
                      </div>
                      <div className="col-span-3">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Notes *</label>
                        <textarea value={logForm.notes} onChange={e => setLogForm(p => ({ ...p, notes: e.target.value }))} rows={2}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm" placeholder="What was done / found / repaired..." />
                      </div>
                    </div>
                  </div>
                )}

                {isExpanded && sl.length > 0 && (
                  <div className="border-t border-slate-100">
                    {sl.map(log => (
                      <div key={log.id} className="px-4 py-2 flex gap-4 text-sm border-b border-slate-50 last:border-0">
                        <span className="text-slate-400 text-xs w-20 flex-shrink-0">{log.date}</span>
                        <span className="px-2 py-0.5 rounded-lg text-xs bg-slate-100 text-slate-600 flex-shrink-0">{log.type}</span>
                        <span className="text-slate-700">{log.notes}</span>
                      </div>
                    ))}
                  </div>
                )}
                {isExpanded && sl.length === 0 && (
                  <div className="px-4 py-3 text-sm text-slate-400 border-t border-slate-100">No service logs yet.</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
