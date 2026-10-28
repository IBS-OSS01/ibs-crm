import React, { useState, useRef, useEffect } from 'react'
import { collection, addDoc, doc, updateDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/app-config'
import { useAuth } from '../../../context/AuthContext'
import { downloadXlsxTemplate, parseXlsxFile } from '../../../lib/xlsxTemplate'
import { itemKey, makeSkuGenerator, parseImages } from '../utils/spareItems'
import { loadEquipment, saveEquipment, newEquipmentId, eqKey } from '../utils/equipmentMaster'
import { MAX_IMAGES } from '../utils/spareImages'

// Columns of the downloadable template (order + labels). A * marks a required column.
const TEMPLATE_HEADERS = ['Item Name*', 'Specifications and Models', 'Make*', 'Equipment Name*', 'Warehouse*', 'Quantity*', 'Min Stock*', 'Unit', 'Min Stock', 'Images*', 'Remarks']

export function downloadItemsTemplate(warehouses = []) {
  const wh = warehouses[0]?.name || warehouses[0]?.id || 'Central Warehouse'
  const rows = [
    ['Bearing 6205', '6205-2RS, 25 x 52 x 15 mm', 'SKF', 'Conveyor Drive Motor', wh, 120, 10, 'pcs', '', 'https://example.com/bearing-6205.jpg', 'Deep groove ball bearing'],
    ['V-Belt A42', 'A-section, 42 in', 'Gates', 'Cooling Tower Fan', wh, 30, 5, 'pcs', '', 'https://example.com/belt-a42-1.jpg, https://example.com/belt-a42-2.jpg', ''],
  ]
  downloadXlsxTemplate('spare-parts-template.xlsx', TEMPLATE_HEADERS, rows)
}

// Map a raw sheet header to one of our fields, tolerant of case, spacing and the * required mark.
const FIELD_ALIASES = {
  name: ['item name', 'name', 'item'],
  specifications: ['specifications and models', 'specifications', 'specification', 'model', 'models', 'specs'],
  make: ['make', 'brand', 'manufacturer'],
  equipmentName: ['equipment name', 'equipment', 'machine', 'machine name'],
  warehouse: ['warehouse', 'location', 'site', 'store', 'godown'],
  qty: ['quantity', 'qty', 'stock', 'on hand', 'onhand', 'count'],
  minStock: ['min stock', 'min stock level', 'minimum stock', 'reorder level'],
  minStock2: ['min stock (2)'],               // the template has "Min Stock" twice; the 2nd is only used when the 1st is empty
  unit: ['unit', 'uom'],
  images: ['images', 'image', 'photo', 'photos', 'image links', 'picture'],
  remarks: ['remarks', 'remark', 'notes', 'description', 'desc'],
  sku: ['sku', 'part number', 'part no', 'code'],   // not in the template; honoured if a sheet still has it
}
const cleanHeader = (h) => String(h || '').toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim()

function mapRow(row, headers) {
  const findVal = (key) => {
    const alias = FIELD_ALIASES[key].find(a => headers.some(h => cleanHeader(h) === a))
    const header = headers.find(h => cleanHeader(h) === alias)
    return header ? String(row[header] ?? '').trim() : ''
  }
  const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : null }
  const minRaw = findVal('minStock') || findVal('minStock2')
  return {
    name: findVal('name'),
    specifications: findVal('specifications'),
    make: findVal('make'),
    equipmentName: findVal('equipmentName'),
    warehouse: findVal('warehouse'),
    qtyRaw: findVal('qty'), qty: num(findVal('qty')),
    minRaw, minStock: num(minRaw),
    unit: findVal('unit') || 'pcs',
    images: parseImages(findVal('images')),
    remarks: findVal('remarks'),
    sku: findVal('sku'),
  }
}

