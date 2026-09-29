import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import StockImportModal from './StockImportModal'

export default function StockLevels() {
  const { userProfile } = useAuth()
  const [stocks, setStocks] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [selectedWarehouse, setSelectedWarehouse] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const isManager = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    try {
      const [whSnap, itemSnap, stockSnap] = await Promise.all([
        getDocs(collection(db, 'inventory_warehouses')),
        getDocs(collection(db, 'inventory_items')),
        getDocs(collection(db, 'inventory_stocks')),
      ])
      const whs = [], itms = [], stks = []
      whSnap.forEach(d => whs.push({ id: d.id, ...d.data() }))
      itemSnap.forEach(d => itms.push({ id: d.id, ...d.data() }))
      stockSnap.forEach(d => stks.push({ id: d.id, ...d.data() }))
      setWarehouses(whs)
      setItems(itms)
      setStocks(stks)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const warehouseName = (id) => warehouses.find(w => w.id === id)?.name || id || '—'

  const filtered = stocks.filter(s => {
    const matchWh = selectedWarehouse === 'all' || s.locationId === selectedWarehouse
    const matchSearch = !search || s.itemName?.toLowerCase().includes(search.toLowerCase()) || s.sku?.toLowerCase().includes(search.toLowerCase())
    return matchWh && matchSearch
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading stock levels...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Stock Levels</h2>
          <p className="text-slate-500 text-sm">{filtered.length} items</p>
        </div>
        {isManager && (
          <button onClick={() => setShowImport(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            ⬆ Bulk Upload Stock
          </button>
        )}
      </div>

      {showImport && (
        <StockImportModal
          warehouses={warehouses}
          existingItems={items}
          existingStocks={stocks}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); fetchAll() }}
        />
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search item or SKU..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        />
        <select
          value={selectedWarehouse}
          onChange={e => setSelectedWarehouse(e.target.value)}
          className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Locations</option>
          {warehouses.map(wh => (
            <option key={wh.id} value={wh.id}>{wh.name || wh.id}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <p className="text-4xl mb-3">📦</p>
            <p>No stock records found</p>
            <p className="text-sm mt-1">Add items to the catalog and receive stock to see levels here</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Item</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">SKU</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Location</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Qty</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Min Stock</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.itemName || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.sku || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{warehouseName(s.locationId)}</td>
                  <td className="px-4 py-3 font-bold text-slate-800">{s.qty ?? 0}</td>
                  <td className="px-4 py-3 text-slate-500">{s.minStock ?? '—'}</td>
                  <td className="px-4 py-3">
                    {s.minStock && s.qty < s.minStock
                      ? <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold">LOW STOCK</span>
                      : <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-lg text-xs font-bold">OK</span>}
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
