import React, { useState, useRef } from 'react'
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { downloadXlsxTemplate, parseXlsxFile } from '../../../lib/xlsxTemplate'

// Columns must match the downloadable template exactly (order + labels).
const TEMPLATE_HEADERS = ['Item Name', 'SKU', 'Warehouse', 'Quantity', 'Unit', 'Min Stock', 'Description']

export function downloadStockTemplate(warehouses = []) {
  const wh1 = warehouses[0]?.name || warehouses[0]?.id || 'Central Warehouse'
  const wh2 = warehouses[1]?.name || warehouses[1]?.id || wh1
  const rows = [
    ['Bearing 6205', 'BRG-6205', wh1, 120, 'pcs', 10, 'Deep groove ball bearing'],
    ['V-Belt A42',   'BELT-A42', wh2, 30,  'pcs', 5,  'Standard V-belt'],
  ]
  downloadXlsxTemplate('stock-upload-template.xlsx', TEMPLATE_HEADERS, rows)
}

const FIELD_ALIASES = {
  name: ['item name', 'name', 'item'],
  sku: ['sku', 'part number', 'part no', 'code'],
  warehouse: ['warehouse', 'location', 'site', 'store', 'godown'],
  qty: ['quantity', 'qty', 'stock', 'on hand', 'onhand', 'count'],
  unit: ['unit', 'uom'],
  minStock: ['min stock', 'min stock level', 'minimum stock', 'reorder level'],
  description: ['description', 'desc', 'notes'],
}

function mapRow(row, headers) {
  const findVal = (key) => {
    const alias = FIELD_ALIASES[key].find(a => headers.some(h => h.toLowerCase().trim() === a))
    const header = headers.find(h => h.toLowerCase().trim() === alias)
    return header ? row[header] : ''
  }
  return {
    name: findVal('name'),
    sku: findVal('sku'),
    warehouse: findVal('warehouse'),
    unit: findVal('unit') || 'pcs',
    qty: findVal('qty'),
    minStock: findVal('minStock'),
    description: findVal('description'),
  }
}

