// GST return data — GSTR-1, GSTR-3B, HSN summary, ITC register and GSTR-2B
// reconciliation. Pure functions over the uniform tax-document model from
// taxDocs.js, so every figure traces back to a voucher.
//
// ⚠ These produce *working data* for filing. Table mapping and portal-JSON field
// names follow the published offline-tool formats at the time of writing, but the
// portal changes them — have the CA validate before uploading a JSON.
import { num, r2, normName } from './financeConstants.js'
import { INDIA_STATES } from './indiaConstants.js'
import { docsOfKind } from './taxDocs.js'

const GSTIN_LOOSE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
export const isRegisteredGstin = (g) => GSTIN_LOOSE.test((g || '').trim().toUpperCase())
export const B2CL_LIMIT = 100000   // inter-state B2C invoice value above this goes to B2CL (limit reduced from ₹2.5L w.e.f. Aug 2024)

const stateName = (code) => INDIA_STATES.find(s => s.code === code)?.name || code || ''
const sum = (arr, f) => r2(arr.reduce((s, x) => s + num(f(x)), 0))

// dd-mm-yyyy for portal JSON
export const portalDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}` }
// Return period MMYYYY from a date
export const periodCode = (iso) => iso ? iso.slice(5, 7) + iso.slice(0, 4) : ''

// One row per effective rate for a document; zero-rated residue (lines with no GST) appears as rate 0.
export function rateRows(d) {
  const rows = (d.rateWise || []).map(r => ({ ...r }))
  const covered = sum(rows, r => r.taxable)
  const residue = r2(d.taxable - covered)
  if (residue > 0.004) {
    const z = rows.find(r => r.rate === 0)
    if (z) z.taxable = r2(z.taxable + residue)
    else rows.unshift({ rate: 0, taxable: residue, cgst: 0, sgst: 0, igst: 0, cess: 0 })
  }
  return rows
}

const periodDocs = (docs, kind, company, from, to) => docsOfKind(docs, kind, { company, from, to }).filter(d => d.status !== 'cancelled' && d.status !== 'Cancelled')

// ═══ HSN SUMMARY ════════════════════════════════════════════════════════════
// Net of credit notes (they carry negative sign into Table 12).
export function hsnSummary(docs, { company, from, to, split = false }) {
  const m = {}
  const add = (d, sign, segment) => (d.items || []).forEach(it => {
    const hsn = (it.hsnCode || '').trim() || 'NA'
    const rate = num(it.gstRate)
    const unit = (it.unit || 'NOS').toUpperCase()
    const key = `${segment}|${hsn}|${unit}|${rate}`
    m[key] = m[key] || { hsn, description: it.description || '', unit, rate, segment, qty: 0, value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
    const r = m[key]
    r.qty = r2(r.qty + sign * num(it.qty)); r.taxable = r2(r.taxable + sign * num(it.taxable))
    r.igst = r2(r.igst + sign * num(it.igst)); r.cgst = r2(r.cgst + sign * num(it.cgst)); r.sgst = r2(r.sgst + sign * num(it.sgst))
    r.value = r2(r.value + sign * (num(it.taxable) + num(it.igst) + num(it.cgst) + num(it.sgst)))
  })
  const seg = (d) => split ? (isRegisteredGstin(d.gstin) ? 'B2B' : 'B2C') : 'ALL'
  periodDocs(docs, 'sales', company, from, to).forEach(d => add(d, 1, seg(d)))
  periodDocs(docs, 'credit_note', company, from, to).forEach(d => add(d, -1, seg(d)))
  const rows = Object.values(m).filter(r => Math.abs(r.taxable) > 0.004 || Math.abs(r.qty) > 0.004).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
  return { rows, missingHsn: rows.filter(r => r.hsn === 'NA').length }
}

// ═══ GSTR-1 ═════════════════════════════════════════════════════════════════
export function buildGstr1(docs, { company, from, to, companyStateCode, gstin }) {
  const sales = periodDocs(docs, 'sales', company, from, to)
  const cns = periodDocs(docs, 'credit_note', company, from, to)
  const warnings = []

  const b2b = {}, b2cl = {}, b2cs = {}, nil = { interReg: 0, intraReg: 0, interUnreg: 0, intraUnreg: 0 }
  const exports = []   // table 6A
  const inv = (d) => ({ number: d.number, date: d.date, value: d.total, pos: d.stateCode || companyStateCode, posName: stateName(d.stateCode || companyStateCode), rows: rateRows(d).filter(r => r.rate > 0 || d.taxable > 0), taxable: d.taxable, tax: d.taxTotal, partyName: d.partyName, gstin: d.gstin, key: d.key })

  sales.forEach(d => {
    if (d.isExport) {
      exports.push({ number: d.number, date: d.date, value: d.total, taxable: d.taxable, igst: d.igst, exportType: d.exportType === 'WPAY' ? 'WPAY' : 'WOPAY', sbNo: d.shippingBillNo, sbDate: d.shippingBillDate, portCode: d.portCode, partyName: d.partyName, currency: d.currency, fcTotal: d.fcTotal, key: d.key, rate: d.exportType === 'WPAY' ? (rateRows(d).find(r => r.rate > 0)?.rate || 0) : 0 })
      return
    }
    const registered = isRegisteredGstin(d.gstin)
    const pos = d.stateCode || companyStateCode
    if (!pos) warnings.push(`${d.number}: place of supply is missing — set the customer's state.`)
    if (d.gstin && !registered) warnings.push(`${d.number}: GSTIN "${d.gstin}" is not in a valid format — treated as unregistered.`)
    const rows = rateRows(d)
    const taxedRows = rows.filter(r => r.rate > 0)
    const zeroTaxable = sum(rows.filter(r => r.rate === 0), r => r.taxable)
    if (zeroTaxable > 0) {
      const inter = (pos && companyStateCode && pos !== companyStateCode)
      nil[(inter ? 'inter' : 'intra') + (registered ? 'Reg' : 'Unreg')] = r2(nil[(inter ? 'inter' : 'intra') + (registered ? 'Reg' : 'Unreg')] + zeroTaxable)
    }
    if (!taxedRows.length) return   // nil-rated only → Table 8
    if (registered) {
      (b2b[d.gstin] = b2b[d.gstin] || { ctin: d.gstin, partyName: d.partyName, invoices: [] }).invoices.push(inv(d))
    } else if (pos && companyStateCode && pos !== companyStateCode && d.total > B2CL_LIMIT) {
      (b2cl[pos] = b2cl[pos] || { pos, posName: stateName(pos), invoices: [] }).invoices.push(inv(d))
    } else {
      taxedRows.forEach(r => {
        const k = `${pos}|${r.rate}`
        const inter = pos && companyStateCode && pos !== companyStateCode
        b2cs[k] = b2cs[k] || { pos, posName: stateName(pos), supplyType: inter ? 'INTER' : 'INTRA', rate: r.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
        const x = b2cs[k]
        x.taxable = r2(x.taxable + r.taxable); x.igst = r2(x.igst + r.igst); x.cgst = r2(x.cgst + r.cgst); x.sgst = r2(x.sgst + r.sgst)
      })
    }
  })

  // Credit notes issued: registered → CDNR, unregistered → CDNUR (only where the original was B2CL-type; small B2C credit notes net off Table 7).
  const cdnr = {}, cdnur = []
  const b2csAdjust = []
  cns.forEach(d => {
    const registered = isRegisteredGstin(d.gstin)
    const pos = d.stateCode || companyStateCode
    const note = { number: d.number, date: d.date, value: d.total, pos, posName: stateName(pos), refNumber: d.refInvoiceNumber, refDate: d.refInvoiceDate, reason: d.reason, rows: rateRows(d).filter(r => r.taxable), taxable: d.taxable, tax: d.taxTotal, partyName: d.partyName, gstin: d.gstin, key: d.key }
    if (!d.refInvoiceNumber) warnings.push(`${d.number}: credit note has no original invoice reference — the portal requires one.`)
    if (registered) (cdnr[d.gstin] = cdnr[d.gstin] || { ctin: d.gstin, partyName: d.partyName, notes: [] }).notes.push(note)
    else if (pos && companyStateCode && pos !== companyStateCode && d.total > B2CL_LIMIT) cdnur.push(note)
    else {
      // against small B2C: reduce Table 7 (B2CS) in the same period
      rateRows(d).filter(r => r.rate > 0).forEach(r => {
        const k = `${pos}|${r.rate}`
        const inter = pos && companyStateCode && pos !== companyStateCode
        b2cs[k] = b2cs[k] || { pos, posName: stateName(pos), supplyType: inter ? 'INTER' : 'INTRA', rate: r.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
        const x = b2cs[k]
        x.taxable = r2(x.taxable - r.taxable); x.igst = r2(x.igst - r.igst); x.cgst = r2(x.cgst - r.cgst); x.sgst = r2(x.sgst - r.sgst)
      })
      b2csAdjust.push(note)
    }
  })

  const hsn = hsnSummary(docs, { company, from, to, split: true })
  exports.forEach(e => { if (!e.sbNo && e.exportType === 'WPAY') warnings.push(`${e.number}: export with payment of IGST needs a shipping bill number to claim the refund.`) })
  if (hsn.missingHsn) warnings.push(`${hsn.missingHsn} HSN line(s) have no HSN/SAC code — Table 12 needs it (4 digits up to ₹5 cr turnover, 6 digits above).`)

  // Documents issued (Table 13) — contiguous series per prefix.
  const series = {}
  const bump = (kindLabel, d) => {
    const m = /^(.*?)(\d+)$/.exec(d.number || '')
    const prefix = m ? m[1] : (d.number || ''), n = m ? Number(m[2]) : 0
    const k = `${kindLabel}|${prefix}`
    series[k] = series[k] || { kindLabel, prefix, from: d.number, to: d.number, min: n, max: n, count: 0 }
    const s = series[k]; s.count++
    if (n < s.min) { s.min = n; s.from = d.number }
    if (n > s.max) { s.max = n; s.to = d.number }
  }
  sales.forEach(d => bump('Invoices for outward supply', d))
  cns.forEach(d => bump('Credit Note', d))
  const docIssued = Object.values(series).map(s => ({ ...s, totalNumber: s.max - s.min + 1, cancelled: Math.max(0, s.max - s.min + 1 - s.count), netIssued: s.count }))

  const b2bList = Object.values(b2b).sort((a, b) => a.ctin.localeCompare(b.ctin))
  const b2clList = Object.values(b2cl)
  const b2csList = Object.values(b2cs).filter(x => Math.abs(x.taxable) > 0.004).sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate)
  const cdnrList = Object.values(cdnr)

  const allInv = [...b2bList.flatMap(p => p.invoices), ...b2clList.flatMap(p => p.invoices)]
  const totals = {
    b2b: { count: allInv.length - b2clList.flatMap(p => p.invoices).length, taxable: sum(b2bList.flatMap(p => p.invoices), i => i.taxable), tax: sum(b2bList.flatMap(p => p.invoices), i => i.tax) },
    b2cl: { count: b2clList.flatMap(p => p.invoices).length, taxable: sum(b2clList.flatMap(p => p.invoices), i => i.taxable), tax: sum(b2clList.flatMap(p => p.invoices), i => i.tax) },
    b2cs: { taxable: sum(b2csList, x => x.taxable), tax: sum(b2csList, x => x.igst + x.cgst + x.sgst) },
    cdn: { count: cns.length, taxable: sum(cns, d => d.taxable), tax: sum(cns, d => d.taxTotal) },
    sales: { count: sales.length, taxable: sum(sales, d => d.taxable), tax: sum(sales, d => d.taxTotal) },
  }
  return { b2b: b2bList, b2cl: b2clList, b2cs: b2csList, cdnr: cdnrList, cdnur, nil, exports, hsn, docIssued, totals, warnings: [...new Set(warnings)], gstin, period: { from, to } }
}

