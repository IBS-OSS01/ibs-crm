import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function ConsumptionRequests() {
  const { user, userProfile } = useAuth()
  const navigate = useNavigate()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [actionLoading, setActionLoading] = useState(null)
  const isManager = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)

  useEffect(() => { fetchRequests() }, [])

  const fetchRequests = async () => {
    try {
      const snap = await getDocs(collection(db, 'inventory_consumption_requests'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      setRequests(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleAction = async (id, status) => {
    setActionLoading(id + status)
    try {
      await updateDoc(doc(db, 'inventory_consumption_requests', id), {
        status,
        reviewedBy: user.uid,
        reviewedByName: userProfile?.name || user.email,
        reviewedAt: new Date().toISOString(),
      })
      setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
    } catch (err) { alert('Error: ' + err.message) }
    finally { setActionLoading(null) }
  }

  const statusBadge = (s) => {
    const status = s || 'pending'
    if (status === 'approved') return <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-lg text-xs font-bold uppercase">Approved</span>
    if (status === 'rejected') return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold uppercase">Rejected</span>
    return <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold uppercase">Pending</span>
  }

  const formatDate = (d) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
    catch { return d }
  }

  const filtered = requests.filter(r => filter === 'all' || (r.status || 'pending') === filter)

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Consumption Requests</h2>
          <p className="text-slate-500 text-sm">{filtered.length} requests</p>
        </div>
        <button onClick={() => navigate('/services/consumption/new')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          + New Request
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {['all', 'pending', 'approved', 'rejected'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition capitalize
              ${filter === f ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <p className="text-4xl mb-3">📋</p>
            <p>No {filter === 'all' ? '' : filter} requests</p>
            <button onClick={() => navigate('/services/consumption/new')}
              className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
              Raise Request
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Item</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">SKU</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Qty</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Site</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Requested By</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Date</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Status</th>
                {isManager && <th className="px-4 py-3 text-left text-slate-600 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.itemName}
                    {r.reason && <p className="text-xs text-slate-400">{r.reason}</p>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.sku}</td>
                  <td className="px-4 py-3 font-bold">{r.qty}</td>
                  <td className="px-4 py-3 text-slate-600 capitalize">{r.locationId?.split('-')[0] || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.requestedByName}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-3">{statusBadge(r.status)}</td>
                  {isManager && (
                    <td className="px-4 py-3">
                      {(!r.status || r.status === 'pending') && (
                        <div className="flex gap-1">
                          <button onClick={() => handleAction(r.id, 'approved')}
                            disabled={actionLoading === r.id + 'approved'}
                            className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg disabled:opacity-50">
                            ✓ Approve
                          </button>
                          <button onClick={() => handleAction(r.id, 'rejected')}
                            disabled={actionLoading === r.id + 'rejected'}
                            className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg disabled:opacity-50">
                            ✗ Reject
                          </button>
                        </div>
                      )}
                      {r.status && r.status !== 'pending' && (
                        <span className="text-xs text-slate-400">By {r.reviewedByName}</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
