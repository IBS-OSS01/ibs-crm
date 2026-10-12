// Bank statement line → suggested accounting entry (receipt / payment / contra), and the voucher that goes with it.
// Pure functions; the review dialog lets the user change every suggestion before anything is posted.
import { r2 } from './financeConstants.js'
import { INPUT_GST_CODE } from './taxCalc.js'

const STOP = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'company', 'the', 'and', 'of', 'india', 'services', 'service', 'solutions', 'solution', 'from', 'neft', 'imps'])
const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(t => t.length > 1 && !STOP.has(t))

const within1 = (a, b) => {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, miss = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++miss > 1) return false
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++ }
  }
  return miss + (a.length - i) + (b.length - j) <= 1
}
const hit = (t, set) => set.has(t) || (t.length >= 6 && [...set].some(u => u.length >= 6 && within1(t, u)))

// Best matching party for a bank narrative: every word of the party's name (or ≥2 words and ≥60%) must appear.
export function bestParty(text, parties) {
  const T = new Set(toks(text))
  let best = null
  for (const p of parties) {
    const pt = toks(p.name); if (!pt.length) continue
    const hits = pt.filter(t => hit(t, T)).length
    const score = hits / pt.length
    if (!(score === 1 || (hits >= 2 && score >= 0.6))) continue
    if (!best || hits > best.hits || (hits === best.hits && score > best.score)) best = { party: p, hits, score }
  }
  return best?.party || null
}

const ALIASES = [   // narrative fragment → party name to look for (statement text rarely carries the full legal name)
  { re: /DEUTSCHE BANK|DEUTR|DEUTN|CHASR|CHAS\d|8110514013202296/i, side: 'credit', like: 'wayzim technology' },
  { re: /WAYZ\d|WAYZIM TECHNOLOGY|FCYAMT|CIOCOR/i, side: 'debit', like: 'wayzim technology' },
  { re: /AMAZON TRNSPT|AMAZON TRANSP/i, side: 'credit', like: 'amazon transportation' },
  { re: /AMAZON SELLER/i, side: 'credit', like: 'amazon seller' },
  { re: /INSTAKART/i, side: 'credit', like: 'instakart' },
]

const DIRECTORS = /KUMAR KAUSHIK VARSH|VARSHA KRI|VARSHA KAUSHIK|KHARBANDA S\b|SANDEEP KHARBANDA|NEHA MALHOTRA|ADVAIT KAUSHIK|FROM KUMAR P\b|VARSHAKRISHANKUMARKA/i
// banks break names across words ("SANDEEP K HARBANDA"), so also test the narrative with only its letters
const DIRECTORS_FLAT = /SANDEEPKHARBANDA|VARSHAKRISHAN|NEHAMALHOTRA|ADVAITKAUSHIK/
const isDirector = (d) => DIRECTORS.test(d) || /66452000001865|XX\s?1865\b/i.test(d) || DIRECTORS_FLAT.test(String(d).toUpperCase().replace(/[^A-Z]/g, ''))
const digitsOf = (s) => String(s || '').replace(/\D/g, '')