// Portal offline-utility JSON (GSTR-1). Item numbering restarts per invoice.
export function gstr1Json(g, { gstin, to, grossTurnover = 0, currentGrossTurnover = 0 }) {
  const itms = (rows) => rows.map((r, i) => ({ num: i + 1, itm_det: { rt: r.rate, txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0 } }))
  const out = { gstin, fp: periodCode(to), gt: grossTurnover, cur_gt: currentGrossTurnover }
  if (g.b2b.length) out.b2b = g.b2b.map(p => ({ ctin: p.ctin, inv: p.invoices.map(i => ({ inum: i.number, idt: portalDate(i.date), val: i.value, pos: i.pos, rchrg: 'N', inv_typ: 'R', itms: itms(i.rows) })) }))
  if (g.b2cl.length) out.b2cl = g.b2cl.map(p => ({ pos: p.pos, inv: p.invoices.map(i => ({ inum: i.number, idt: portalDate(i.date), val: i.value, itms: itms(i.rows) })) }))
  if (g.b2cs.length) out.b2cs = g.b2cs.map(x => ({ sply_ty: x.supplyType, rt: x.rate, typ: 'OE', pos: x.pos, txval: x.taxable, iamt: x.igst, camt: x.cgst, samt: x.sgst, csamt: 0 }))
  if (g.exports?.length) out.exp = ['WOPAY', 'WPAY'].filter(t => g.exports.some(e => e.exportType === t)).map(t => ({ exp_typ: t, inv: g.exports.filter(e => e.exportType === t).map(e => ({ inum: e.number, idt: portalDate(e.date), val: e.value, ...(e.portCode ? { sbpcode: e.portCode } : {}), ...(e.sbNo ? { sbnum: e.sbNo } : {}), ...(e.sbDate ? { sbdt: portalDate(e.sbDate) } : {}), itms: [{ txval: e.taxable, rt: e.rate, iamt: e.igst, csamt: 0 }] })) }))
  if (g.cdnr.length) out.cdnr = g.cdnr.map(p => ({ ctin: p.ctin, nt: p.notes.map(n => ({ ntty: 'C', nt_num: n.number, nt_dt: portalDate(n.date), val: n.value, pos: n.pos, rchrg: 'N', inv_typ: 'R', itms: itms(n.rows) })) }))
  if (g.cdnur.length) out.cdnur = g.cdnur.map(n => ({ typ: 'B2CL', ntty: 'C', nt_num: n.number, nt_dt: portalDate(n.date), val: n.value, pos: n.pos, itms: itms(n.rows) }))
  // sply_ty codes (portal naming): INTRB2B / INTRB2C = inter-state to registered / unregistered; INTRAB2B / INTRAB2C = intra-state.
  const nilRows = [['INTRB2B', g.nil.interReg], ['INTRB2C', g.nil.interUnreg], ['INTRAB2B', g.nil.intraReg], ['INTRAB2C', g.nil.intraUnreg]].filter(([, v]) => v > 0)
  if (nilRows.length) out.nil = { inv: nilRows.map(([t, v]) => ({ sply_ty: t, expt_amt: 0, nil_amt: v, ngsup_amt: 0 })) }
  if (g.hsn.rows.length) out.hsn = {
    data: g.hsn.rows.map((r, i) => ({ num: i + 1, hsn_sc: r.hsn, desc: (r.description || '').slice(0, 30), uqc: r.unit, qty: r.qty, val: r.value, txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0, rt: r.rate })),
  }
  if (g.docIssued.length) out.doc_issue = { doc_det: [
    { doc_num: 1, doc_typ: 'Invoices for outward supply', docs: g.docIssued.filter(s => s.kindLabel.startsWith('Invoices')).map((s, i) => ({ num: i + 1, from: s.from, to: s.to, totnum: s.totalNumber, cancel: s.cancelled, net_issue: s.netIssued })) },
    ...(g.docIssued.some(s => s.kindLabel === 'Credit Note') ? [{ doc_num: 5, doc_typ: 'Credit Note', docs: g.docIssued.filter(s => s.kindLabel === 'Credit Note').map((s, i) => ({ num: i + 1, from: s.from, to: s.to, totnum: s.totalNumber, cancel: s.cancelled, net_issue: s.netIssued })) }] : []),
  ] }
  return out
}

