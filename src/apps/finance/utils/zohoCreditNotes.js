// Credit notes exported from Zoho Books ("Credit Note" CSV, one row per line item) → credit-note vouchers that reverse the sale
// and the output tax and settle the invoice they refer to. Pure functions — the import dialog does the Firestore writes.
import { computeVoucherTotals } from './taxCalc.js'
import { r2 } from './financeConstants.js'

const s = (v) => String(v ?? '').trim()
const n = (v) => { const x = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : 0 }
export const normName = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const firstWord = (x) => normName(x).replace(/\b(private|pvt|limited|ltd)\b/g, '').trim().split(' ')[0]

// Zoho's reason text → the GST reason codes the credit-note form offers
export const reasonCodeOf = (t) => /return/i.test(t) ? '01' : /discount/i.test(t) ? '02' : /defici/i.test(t) ? '03' : /correct/i.test(t) ? '04' : /place of supply/i.test(t) ? '05' : '07'
const REASON_TEXT = { '01': 'Sales return', '02': 'Post-sale discount', '03': 'Deficiency in services', '04': 'Correction in invoice', '05': 'Change in place of supply', '07': 'Others' }

// rows: CSV rows by header. customers: crm_customers docs. invoices: finance_invoices docs (to find the invoice each note refers to).
export function parseZohoCreditNotes(rows, { customers = [], invoices = [] } = {}) {
  const groups = new Map()
  rows.forEach(r => {
    const num = s(r['Credit Note Number']); if (!num) return
    if (!groups.has(num)) groups.set(num, { head: r, lines: [] })
    groups.get(num).lines.push(r)
  })
  const out = []
  for (const [number, { head, lines }] of groups) {
    const warnings = []
    const gstin = s(head['GST Identification Number (GSTIN)']).toUpperCase()
    const custName = s(head['Customer Name'])
    const same = customers.filter(c => normName(c.shopName) === normName(custName))
    const customer = (gstin && customers.find(c => String(c.gstin || '').toUpperCase() === gstin)) || same[0] || null
    if (!customer) warnings.push(`Customer “${custName}” is not in Parties → Customers`)

    const invNo = s(head['Associated Invoice Number']) || s(head['Applied Invoice Number'])
    const invoice = invoices.find(i => i.invoiceType === 'TI' && s(i.invoiceNumber) === invNo && (!customer || firstWord(i.billToName) === firstWord(custName))) || null
    if (invNo && !invoice) warnings.push(`Invoice ${invNo} is not in the books — the note will be on account`)

    const items = lines.map(l => {
      const qty = n(l.Quantity) || 1, total = n(l['Item Total'])
      return { description: [s(l['Item Name']), s(l['Item Desc'])].filter(Boolean).join(' — ') || 'Item', hsnCode: s(l['HSN/SAC']), qty, unit: 'Nos', rate: r2(total / qty), gstRate: n(l['Item Tax %']) || n(l['CGST Rate %']) * 2 || n(l['IGST Rate %']), stockItemId: '', sku: '' }
    })
    const igst = lines.reduce((t, l) => t + n(l.IGST), 0), cgst = lines.reduce((t, l) => t + n(l.CGST), 0)
    const applyGst = igst + cgst > 0
    const supplyType = igst > 0 ? 'inter' : 'intra'
    const calc = computeVoucherTotals(items, { supplyType, applyGst, rounding: true })
    const total = r2(n(head.Total))
    if (Math.abs(calc.total - total) > 1) warnings.push(`Lines come to ${calc.total} but Zoho's total is ${total}`)
    if (n(head['TDS Amount'])) warnings.push('Zoho shows TDS on this note — not imported')
    out.push({
      number, zohoId: s(head['CreditNotes ID']), date: s(head['Credit Note Date']), status: s(head['Credit Note Status']),
      customer, customerName: custName, gstin, invoice, invoiceNumber: invNo, invoiceDate: s(head['Associated Invoice Date']),
      reason: s(head.Reason), items, applyGst, supplyType, total, calcTotal: calc.total, warnings,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, undefined, { numeric: true }))
}

// The voucher body (before numbering), the same shape the Credit Note form saves.
export function toCreditVoucher(cn, { company = 'UIPL', stateCode = '27' } = {}) {
  const c = cn.customer || {}, inv = cn.invoice || {}
  const t = computeVoucherTotals(cn.items, { supplyType: cn.supplyType, applyGst: cn.applyGst, rounding: true })
  const code = reasonCodeOf(cn.reason)
  return {
    voucherType: 'credit_note', company, date: cn.date, partyType: 'customer', partyId: c.id || inv.customerId || '', partyName: c.shopName || cn.customerName, partyGstin: c.gstin || cn.gstin || '', interCompany: null,
    refInvoiceId: inv.id || '', refInvoiceNumber: inv.invoiceNumber || cn.invoiceNumber || '', refInvoiceDate: inv.invoiceDate || '', placeOfSupplyCode: inv.posStateCode || '',
    reasonCode: code, reason: REASON_TEXT[code], applyGst: cn.applyGst, supplyType: cn.supplyType, itcEligible: true, costCentreId: '', companyStateCode: stateCode,
    items: t.items, gstLines: t.gstLines, subTotal: t.subTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total,
    refNumber: cn.number, narration: `Zoho credit note ${cn.number}${cn.reason ? ' · ' + cn.reason : ''}`, currency: 'INR', fxRate: 1, fc: null, source: 'zoho-import', zohoCreditNoteId: cn.zohoId,
  }
}
