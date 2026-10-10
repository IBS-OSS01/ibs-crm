// Voucher → double-entry lines.
//
// Same philosophy as ledger.js: nothing here is persisted. A voucher document
// (finance_vouchers) is the single source of truth; its ledger lines are
// derived on read, so a report can never disagree with the voucher it came
// from, and editing/cancelling a voucher needs no reversal bookkeeping.
//
// Every returned line:
//   { accountCode, accountName, debit, credit, date, company, companyInferred,
//     sourceType, sourceId, sourceDocNumber, description,
//     // optional, set on the party control line (Receivable/Payable):
//     partyType, partyId, partyName, billKey, billRef, dueDate, allocatesTo, onAccount,
//     // optional, set on cash/bank lines:
//     bankAccountId }
// A voucher's lines always net to zero (asserted by the test script).
import { num, r2, normName } from './financeConstants.js'
import { gstHead, OUTPUT_GST_CODE, INPUT_GST_CODE } from './taxCalc.js'

const acctName = (accounts, code) => accounts.find(a => a.code === code)?.name || code

const line = (accounts, code, debit, credit, extra = {}) => ({
  accountCode: code, accountName: acctName(accounts, code),
  debit: r2(debit), credit: r2(credit), ...extra,
})

const isCashBank = (code) => code === '1100' || code === '1110'

export const partyKeyOf = (partyId, partyName) => normName(partyName) || (partyId ? `id:${partyId}` : '')

// due date = bill date + credit days
export const addDays = (dateStr, days) => {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + num(days))
  // Local-date formatting: toISOString() converts to UTC and shifts the day back
  // by one in any timezone ahead of UTC (e.g. India).
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Rounding differences post to the rounding accounts exactly like invoices do.
// `partyIsDebited` = the party control line sits on the debit side (sales
// invoice, debit-note style) — then a positive roundOff is a *credit*.
function roundLine(accounts, roundOff, partyIsDebited) {
  const ro = r2(roundOff)
  if (!ro) return null
  const roundUp = ro > 0
  // Party debited & total rounded up → we billed more → credit income (4950).
  // Party credited & total rounded up → we owe more → debit expense (5950).
  if (partyIsDebited) return roundUp ? line(accounts, '4950', 0, ro) : line(accounts, '5950', -ro, 0)
  return roundUp ? line(accounts, '5950', ro, 0) : line(accounts, '4950', 0, -ro)
}

// Bill key naming — used both when a voucher creates a bill and when another
// voucher's allocation refers back to it.
export const billKey = (docType, docId) => `${docType}:${docId}`