export default function ItemsImportModal({ existingItems, warehouses = [], existingStocks = [], onClose, onImported }) {
  const { user } = useAuth()
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null) // { headers, rows }
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null) // { created, updated, stocksCreated, stocksUpdated, skipped, errors }
  const fileRef = useRef()
  const [equipment, setEquipment] = useState([])      // the Equipment Master: a new Equipment Name in the sheet is added to it
  useEffect(() => { loadEquipment().then(setEquipment).catch(() => {}) }, [])
  const knownEquipment = new Set(equipment.map(e => eqKey(e.name)))

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

  // The Warehouse cell is free text: match by name first (how people type it), then by id.
  const resolveWarehouse = (raw) => {
    const key = (raw || '').toLowerCase().trim()
    if (!key) return null
    return warehouses.find(w => (w.name || '').toLowerCase().trim() === key)
        || warehouses.find(w => (w.id || '').toLowerCase().trim() === key)
        || null
  }

  // What is wrong with a row (empty = fine). Every column marked * must be filled.
  const problems = (r) => {
    const p = []
    if (!r.name) p.push('Item Name')
    if (!r.make) p.push('Make')
    if (!r.equipmentName) p.push('Equipment Name')
    if (!r.warehouse) p.push('Warehouse'); else if (!resolveWarehouse(r.warehouse)) p.push(`Warehouse "${r.warehouse}" is not set up`)
    if (r.qty === null || r.qty < 0) p.push('Quantity')
    if (r.minStock === null || r.minStock < 0) p.push('Min Stock')
    if (!r.images.length) p.push('Images'); else if (r.images.length > MAX_IMAGES) p.push(`Images (at most ${MAX_IMAGES})`)
    return p
  }

  const mappedAll = parsed ? parsed.rows.map(r => mapRow(r, parsed.headers)) : []
  const preview = mappedAll.slice(0, 8)
  const invalidCount = mappedAll.filter(r => problems(r).length).length

  const existingByKey = new Map(existingItems.map(i => [itemKey(i), i]))
  const existingBySku = new Map(existingItems.filter(i => i.sku).map(i => [String(i.sku).toLowerCase().trim(), i]))
  const findExisting = (r) => (r.sku && existingBySku.get(r.sku.toLowerCase())) || existingByKey.get(itemKey(r))

  const handleImport = async () => {
    if (!mappedAll.length) return
    setImporting(true); setResult(null)
    let created = 0, updated = 0, stocksCreated = 0, stocksUpdated = 0, skipped = 0, errors = 0
    const nextSku = makeSkuGenerator(existingItems)
    const itemByKey = new Map(existingByKey)
    const stockByKey = new Map(existingStocks.filter(s => s.sku && s.locationId).map(s => [`${String(s.sku).toLowerCase().trim()}|${s.locationId}`, s]))
    const now = () => new Date().toISOString()

    // Equipment names the master does not have yet join it (if the master cannot be written the items still keep the name)
    const fresh = new Map()
    for (const r of mappedAll) if (!problems(r).length && !knownEquipment.has(eqKey(r.equipmentName)) && !fresh.has(eqKey(r.equipmentName))) fresh.set(eqKey(r.equipmentName), r)
    if (fresh.size) {
      try {
        const next = [...equipment, ...[...fresh.values()].map(r => ({ id: newEquipmentId(), name: r.equipmentName, make: r.make, model: '', remarks: '' }))]
        await saveEquipment(next); setEquipment(next)
      } catch (e) { console.error('equipment master not updated', e) }
    }

    for (const r of mappedAll) {
      if (problems(r).length) { skipped++; continue }
      const wh = resolveWarehouse(r.warehouse)
      try {
        // ── the item (catalog entry) ──
        const fields = { name: r.name, specifications: r.specifications, make: r.make, equipmentName: r.equipmentName, unit: r.unit, minStock: r.minStock, images: r.images, remarks: r.remarks }
        let match = (r.sku && existingBySku.get(r.sku.toLowerCase())) || itemByKey.get(itemKey(r))
        let sku
        if (match) {
          sku = match.sku
          if (match.id !== 'pending') {
            await updateDoc(doc(db, 'inventory_items', match.id), { ...fields, updatedBy: user.uid, updatedAt: now() })
            updated++
          }
        } else {
          sku = r.sku || nextSku()
          const ref = await addDoc(collection(db, 'inventory_items'), { ...fields, sku, createdBy: user.uid, createdAt: now() })
          itemByKey.set(itemKey(r), { id: 'pending', sku })       // a repeated row in the same file must not create a second item
          created++
        }

        // ── the stock of that item in the warehouse: the Quantity in the sheet REPLACES what is there now ──
        const stockKey = `${String(sku).toLowerCase().trim()}|${wh.id}`
        const stockFields = { itemName: r.name, sku, make: r.make, equipmentName: r.equipmentName, locationId: wh.id, locationName: wh.name || wh.id, qty: r.qty, minStock: r.minStock }
        const stockMatch = stockByKey.get(stockKey)
        if (stockMatch) {
          await updateDoc(doc(db, 'inventory_stocks', stockMatch.id), { ...stockFields, updatedBy: user.uid, updatedAt: now() })
          stocksUpdated++
        } else {
          const ref = await addDoc(collection(db, 'inventory_stocks'), { ...stockFields, createdBy: user.uid, createdAt: now() })
          stockByKey.set(stockKey, { id: ref.id, sku, locationId: wh.id })
          stocksCreated++
        }
      } catch (e) { errors++; console.error(e) }
    }
    setResult({ created, updated, stocksCreated, stocksUpdated, skipped, errors })
    setImporting(false)
    if (created || updated || stocksCreated || stocksUpdated) onImported?.()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">📋 Import Spare Parts from Template</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              One row per spare part and warehouse — adds or updates the item and puts its quantity into that warehouse.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            ⚠️ The <strong>Quantity</strong> column <strong>replaces</strong> the current stock of that item in that warehouse.
            Columns marked <strong>*</strong> must be filled in — rows missing any of them are skipped.
            <strong> Images</strong>: paste the link(s) to the photo(s) (Google Drive / OneDrive / website), separated by commas, at most {MAX_IMAGES} per item. Photos from your computer can be added on the Items Catalog screen (Edit item → Photos).
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
          </div>

          {/* Step 1: get the template */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex items-center justify-between gap-3">
            <div>
              <p className="font-bold mb-0.5">1. Download the Excel template</p>
              <p>Fill it in Excel — one row per spare part and warehouse — then upload it below. New items get their Model Item Code (SP-00001 …) automatically; new Equipment Names are added to the Equipment Master.</p>
            </div>
            <button onClick={() => downloadItemsTemplate(warehouses)}
              className="px-3 py-1.5 bg-white border border-blue-300 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-100 transition whitespace-nowrap">
              ⬇ Download Template (.xlsx)
            </button>
          </div>

          {/* Step 2: upload */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">2. Upload the filled-in file</p>
            <button onClick={() => fileRef.current?.click()}
              className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition">
              📁 {fileName || 'Upload Excel file (.xlsx, .xls)'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            {parseError && <p className="text-xs text-red-600 mt-2">{parseError}</p>}
          </div>

          {/* Preview + import */}
          {parsed && (
            <div>
              <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
                <p className="text-sm font-bold text-slate-700">
                  {parsed.rows.length} rows detected{invalidCount > 0 && <span className="text-red-600"> · {invalidCount} will be skipped</span>} · Preview (first 8):
                </p>
                {result ? (
                  <div className="flex flex-wrap gap-3 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-50 text-green-700">
                    <span>➕ {result.created} items added</span>
                    <span>🔁 {result.updated} items updated</span>
                    <span>📦 {result.stocksCreated} stock added · {result.stocksUpdated} stock updated</span>
                    {result.skipped > 0 && <span className="text-slate-500">⏭ {result.skipped} skipped</span>}
                    {result.errors > 0 && <span className="text-red-600">❌ {result.errors} errors</span>}
                  </div>
                ) : (
                  <button onClick={handleImport} disabled={importing || invalidCount === mappedAll.length}
                    className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                    {importing ? 'Importing…' : `⬆ Import ${mappedAll.length - invalidCount} Rows`}
                  </button>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">Item Name</th>
                      <th className="text-left px-3 py-2">Specifications / Models</th>
                      <th className="text-left px-3 py-2">Make</th>
                      <th className="text-left px-3 py-2">Equipment</th>
                      <th className="text-left px-3 py-2">Warehouse</th>
                      <th className="text-left px-3 py-2">Qty</th>
                      <th className="text-left px-3 py-2">Min</th>
                      <th className="text-left px-3 py-2">Images</th>
                      <th className="text-left px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((row, i) => {
                      const p = problems(row)
                      const willUpdate = !p.length && findExisting(row)
                      return (
                        <tr key={i} className={p.length ? 'bg-red-50/40' : ''}>
                          <td className="px-3 py-2 text-slate-700">{row.name || '—'}</td>
                          <td className="px-3 py-2 text-slate-500">{row.specifications || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{row.make || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{row.equipmentName || '—'}{row.equipmentName && !knownEquipment.has(eqKey(row.equipmentName)) && <span className="ml-1 text-[10px] text-amber-600">new</span>}</td>
                          <td className="px-3 py-2 text-slate-600">{row.warehouse || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{row.qty ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{row.minStock ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{row.images.length ? `🖼 ${row.images.length}` : '—'}</td>
                          <td className="px-3 py-2">
                            {p.length ? <span className="text-red-600">skip — {p.join(', ')}</span>
                              : willUpdate ? <span className="text-blue-600 font-medium">update item + stock</span>
                              : <span className="text-green-600 font-medium">new item + stock</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                An item is recognised by Item Name + Make + Equipment Name + Specifications/Models together: the same combination updates that item, a new one creates it.
                Stock is matched by item + warehouse.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