// line: { date, description, ref, debit, credit, trnType }
// ctx:  { customers: [{id,name}], vendors: [{id,name}], banks: [{id,name,accountNumber}], thisBankId }
export function suggestEntry(line, ctx) {
  const d = String(line.description || ''), isCredit = line.credit > 0
  const out = (o) => ({ kind: isCredit ? 'receipt' : 'payment', partyType: '', partyId: '', partyName: '', accountCode: '', otherBankId: '', reason: '', review: false, ...o })
  const others = (ctx.banks || []).filter(b => b.id !== ctx.thisBankId)

  // 0. sweep to / from a fixed deposit, and interest the bank credits on it (the narrative carries the FD / sweep account number)
  const fdHit = (ctx.fds || []).find(f => String(f.accountNumber || '').split(/[,;/\s]+/).map(digitsOf).some(a => a.length >= 6 && (d.match(/\d{9,}/g) || []).some(n => n.endsWith(a) || a.endsWith(n))))
  if (fdHit && /SWEEP|SWCR|AUTO|\bFD\b|DEPOSIT|INT\.?\s*ON/i.test(d)) {
    if (isCredit && /INT\.?\s*ON|INTEREST/i.test(d)) return out({ accountCode: '4910', reason: `Interest on ${fdHit.name}` })
    return out({ kind: 'contra', otherBankId: fdHit.id, reason: isCredit ? `Sweep-in from ${fdHit.name}` : `Sweep-out to ${fdHit.name}` })
  }
  // 1. money moving between our own accounts → contra
  if (/UDISHTHA INNOVATIONS/i.test(d)) {
    const nums = d.match(/\d{9,}/g) || []
    const other = others.find(b => { const a = digitsOf(b.accountNumber); return a.length >= 6 && nums.some(n => n.endsWith(a) || a.endsWith(n)) })
      || others.find(b => toks(`${b.name} ${b.bankName || ''}`).some(t => t.length >= 4 && d.toLowerCase().includes(t)))      // e.g. "…HDFC BANK LTD" in the narrative
    return out({ kind: 'contra', otherBankId: other?.id || '', reason: other ? `Transfer ${isCredit ? 'from' : 'to'} ${other.name}` : 'Transfer between own accounts — choose the other bank', review: !other })
  }
  // 2. GST charged on bank charges → input tax
  const gst = /\b(CGST|SGST|IGST)\b/i.exec(d)
  if (gst && !isCredit && (/TAX/i.test(line.trnType || '') || /^(TAX\s+)?MH\s+(CGST|SGST|IGST)\b/i.test(d))) {
    const head = gst[1].toLowerCase()
    return out({ accountCode: INPUT_GST_CODE[head], reason: `Input ${gst[1].toUpperCase()} on bank charges` })
  }
  // 3. bank charges
  if (!isCredit && (/Bank Charges|IMP BILL COMM|Annual fee/i.test(d) || /SVC/.test(line.trnType || ''))) return out({ accountCode: '5170', reason: 'Bank charges' })
  // 4. salaries
  if (!isCredit && /\bSALARY\b|SAL DIFF|AUTOPAY OUT/i.test(d)) return out({ accountCode: '5110', reason: /AUTOPAY/i.test(d) ? 'Salary batch' : 'Salary' })
  // 4b. statutory dues paid through net banking (the narrative names the person who made the payment, so check this before the directors rule)
  if (!isCredit && /\bGST TAX PAYMENT\b|\bGST PAYMENT\b/i.test(d)) return out({ accountCode: '2400', reason: 'GST paid to the government (split into CGST / SGST / IGST when you file)' })
  if (!isCredit && /\bTDS\b/i.test(d) && !/REFUND|DEBT/i.test(d)) return out({ accountCode: '2500', reason: 'TDS paid to the government' })
  if (!isCredit && /\bPTRC\b|PROFESSIONAL TAX/i.test(d)) return out({ accountCode: '2630', reason: 'Professional tax paid' })
  // 4b-2. tax challans (CBDT / OLTAS), bank-guarantee commission and stamp paper, courier, domains and printing
  if (!isCredit && /CBDT|\bOLTAS\b/i.test(d)) return out({ accountCode: '2500', reason: 'Tax paid to the government by challan (CBDT) — TDS' })
  if (!isCredit && /COMM-GTEE|CHGS-STMP|STMP-PAPER|GUARANTEE (COMM|CHG)/i.test(d)) return out({ accountCode: '5170', reason: 'Bank guarantee commission / stamp paper charges' })
  if (!isCredit && /\bDHL\b|DHLMB|FEDEX|BLUE\s?DART|\bDTDC\b|DELHIVERY/i.test(d)) return out({ accountCode: '5120', reason: 'Courier / freight' })
  if (!isCredit && /GODADDY|HOSTINGER|GOOGLE\s?(WORKSPACE|CLOUD)|MICROSOFT|\bZOHO\b/i.test(d)) return out({ accountCode: '5135', reason: 'IT, software and internet' })
  if (!isCredit && /VISTAPRINT/i.test(d)) return out({ accountCode: '5150', reason: 'Printing / marketing material' })
  // 4c. staff (HR employees): salary or a reimbursement, even when the narrative does not say SALARY
  if (!isCredit && (ctx.employees || []).length && !isDirector(d)) {
    const emp = bestParty(d, ctx.employees.map(n => ({ id: n, name: n })))
    if (emp) return out({ accountCode: '5110', reason: `Paid to employee ${emp.name}`, review: /CONSULT|VISIT|MEAL|FOOD|TKT|TRAVEL|ADVANCE|LOAN/i.test(d) })
  }
  // 5. directors / promoters' own money
  if (isDirector(d)) return out({ accountCode: '2910', reason: isCredit ? 'Money from a director / promoter — loan or capital?' : 'Paid to a director / promoter — advance, reimbursement or loan repayment?', review: true })
  // 6. known counter-parties
  const pool = isCredit ? ctx.customers : ctx.vendors
  const alias = ALIASES.find(a => a.side === (isCredit ? 'credit' : 'debit') && a.re.test(d))
  const byAlias = alias ? pool.find(p => toks(p.name).join(' ').includes(alias.like)) : null
  const party = byAlias || bestParty(d, pool)
  if (party) return out({ partyType: isCredit ? 'customer' : 'vendor', partyId: party.id, partyName: party.name, reason: `${isCredit ? 'Received from' : 'Paid to'} ${party.name}` })
  // 7. rent
  if (!isCredit && /RENT\b|RONAK DEVIDAS LONKAR/i.test(d)) return out({ accountCode: /DEPOSIT/i.test(d) ? '1900' : '5100', reason: /DEPOSIT/i.test(d) ? 'Godown deposit' : 'Rent (godown landlord)' })
  // 8. unidentified
  return out({ accountCode: isCredit ? '2900' : '5900', reason: isCredit ? 'Unidentified receipt — parked in Other Current Liabilities until you classify it' : 'Unidentified payment — parked in Miscellaneous Expenses until you classify it', review: true })
}