export function deriveVoucherLines(v, accounts) {
  if (!v || v.status === 'cancelled' || !v.date) return []
  const t = v.voucherType
  let lines = []
  const party = {
    partyType: v.partyType || (t === 'purchase' || t === 'debit_note' || t === 'payment' ? 'vendor' : 'customer'),
    partyId: v.partyId || '', partyName: v.partyName || '',
  }
  const items = v.items || []
  const gst = v.gstLines || []
  const taxTotal = r2(gst.reduce((s, g) => s + num(g.amount), 0))
  const subTotal = r2(num(v.subTotal) || items.reduce((s, i) => s + num(i.taxable), 0))
  const total = r2(num(v.total))
  const roundOff = r2(num(v.roundOff))
  const tds = v.tds?.applicable ? r2(num(v.tds.amount)) : 0

  // Group the taxable value by the account each item posts to.
  const byAccount = (defaultCode) => {
    const m = {}
    items.forEach(i => {
      const code = i.accountCode || v.purchaseAccountCode || defaultCode
      m[code] = (m[code] || 0) + num(i.taxable)
    })
    return Object.entries(m)
  }

  if (t === 'purchase') {
    const itc = v.itcEligible !== false
    const rcm = !!v.rcm
    const ap = line(accounts, '2100', 0, total - tds, {
      ...party, billKey: billKey('purchase', v.id), billRef: v.voucherNumber, externalRef: v.refNumber || '',
      dueDate: v.dueDate || addDays(v.date, v.creditDays),
    })
    const heads = byAccount('5000')
    heads.forEach(([code, amt], idx) => {
      let debit = amt
      // Blocked / ineligible ITC is a cost — fold the tax into the first expense head.
      if (!itc && idx === 0) debit += taxTotal
      lines.push(line(accounts, code, debit, 0))
    })
    if (itc) {
      gst.forEach(g => {
        const head = gstHead(g.label); if (!head) return
        lines.push(line(accounts, INPUT_GST_CODE[head], num(g.amount), 0))
      })
    }
    if (rcm) {
      // The vendor isn't paid the tax; it's our own liability (cash ledger) with ITC claimed alongside.
      lines.push(line(accounts, '2404', 0, taxTotal))
    }
    lines.push(ap)
    if (tds) lines.push(line(accounts, '2500', 0, tds, { tdsSection: v.tds.section || '' }))
    const rl = roundLine(accounts, roundOff, false); if (rl) lines.push(rl)
  }

  else if (t === 'credit_note') {
    // Issued to a customer (sales return / rate or quantity correction): reverses revenue + output tax.
    heads(byAccount('4000'), lines, accounts, true)
    gst.forEach(g => {
      const head = gstHead(g.label); if (!head) return
      lines.push(line(accounts, OUTPUT_GST_CODE[head], num(g.amount), 0))
    })
    lines.push(line(accounts, '1200', 0, total, {
      ...party, partyType: 'customer', billRef: v.voucherNumber,
      ...(v.refInvoiceId ? { allocatesTo: billKey('invoice', v.refInvoiceId) } : { onAccount: true }),
    }))
    const rl = roundLine(accounts, roundOff, false); if (rl) lines.push(rl)
  }

  else if (t === 'debit_note') {
    // Issued to a vendor (purchase return / rate difference): reverses purchase + input tax.
    const itc = v.itcEligible !== false
    byAccount('5000').forEach(([code, amt], idx) => {
      let credit = amt
      if (!itc && idx === 0) credit += taxTotal
      lines.push(line(accounts, code, 0, credit))
    })
    if (itc) {
      gst.forEach(g => {
        const head = gstHead(g.label); if (!head) return
        lines.push(line(accounts, INPUT_GST_CODE[head], 0, num(g.amount)))
      })
    }
    lines.push(line(accounts, '2100', total, 0, {
      ...party, partyType: 'vendor', billRef: v.voucherNumber,
      ...(v.refPurchaseId ? { allocatesTo: billKey('purchase', v.refPurchaseId) } : { onAccount: true }),
    }))
    const rl = roundLine(accounts, roundOff, true); if (rl) lines.push(rl)
  }

  else if (t === 'payment') {
    const partyAmt = r2(num(v.partyAmount))
    const accLines = (v.accountLines || []).filter(l => num(l.amount) > 0)
    const accSum = r2(accLines.reduce((s, l) => s + num(l.amount), 0))
    const bankAmt = r2(partyAmt + accSum - tds)
    const bankCode = v.bankAccountCode || '1100'
    if (partyAmt > 0) {
      const allocs = (v.allocations || []).filter(a => num(a.amount) > 0)
      let allocated = 0
      allocs.forEach(a => {
        allocated += num(a.amount)
        lines.push(line(accounts, '2100', num(a.amount), 0, {
          ...party, partyType: 'vendor', billRef: a.docNumber || '', allocatesTo: a.billKey,
        }))
      })
      const rest = r2(partyAmt - allocated)
      if (rest > 0.004) lines.push(line(accounts, '2100', rest, 0, { ...party, partyType: 'vendor', billRef: v.voucherNumber, onAccount: true }))
    }
    accLines.forEach(l => lines.push(line(accounts, l.accountCode, num(l.amount), 0, { description: l.description || '' })))
    lines.push(line(accounts, bankCode, 0, bankAmt, isCashBank(bankCode) && v.bankAccountId ? { bankAccountId: v.bankAccountId } : {}))
    if (tds) lines.push(line(accounts, '2500', 0, tds, { tdsSection: v.tds.section || '' }))
  }

  else if (t === 'receipt') {
    const partyAmt = r2(num(v.partyAmount))
    const accLines = (v.accountLines || []).filter(l => num(l.amount) > 0)
    const accSum = r2(accLines.reduce((s, l) => s + num(l.amount), 0))
    const tdsRec = v.tdsReceivable?.applicable ? r2(num(v.tdsReceivable.amount)) : 0
    const bankAmt = r2(partyAmt - tdsRec + accSum)
    const bankCode = v.bankAccountCode || '1100'
    lines.push(line(accounts, bankCode, bankAmt, 0, isCashBank(bankCode) && v.bankAccountId ? { bankAccountId: v.bankAccountId } : {}))
    if (tdsRec) lines.push(line(accounts, '1310', tdsRec, 0, { tdsSection: v.tdsReceivable.section || '' }))
    if (partyAmt > 0) {
      const allocs = (v.allocations || []).filter(a => num(a.amount) > 0)
      let allocated = 0
      allocs.forEach(a => {
        allocated += num(a.amount)
        lines.push(line(accounts, '1200', 0, num(a.amount), {
          ...party, partyType: 'customer', billRef: a.docNumber || '', allocatesTo: a.billKey,
        }))
      })
      const rest = r2(partyAmt - allocated)
      if (rest > 0.004) lines.push(line(accounts, '1200', 0, rest, { ...party, partyType: 'customer', billRef: v.voucherNumber, onAccount: true }))
    }
    accLines.forEach(l => lines.push(line(accounts, l.accountCode, 0, num(l.amount), { description: l.description || '' })))
  }

  else if (t === 'contra') {
    const amt = r2(num(v.amount))
    const to = v.toAccountCode || '1100', from = v.fromAccountCode || '1110'
    lines.push(line(accounts, to, amt, 0, isCashBank(to) && v.toBankAccountId ? { bankAccountId: v.toBankAccountId } : {}))
    lines.push(line(accounts, from, 0, amt, isCashBank(from) && v.fromBankAccountId ? { bankAccountId: v.fromBankAccountId } : {}))
  }

  else return []

  return lines
    .filter(l => Math.abs(l.debit) > 0.004 || Math.abs(l.credit) > 0.004)
    .map(l => ({
      ...l,
      date: v.date,
      company: v.company || 'UIPL',
      companyInferred: false,
      sourceType: t,
      sourceId: v.id,
      sourceDocNumber: v.voucherNumber || v.id,
      description: l.description || v.partyName || v.narration || '',
      ...(v.costCentreId ? { costCentreId: v.costCentreId } : {}),
    }))
}

