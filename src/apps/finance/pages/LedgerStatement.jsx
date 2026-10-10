import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { ledgerStatement, monthlySummary } from '../utils/statements.js'
import { partyKeyOf } from '../utils/voucherEngine.js'
import { VOUCHER_TYPES, kindOfSource, fmtAmt, fmtDrCr, fyRange, currentFY } from '../utils/financeConstants.js'
import { downloadXlsx, downloadCsv, printReport } from '../utils/exportUtils.js'
import { useVoucherModal } from '../components/useVoucherModal.jsx'
import { ReportShell, CompanyToggle, DateRange, ExportBar, DrCr, Badge, Empty, inputCls, cardCls } from '../components/FinanceUI.jsx'

const MODES = [
  { key: 'customer', label: 'Customers', control: '1200' },
  { key: 'vendor',   label: 'Vendors',   control: '2100' },
  { key: 'account',  label: 'Accounts',  control: null },
]

export default function LedgerStatement() {
  const { raw, allLines, accounts, loading, reload } = useFinanceData()
  const { open, modal } = useVoucherModal({ raw, allLines, reload })
  const [params] = useSearchParams()
  const [company, setCompany] = useState(params.get('company') || 'UIPL')
  const [mode, setMode] = useState(params.get('mode') || 'customer')
  const [selected, setSelected] = useState(params.get('party') || '')
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const [monthly, setMonthly] = useState(false)

  const entries = useMemo(() => raw ? buildVoucherIndex(raw) : [], [raw])
  const entryByLineKey = useMemo(() => { const m = {}; entries.forEach(e => { if (!m[e.lineKey]) m[e.lineKey] = e }); return m }, [entries])

  // Every party that has ever touched the control accounts — includes legacy free-text names that aren't in a master.
  const partyOptions = useMemo(() => {
    const m = { customer: {}, vendor: {} }
    allLines.forEach(l => {
      if (l.company !== company || !l.partyName) return
      if (l.accountCode === '1200') m.customer[partyKeyOf(l.partyId, l.partyName)] = l.partyName
      if (l.accountCode === '2100') m.vendor[partyKeyOf(l.partyId, l.partyName)] = l.partyName
    })
    const toList = (o) => Object.entries(o).map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name))
    return { customer: toList(m.customer), vendor: toList(m.vendor) }
  }, [allLines, company])

  const control = MODES.find(m => m.key === mode)?.control
  const match = useMemo(() => {
    if (!selected) return () => false
    if (mode === 'account') return (l) => l.accountCode === selected
    return (l) => l.accountCode === control && partyKeyOf(l.partyId, l.partyName) === selected
  }, [mode, selected, control])

  const stmt = useMemo(() => selected ? ledgerStatement(allLines, { match, company, from: period.from, to: period.to }) : null, [allLines, match, company, period, selected, mode])
  const monthRows = useMemo(() => stmt ? monthlySummary(stmt.rows, stmt.opening) : [], [stmt])

  const selectedName = mode === 'account' ? (accounts.find(a => a.code === selected)?.name || '') : (partyOptions[mode]?.find(p => p.key === selected)?.name || '')
  const switchMode = (m) => { setMode(m); setSelected('') }

  const sheet = () => stmt ? [
    ['Date', 'Type', 'Voucher No', 'Particulars', 'Debit', 'Credit', 'Balance (Dr+/Cr−)'],
    ['', '', '', 'Opening balance', '', '', stmt.opening],
    ...stmt.rows.map(r => [r.date, VOUCHER_TYPES[kindOfSource(r.sourceType)]?.label || (r.sourceType === 'opening' ? 'Opening' : r.sourceType), r.docNo, r.particulars, r.debit || '', r.credit || '', r.balance]),
    ['', '', '', 'Closing balance', stmt.totalDebit, stmt.totalCredit, stmt.closing],
  ] : [['No data']]
  const title = `Ledger — ${selectedName} (${company}) ${period.from} to ${period.to}`

  const openRow = (r) => {
    const key = `${r.sourceType}:${r.sourceId}`
    const e = entryByLineKey[key]
    if (e) open(e)
  }

  return (
    <ReportShell title="Ledger Statement" subtitle="A customer's, vendor's or any account's full ledger — opening balance, every voucher, running balance."
      loading={loading}
      exportBar={stmt && <ExportBar onXlsx={() => downloadXlsx(title, [{ name: 'Ledger', rows: sheet() }])} onCsv={() => downloadCsv(title, sheet())} onPrint={() => printReport({ title: `Ledger: ${selectedName}`, subtitle: `${company} · ${period.from} to ${period.to}`, rows: sheet() })} />}
      filters={<>
        <CompanyToggle value={company} onChange={c => { setCompany(c); setSelected('') }} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {MODES.map(m => <button key={m.key} onClick={() => switchMode(m.key)} className={`px-3 py-1.5 font-medium ${mode === m.key ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{m.label}</button>)}
        </div>
        <select value={selected} onChange={e => setSelected(e.target.value)} className={`${inputCls} min-w-64`}>
          <option value="">— select {mode === 'account' ? 'an account' : mode} —</option>
          {mode === 'account'
            ? accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)
            : (partyOptions[mode] || []).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
        <DateRange from={period.from} to={period.to} onChange={setPeriod} />
        <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={monthly} onChange={e => setMonthly(e.target.checked)} />Monthly summary</label>
      </>}>
      {!stmt ? <Empty>Pick a {mode === 'account' ? 'account' : mode} to see its ledger.</Empty> : monthly ? (
        <div className={`${cardCls} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="text-left px-4 py-3">Month</th><th className="text-right px-4 py-3">Debit</th><th className="text-right px-4 py-3">Credit</th><th className="text-right px-4 py-3">Closing balance</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/60"><td className="px-4 py-2.5 italic text-slate-500" colSpan={3}>Opening balance</td><td className="px-4 py-2.5 text-right"><DrCr value={stmt.opening} /></td></tr>
              {monthRows.map(m => <tr key={m.month}><td className="px-4 py-2.5 font-medium">{m.month}</td><td className="px-4 py-2.5 text-right">{fmtAmt(m.debit)}</td><td className="px-4 py-2.5 text-right">{fmtAmt(m.credit)}</td><td className="px-4 py-2.5 text-right"><DrCr value={m.closing} /></td></tr>)}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`${cardCls} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
              <th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Type</th><th className="text-left px-4 py-3">Voucher #</th>
              <th className="text-left px-4 py-3">Particulars</th><th className="text-right px-4 py-3">Debit</th><th className="text-right px-4 py-3">Credit</th><th className="text-right px-4 py-3">Balance</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/60"><td className="px-4 py-2.5 italic text-slate-500" colSpan={6}>Opening balance as on {period.from}</td><td className="px-4 py-2.5 text-right font-medium"><DrCr value={stmt.opening} /></td></tr>
              {stmt.rows.map((r, i) => {
                const kind = kindOfSource(r.sourceType)
                return (
                  <tr key={i} onClick={() => openRow(r)} className="cursor-pointer hover:bg-blue-50/40">
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.date}</td>
                    <td className="px-4 py-2.5"><Badge color={VOUCHER_TYPES[kind]?.color || 'bg-slate-100 text-slate-500'}>{VOUCHER_TYPES[kind]?.label || (r.sourceType === 'opening' ? 'Opening' : r.sourceType)}</Badge></td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.docNo}</td>
                    <td className="px-4 py-2.5 text-slate-700">{r.particulars}</td>
                    <td className="px-4 py-2.5 text-right">{r.debit ? fmtAmt(r.debit) : ''}</td>
                    <td className="px-4 py-2.5 text-right">{r.credit ? fmtAmt(r.credit) : ''}</td>
                    <td className="px-4 py-2.5 text-right font-medium"><DrCr value={r.balance} /></td>
                  </tr>
                )
              })}
              {stmt.rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No transactions in this period.</td></tr>}
            </tbody>
            <tfoot><tr className="bg-slate-50 font-bold"><td colSpan={4} className="px-4 py-2.5 text-slate-600">Closing balance</td>
              <td className="px-4 py-2.5 text-right">{fmtAmt(stmt.totalDebit)}</td><td className="px-4 py-2.5 text-right">{fmtAmt(stmt.totalCredit)}</td>
              <td className="px-4 py-2.5 text-right">{fmtDrCr(stmt.closing)}</td></tr></tfoot>
          </table>
        </div>
      )}
      {modal}
    </ReportShell>
  )
}
