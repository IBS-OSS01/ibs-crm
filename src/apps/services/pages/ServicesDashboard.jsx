import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'

export default function ServicesDashboard() {
  const [stats, setStats] = useState({ locations: 0, skus: 0, pendingConsumption: 0, pendingSpare: 0 })
  const [recentActivity, setRecentActivity] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    try {
      const [locSnap, itemSnap, conSnap, spareSnap] = await Promise.all([
        getDocs(collection(db, 'inventory_warehouses')),
        getDocs(collection(db, 'inventory_items')),
        getDocs(collection(db, 'inventory_consumption_requests')),
        getDocs(collection(db, 'inventory_spare_requests')),
      ])

      const conDocs = [], spareDocs = []
      conSnap.forEach(d => conDocs.push({ id: d.id, type: 'Consumption', ...d.data() }))
      spareSnap.forEach(d => spareDocs.push({ id: d.id, type: 'Spare', ...d.data() }))

      const pending = conDocs.filter(r => !r.status || r.status === 'pending').length
      const pendingSpare = spareDocs.filter(r => !r.status || r.status === 'pending').length

      setStats({
        locations: locSnap.size,
        skus: itemSnap.size,
        pendingConsumption: pending,
        pendingSpare: pendingSpare,
      })

      // Recent activity - merge and sort
      const all = [...conDocs, ...spareDocs].sort((a, b) => {
        const at = a.createdAt ? new Date(a.createdAt) : new Date(0)
        const bt = b.createdAt ? new Date(b.createdAt) : new Date(0)
        return bt - at
      }).slice(0, 10)
      setRecentActivity(all)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const statusBadge = (status) => {
    const s = status || 'pending'
    if (s === 'approved') return <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-lg text-xs font-bold uppercase">Approved</span>
    if (s === 'rejected') return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold uppercase">Rejected</span>
    return <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold uppercase">Pending</span>
  }

  const formatDate = (d) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
    catch { return d }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading dashboard...</div>

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h2>
        <p className="text-slate-500 text-sm">All sites + Central Warehouse, Pune</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'ACTIVE LOCATIONS', value: stats.locations, color: 'text-slate-800' },
          { label: 'SKUS IN CATALOG', value: stats.skus, color: 'text-slate-800' },
          { label: 'PENDING CONSUMPTION', value: stats.pendingConsumption, color: stats.pendingConsumption > 0 ? 'text-orange-500' : 'text-slate-800' },
          { label: 'PENDING SPARE REQUESTS', value: stats.pendingSpare, color: stats.pendingSpare > 0 ? 'text-orange-500' : 'text-slate-800' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
            <p className="text-xs text-slate-400 font-semibold tracking-wider">{s.label}</p>
            <p className={`text-4xl font-bold mt-2 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Low Stock */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">Low stock across all sites</h3>
          {lowStock.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <p>Nothing below minimum stock level. 🔥</p>
            </div>
          ) : (
            lowStock.map(item => (
              <div key={item.id} className="py-2 border-b border-slate-100 text-sm">{item.name}</div>
            ))
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">Recent activity</h3>
          {recentActivity.length === 0 ? (
            <div className="text-center py-8 text-slate-400">No recent activity</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left py-2 font-medium">TYPE</th>
                    <th className="text-left py-2 font-medium">ITEM</th>
                    <th className="text-left py-2 font-medium">SITE</th>
                    <th className="text-left py-2 font-medium">STATUS</th>
                    <th className="text-left py-2 font-medium">DATE</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-2 text-slate-600">{r.type}</td>
                      <td className="py-2 text-slate-800 font-medium">{r.itemName}</td>
                      <td className="py-2 text-blue-600 capitalize">{r.locationId?.split('-')[0] || '—'}</td>
                      <td className="py-2">{statusBadge(r.status)}</td>
                      <td className="py-2 text-slate-400">{formatDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