// small helper used by credit_note (kept out of the main flow for readability)
function heads(entries, lines, accounts, debitSide) {
  entries.forEach(([code, amt]) => lines.push(debitSide ? line(accounts, code, amt, 0) : line(accounts, code, 0, amt)))
}

// ── Opening balances ────────────────────────────────────────────────────────
// Customer/vendor/bank masters carry an opening balance; it enters the books as
// a balanced pair against 'Opening Balance Equity' (3200), dated at the
// opening date (default: start of the earliest FY the app knows about).
export function deriveOpeningLines({ customers = [], vendors = [], bankAccounts = [], accounts = [], defaultDate = '2000-04-01' }) {
  const out = []
  const push = (lns, meta) => lns.forEach(l => out.push({
    ...l, ...meta, companyInferred: false, sourceType: 'opening',
  }))

  customers.forEach(c => {
    const amt = r2(num(c.openingBalance)); if (!amt) return
    const dr = (c.openingType || 'Dr') === 'Dr'
    const company = c.openingCompany || c.company || (c.companies || [])[0] || 'UIPL'
    const key = partyKeyOf(c.id, c.shopName)
    const meta = { date: c.openingDate || defaultDate, company, sourceId: `cust-${c.id}`, sourceDocNumber: 'Opening Balance', description: c.shopName }
    push([
      line(accounts, '1200', dr ? amt : 0, dr ? 0 : amt, {
        partyType: 'customer', partyId: c.id, partyName: c.shopName, billKey: billKey('opening', `c-${key}`), billRef: 'Opening Balance',
        dueDate: c.openingDate || defaultDate,
      }),
      line(accounts, '3200', dr ? 0 : amt, dr ? amt : 0),
    ], meta)
  })

  vendors.forEach(vd => {
    const amt = r2(num(vd.openingBalance)); if (!amt) return
    const cr = (vd.openingType || 'Cr') === 'Cr'
    const company = vd.openingCompany || 'UIPL'
    const key = partyKeyOf(vd.id, vd.vendorName)
    const meta = { date: vd.openingDate || defaultDate, company, sourceId: `vend-${vd.id}`, sourceDocNumber: 'Opening Balance', description: vd.vendorName }
    push([
      line(accounts, '2100', cr ? 0 : amt, cr ? amt : 0, {
        partyType: 'vendor', partyId: vd.id, partyName: vd.vendorName, billKey: billKey('opening', `v-${key}`), billRef: 'Opening Balance',
        dueDate: vd.openingDate || defaultDate,
      }),
      line(accounts, '3200', cr ? amt : 0, cr ? 0 : amt),
    ], meta)
  })

  bankAccounts.forEach(b => {
    const amt = r2(num(b.openingBalance)); if (!amt) return
    const code = b.type === 'cash' ? '1110' : '1100'
    const meta = { date: b.openingDate || defaultDate, company: b.company || 'UIPL', sourceId: `bank-${b.id}`, sourceDocNumber: 'Opening Balance', description: b.name }
    push([
      line(accounts, code, amt > 0 ? amt : 0, amt > 0 ? 0 : -amt, { bankAccountId: b.id }),
      line(accounts, '3200', amt > 0 ? 0 : -amt, amt > 0 ? amt : 0),
    ], meta)
  })
  return out
}