// ═══ GSTR-3B ════════════════════════════════════════════════════════════════
const zeroTax = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 })
const addRows = (acc, rows, sign = 1) => rows.forEach(r => {
  acc.taxable = r2(acc.taxable + sign * r.taxable); acc.igst = r2(acc.igst + sign * r.igst)
  acc.cgst = r2(acc.cgst + sign * r.cgst); acc.sgst = r2(acc.sgst + sign * r.sgst)
})

// Cross-utilisation per section 49(5): IGST credit → IGST, CGST, SGST; CGST credit → CGST, IGST; SGST credit → SGST, IGST.
export function setOff(liab, itc) {
  const L = { igst: liab.igst, cgst: liab.cgst, sgst: liab.sgst }
  const C = { igst: itc.igst, cgst: itc.cgst, sgst: itc.sgst }
  const used = { igst: { igst: 0, cgst: 0, sgst: 0 }, cgst: { igst: 0, cgst: 0 }, sgst: { igst: 0, sgst: 0 } }
  const take = (from, to) => { const u = Math.min(C[from], L[to]); if (u > 0) { C[from] = r2(C[from] - u); L[to] = r2(L[to] - u); used[from][to] = r2(used[from][to] + u) } }
  take('igst', 'igst'); take('igst', 'cgst'); take('igst', 'sgst')
  take('cgst', 'cgst'); take('cgst', 'igst')
  take('sgst', 'sgst'); take('sgst', 'igst')
  return { cash: L, itcUsed: used, itcLeft: C }
}