export const suggestAll = (lines, ctx) => lines.map(l => ({ lineId: l.id, ...suggestEntry(l, ctx) }))

// The voucher document (as the Payment / Receipt / Contra forms would save it) for one reviewed row.
export function buildVoucher(row, line, { company, bank, interCompanyFlag }) {
  const amt = r2(line.credit || line.debit)
  const common = { company, date: line.date, refNumber: String(line.ref || '').slice(0, 60), narration: String(line.description || '').slice(0, 250), bankStatementLine: line.id }
  if (row.kind === 'contra') {
    const other = row.otherBank
    const from = line.credit ? other : bank, to = line.credit ? bank : other
    const codeOf = (x) => (x.fd ? '1520' : '1100')                     // a fixed deposit is the other side of a sweep
    return { voucherType: 'contra', ...common, amount: amt, fromAccountCode: codeOf(from), fromBankAccountId: from.id || '', toAccountCode: codeOf(to), toBankAccountId: to.id || '', fromAccountName: from.name, toAccountName: to.name }
  }
  const viaParty = !!row.partyId || !!row.partyName
  const base = {
    ...common, ...(viaParty ? { partyType: row.partyType, partyId: row.partyId, partyName: row.partyName } : {}),
    partyAmount: viaParty ? amt : 0, allocations: [], accountLines: viaParty ? [] : [{ accountCode: row.accountCode, amount: amt, description: row.reason || '' }],
    bankAccountCode: '1100', bankAccountId: bank.id || '', amount: amt, currency: 'INR', fxRate: 1, bankAmountInr: null, onAccountFc: 0,
  }
  if (row.kind === 'receipt') return { voucherType: 'receipt', ...base, ...(interCompanyFlag || {}), tdsReceivable: { applicable: false } }
  return { voucherType: 'payment', ...base, tds: { applicable: false } }
}

// The key bookEntries() will give this voucher's bank line, so the statement line can be matched to it straight away.
export const bankLineKey = (voucherType, voucherId, line) => {
  const credit = line.credit > 0
  const amt = r2(line.credit || line.debit)
  return `${voucherType}:${voucherId}|${credit ? amt : 0}|${credit ? 0 : amt}|1`
}
