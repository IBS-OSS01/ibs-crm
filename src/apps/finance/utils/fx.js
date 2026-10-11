// Multi-currency helpers. The books are always kept in INR (the base currency): a foreign-currency
// document is entered in that currency, converted at the exchange rate on its booking date, and every
// ledger amount is the INR figure. The foreign amount is remembered on the document (`fc`) and on the party
// line, so a later payment / receipt can settle the bill in that currency and book the exchange difference.
import { num, r2 } from './financeConstants.js'

export const CURRENCIES = [
  ['INR', 'Indian Rupee', '₹'], ['USD', 'US Dollar', '$'], ['EUR', 'Euro', '€'], ['GBP', 'Pound Sterling', '£'], ['AED', 'UAE Dirham', 'AED'],
  ['SGD', 'Singapore Dollar', 'S$'], ['JPY', 'Japanese Yen', '¥'], ['CNY', 'Chinese Yuan', 'CN¥'], ['AUD', 'Australian Dollar', 'A$'], ['CAD', 'Canadian Dollar', 'C$'],
  ['CHF', 'Swiss Franc', 'CHF'], ['HKD', 'Hong Kong Dollar', 'HK$'], ['SAR', 'Saudi Riyal', 'SAR'], ['QAR', 'Qatari Riyal', 'QAR'], ['MYR', 'Malaysian Ringgit', 'RM'],
  ['THB', 'Thai Baht', '฿'], ['ZAR', 'South African Rand', 'R'], ['KRW', 'South Korean Won', '₩'], ['NZD', 'New Zealand Dollar', 'NZ$'], ['BDT', 'Bangladeshi Taka', '৳'],
].map(([code, name, symbol]) => ({ code, name, symbol }))

export const symbolOf = (code) => CURRENCIES.find(c => c.code === code)?.symbol || code || '₹'
export const fmtFc = (amount, code) => `${symbolOf(code)} ${(Number(amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Latest rate on or before `date` (INR per 1 unit). Falls back to the earliest later rate if none earlier exists.
export function rateOn(rates = [], currency, date) {
  if (!currency || currency === 'INR') return 1
  const list = rates.filter(r => r.currency === currency && num(r.rate) > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  if (!list.length) return 0
  let best = null
  for (const r of list) { if ((r.date || '') <= date) best = r; else break }
  return num((best || list[0]).rate)
}

// FC totals (from computeVoucherTotals with rounding:false) → the INR document fields the ledger engine reads.
export function convertTotals(fcTotals, fx, currency) {
  const rate = num(fx)
  const items = fcTotals.items.map(i => {
    const taxable = r2(num(i.taxable) * rate), cgst = r2(num(i.cgst) * rate), sgst = r2(num(i.sgst) * rate), igst = r2(num(i.igst) * rate)
    const lineTax = r2(cgst + sgst + igst)
    return { ...i, rateFc: i.rate, rate: r2(num(i.rate) * rate), taxable, cgst, sgst, igst, lineTax, lineTotal: r2(taxable + lineTax) }
  })
  const gstLines = fcTotals.gstLines.map(g => ({ ...g, base: r2(num(g.base) * rate), amount: r2(num(g.amount) * rate) }))
  const subTotal = r2(items.reduce((s, i) => s + i.taxable, 0))
  const sumHead = (re) => r2(gstLines.filter(g => re.test(g.label)).reduce((s, g) => s + g.amount, 0))
  const taxTotal = r2(gstLines.reduce((s, g) => s + g.amount, 0))
  return {
    items, gstLines, subTotal, taxTotal, roundOff: 0, total: r2(subTotal + taxTotal),
    cgst: sumHead(/^CGST/), sgst: sumHead(/^SGST/), igst: sumHead(/^IGST/),
    fc: { currency, rate, subTotal: fcTotals.subTotal, taxTotal: fcTotals.taxTotal, total: fcTotals.total },
  }
}

// Unrealised gain / loss on open foreign-currency bills at a closing rate.
//   receivable: closing value higher than book value = gain;   payable: higher = loss.
export function revaluation(openBills, kind, rateFor) {
  return openBills.filter(b => b.currency && num(b.fcPending) > 0).map(b => {
    const closing = rateFor(b.currency)
    const book = r2(num(b.fcPending) * num(b.fxRate)), now = r2(num(b.fcPending) * closing)
    const diff = r2(now - book)
    return { ...b, closingRate: closing, bookInr: book, closingInr: now, gain: kind === 'receivable' ? diff : -diff }
  })
}

// ECB reference rate for `currency` → INR on `date` (weekends / holidays return the previous working day).
// Not the RBI or customs-notified rate: use it as a convenient default and overwrite when your CA/bank rate differs.
// AED, SAR and QAR are pegged to the dollar and not published by the ECB, so they are derived from USD.
const PEGS = { AED: 3.6725, SAR: 3.75, QAR: 3.64 }
export async function fetchMarketRate(currency, date) {
  const base = PEGS[currency] ? 'USD' : currency
  const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${base}&symbols=INR`)
  if (!res.ok) throw new Error(`No rate available for ${currency} on ${date}`)
  const j = await res.json()
  const inr = j?.rates?.INR
  if (!inr) throw new Error(`No rate available for ${currency}`)
  return { rate: Math.round((PEGS[currency] ? inr / PEGS[currency] : inr) * 10000) / 10000, date: j.date }
}