export function buildGstr3b(docs, { company, from, to, companyStateCode, openingCredit = { igst: 0, cgst: 0, sgst: 0 } }) {
  const sales = periodDocs(docs, 'sales', company, from, to)
  const cns = periodDocs(docs, 'credit_note', company, from, to)
  const purchases = periodDocs(docs, 'purchase', company, from, to).filter(d => !d.legacy)
  const dns = periodDocs(docs, 'debit_note', company, from, to)

  const t31a = zeroTax(), t31b = zeroTax(), t31c = zeroTax(), t31d = zeroTax()
  const interUnreg = {}   // 3.2: pos → { taxable, igst }
  ;[[sales, 1], [cns, -1]].forEach(([list, sign]) => list.forEach(d => {
    const rows = rateRows(d)
    if (d.isExport) { addRows(t31b, rows, sign); return }          // exports are zero-rated supplies, 3.1(b)
    addRows(t31a, rows.filter(r => r.rate > 0), sign)
    addRows(t31c, rows.filter(r => r.rate === 0), sign)
    const pos = d.stateCode || companyStateCode
    if (!isRegisteredGstin(d.gstin) && pos && companyStateCode && pos !== companyStateCode) {
      const x = interUnreg[pos] = interUnreg[pos] || { pos, posName: stateName(pos), taxable: 0, igst: 0 }
      rows.filter(r => r.rate > 0).forEach(r => { x.taxable = r2(x.taxable + sign * r.taxable); x.igst = r2(x.igst + sign * r.igst) })
    }
  }))
  purchases.filter(d => d.rcm).forEach(d => addRows(t31d, rateRows(d).filter(r => r.rate > 0)))

  const eligible = (d) => d.itcEligible !== false
  const itcImport = zeroTax(), itcRcm = zeroTax(), itcOther = zeroTax(), itcRevOther = zeroTax(), itcBlocked = zeroTax()
  purchases.forEach(d => {
    const rows = rateRows(d).filter(r => r.rate > 0)
    if (!eligible(d)) { addRows(itcBlocked, rows); return }
    addRows(d.rcm ? itcRcm : itcOther, rows)
  })
  dns.filter(eligible).forEach(d => addRows(itcRevOther, rateRows(d).filter(r => r.rate > 0)))

  const grossItc = { igst: r2(itcOther.igst + itcRcm.igst), cgst: r2(itcOther.cgst + itcRcm.cgst), sgst: r2(itcOther.sgst + itcRcm.sgst) }
  const netItc = { igst: r2(grossItc.igst - itcRevOther.igst), cgst: r2(grossItc.cgst - itcRevOther.cgst), sgst: r2(grossItc.sgst - itcRevOther.sgst) }

  // Set-off uses opening credit ledger + this period's non-RCM ITC (RCM credit is only available after the cash payment).
  const available = {
    igst: r2(Math.max(0, openingCredit.igst + itcOther.igst - itcRevOther.igst)),
    cgst: r2(Math.max(0, openingCredit.cgst + itcOther.cgst - itcRevOther.cgst)),
    sgst: r2(Math.max(0, openingCredit.sgst + itcOther.sgst - itcRevOther.sgst)),
  }
  const liab = { igst: t31a.igst, cgst: t31a.cgst, sgst: t31a.sgst }
  const so = setOff(liab, available)
  const rcmCash = { igst: t31d.igst, cgst: t31d.cgst, sgst: t31d.sgst }
  const cashTotal = r2(so.cash.igst + so.cash.cgst + so.cash.sgst + rcmCash.igst + rcmCash.cgst + rcmCash.sgst)
  const warnings = []
  if (t31a.igst < 0 || t31a.cgst < 0) warnings.push('Credit notes exceed sales in this period — the negative liability must be carried per the CA\'s advice (adjust in a later return).')
  const legacy = docsOfKind(docs, 'purchase', { company, from, to }).filter(d => d.legacy)
  if (legacy.length) warnings.push(`${legacy.length} old Payables record(s) in this period carry no GST detail, so no ITC is claimed on them. Re-enter them as Purchase vouchers to claim ITC.`)

  return { t31a, t31b, t31c, t31d, interUnreg: Object.values(interUnreg), itcImport, itcRcm, itcOther, itcRevOther, itcBlocked, grossItc, netItc, available, setOff: so, rcmCash, cashTotal, openingCredit, warnings }
}

