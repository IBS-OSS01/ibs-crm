// Entries made from bank statements under an earlier rule set: re-run today's rules on the bank narrative and offer the ones
// that now have a clear home —
//   • parked ones (Miscellaneous Expenses / Other Current Liabilities) and salary guesses that are really director money, tax, etc.
//   • GST charged by the bank that was booked as a payment to a vendor (matched by a reference in the narrative) → Input GST.
// Only untouched, statement-made entries are considered — anything the user edited by hand has a different description.
import { suggestEntry } from './bankEntries.js'
import { r2, num } from './financeConstants.js'

// the note the app wrote when it made the entry → the ledger it put it in. If the ledger is different now, a person changed it: leave it.
const ORIGINAL = [[/^Unidentified payment/, '5900'], [/^Unidentified receipt/, '2900'], [/^(Paid to a director|Money from a director)/, '2900'], [/^Paid to employee/, '5110']]
const originalLedger = (desc) => (ORIGINAL.find(([re]) => re.test(String(desc || ''))) || [])[1]
const INPUT_GST = /^130[123]$/

export function reclassifyProposals(vouchers, ctx) {
  const out = []
  for (const v of vouchers || []) {
    if (!['payment', 'receipt'].includes(v.voucherType) || v.status === 'cancelled') continue
    const amt = r2(num(v.amount))
    const line = { description: v.narration, ref: v.refNumber, debit: v.voucherType === 'payment' ? amt : 0, credit: v.voucherType === 'receipt' ? amt : 0 }
    if (v.partyId || v.partyName) {
      if (v.voucherType !== 'payment') continue
      const s = suggestEntry(line, { ...ctx, customers: [], vendors: [], employees: [] })        // ignore the party it was wrongly matched to
      if (INPUT_GST.test(s.accountCode || '')) out.push({ voucher: v, suggestion: s, wasParty: true })
      continue
    }
    if (!v.bankStatementLine) continue
    const al = v.accountLines || []
    if (al.length !== 1 || !originalLedger(al[0].description) || al[0].accountCode !== originalLedger(al[0].description)) continue
    const s = suggestEntry(line, ctx)
    if (s.kind !== v.voucherType || (!s.accountCode && !s.partyId)) continue
    if (!s.partyId && s.accountCode === al[0].accountCode) continue
    if (s.review && s.accountCode !== '2910') continue          // still unidentified — leave it parked
    out.push({ voucher: v, suggestion: s })
  }
  return out
}

// the fields to write back on the voucher
export function reclassifiedFields(v, s) {
  const amt = r2(num(v.amount))
  if (s.partyId) return { partyType: s.partyType, partyId: s.partyId, partyName: s.partyName, partyAmount: amt, accountLines: [] }
  const old = (v.accountLines || [])[0] || {}
  return { partyType: '', partyId: '', partyName: '', partyAmount: 0, allocations: [], accountLines: [{ ...old, accountCode: s.accountCode, amount: amt, description: s.reason }] }
}
