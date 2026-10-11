// Purchase bills exported from Zoho Books ("Bill" CSV, one row per line item) → purchase vouchers,
// plus the matching of bank payments (already in the books) to those bills. Pure functions.
import { computeVoucherTotals, supplyTypeOf } from './taxCalc.js'
import { normUnit } from './itemsImport.js'
import { r2 } from './financeConstants.js'

const s = (v) => String(v ?? '').trim()
const n = (v) => { const x = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : 0 }
export const normName = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Zoho expense account → this app's chart of accounts
export const ACCOUNT_MAP = {
  'Bank Fees and Charges': '5170', 'Software Expense': '5135', 'IT and Internet Expenses': '5135', 'Other Expenses': '5900', 'Office Expenses': '5900', 'Printing and Stationery': '5900',
  'Business EOR Purchase Services': '5105', 'Professional Feee': '5190', 'Professional Fees': '5190', 'Consultant Expense': '5190',
  'Job Costing': '5000', 'Cost of Goods Sold': '5000', 'Inventory Asset': '5000', 'Merchandise': '5000', 'Customs Duty': '5000',
  'Travel Expense': '5125', 'Meal Allowance': '5125', 'Prepaid Expenses': '1900', 'Input IGST': '1303', 'Transportation Expense': '5120', 'Shed- Mundwa': '5100',
  'Business Devlopment Expense': '5150', 'Rent Expense': '5100', 'Staff Welfare expenses': '5900', 'Deposits': '1900',
}
export const accountFor = (name) => ACCOUNT_MAP[s(name)] || '5900'

export function tdsSectionOf(name, code, pct) {
  const t = `${name || ''} ${code || ''}`
  const rate = n(pct) || n((String(name).match(/(\d+(?:\.\d+)?)\s*%/) || [])[1])
  if (/\b195\b/.test(t)) return { section: '195', rate }
  if (/194\s*C|contractor/i.test(t)) return { section: '194C', rate }
  if (/194\s*J|professional/i.test(t)) return { section: rate && rate <= 2 ? '194J-T' : '194J-P', rate: rate || 10 }
  if (/194\s*H/i.test(t)) return { section: '194H', rate: rate || 2 }
  if (/194\s*I/i.test(t)) return { section: rate && rate <= 2 ? '194I-A' : '194I-B', rate: rate || 10 }
  return { section: rate ? '194C' : '', rate }
}