// ═══ ITC REGISTER ═══════════════════════════════════════════════════════════
export function itcRegister(docs, { company, from, to }) {
  const purchases = periodDocs(docs, 'purchase', company, from, to)
  const dns = periodDocs(docs, 'debit_note', company, from, to)
  const rows = []
  purchases.forEach(d => {
    const tax = r2(d.cgst + d.sgst + d.igst)
    let status = 'Eligible'
    if (d.legacy) status = 'No GST detail'
    else if (d.itcEligible === false) status = 'Blocked (s.17(5))'
    else if (tax === 0) status = 'No tax'
    else if (d.rcm) status = 'Eligible (RCM)'
    rows.push({ ...d, sign: 1, tax, itc: status.startsWith('Eligible') ? tax : 0, status })
  })
  dns.forEach(d => {
    const tax = r2(d.cgst + d.sgst + d.igst)
    rows.push({ ...d, sign: -1, tax, itc: d.itcEligible === false ? 0 : -tax, status: 'Reversal (debit note)' })
  })
  rows.sort((a, b) => a.date.localeCompare(b.date))
  const tot = { igst: 0, cgst: 0, sgst: 0, eligible: 0, blocked: 0 }
  rows.forEach(r => {
    const f = r.itc === 0 ? 0 : (r.itc > 0 ? 1 : -1)
    if (f) { tot.igst = r2(tot.igst + f * r.igst); tot.cgst = r2(tot.cgst + f * r.cgst); tot.sgst = r2(tot.sgst + f * r.sgst); tot.eligible = r2(tot.eligible + r.itc) }
    else if (r.status.startsWith('Blocked')) tot.blocked = r2(tot.blocked + r.tax)
  })
  return { rows, totals: tot }
}

