// Export to Tally (XML import format) — ledger masters and accounting vouchers.
//
// Every voucher is rebuilt from its ledger lines, so what Tally receives balances exactly
// like the books here. Best effort: voucher-level statutory details (GST classification,
// HSN, bill allocations, inventory entries) are not included — import into a TEST company
// first and let your CA review.
import { num, r2, kindOfSource } from './financeConstants.js'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const ymd = (d) => (d || '').replace(/-/g, '')
const amt = (n) => (Math.round(n * 100) / 100).toFixed(2)

const TALLY_TYPE = { sales: 'Sales', purchase: 'Purchase', receipt: 'Receipt', payment: 'Payment', contra: 'Contra', journal: 'Journal', credit_note: 'Credit Note', debit_note: 'Debit Note', expense: 'Payment', opening: 'Journal', stock: 'Journal' }

function groupFor(account) {
  const c = account.code
  if (c === '1100') return 'Bank Accounts'
  if (c === '1110') return 'Cash-in-Hand'
  if (c === '1400') return 'Stock-in-Hand'
  if (c === '1500') return 'Fixed Assets'
  if (c.startsWith('13')) return c === '1310' ? 'Current Assets' : 'Duties & Taxes'
  if (account.type === 'asset') return 'Current Assets'
  if (c.startsWith('24') || c === '2500') return 'Duties & Taxes'
  if (account.type === 'liability') return 'Current Liabilities'
  if (account.type === 'equity') return c === '3200' ? 'Suspense A/c' : 'Capital Account'
  if (c === '4000') return 'Sales Accounts'
  if (account.type === 'income') return 'Indirect Incomes'
  if (c === '5000') return 'Purchase Accounts'
  if (c === '5010') return 'Direct Expenses'
  return 'Indirect Expenses'
}

const envelope = (report, company, body) => `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>${report}</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>
  <REQUESTDATA>
${body}
  </REQUESTDATA>
 </IMPORTDATA></BODY>
</ENVELOPE>
`

const ledgerXml = (name, parent, extra = '') => `   <TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>${esc(parent)}</PARENT>${extra}</LEDGER></TALLYMESSAGE>`

// The ledger name Tally will see for a line: parties are their own ledgers.
export const tallyLedgerName = (l) => ((l.accountCode === '1200' || l.accountCode === '2100') && l.partyName) ? l.partyName : (l.accountName || l.accountCode)

export function tallyMasters({ accounts, lines, customers = [], vendors = [], bankAccounts = [], company }) {
  const out = []
  const seen = new Set()
  const add = (name, parent, extra) => { const k = name.toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push(ledgerXml(name, parent, extra)) }
  accounts.filter(a => !['1200', '2100'].includes(a.code)).forEach(a => add(a.name, groupFor(a)))
  bankAccounts.filter(b => b.company === company).forEach(b => add(b.name, b.type === 'cash' ? 'Cash-in-Hand' : b.type === 'fd' ? 'Investments' : 'Bank Accounts'))
  customers.forEach(c => c.shopName && add(c.shopName, 'Sundry Debtors', c.gstin ? `<PARTYGSTIN>${esc(c.gstin)}</PARTYGSTIN>` : ''))
  vendors.forEach(v => v.vendorName && add(v.vendorName, 'Sundry Creditors', v.gstin ? `<PARTYGSTIN>${esc(v.gstin)}</PARTYGSTIN>` : ''))
  lines.forEach(l => { if (l.partyName && l.accountCode === '1200') add(l.partyName, 'Sundry Debtors'); if (l.partyName && l.accountCode === '2100') add(l.partyName, 'Sundry Creditors') })
  return envelope('All Masters', company, out.join('\n'))
}

export function tallyVouchers({ lines, company, from, to, companyName }) {
  const docs = new Map()
  lines.filter(l => l.company === company && (!from || l.date >= from) && (!to || l.date <= to)).forEach(l => {
    const k = `${l.sourceType}:${l.sourceId}:${l.date}`
    if (!docs.has(k)) docs.set(k, [])
    docs.get(k).push(l)
  })
  const body = []
  let count = 0
  ;[...docs.values()].sort((a, b) => a[0].date.localeCompare(b[0].date)).forEach(ls => {
    const first = ls[0]
    const vtype = TALLY_TYPE[kindOfSource(first.sourceType)] || 'Journal'
    const party = ls.find(l => l.partyName && (l.accountCode === '1200' || l.accountCode === '2100'))?.partyName || ''
    const entries = ls.map(l => {
      const dr = r2(num(l.debit) - num(l.credit))
      return `     <ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(tallyLedgerName(l))}</LEDGERNAME><ISDEEMEDPOSITIVE>${dr > 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amt(-dr)}</AMOUNT></ALLLEDGERENTRIES.LIST>`
    })
    count++
    body.push(`   <TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${vtype}" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${ymd(first.date)}</DATE><VOUCHERTYPENAME>${vtype}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(first.sourceDocNumber || first.sourceId)}</VOUCHERNUMBER>${party ? `<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>` : ''}
     <NARRATION>${esc(first.description || '')}</NARRATION>
${entries.join('\n')}
    </VOUCHER></TALLYMESSAGE>`)
  })
  return { xml: envelope('Vouchers', companyName || company, body.join('\n')), count }
}