export default function StockImportModal({ warehouses, existingItems, existingStocks, onClose, onImported }) {
  const { user } = useAuth()
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null) // { itemsCreated, stocksUpdated, stocksCreated, skipped, errors }
  const fileRef = useRef()

  const handleFile = async (e) => {
    const f = e.target.files[0]; if (!f) return
    setFileName(f.name)
    setResult(null)
    setParseError('')
    try {
      const p = await parseXlsxFile(f)
      setParsed(p)
    } catch (err) {
      setParsed(null)
      setParseError('Could not read that file. Make sure it\'s a valid .xlsx/.xls exported from the template.')
    }
  }

  // Resolve free-text "Warehouse" cell to a real warehouse id — match by
  // name first (how people will actually type it), fall back to id.
  const resolveWarehouse = (raw) => {
    const key = (raw || '').toLowerCase().trim()
    if (!key) return null
    return warehouses.find(w => (w.name || '').toLowerCase().trim() === key)
        || warehouses.find(w => (w.id || '').toLowerCase().trim() === key)
        || null
  }

  const preview = parsed ? parsed.rows.slice(0, 8).map(r => mapRow(r, parsed.headers)) : []

  const existingItemsBySku = new Map(
    existingItems.filter(i => i.sku).map(i => [String(i.sku).toLowerCase().trim(), i])
  )
  // Keyed by "sku|locationId" since one upload can now span multiple warehouses.
  const existingStocksByKey = new Map(
    existingStocks.filter(s => s.sku && s.locationId).map(s => [`${String(s.sku).toLowerCase().trim()}|${s.locationId}`, s])
  )

  const handleImport = async () => {
    if (!parsed?.rows?.length) return
    setImporting(true); setResult(null)
    let itemsCreated = 0, stocksUpdated = 0, stocksCreated = 0, skipped = 0, errors = 0

    for (const raw of parsed.rows) {
      const mapped = mapRow(raw, parsed.headers)
      const name = mapped.name?.trim()
      const sku = mapped.sku?.trim()
      const wh = resolveWarehouse(mapped.warehouse)
      if (!name || !sku || !wh) { skipped++; continue }
      const qty = parseInt(mapped.qty) || 0
      const minStock = parseInt(mapped.minStock) || 0
      const skuKey = sku.toLowerCase()
      const stockKey = `${skuKey}|${wh.id}`

      try {
        // Create the catalog item if it doesn't exist yet. Existing catalog
        // entries are left untouched — this import manages stock, not the
        // item master.
        if (!existingItemsBySku.has(skuKey)) {
          await addDoc(collection(db, 'inventory_items'), {
            name, sku, unit: mapped.unit || 'pcs', minStock, description: mapped.description || '',
            createdBy: user.uid, createdAt: new Date().toISOString(),
          })
          existingItemsBySku.set(skuKey, { id: 'pending', sku })
          itemsCreated++
        }

        // Quantity in the file REPLACES the current on-hand quantity for
        // this item at its warehouse (stock-take / opening balance).
        const stockMatch = existingStocksByKey.get(stockKey)
        if (stockMatch) {
          await updateDoc(doc(db, 'inventory_stocks', stockMatch.id), {
            itemName: name, sku, locationId: wh.id, locationName: wh.name || wh.id, qty, minStock,
            updatedBy: user.uid, updatedAt: new Date().toISOString(),
          })
          stocksUpdated++
        } else {
          const ref = await addDoc(collection(db, 'inventory_stocks'), {
            itemName: name, sku, locationId: wh.id, locationName: wh.name || wh.id, qty, minStock,
            createdBy: user.uid, createdAt: new Date().toISOString(),
          })
          existingStocksByKey.set(stockKey, { id: ref.id, sku, locationId: wh.id })
          stocksCreated++
        }
      } catch (e) { errors++; console.error(e) }
    }
    setResult({ itemsCreated, stocksUpdated, stocksCreated, skipped, errors })
    setImporting(false)
    if (stocksUpdated > 0 || stocksCreated > 0) onImported?.()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">📦 Bulk Upload Stock</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Upload a stock master list — each row's Warehouse column decides which warehouse gets updated.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            ⚠️ The <strong>Quantity</strong> column <strong>replaces</strong> the current stock count for each item at its
            warehouse — use this for a physical stock take / opening balance, not for logging a single delivery on top
            of existing stock.
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Valid warehouse names</p>
            {warehouses.length === 0 ? (
              <p className="text-xs text-red-600">No warehouses set up yet — add one under Services → Warehouses first.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {warehouses.map(wh => (
                  <span key={wh.id} className="px-2 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-mono">{wh.name || wh.id}</span>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-400 mt-1">Type the Warehouse cell exactly as one of these names (not case-sensitive).</p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex items-center justify-between gap-3">
            <div>
              <p className="font-bold mb-0.5">1. Download the Excel template</p>
              <p>Pre-filled with your real warehouse names. Fill it in Excel, then upload it below.</p>
            </div>
            <button onClick={() => downloadStockTemplate(warehouses)}
              className="px-3 py-1.5 bg-white border border-blue-300 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-100 transition whitespace-nowrap">
              ⬇ Download Template (.xlsx)
            </button>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">2. Upload the filled-in file</p>
            <button onClick={() => fileRef.current?.click()}
              className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition">
              📁 {fileName || 'Upload Excel file (.xlsx, .xls)'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            {parseError && <p className="text-xs text-red-600 mt-2">{parseError}</p>}
          </div>

          {parsed && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-slate-700">{parsed.rows.length} rows detected · Preview (first 8):</p>
                {result ? (
                  <div className="flex flex-wrap gap-3 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-50 text-green-700">
                    <span>📦 {result.stocksUpdated} stock updated</span>
                    <span>➕ {result.stocksCreated} stock added</span>
                    {result.itemsCreated > 0 && <span>🗂️ {result.itemsCreated} new catalog items</span>}
                    {result.skipped > 0 && <span className="text-slate-500">⏭ {result.skipped} skipped</span>}
                    {result.errors > 0 && <span className="text-red-600">❌ {result.errors} errors</span>}
                  </div>
                ) : (
                  <button onClick={handleImport} disabled={importing}
                    className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                    {importing ? 'Importing…' : `⬆ Import ${parsed.rows.length} Rows`}
                  </button>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">Item Name</th>
                      <th className="text-left px-3 py-2">SKU</th>
                      <th className="text-left px-3 py-2">Warehouse</th>
                      <th className="text-left px-3 py-2">Qty</th>
                      <th className="text-left px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((row, i) => {
                      const wh = resolveWarehouse(row.warehouse)
                      const skuKey = row.sku?.toLowerCase()
                      const invalid = !row.name || !row.sku || !wh
                      const stockExists = wh && skuKey && existingStocksByKey.has(`${skuKey}|${wh.id}`)
                      const itemExists = skuKey && existingItemsBySku.has(skuKey)
                      return (
                        <tr key={i} className={invalid ? 'opacity-40 line-through' : ''}>
                          <td className="px-3 py-2 text-slate-700">{row.name || '—'}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{row.sku || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {row.warehouse ? (wh ? (wh.name || wh.id) : <span className="text-red-500">{row.warehouse} (unknown)</span>) : '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{row.qty || 0}</td>
                          <td className="px-3 py-2">
                            {invalid ? <span className="text-slate-400">skip</span>
                              : <span className={stockExists ? 'text-blue-600 font-medium' : 'text-green-600 font-medium'}>
                                  {stockExists ? 'update stock' : 'new stock'}{!itemExists ? ' · new item' : ''}
                                </span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Rows are matched by SKU + Warehouse. New SKUs create a catalog item automatically. Rows missing Item Name,
                SKU, or with an unrecognized Warehouse are skipped.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
