import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'

export default function ReorderConsolidation() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      const snap = await getDocs(collection(db, 'inventory_reorder_consolidations'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setItems(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Reorder Consolidation</h2>
      <p className="text-slate-500 text-sm">Consolidated view of all pending reorder requests across sites</p>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        {items.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <p className="text-4xl mb-3">📋</p>
            <p>No reorder consolidations found</p>
            <p className="text-sm mt-1">Approved spare requests will appear here for consolidated ordering</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Item</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Total Qty</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Sites</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{item.itemName}</td>
                  <td className="px-4 py-3 font-bold">{item.totalQty || item.qty}</td>
                  <td className="px-4 py-3 text-slate-600">{item.sites || item.locationId}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold uppercase">{item.status || 'pending'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
