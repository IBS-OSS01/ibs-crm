// Reading an items export (Zoho Books style: ITEM_ID, Name, SKU, Purchase Rate, Rate, Stock On Hand, HSN/SAC, Usage Unit)
// into rows ready to become stock items. Pure functions — the modal does the Firestore writes.
import { num, r2 } from './financeConstants.js'

const ALIASES = {
  zohoId: ['item_id', 'item id', 'itemid'],
  name: ['name', 'item name', 'item'],
  sku: ['sku', 'part number', 'part no', 'code'],
  purchaseRate: ['purchase rate', 'purchase price', 'cost price', 'cost'],
  saleRate: ['rate', 'selling price', 'sales rate', 'sale rate', 'price'],
  description: ['description', 'purchase description', 'notes'],
  purchaseDescription: ['purchase description'],
  stock: ['stock on hand', 'stock', 'quantity', 'qty', 'opening stock'],
  hsn: ['hsn/sac', 'hsn', 'sac', 'hsn code'],
  unit: ['usage unit', 'unit', 'uom'],
}

export const parseMoney = (v) => {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''))     // ₹, $, commas (also lakh grouping), spaces, stray bytes
  return Number.isFinite(n) ? n : 0
}

const UNIT_MAP = { m: 'mtr', mtr: 'mtr', meter: 'mtr', metre: 'mtr', pcs: 'pcs', pc: 'pcs', nos: 'nos', no: 'nos', box: 'box', kg: 'kg', kgs: 'kg', ltr: 'ltr', l: 'ltr', set: 'set', sqft: 'sqft', hrs: 'hours', hours: 'hours', days: 'days', lot: 'lot' }
export const normUnit = (u, isService) => UNIT_MAP[String(u || '').trim().toLowerCase()] || (isService ? 'nos' : 'pcs')

// Service / charge lines are billed but never held in stock: SAC codes start 99 (98 for the "spares under contract" heading),
// and a few words give charges away when no code is present.
const SERVICE_WORDS = /\b(service|services|charges|charge|fee|fees|salaries|salary|expenses|cmc|camc|maintenance|maintenace|subscription|commissioning|logistic|transportation|forwarding|customs duty|engineer)\b/i
export const looksLikeService = ({ name, hsn }) => /^(99|98)/.test(String(hsn || '').trim()) || SERVICE_WORDS.test(name || '')

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

export function parseItemsSheet(matrix) {
  const hIdx = matrix.findIndex(r => r.some(c => ALIASES.name.includes(norm(c))) && r.length > 2)
  if (hIdx < 0) return { rows: [], error: 'Could not find a header row with a Name column.' }
  const head = matrix[hIdx].map(norm)
  const col = (key, skip = []) => { for (const a of ALIASES[key]) { const i = head.indexOf(a); if (i >= 0 && !skip.includes(i)) return i } return -1 }
  const c = { zohoId: col('zohoId'), name: col('name'), sku: col('sku'), purchaseRate: col('purchaseRate'), saleRate: col('saleRate'), description: col('description'), purchaseDescription: col('purchaseDescription'), stock: col('stock'), hsn: col('hsn'), unit: col('unit') }
  const get = (r, i) => (i >= 0 ? r[i] : '')
  const rows = []
  matrix.slice(hIdx + 1).forEach((r, n) => {
    const name = String(get(r, c.name) ?? '').trim()
    if (!name) return
    const hsn = String(get(r, c.hsn) ?? '').trim()
    const isService = looksLikeService({ name, hsn })
    const description = String(get(r, c.description) || get(r, c.purchaseDescription) || '').trim()
    rows.push({
      line: hIdx + n + 2, zohoId: String(get(r, c.zohoId) ?? '').trim(), name, sku: String(get(r, c.sku) ?? '').trim(), hsn, isService,
      unit: normUnit(get(r, c.unit), isService), purchaseRate: r2(parseMoney(get(r, c.purchaseRate))), saleRate: r2(parseMoney(get(r, c.saleRate))),
      stock: isService ? 0 : Math.max(0, num(parseMoney(get(r, c.stock)))), description,
    })
  })
  return { rows }
}

// SKU for rows that have none: traceable to the source system, unique within the file and against what exists.
export function assignSkus(rows, existingSkus = []) {
  const used = new Set(existingSkus.map(s => String(s).toLowerCase()))
  rows.forEach(r => { if (r.sku) used.add(r.sku.toLowerCase()) })
  return rows.map(r => {
    if (r.sku) return r
    let base = r.zohoId ? `ZB-${r.zohoId.slice(-8)}` : `ITM-${String(r.name).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 14)}`
    let sku = base, k = 2
    while (used.has(sku.toLowerCase())) sku = `${base}-${k++}`
    used.add(sku.toLowerCase())
    return { ...r, sku, skuGenerated: true }
  })
}

// Which existing item (if any) is this row? Source-system id first, then SKU, then the exact name.
export function matchExisting(row, items) {
  return items.find(i => row.zohoId && i.zohoItemId === row.zohoId)
    || (row.sku && !row.skuGenerated ? items.find(i => String(i.sku || '').toLowerCase() === row.sku.toLowerCase()) : null)
    || items.find(i => norm(i.name || i.itemName) === norm(row.name))
    || null
}
