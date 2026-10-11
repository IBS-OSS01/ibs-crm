// Sales invoices exported from Zoho Books ("Invoice" CSV, one row per line item) → invoice documents for finance_invoices,
// plus the matching of bank receipts (already in the books "on account") to those invoices.
// Pure functions — the import dialog does the Firestore writes.
import { INDIA_STATES } from './indiaConstants.js'
import { normUnit } from './itemsImport.js'
import { r2 } from './financeConstants.js'

const s = (v) => String(v ?? '').trim()
const n = (v) => { const x = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : 0 }
export const normName = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const stateOf = (pos) => {                       // "27-Maharashtra" → { name, code }
  const m = /^(\d{2})\s*-\s*(.+)$/.exec(s(pos))
  if (m) return { code: m[1], name: INDIA_STATES.find(x => x.code === m[1])?.name || m[2].trim() }
  const hit = INDIA_STATES.find(x => x.name.toLowerCase() === s(pos).toLowerCase())
  return { code: hit?.code || '', name: hit?.name || s(pos) }
}

// rows: parsed CSV rows keyed by header. customers: crm_customers docs [{ id, shopName, gstin, state, ... }].
export function parseZohoInvoices(rows, { customers = [], company = 'UIPL', groupName = 'wayzim' } = {}) {
  const groups = new Map()
  rows.forEach(r => {
    const num = s(r['Invoice Number']); if (!num) return
    if (!groups.has(num)) groups.set(num, { head: r, lines: [] })
    groups.get(num).lines.push(r)
  })
  const out = []
  for (const [number, { head, lines }] of groups) {
    const warnings = []
    const gstin = s(head['GST Identification Number (GSTIN)']).toUpperCase()
    const pos = stateOf(head['Place of Supply(With State Code)'] || head['Place of Supply'])
    const custName = s(head['Customer Name'])
    // customer record: GSTIN first (a customer can have several), then the name
    const sameName = customers.filter(c => normName(c.shopName) === normName(custName))
    const customer = (gstin && customers.find(c => String(c.gstin || '').toUpperCase() === gstin))
      || (sameName.length === 1 ? sameName[0] : sameName.find(c => c.state && c.state === pos.name) || sameName[0]) || null
    if (!customer) warnings.push(`Customer “${custName}” is not in Parties → Customers`)

    const items = lines.map(l => {
      const qty = n(l.Quantity) || 1, total = n(l['Item Total'])
      const rate = r2(total / qty)
      const name = s(l['Item Name']), desc = s(l['Item Desc'])
      return {
        description: [name, desc].filter(Boolean).join(' — ') || 'Item', hsnCode: s(l['HSN/SAC']), qty, unit: normUnit(l['Usage unit'], !s(l['Usage unit'])),
        rate, gstRate: n(l['Item Tax %']), stockItemId: '', sku: '', _total: total, _cgst: n(l.CGST), _sgst: n(l.SGST), _igst: n(l.IGST),
      }
    })
    const subTotal = r2(items.reduce((t, i) => t + i._total, 0))
    // tax lines per rate, from the amounts Zoho computed
    const byRate = {}
    items.forEach(i => { if (!(i.gstRate > 0)) return; const b = (byRate[i.gstRate] = byRate[i.gstRate] || { base: 0, cgst: 0, sgst: 0, igst: 0 }); b.base += i._total; b.cgst += i._cgst; b.sgst += i._sgst; b.igst += i._igst })
    const gstLines = []
    Object.entries(byRate).forEach(([rate, b]) => {
      const r = Number(rate)
      if (b.igst > 0) gstLines.push({ label: `IGST ${r}%`, rate: r, base: r2(b.base), amount: r2(b.igst) })
      else { gstLines.push({ label: `CGST ${r / 2}%`, rate: r / 2, base: r2(b.base), amount: r2(b.cgst) }); gstLines.push({ label: `SGST ${r / 2}%`, rate: r / 2, base: r2(b.base), amount: r2(b.sgst) }) }
    })
    const tax = r2(gstLines.reduce((t, g) => t + g.amount, 0))
    const total = r2(n(head.Total)), roundOff = r2(total - subTotal - tax)          // Zoho's rounding, kept so the invoice total is exactly Zoho's
    if (Math.abs(roundOff) > 1) warnings.push(`Lines add up to ${r2(subTotal + tax)} but Zoho's total is ${total}`)
    if (n(head['TDS Amount']) || n(head['TCS Amount'])) warnings.push('Zoho shows TDS / TCS on this invoice — not imported')
    const isGroup = normName(custName).includes(groupName)
    out.push({
      number, zohoId: s(head['Invoice ID']), company, invoiceType: 'TI', date: s(head['Invoice Date']), dueDate: s(head['Due Date']) || s(head['Invoice Date']), terms: s(head['Payment Terms Label']) || 'Due on Receipt',
      poNumber: s(head.PurchaseOrder), customer, customerName: custName, gstin, posState: pos.name, posStateCode: pos.code,
      items: items.map(({ _total, _cgst, _sgst, _igst, ...i }) => i), gstLines, subTotal, roundOff, total, applyGst: gstLines.length > 0,
      interCompany: isGroup ? 'Wayzim' : null, status: s(head['Invoice Status']), zohoBalance: r2(n(head.Balance)), lastPaymentDate: s(head['Last Payment Date']), warnings,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, undefined, { numeric: true }))
}

// The document written to finance_invoices (same shape the Invoices form saves).
export function toInvoiceDoc(inv, { seller = {}, user, now = new Date().toISOString() } = {}) {
  const c = inv.customer || {}
  return {
    company: inv.company, invoiceType: 'TI', invoiceDate: inv.date, dueDate: inv.dueDate, terms: inv.terms, poNumber: inv.poNumber, customerId: c.id || '',
    billToName: c.shopName || inv.customerName, billToAddress: c.address || '', billToCity: c.city || '', billToState: c.state || inv.posState, billToPincode: c.pincode || '', billToGstin: c.gstin || inv.gstin || '',
    sameShipTo: true, shipToName: '', shipToAddress: '', shipToCity: '', shipToState: '', shipToPincode: '', shipToGstin: '',
    posState: inv.posState, posStateCode: inv.posStateCode, applyGst: inv.applyGst, interCompany: inv.interCompany, isExport: false, exportType: 'WOPAY', shippingBillNo: '', shippingBillDate: '', portCode: '',
    notes: '', termsAndConditions: seller.termsAndConditions || '', currency: 'INR',
    invoiceNumber: inv.number, sellerName: seller.legalName || inv.company, sellerGstin: seller.gstin || '', sellerState: seller.state || '', sellerStateCode: seller.stateCode || '',
    items: inv.items, subTotal: inv.subTotal, gstLines: inv.gstLines, roundOff: inv.roundOff, total: inv.total,
    status: 'sent', source: 'zoho-import', zohoInvoiceId: inv.zohoId, createdBy: user?.uid || '', createdAt: now,
  }
}

// ── Receipts → invoices ───────────────────────────────────────────────────────────────────────────────────────────────
// A receipt can settle several invoices, and a customer often deducts TDS, so the cash received is
//   Σ invoice amounts − TDS% × Σ taxable value.   Every combination of up to 4 open invoices (dated on or before the receipt)
// and each TDS rate is tried; the closest to the cash received (within ₹1.50) wins, earlier invoices preferred.
export const TDS_RATES = [{ rate: 0, section: '' }, { rate: 0.001, section: '194O' }, { rate: 0.01, section: '194C' }, { rate: 0.02, section: '194C' }, { rate: 0.1, section: '194J' }]
// the customer's main name: one customer trades as several entities (Amazon Seller / Amazon Transportation) and pays under either
const keyOfParty = (x) => normName(x).replace(/\b(private|pvt|limited|ltd|the|m s)\b/g, '').trim().split(' ')[0] || ''

// invoices: [{ number, date, total, subTotal, customerName, zohoBalance }]; receipts: [{ id, date, partyName, cash }]
export function matchReceipts(invoices, receipts, { tolerance = 1.5 } = {}) {
  const open = invoices.map(i => ({ ...i, key: keyOfParty(i.customerName), left: r2(i.total), partial: i.zohoBalance > 0.5 && i.zohoBalance < i.total - 0.5 ? r2(i.total - i.zohoBalance) : 0 }))
  const matches = [], unmatched = []
  for (const rc of receipts.slice().sort((a, b) => a.date.localeCompare(b.date) || a.cash - b.cash)) {
    const cands = open.filter(i => i.key === keyOfParty(rc.partyName) && i.left > 0.5 && i.date <= rc.date).sort((a, b) => a.date.localeCompare(b.date))
    let best = null
    const consider = (picked) => {
      const gross = picked.reduce((t, p) => t + p.amount, 0)
      const taxable = picked.reduce((t, p) => t + p.sub, 0)
      for (const tr of TDS_RATES) {
        const tds = r2(tr.rate * taxable), diff = Math.abs(r2(gross - tds - rc.cash))
        if (diff > tolerance) continue
        const score = [diff > 0.05 ? 1 : 0, tr.rate > 0 ? 1 : 0, picked.length, picked.map(p => p.inv.date).join('|')]      // exact, no TDS, fewer invoices, earliest
        if (!best || cmp(score, best.score) < 0) best = { score, picked, tds, tr, diff, gross }
      }
    }
    const walk = (start, picked) => {
      if (picked.length) consider(picked)
      if (picked.length >= 4) return
      for (let i = start; i < cands.length; i++) {
        const inv = cands[i], opts = [{ amount: inv.left, sub: inv.subTotal * inv.left / inv.total }]
        if (inv.partial && inv.partial <= inv.left) opts.push({ amount: inv.partial, sub: inv.subTotal * inv.partial / inv.total })
        for (const o of opts) walk(i + 1, [...picked, { inv, ...o }])
      }
    }
    if (cands.length <= 22) walk(0, [])
    if (!best) { unmatched.push(rc); continue }
    best.picked.forEach(p => { p.inv.left = r2(p.inv.left - p.amount); if (p.inv.partial && Math.abs(p.amount - p.inv.partial) < 0.01) p.inv.partial = 0 })
    matches.push({ receiptId: rc.id, date: rc.date, cash: rc.cash, tds: best.tds, tdsSection: best.tr.section, tdsRate: best.tr.rate, diff: best.diff, allocations: best.picked.map(p => ({ number: p.inv.number, amount: r2(p.amount) })) })
  }
  // Second pass — part payments: what is left is applied to the customer's oldest open invoices, but never beyond what Zoho shows as paid
  const still = []
  for (const rc of unmatched) {
    let left = rc.cash; const allocations = []
    // oldest invoice first; an advance paid before the invoice was raised is applied to it too
    const cands = open.filter(i => i.key === keyOfParty(rc.partyName) && i.left > 0.5).sort((a, b) => a.date.localeCompare(b.date))
    for (const inv of cands) {
      if (left < 0.5) break
      const cap = r2(inv.left - Math.max(0, inv.zohoBalance || 0))             // Zoho's paid amount not yet explained
      const take = r2(Math.min(left, cap, inv.left)); if (take < 0.5) continue
      inv.left = r2(inv.left - take); left = r2(left - take); allocations.push({ number: inv.number, amount: take })
    }
    if (allocations.length) matches.push({ receiptId: rc.id, date: rc.date, cash: rc.cash, tds: 0, tdsSection: '', tdsRate: 0, diff: 0, partial: true, onAccount: left, allocations })
    else still.push(rc)
  }
  return { matches, unmatched: still, remaining: open.filter(i => i.left > 0.5).map(i => ({ number: i.number, customerName: i.customerName, date: i.date, total: i.total, left: i.left, zohoBalance: i.zohoBalance })) }
}
function cmp(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1 } return 0 }
