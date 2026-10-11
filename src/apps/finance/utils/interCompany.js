// UIPL ⇄ Wayzim service fee. Wayzim only sells; UIPL sells on its behalf and employs the staff who serve it, and bills
// Wayzim a service fee. That one invoice is a sale for UIPL and a cost for Wayzim, so Wayzim's books are mirrored
// from UIPL's documents rather than keyed twice:
//   UIPL invoice to Wayzim          → Wayzim:  Dr Service Fee to UIPL (5200) / Cr Payable to UIPL (2100)
//   UIPL credit note to Wayzim      → Wayzim:  Dr Payable to UIPL / Cr Service Fee to UIPL
//   UIPL receipt from Wayzim        → Wayzim:  Dr Payable to UIPL / Cr Bank  (+ exchange difference)
// The mirror is derived at read time like every other ledger line, so editing or cancelling the UIPL document
// changes Wayzim's books too. (There is no consolidated statement that eliminates the two sides yet.)
import { num, r2 } from './financeConstants.js'
import { billKey } from './voucherEngine.js'

export const GROUP_COMPANY = 'Wayzim'
export const isGroupPartyName = (name, groupLegalName) => {
  const n = (name || '').toLowerCase()
  return !!n && (n.includes('wayzim') || (!!groupLegalName && n === groupLegalName.toLowerCase()))
}

const acct = (accounts, code) => { const a = accounts.find(x => x.code === code); return { accountCode: code, accountName: a?.name || code } }
const base = (company, date, sourceType, sourceId, doc) => ({ company, date, companyInferred: false, sourceType, sourceId, sourceDocNumber: doc, description: 'UIPL service fee' })
const fcTagOf = (cur, fcAmount, rate) => (cur && cur !== 'INR' && num(fcAmount) ? { currency: cur, fcAmount: r2(fcAmount), fxRate: num(rate) } : {})

export function deriveInterCompanyLines({ invoices = [], vouchers = [], accounts = [] }) {
  const out = []
  const party = { partyType: 'vendor', partyId: 'uipl', partyName: 'UIPL' }

  invoices.forEach(inv => {
    if (!inv.interCompany || inv.company === inv.interCompany || !inv.invoiceDate || ['PI', 'SO'].includes(inv.invoiceType)) return
    const total = r2(num(inv.total))
    if (!total) return
    const b = base(inv.interCompany, inv.invoiceDate, 'icinvoice', inv.id, inv.invoiceNumber || inv.id)
    out.push({ ...acct(accounts, '5200'), debit: total, credit: 0, ...b })
    out.push({ ...acct(accounts, '2100'), debit: 0, credit: total, ...b, ...party, billKey: billKey('ic', inv.id), billRef: inv.invoiceNumber || inv.id, dueDate: inv.dueDate || inv.invoiceDate,
      ...fcTagOf(inv.fx?.currency, inv.fx?.total, inv.fx?.rate) })
  })

  vouchers.forEach(v => {
    if (!v.interCompany || v.status === 'cancelled' || !v.date) return
    const target = v.interCompany
    if (v.voucherType === 'credit_note') {
      const total = r2(num(v.total)); if (!total) return
      const b = base(target, v.date, 'iccn', v.id, v.voucherNumber)
      out.push({ ...acct(accounts, '2100'), debit: total, credit: 0, ...b, ...party, billRef: v.voucherNumber, ...(v.refInvoiceId ? { allocatesTo: billKey('ic', v.refInvoiceId) } : { onAccount: true }),
        ...fcTagOf(v.currency, v.fc?.total, v.fxRate) })
      out.push({ ...acct(accounts, '5200'), debit: 0, credit: total, ...b })
    }
    if (v.voucherType === 'receipt') {
      // what UIPL received is what Wayzim paid
      const partyAmt = r2(num(v.partyAmount)); if (!partyAmt) return
      const bankGot = v.bankAmountInr !== undefined && v.bankAmountInr !== null && v.bankAmountInr !== '' ? r2(num(v.bankAmountInr)) : partyAmt
      const b = base(target, v.date, 'icpayment', v.id, v.voucherNumber)
      let allocated = 0
      ;(v.allocations || []).filter(a => num(a.amount) > 0).forEach(a => {
        allocated += num(a.amount)
        out.push({ ...acct(accounts, '2100'), debit: r2(a.amount), credit: 0, ...b, ...party, billRef: a.docNumber || '', allocatesTo: String(a.billKey || '').replace(/^invoice:/, 'ic:'), ...fcTagOf(v.currency, a.fcAmount, a.billRate) })
      })
      const rest = r2(partyAmt - allocated)
      if (rest > 0.004) out.push({ ...acct(accounts, '2100'), debit: rest, credit: 0, ...b, ...party, billRef: v.voucherNumber, onAccount: true, ...fcTagOf(v.currency, v.onAccountFc, v.fxRate) })
      out.push({ ...acct(accounts, '1100'), debit: 0, credit: bankGot, ...b })
      const diff = r2(bankGot - partyAmt)       // Wayzim paid more rupees than the liability it cleared → loss
      if (diff > 0.004) out.push({ ...acct(accounts, '5925'), debit: diff, credit: 0, ...b })
      else if (diff < -0.004) out.push({ ...acct(accounts, '4925'), debit: 0, credit: -diff, ...b })
    }
  })
  return out
}
