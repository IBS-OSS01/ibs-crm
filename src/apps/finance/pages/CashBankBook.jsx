import React, { useMemo, useState } from 'react'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { ledgerStatement, monthlySummary } from '../utils/statements.js'
import { VOUCHER_TYPES, kindOfSource, fmtAmt, fyRange, currentFY } from '../utils/financeConstants.js'
import { downloadXlsx, downloadCsv, printReport } from '../utils/exportUtils.js'
import { useVoucherModal } from '../components/useVoucherModal.jsx'
import { ReportShell, CompanyToggle, DateRange, ExportBar, DrCr, Badge, inputCls, cardCls } from '../components/FinanceUI.jsx'

export default function CashBankBook() {
  const { raw, allLines, loading, reload } = useFinanceData()
  const { open, modal } = useVoucherModal({ raw, allLines, reload })
  const [company, setCompany] = useState('UIPL')
  const [sel, setSel] = useState('all-bank')
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const [monthly, setMonthly] = useState(false)

  const entries = useMemo(() => raw ? buildVoucherIndex(raw) : [], [raw])
  const entryByLineKey = useMemo(() => { const m = {}; entries.forEach(e => { if (!m[e.lineKey]) m[e.lineKey] = e }); return m }, [entries])

  const options = useMemo(() => {
    const banks = (raw?.bankAccounts || []).filter(b => b.company === company && b.active !== false)
    return [
      { key: 'all-bank', label: 'All bank accounts', code: '1100', bankId: null },
      ...banks.filter(b => b.type !== 'cash').map(b => ({ key: `bank:${b.id}`, label: `${b.name}${b.accountNumber ? ` ••${String(b.accountNumber).slice(-4)}` : ''}`, code: '1100', bankId: b.id })),
      { key: 'unassigned', label: 'Bank — not assigned to an account (legacy entries)', code: '1100', bankId: '' },
      { key: 'cash', label: 'Cash in hand', code: '1110', bankId: null },
    ]
  }, [raw, company])

  const makeMatch = (o) => (l) => l.accountCode === o.code && (o.bankId === null || (o.bankId === '' ? !l.bankAccountId : l.bankAccountId === o.bankId))
  const cur = options.find(o => o.key === sel) || options[0]

  const stmt = useMemo(() => ledgerStatement(allLines, { match: makeMatch(cur), company, from: period.from, to: period.to }), [allLines, cur, company, period]) // eslint-disable-line react-hooks/exhaustive-deps
  const monthRows = useMemo(() => monthlySummary(stmt.rows, stmt.opening), [stmt])
  const balances = useMemo(() => options.map(o => ({ ...o, closing: ledgerStatement(allLines, { match: makeMatch(o), company, to: period.to }).closing })), [allLines, options, company, period.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const sheet = () => [['Date', 'Voucher No', 'Type', 'Particulars', 'Receipts (Dr)', 'Payments (Cr)', 'Balance (Dr+/Cr−)'],
    ['', '', '', 'Opening balance', '', '', stmt.opening],
    ...stmt.rows.map(r => [r.date, r.docNo, VOUCHER_TYPES[kindOfSource(r.sourceType)]?.label || r.sourceType, r.particulars, r.debit || '', r.credit || '', r.balance]),
    ['', '', '', 'Closing balance', stmt.totalDebit, stmt.totalCredit, stmt.closing]]
  const title = `${cur.label} book — ${company} ${period.from} to ${period.to}`

  return (
    <ReportShell title="Cash / Bank Book" subtitle="Receipts and payments through each bank account and cash, with running balance."
      loading={loading}
      exportBar={<ExportBar onXlsx={() => downloadXlsx(title, [{ name: 'Book', rows: sheet() }])} onCsv={() => downloadCsv(title, sheet())} onPrint={() => printReport({ title: cur.label, subtitle: `${company} · ${period.from} to ${period.to}`, rows: sheet() })} />}
      filters={<>
        <CompanyToggle value={company} onChange={c => { setCompany(c); setSel('all-bank') }} />
        <DateRange from={period.from} to={period.to} onChange={setPeriod} />
        <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={monthly} onChange={e => setMonthly(e.target.checked)} />Monthly summary</label>
      </>}>
      <div className="flex gap-2 flex-wrap">
        {balances.map(b => (
          <button key={b.key} onClick={() => setSel(b.key)} className={`${cardCls} px-3 py-2 text-left hover:border-blue-300 ${sel === b.key ? 'border-blue-500 ring-1 ring-blue-300' : ''}`}>
            <p className="text-xs text-slate-500 max-w-48 truncate">{b.label}</p>
            <p className="text-sm font-bold text-slate-800"><DrCr value={b.closing} /></p>
          </button>
        ))}
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        {monthly ? (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="text-left px-4 py-3">Month</th><th className="text-right px-4 py-3">Receipts</th><th className="text-right px-4 py-3">Payments</th><th className="text-right px-4 py-3">Closing</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/60"><td className="px-4 py-2.5 italic text-slate-500" colSpan={3}>Opening balance</td><td className="px-4 py-2.5 text-right"><DrCr value={stmt.opening} /></td></tr>
              {monthRows.map(m => <tr key={m.month}><td className="px-4 py-2.5 font-medium">{m.month}</td><td className="px-4 py-2.5 text-right">{fmtAmt(m.debit)}</td><td className="px-4 py-2.5 text-right">{fmtAmt(m.credit)}</td><td className="px-4 py-2.5 text-right"><DrCr value={m.closing} /></td></tr>)}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
              <th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Type</th><th className="text-left px-4 py-3">Voucher #</th><th className="text-left px-4 py-3">Particulars</th>
              <th className="text-right px-4 py-3">Receipts (Dr)</th><th className="text-right px-4 py-3">Payments (Cr)</th><th className="text-right px-4 py-3">Balance</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/60"><td className="px-4 py-2.5 italic text-slate-500" colSpan={6}>Opening balance as on {period.from}</td><td className="px-4 py-2.5 text-right font-medium"><DrCr value={stmt.opening} /></td></tr>
              {stmt.rows.map((r, i) => {
                const kind = kindOfSource(r.sourceType)
                return (
                  <tr key={i} className="cursor-pointer hover:bg-blue-50/40" onClick={() => { const e = entryByLineKey[`${r.sourceType}:${r.sourceId}`]; if (e) open(e) }}>
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.date}</td>
                    <td className="px-4 py-2.5"><Badge color={VOUCHER_TYPES[kind]?.color || 'bg-slate-100 text-slate-500'}>{VOUCHER_TYPES[kind]?.label || (kind === 'opening' ? 'Opening' : kind)}</Badge></td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.docNo}</td>
                    <td className="px-4 py-2.5 text-slate-700">{r.particulars}</td>
                    <td className="px-4 py-2.5 text-right text-green-700">{r.debit ? fmtAmt(r.debit) : ''}</td>
                    <td className="px-4 py-2.5 text-right text-red-600">{r.credit ? fmtAmt(r.credit) : ''}</td>
                    <td className="px-4 py-2.5 text-right font-medium"><DrCr value={r.balance} /></td>
                  </tr>
                )
              })}
              {stmt.rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No cash/bank movement in this period.</td></tr>}
            </tbody>
            <tfoot><tr className="bg-slate-50 font-bold"><td colSpan={4} className="px-4 py-2.5 text-slate-600">Closing balance</td>
              <td className="px-4 py-2.5 text-right">{fmtAmt(stmt.totalDebit)}</td><td className="px-4 py-2.5 text-right">{fmtAmt(stmt.totalCredit)}</td><td className="px-4 py-2.5 text-right"><DrCr value={stmt.closing} /></td></tr></tfoot>
          </table>
        )}
      </div>
      {modal}
    </ReportShell>
  )
}