// rows: parsed CSV rows. vendors: finance_vendors docs [{ id, vendorName, gstin, state }]. stateCode: our own GST state code.
export function parseZohoBills(rows, { vendors = [], stateCode = '27' } = {}) {
  const groups = new Map()
  rows.forEach(r => {
    const no = s(r['Bill Number']), id = s(r['Bill ID']); if (!no && !id) return
    const k = id || `${no}|${s(r['Vendor Name'])}|${s(r['Bill Date'])}`
    if (!groups.has(k)) groups.set(k, { head: r, lines: [] })
    groups.get(k).lines.push(r)
  })
  const out = []
  for (const [key, { head, lines }] of groups) {
    const warnings = []
    const vname = s(head['Vendor Name']), gstin = s(head['GST Identification Number (GSTIN)']).toUpperCase()
    const vendor = (gstin && vendors.find(v => String(v.gstin || '').toUpperCase() === gstin && normName(v.vendorName).split(' ')[0] === normName(vname).split(' ')[0]))
      || vendors.find(v => normName(v.vendorName) === normName(vname)) || null
    const srcState = s(head['Source of Supply']), dstState = s(head['Destination of Supply'])
    const supplyType = srcState && dstState ? (srcState === dstState ? 'intra' : 'inter') : supplyTypeOf(gstin.slice(0, 2), stateCode)
    const items = lines.map(l => {
      const qty = n(l.Quantity) || 1, tot = n(l['Item Total'])
      return { description: [s(l['Item Name']), s(l.Description)].filter(Boolean).join(' — ') || 'Item', hsnCode: s(l['HSN/SAC']), qty, unit: normUnit(l['Usage unit'], !s(l['Usage unit'])),
        rate: qty ? r2(tot / qty) : tot, discountPct: 0, gstRate: n(l['Tax Percentage']), accountCode: accountFor(l.Account), stockItemId: '', sku: '', _account: s(l.Account), _taxAmt: n(l['Tax Amount']) }
    })
    const applyGst = items.some(i => i.gstRate > 0)
    let t = computeVoucherTotals(items, { supplyType, applyGst, rcm: false, rounding: false })
    const zohoNet = r2(n(head.Total)), tdsAmt = r2(n(head['TDS Amount']))
    const gross = r2(zohoNet + tdsAmt)                        // Zoho's Total is what is left to pay after TDS
    let roundOff = r2(gross - t.subTotal - t.taxTotal)
    if (Math.abs(roundOff) > 1.5) {                           // charges / adjustments in Zoho's total that are not line items: keep them visible, not as "round off"
      warnings.push(`Zoho's total is ${gross} but the lines come to ${r2(t.subTotal + t.taxTotal)} — the ${r2(roundOff)} difference is added as an adjustment line`)
      items.push({ description: 'Other charges / adjustment (difference to the bill total in Zoho)', hsnCode: '', qty: 1, unit: 'nos', rate: roundOff, discountPct: 0, gstRate: 0, accountCode: items[0]?.accountCode || '5900', stockItemId: '', sku: '', _account: items[0]?._account || '', _taxAmt: 0 })
      t = computeVoucherTotals(items, { supplyType, applyGst, rcm: false, rounding: false }); roundOff = r2(gross - t.subTotal - t.taxTotal)
    }
    const td = tdsAmt > 0 ? tdsSectionOf(head['TDS Name'], head['TDS Section Code'], head['TDS Percentage']) : null
    const skip = /hongkong|hsbc/i.test(vname) && items.every(i => i._account === 'Bank Fees and Charges') ? 'Bank charges — already booked from the bank statement' : (gross <= 0 ? 'Zero-value bill' : '')
    out.push({
      key, number: s(head['Bill Number']), zohoId: s(head['Bill ID']), date: s(head['Bill Date']), dueDate: s(head['Due Date']) || s(head['Bill Date']), terms: s(head['Payment Terms Label']),
      vendor, vendorName: vname, gstin, gstTreatment: s(head['GST Treatment']), supplyType, srcState, applyGst, itcEligible: lines.every(l => !s(l['ITC Eligibility']) || s(l['ITC Eligibility']) === 'eligible'),
      items: items.map(({ _account, _taxAmt, ...i }) => i), subTotal: t.subTotal, gstLines: t.gstLines, taxTotal: t.taxTotal, roundOff, total: gross, net: zohoNet,
      tds: td ? { applicable: true, section: td.section, rate: td.rate, base: t.subTotal, amount: tdsAmt } : { applicable: false, section: '', rate: 0, base: 0, amount: 0 },
      status: s(head['Bill Status']), zohoBalance: r2(n(head.Balance)), poNumber: s(head.PurchaseOrder), skip, warnings, accounts: [...new Set(items.map(i => i._account))],
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
}

// The voucher body (before numbering) as the Purchase form would save it.
export function toPurchaseVoucher(b, { company = 'UIPL', stateCode = '27' } = {}) {
  const v = b.vendor || {}
  const creditDays = Math.max(0, Math.round((new Date(b.dueDate + 'T00:00:00') - new Date(b.date + 'T00:00:00')) / 86400000)) || 0
  return {
    voucherType: 'purchase', company, date: b.date, partyType: 'vendor', partyId: v.id || '', partyName: v.vendorName || b.vendorName, partyGstin: v.gstin || b.gstin || '',
    partyState: v.state || '', partyStateCode: (v.gstin || b.gstin || '').slice(0, 2) || '', placeOfSupplyCode: stateCode, companyStateCode: stateCode, supplyType: b.supplyType,
    refNumber: b.number, refDate: b.date, creditDays, dueDate: b.dueDate, applyGst: b.applyGst, rcm: false, itcEligible: b.itcEligible, purchaseAccountCode: '5000', warehouseId: '', costCentreId: '',
    items: b.items.map(i => ({ ...i, ...computeLineOf(i, b) })), gstLines: b.gstLines, subTotal: b.subTotal, taxTotal: b.taxTotal, roundOff: b.roundOff, total: b.total, tds: b.tds,
    narration: `Zoho bill ${b.number}${b.poNumber ? ' · PO ' + b.poNumber : ''}`, currency: 'INR', fxRate: 1, fc: null, source: 'zoho-import', zohoBillId: b.zohoId,
  }
}
const computeLineOf = (i, b) => computeVoucherTotals([i], { supplyType: b.supplyType, applyGst: b.applyGst, rounding: false }).items[0]

// ── Payments → bills ──────────────────────────────────────────────────────────────────────────────────────────────────
// A bank payment settles the bill's payable, which is the bill total less the TDS deducted. One payment can settle several
// bills (any combination of up to 4, same vendor); the closest to the cash paid (within ₹1.50) wins, earliest bills first.
const keyOf = (x) => normName(x).replace(/\b(private|pvt|limited|ltd|the|m s|india|indian|co|company)\b/g, '').trim().split(' ')[0] || ''
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1 } return 0 }

// bills: [{ key, date, net, vendorName, zohoBalance }]; payments: [{ id, date, cash, partyName?, text }] (text = narration used when the payment has no vendor yet)
export function matchPayments(bills, payments, { tolerance = 1.5, fxVendors = [], fxPct = 0.04 } = {}) {
  const open = bills.map(b => ({ ...b, vk: keyOf(b.vendorName), left: r2(b.net) }))
  const fx = new Set(fxVendors.map(keyOf))               // foreign vendors: the rupees paid differ from the rupees booked (exchange difference)
  const matches = [], unmatched = []
  for (const p of payments.slice().sort((a, b) => a.date.localeCompare(b.date) || a.cash - b.cash)) {
    const hay = normName(`${p.partyName || ''} ${p.text || ''}`)
    const mine = open.filter(b => b.left > 0.5 && b.vk && (p.partyName ? keyOf(p.partyName) === b.vk : (` ${hay} `).includes(` ${b.vk} `))).sort((a, b) => a.date.localeCompare(b.date))
    const cands = mine.filter(b => b.date <= p.date)
    let best = null
    const walk = (start, picked) => {
      if (picked.length) {
        const sum = r2(picked.reduce((t, b) => t + b.left, 0)), diff = Math.abs(sum - p.cash)
        const tol = fx.has(picked[0].vk) ? Math.max(tolerance, sum * fxPct) : tolerance
        if (diff <= tol) { const score = [diff > 0.05 ? 1 : 0, picked.length, picked.map(b => b.date).join('|')]; if (!best || cmp(score, best.score) < 0) best = { score, picked } }
      }
      if (picked.length >= 4) return
      for (let i = start; i < cands.length; i++) walk(i + 1, [...picked, cands[i]])
    }
    if (cands.length <= 24) walk(0, [])
    if (best) {
      const allocations = best.picked.map(b => ({ key: b.key, amount: r2(b.left) }))
      best.picked.forEach(b => { b.left = 0 })
      matches.push({ paymentId: p.id, date: p.date, cash: p.cash, exact: true, fxDiff: r2(p.cash - allocations.reduce((t, a) => t + a.amount, 0)), allocations })
    } else unmatched.push({ ...p, mine })
  }
  // part payments: oldest open bills of the vendor, never beyond what Zoho shows as paid
  const still = []
  for (const p of unmatched) {
    let left = p.cash; const allocations = []
    for (const b of p.mine) {
      if (left < 0.5) break
      const cap = r2(b.left - Math.max(0, b.zohoBalance || 0))
      const take = r2(Math.min(left, cap, b.left)); if (take < 0.5) continue
      b.left = r2(b.left - take); left = r2(left - take); allocations.push({ key: b.key, amount: take })
    }
    if (allocations.length) matches.push({ paymentId: p.id, date: p.date, cash: p.cash, exact: false, onAccount: left, allocations }); else still.push(p)
  }
  return { matches, unmatched: still.map(({ mine, ...p }) => p), remaining: open.filter(b => b.left > 0.5).map(b => ({ key: b.key, number: b.number, vendorName: b.vendorName, date: b.date, net: b.net, left: b.left, zohoBalance: b.zohoBalance })) }
}
