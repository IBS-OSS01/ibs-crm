// Inventory (stock) ledger engine — derived, like the GL: nothing is stored except
// the source documents. Movements are collected from
//   • item opening stock (inventory_items.openingStock per godown),
//   • Purchase / Debit Note vouchers and Sales invoices / Credit Notes that carry
//     stockItemId (or an exact SKU) on their lines,
//   • Services stock adjustments / transfers / approved consumption requests,
//   • Finance stock journals (transfer, adjustment, manufacturing),
// then valued chronologically (weighted-average or FIFO per item) to give the
// running quantity/value that the Stock Ledger, Stock Summary and the books use.
//
// Books integration (perpetual): each day's net change in stock value posts
// Dr Stock in Hand (1400) / Cr Stock Adjustment (5010) — so Purchases (5000) minus
// that credit nets to the cost of goods actually sold. Opening stock posts
// against Opening Balance Equity (3200) so it doesn't distort profit.
import { num, r2, normName } from './financeConstants.js'

export const OPENING_DEFAULT_DATE = '2000-04-01'

const pad = (n) => String(n).padStart(2, '0')
// ISO timestamp (UTC) → local calendar date
export const localDate = (iso) => {
  if (!iso) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function itemResolver(stockItems = []) {
  const byId = new Map(), bySku = new Map(), byName = new Map()
  stockItems.filter(i => !i.isService).forEach(i => {   // service / charge items never move stock
    byId.set(i.id, i)
    if (i.sku) bySku.set(String(i.sku).trim().toLowerCase(), i)
    byName.set(normName(i.name || i.itemName), i)
  })
  return {
    byId, bySku,
    // vouchers/invoices: id, then exact SKU only (a free-text description must never silently move stock)
    forLine: (ln) => (ln.stockItemId && byId.get(ln.stockItemId)) || (ln.sku && bySku.get(String(ln.sku).trim().toLowerCase())) || null,
    // Services documents only carry name + sku
    forDoc: (d) => (d.itemId && byId.get(d.itemId)) || (d.sku && bySku.get(String(d.sku).trim().toLowerCase())) || byName.get(normName(d.itemName)) || null,
  }
}

const PRIORITY = { in: 1, set: 2, transfer: 2, out: 3 }
const prio = (m) => (m.kind === 'opening' ? 0 : m.kind === 'mfg_produce' ? 4 : PRIORITY[m.type])   // produced goods are valued after the materials consumed

// ── collect ─────────────────────────────────────────────────────────────────
export function collectMovements({
  stockItems = [], warehouses = [], vouchers = [], invoices = [], adjustments = [], transfers = [], consumption = [], stockJournals = [],
  isAccountingInvoice = () => true, options = {},
} = {}) {
  const { includeServicesReceive = false, includeServices = true } = options
  const res = itemResolver(stockItems)
  const whCompany = Object.fromEntries(warehouses.map(w => [w.id, w.company || 'UIPL']))
  const defaultWh = options.defaultWarehouseId || warehouses[0]?.id || ''
  const whOf = (id) => id || defaultWh
  const out = []
  let seq = 0
  const push = (m) => out.push({ seq: seq++, qty: 0, company: 'UIPL', ...m })

  // opening
  stockItems.forEach(it => {
    const open = it.openingStock || {}
    Object.entries(open).forEach(([whId, o]) => {
      const q = num(o?.qty); if (!q) return
      push({ type: 'in', kind: 'opening', date: it.openingDate || OPENING_DEFAULT_DATE, company: whCompany[whId] || 'UIPL', itemId: it.id, warehouseId: whId, qty: q, rate: num(o.rate), value: r2(q * num(o.rate)), voucherType: 'opening', voucherNo: 'Opening Stock', party: '', source: 'opening', sourceId: it.id })
    })
  })

  // finance vouchers + invoices
  const fromLines = (doc, { kind, voucherType, party, sign, valueMode, dateField = 'date', numberField = 'voucherNumber', src }) => {
    ;(doc.items || []).forEach((ln, idx) => {
      const it = res.forLine(ln); if (!it) return
      const q = num(ln.qty); const taxable = num(ln.taxable ?? (num(ln.qty) * num(ln.rate)))
      if (!q && !taxable) return
      const costTax = doc.itcEligible === false ? num(ln.cgst) + num(ln.sgst) + num(ln.igst) : 0   // blocked credit is part of cost
      push({
        type: sign > 0 ? 'in' : 'out', kind, date: doc[dateField], company: doc.company || 'UIPL', itemId: it.id, warehouseId: whOf(ln.warehouseId || doc.warehouseId), qty: q,
        value: valueMode === 'fixed' ? r2(taxable + (sign > 0 ? costTax : 0)) : undefined, valueMode, voucherType, voucherNo: doc[numberField] || '', party, source: src, sourceId: doc.id, lineIdx: idx,
        poId: doc.purchaseOrderId || '',
      })
    })
  }
  vouchers.forEach(v => {
    if (v.status === 'cancelled' || !v.date) return
    if (v.voucherType === 'purchase') fromLines(v, { kind: 'purchase', voucherType: 'purchase', party: v.partyName, sign: 1, valueMode: 'fixed', src: 'voucher' })
    else if (v.voucherType === 'debit_note') fromLines(v, { kind: 'purchase_return', voucherType: 'debit_note', party: v.partyName, sign: -1, valueMode: 'fixed', src: 'voucher' })
    else if (v.voucherType === 'credit_note') fromLines(v, { kind: 'sales_return', voucherType: 'credit_note', party: v.partyName, sign: 1, valueMode: 'avg', src: 'voucher' })
  })
  invoices.filter(isAccountingInvoice).forEach(inv => {
    if (!inv.invoiceDate) return
    fromLines({ ...inv, date: inv.invoiceDate, voucherNumber: inv.invoiceNumber }, { kind: 'sale', voucherType: 'sales', party: inv.billToName, sign: -1, valueMode: 'avg', src: 'invoice' })
  })

  // Services module
  if (includeServices) {
    adjustments.forEach(a => {
      const it = res.forDoc(a); if (!it) return
      const date = localDate(a.createdAt) || a.date; if (!date) return
      const wh = whOf(a.locationId), q = num(a.qty)
      const base = { date, company: whCompany[wh] || 'UIPL', itemId: it.id, warehouseId: wh, voucherType: 'adjustment', voucherNo: a.invoiceNo || 'Stock adj.', party: a.supplier || '', source: 'adjustment', sourceId: a.id }
      if (a.type === 'receive') {
        if (includeServicesReceive) push({ ...base, type: 'in', kind: 'receipt', qty: q, valueMode: 'avg', voucherType: 'receive', voucherNo: a.invoiceNo || 'Receive' })
      } else if (a.adjustmentType === 'remove') push({ ...base, type: 'out', kind: 'adjustment_out', qty: q, valueMode: 'avg' })
      else if (a.adjustmentType === 'set') push({ ...base, type: 'set', kind: 'adjustment_set', qty: q, valueMode: 'avg' })
      else push({ ...base, type: 'in', kind: 'adjustment_in', qty: q, valueMode: 'avg' })
    })
    transfers.forEach(t => {
      const it = res.forDoc(t); if (!it || t.status === 'cancelled') return
      const date = localDate(t.createdAt) || t.date; if (!date) return
      push({ type: 'transfer', kind: 'transfer', date, company: whCompany[t.fromLocationId] || 'UIPL', itemId: it.id, warehouseId: t.fromLocationId, toWarehouseId: t.toLocationId, qty: num(t.qty), voucherType: 'transfer', voucherNo: 'Transfer', party: '', source: 'transfer', sourceId: t.id })
    })
    consumption.filter(c => c.status === 'approved').forEach(c => {
      const it = res.forDoc(c); if (!it) return
      const date = localDate(c.reviewedAt) || localDate(c.createdAt); if (!date) return
      const wh = whOf(c.locationId)
      push({ type: 'out', kind: 'consumption', date, company: whCompany[wh] || 'UIPL', itemId: it.id, warehouseId: wh, qty: num(c.qty), valueMode: 'avg', voucherType: 'consumption', voucherNo: c.projectName || c.reference || 'Consumption', party: c.requestedByName || '', source: 'consumption', sourceId: c.id })
    })
  }

  // Finance stock journals
  stockJournals.forEach(j => {
    if (j.status === 'cancelled' || !j.date) return
    const base = { date: j.date, company: j.company || 'UIPL', voucherType: 'stock_journal', voucherNo: j.voucherNumber || 'Stock Journal', party: '', source: 'journal', sourceId: j.id }
    if (j.type === 'transfer') {
      ;(j.lines || []).forEach(l => { if (res.byId.get(l.itemId) && num(l.qty)) push({ ...base, type: 'transfer', kind: 'transfer', itemId: l.itemId, warehouseId: l.fromWarehouseId, toWarehouseId: l.toWarehouseId, qty: num(l.qty) }) })
    } else if (j.type === 'adjust') {
      ;(j.lines || []).forEach(l => {
        if (!res.byId.get(l.itemId)) return
        if (l.mode === 'set') push({ ...base, type: 'set', kind: 'adjustment_set', itemId: l.itemId, warehouseId: whOf(l.warehouseId), qty: num(l.qty), valueMode: 'avg' })
        else if (num(l.qty) < 0) push({ ...base, type: 'out', kind: 'adjustment_out', itemId: l.itemId, warehouseId: whOf(l.warehouseId), qty: -num(l.qty), valueMode: 'avg' })
        else if (num(l.qty) > 0) push({ ...base, type: 'in', kind: 'adjustment_in', itemId: l.itemId, warehouseId: whOf(l.warehouseId), qty: num(l.qty), valueMode: num(l.rate) ? 'fixed' : 'avg', value: num(l.rate) ? r2(num(l.qty) * num(l.rate)) : undefined, rate: num(l.rate) })
      })
    } else if (j.type === 'manufacture') {
      const g = `mfg-${j.id}`
      ;(j.consume || []).forEach(l => { if (res.byId.get(l.itemId) && num(l.qty)) push({ ...base, type: 'out', kind: 'mfg_consume', itemId: l.itemId, warehouseId: whOf(l.warehouseId), qty: num(l.qty), valueMode: 'avg', group: g }) })
      ;(j.produce || []).forEach(l => { if (res.byId.get(l.itemId) && num(l.qty)) push({ ...base, type: 'in', kind: 'mfg_produce', itemId: l.itemId, warehouseId: whOf(l.warehouseId), qty: num(l.qty), valueMode: 'group', group: g, weight: num(l.rate) ? num(l.rate) * num(l.qty) : num(l.qty) }) })
    }
  })

  return out.filter(m => m.date).sort((a, b) => a.date.localeCompare(b.date) || (prio(a) - prio(b)) || a.seq - b.seq)
}

// ── valuation ───────────────────────────────────────────────────────────────
export function valueMovements(movements, stockItems = []) {
  const items = Object.fromEntries(stockItems.map(i => [i.id, i]))
  const state = {}      // `${company}|${itemId}` → { qty, value, layers, lastRate, wh: { whId: qty } }
  const st = (company, itemId) => {
    const k = `${company}|${itemId}`
    return (state[k] = state[k] || { company, itemId, qty: 0, value: 0, layers: [], lastRate: num(items[itemId]?.purchaseRate), wh: {} })
  }
  const method = (itemId) => (items[itemId]?.valuationMethod === 'fifo' ? 'fifo' : 'avg')
  const avgRate = (s) => (s.qty > 0.00001 ? s.value / s.qty : s.lastRate)

  const addIn = (s, q, value, itemId) => {
    s.qty += q
    s.value += value
    if (q > 0) { s.lastRate = value / q; if (method(itemId) === 'fifo') s.layers.push({ qty: q, rate: value / q }) }
    else if (value && s.layers.length) {   // value-only adjustment spreads over remaining layers
      const total = s.layers.reduce((a, l) => a + l.qty * l.rate, 0)
      if (total) s.layers.forEach(l => { l.rate = l.rate * (total + value) / total })
    }
  }
  const takeOut = (s, q, itemId) => {
    let value
    if (method(itemId) === 'fifo' && s.layers.length) {
      let need = q; value = 0
      while (need > 0.000001 && s.layers.length) {
        const l = s.layers[0], use = Math.min(l.qty, need)
        value += use * l.rate; l.qty -= use; need -= use
        if (l.qty <= 0.000001) s.layers.shift()
      }
      if (need > 0.000001) value += need * s.lastRate    // negative stock: last known rate
    } else value = q * avgRate(s)
    s.qty -= q; s.value -= value
    if (Math.abs(s.qty) < 0.000001) { s.qty = 0; s.value = 0; s.layers = [] }
    return value
  }

  const result = []
  const groups = {}
  movements.forEach(m => { if (m.group) (groups[m.group] = groups[m.group] || { out: 0 }) })

  movements.forEach(m => {
    const s = st(m.company, m.itemId)
    const r = { ...m, inQty: 0, outQty: 0, inValue: 0, outValue: 0 }
    s.wh[m.warehouseId] = s.wh[m.warehouseId] || 0

    if (m.type === 'transfer') {
      // no value effect: one row leaves the source godown, one arrives at the destination
      s.wh[m.warehouseId] -= m.qty; s.wh[m.toWarehouseId] = (s.wh[m.toWarehouseId] || 0) + m.qty
      const base = { ...r, transfer: true, balQty: r2(s.qty), balValue: r2(s.value), balRate: s.qty > 0.00001 ? r2(s.value / s.qty) : 0 }
      result.push({ ...base, outQty: m.qty, whBalQty: r2(s.wh[m.warehouseId]), counterWarehouseId: m.toWarehouseId })
      result.push({ ...base, warehouseId: m.toWarehouseId, inQty: m.qty, whBalQty: r2(s.wh[m.toWarehouseId]), counterWarehouseId: m.warehouseId, seq: m.seq + 0.5 })
      return
    } else if (m.type === 'set') {
      const delta = m.qty - s.wh[m.warehouseId]
      if (delta > 0) { const v = delta * avgRate(s); addIn(s, delta, v, m.itemId); s.wh[m.warehouseId] += delta; r.inQty = delta; r.inValue = r2(v) }
      else if (delta < 0) { const v = takeOut(s, -delta, m.itemId); s.wh[m.warehouseId] += delta; r.outQty = -delta; r.outValue = r2(v) }
    } else if (m.type === 'in') {
      let value = m.value
      if (m.valueMode === 'group') {
        const siblings = movements.filter(x => x.group === m.group && x.type === 'in')
        const totalW = siblings.reduce((a, x) => a + x.weight, 0) || 1
        value = (groups[m.group].out || 0) * (m.weight / totalW)
      } else if (m.valueMode === 'avg' || value === undefined) value = m.qty * avgRate(s)
      addIn(s, m.qty, value, m.itemId)
      s.wh[m.warehouseId] += m.qty
      r.inQty = m.qty; r.inValue = r2(value)
    } else {   // out
      let value
      if (m.valueMode === 'fixed' && m.value !== undefined && m.qty === 0) {   // rate-difference debit note: value only
        value = m.value; addIn(s, 0, -value, m.itemId)
      } else if (m.valueMode === 'fixed' && m.value !== undefined) {   // purchase return: reverses the stated value
        value = m.value
        s.qty -= m.qty; s.value -= value
        if (method(m.itemId) === 'fifo') { let need = m.qty; while (need > 0.000001 && s.layers.length) { const l = s.layers[s.layers.length - 1], u = Math.min(l.qty, need); l.qty -= u; need -= u; if (l.qty <= 0.000001) s.layers.pop() } }
        if (Math.abs(s.qty) < 0.000001) { s.qty = 0; s.layers = [] }
      } else value = takeOut(s, m.qty, m.itemId)
      s.wh[m.warehouseId] -= m.qty
      r.outQty = m.qty; r.outValue = r2(value)
      if (m.group) groups[m.group].out += value
    }
    r.balQty = r2(s.qty); r.balValue = r2(s.value); r.balRate = s.qty > 0.00001 ? r2(s.value / s.qty) : 0
    r.whBalQty = r2(s.wh[m.warehouseId] || 0)
    result.push(r)
  })

  const summary = Object.values(state).map(s => ({
    company: s.company, itemId: s.itemId, qty: r2(s.qty), value: r2(s.value), rate: s.qty > 0.00001 ? r2(s.value / s.qty) : 0,
    warehouses: Object.fromEntries(Object.entries(s.wh).map(([k, v]) => [k, r2(v)]).filter(([, v]) => v !== 0)), negative: s.qty < -0.00001,
  }))
  return { movements: result, summary }
}

// ── books lines ─────────────────────────────────────────────────────────────
export function deriveStockLines(valued, accounts = []) {
  const name = (code) => accounts.find(a => a.code === code)?.name || code
  const days = {}
  valued.forEach(m => {
    if (m.transfer) return
    const delta = r2(m.inValue - m.outValue)
    if (!delta) return
    const key = `${m.company}|${m.date}|${m.kind === 'opening' ? 'open' : 'move'}`
    days[key] = days[key] || { company: m.company, date: m.date, opening: m.kind === 'opening', delta: 0 }
    days[key].delta = r2(days[key].delta + delta)
  })
  const mk = (d, code, debit, credit) => ({
    accountCode: code, accountName: name(code), debit, credit, date: d.date, company: d.company, companyInferred: false,
    sourceType: 'stock', sourceId: `stock-${d.company}-${d.date}-${d.opening ? 'open' : 'move'}`, sourceDocNumber: d.opening ? 'Opening Stock' : 'Stock valuation',
    description: d.opening ? 'Opening stock value' : 'Net change in stock value (purchases in, sales/consumption out at cost)',
  })
  return Object.values(days).filter(d => d.delta !== 0).flatMap(d => {
    const counter = d.opening ? '3200' : '5010'
    const a = Math.abs(d.delta)
    return d.delta > 0 ? [mk(d, '1400', a, 0), mk(d, counter, 0, a)] : [mk(d, counter, a, 0), mk(d, '1400', 0, a)]
  })
}

// ── convenience ─────────────────────────────────────────────────────────────
export function computeStock(raw, accounts, isAccountingInvoice, options = {}) {
  if (!raw || !(raw.stockItems || []).length) return { movements: [], summary: [], lines: [] }
  const movs = collectMovements({
    stockItems: raw.stockItems, warehouses: raw.warehouses || [], vouchers: raw.vouchers || [], invoices: raw.invoices || [],
    adjustments: raw.stockAdjustments || [], transfers: raw.stockTransfers || [], consumption: raw.consumptionRequests || [],
    stockJournals: (raw.vouchers || []).filter(v => v.voucherType === 'stock_journal'), isAccountingInvoice, options,
  })
  const { movements, summary } = valueMovements(movs, raw.stockItems)
  return { movements, summary, lines: deriveStockLines(movements, accounts) }
}

// Item balance as of a date (qty/value), optionally one godown (qty only).
export function balancesAsOf(movements, { company, asOf, warehouseId } = {}) {
  const last = {}, wh = {}
  movements.forEach(m => {
    if (company && m.company !== company) return
    if (asOf && m.date > asOf) return
    last[m.itemId] = m
    wh[`${m.itemId}|${m.warehouseId}`] = m.whBalQty
  })
  return { last, wh }
}