// ═══ GSTR-2B RECONCILIATION ═════════════════════════════════════════════════
export const normInvNo = (s) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '')

// Parse the JSON downloaded from the GST portal (GSTR-2B) into flat supplier invoices.
export function parseGstr2bJson(json) {
  const data = json?.data || json
  const dd = data?.docdata || data
  const out = []
  const push = (supplier, inv, type) => {
    const items = inv.items || inv.itms || []
    const pick = (f) => items.length ? items.reduce((s, i) => s + num(i[f] ?? i.itm_det?.[f]), 0) : num(inv[f])
    out.push({
      gstin: (supplier.ctin || '').toUpperCase(), supplier: supplier.trdnm || '', number: inv.inum || inv.ntnum || inv.nt_num || '',
      date: isoFromPortal(inv.dt || inv.idt || inv.ntdt), value: num(inv.val), taxable: r2(pick('txval')),
      igst: r2(pick('igst') || pick('iamt')), cgst: r2(pick('cgst') || pick('camt')), sgst: r2(pick('sgst') || pick('samt')),
      itcAvailable: (inv.itcavl || 'Y') !== 'N', type, reverseCharge: inv.rev === 'Y',
    })
  }
  ;(dd?.b2b || []).forEach(s => (s.inv || []).forEach(i => push(s, i, 'Invoice')))
  ;(dd?.cdnr || []).forEach(s => (s.nt || []).forEach(n => push(s, n, 'Credit/Debit note')))
  return { rows: out, period: data?.rtnprd || '', gstin: data?.gstin || '' }
}
function isoFromPortal(d) {
  if (!d) return ''
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(d)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d
}

