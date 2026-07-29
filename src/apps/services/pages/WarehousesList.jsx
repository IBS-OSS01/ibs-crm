import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'

export default function WarehousesList() {
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchWarehouses()
  }, [])

  const fetchWarehouses = async () => {
    try {
      const snap = await getDocs(collection(db, 'inventory_warehouses'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setWarehouses(data)
    } catch (err) {
      console.error('Error fetching warehouses:', err)
    } finally {
      setLoading(false)
    }
  }

  const locationLabel = (id) => {
    const map = {
      'central-pune': 'Central Warehouse',
      'medchal-hyderabad': 'Medchal',
      'saidham-mumbai': 'Saidham',
      'delu-delhi': 'Delu',
    }
    return map[id] || id
  }

  const cityLabel = (id) => {
    if (id?.includes('pune')) return '📍 Pune'
    if (id?.includes('hyderabad')) return '📍 Hyderabad'
    if (id?.includes('mumbai')) return '📍 Mumbai'
    if (id?.includes('delhi')) return '📍 Delhi'
    return '📍 India'
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="text-slate-500">Loading warehouses...</div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Warehouses</h2>
        <p className="text-slate-500 text-sm">{warehouses.length} active locations</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {warehouses.map((wh) => (
          <div key={wh.id} className="bg-white rounded-xl shadow p-6 border border-slate-200 hover:border-blue-300 transition">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-800 text-lg">
                  {wh.name || locationLabel(wh.id)}
                </h3>
                <p className="text-slate-500 text-sm">{cityLabel(wh.id)}</p>
              </div>
              <span className="text-3xl">🏭</span>
            </div>

            <div className="space-y-2 text-sm text-slate-600">
              {wh.address && <p>📌 {wh.address}</p>}
              {wh.manager && <p>👤 Manager: {wh.manager}</p>}
              {wh.phone && <p>📞 {wh.phone}</p>}
              <p className="text-xs text-slate-400 mt-3">ID: {wh.id}</p>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className={`px-2 py-1 rounded-lg text-xs font-medium ${wh.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {wh.active !== false ? '● Active' : '● Inactive'}
              </span>
            </div>
          </div>
        ))}

        {warehouses.length === 0 && (
          <div className="col-span-2 text-center py-12 text-slate-400">
            No warehouses found. Data may still be loading.
          </div>
        )}
      </div>
    </div>
  )
}
