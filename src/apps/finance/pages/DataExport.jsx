// Data export: Tally XML (masters + vouchers) and full Excel dumps for the accountant.
import React, { useMemo, useState } from 'react'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { tallyMasters, tallyVouchers } from '../utils/tallyExport.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { computeAccountBalances } from '../utils/ledger.js'
import { fyRange, currentFY, todayStr, VOUCHER_TYPES, kindOfSource } from '../utils/financeConstants.js'
import { downloadXlsx } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, DateRange, cardCls, btnPrimary, btnGhost } from '../components/FinanceUI.jsx'

const save = (name, text, type = 'application/xml') => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}

export default function DataExport() {
  const { raw, allLines, accounts, loading } = useFinanceData()
  const [company, setCompany] = useState('UIPL')
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const [msg, setMsg] = useState('')
  const cs = raw?.companySettings?.[company] || {}
  const tallyName = cs.legalName || company
  const stats = useMemo(() => tallyVouchers({ lines: allLines, company, from: period.from, to: period.to, companyName: tallyName }).count, [allLines, company, period, tallyName])

  const masters = () => { save(`Tally-masters-${company}.xml`, tallyMasters({ accounts, lines: allLines.filter(l => l.company === company), customers: raw.customers, vendors: raw.vendors, bankAccounts: raw.bankAccounts, company: tallyName })); setMsg('Masters file downloaded. Import it first (Gateway of Tally → Import → Masters), then the vouchers.') }
  const vouchers = () => { const r = tallyVouchers({ lines: allLines, company, from: period.from, to: period.to, companyName: tallyName }); save(`Tally-vouchers-${company}-${period.from}-to-${period.to}.xml`, r.xml); setMsg(`${r.count} voucher(s) exported.`) }

  const excelAll = () => {
    const idx = buildVoucherIndex(raw).filter(e => e.company === company && e.date >= period.from && e.date <= period.to && !e.cancelled)
    const tb = computeAccountBalances(allLines, accounts, { company, asOfDate: period.to })
    downloadXlsx(`Books ${company} ${period.from} to ${period.to}`, [
      { name: 'Vouchers', rows: [['Date', 'Type', 'Number', 'Party', 'Amount', 'Narration'], ...idx.map(e => [e.date, VOUCHER_TYPES[e.kind]?.label || e.memoLabel || e.kind, e.number, e.partyName, e.amount, e.narration])] },
      { name: 'Ledger lines', rows: [['Date', 'Voucher type', 'Voucher', 'Account code', 'Account', 'Party', 'Debit', 'Credit', 'Narration'], ...allLines.filter(l => l.company === company && l.date >= period.from && l.date <= period.to).sort((a, b) => a.date.localeCompare(b.date)).map(l => [l.date, VOUCHER_TYPES[kindOfSource(l.sourceType)]?.label || l.sourceType, l.sourceDocNumber, l.accountCode, l.accountName, l.partyName || '', l.debit, l.credit, l.description || ''])] },
      { name: 'Trial balance', rows: [['Code', 'Account', 'Type', 'Debit', 'Credit'], ...tb.sort((a, b) => a.code.localeCompare(b.code)).map(r => [r.code, r.name, r.type, r.debit, r.credit])] },
      { name: 'Chart of accounts', rows: [['Code', 'Name', 'Type', 'Normal balance'], ...accounts.map(a => [a.code, a.name, a.type, a.normalBalance])] },
    ])
  }

  return (
    <ReportShell title="Export & Backup" loading={loading} subtitle="Hand the books to your accountant — as Excel, or as an XML file Tally can import."
      filters={<><CompanyToggle value={company} onChange={setCompany} /><DateRange from={period.from} to={period.to} onChange={setPeriod} /></>}>
      {msg && <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">{msg}</div>}
      <div className="grid md:grid-cols-2 gap-4">
        <div className={`${cardCls} p-5 space-y-3`}>
          <h3 className="font-semibold text-slate-800">Tally (XML)</h3>
          <p className="text-sm text-slate-500">Two files: ledger masters, then {stats} accounting voucher(s) dated {period.from} to {period.to}. Each voucher is rebuilt from its ledger entries so it balances in Tally exactly as here.</p>
          <div className="flex gap-2 flex-wrap"><button className={btnPrimary} onClick={masters}>1. Download masters</button><button className={btnPrimary} onClick={vouchers}>2. Download vouchers</button></div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Best effort. GST classification, HSN, bill-wise allocations and inventory (item) entries are not carried over, and Tally company name must match “{tallyName}”. Try it in a <b>test company</b> and have your CA review before using it for real.</p>
        </div>
        <div className={`${cardCls} p-5 space-y-3`}>
          <h3 className="font-semibold text-slate-800">Excel workbook</h3>
          <p className="text-sm text-slate-500">All vouchers, every ledger line, the trial balance at {period.to} and the chart of accounts — one file, four sheets.</p>
          <button className={btnGhost} onClick={excelAll}>⬇ Download Excel</button>
          <p className="text-xs text-slate-400">GST returns, TDS statements, stock reports and bank reconciliation each have their own Excel export on their pages.</p>
        </div>
      </div>
      <p className="text-xs text-slate-400">Today is {todayStr()}. Backups of the underlying data are held by Firebase; this page exports a readable copy, not a restorable database dump.</p>
    </ReportShell>
  )
}