// Map spreadsheet rows (header names flexible) into the same shape.
export function parseGstr2bRows(rows) {
  const key = (r, ...names) => { const k = Object.keys(r).find(c => names.some(n => c.toLowerCase().replace(/[^a-z]/g, '').includes(n))); return k ? r[k] : '' }
  return rows.map(r => ({
    gstin: String(key(r, 'gstin', 'ctin')).toUpperCase().trim(), supplier: String(key(r, 'tradename', 'suppliername', 'trdnm', 'supplier')), number: String(key(r, 'invoicenumber', 'invoiceno', 'inum', 'invoicenum', 'documentnumber')),
    date: toIso(key(r, 'invoicedate', 'documentdate', 'date')), value: num(key(r, 'invoicevalue', 'val')), taxable: num(key(r, 'taxablevalue', 'txval', 'taxable')),
    igst: num(key(r, 'integratedtax', 'igst')), cgst: num(key(r, 'centraltax', 'cgst')), sgst: num(key(r, 'stateuttax', 'sgst', 'utgst')),
    itcAvailable: true, type: 'Invoice', reverseCharge: false,
  })).filter(r => r.gstin && r.number)
}
function toIso(v) {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const s = String(v || '')
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
}

// Match books (purchase vouchers) against 2B. Key = supplier GSTIN + normalised invoice no.
// Tolerance ₹1 on tax amounts (rounding differences are common).
export function reconcile2b(books, twoB, { tolerance = 1 } = {}) {
  const bookKey = (b) => `${(b.gstin || '').toUpperCase()}|${normInvNo(b.externalNumber || b.number)}`
  const bMap = new Map(), used = new Set()
  books.forEach(b => { const k = bookKey(b); if (!bMap.has(k)) bMap.set(k, []); bMap.get(k).push(b) })
  const matched = [], mismatch = [], onlyTwoB = []
  twoB.forEach(t => {
    const k = `${t.gstin}|${normInvNo(t.number)}`
    const cand = (bMap.get(k) || []).find(b => !used.has(b.key))
    if (!cand) { onlyTwoB.push(t); return }
    used.add(cand.key)
    const diffs = []
    const bt = r2(cand.cgst + cand.sgst + cand.igst), tt = r2(t.cgst + t.sgst + t.igst)
    if (Math.abs(bt - tt) > tolerance) diffs.push(`Tax: books ${bt} vs 2B ${tt}`)
    if (Math.abs(cand.taxable - t.taxable) > tolerance) diffs.push(`Taxable: books ${cand.taxable} vs 2B ${t.taxable}`)
    if (cand.date && t.date && cand.externalDate && cand.externalDate !== t.date) diffs.push(`Date: books ${cand.externalDate} vs 2B ${t.date}`)
    const row = { book: cand, gstr2b: t, diffs }
    ;(diffs.length ? mismatch : matched).push(row)
  })
  const onlyBooks = books.filter(b => !used.has(b.key) && (b.cgst + b.sgst + b.igst) > 0 && b.itcEligible !== false && !b.rcm)
  const noItc = books.filter(b => !used.has(b.key) && !onlyBooks.includes(b))
  return { matched, mismatch, onlyBooks, onlyTwoB, noItc,
    totals: {
      matchedTax: sum(matched, r => r.book.cgst + r.book.sgst + r.book.igst), mismatchTax: sum(mismatch, r => r.book.cgst + r.book.sgst + r.book.igst),
      onlyBooksTax: sum(onlyBooks, b => b.cgst + b.sgst + b.igst), onlyTwoBTax: sum(onlyTwoB, t => t.cgst + t.sgst + t.igst),
    } }
}

export { normName }
