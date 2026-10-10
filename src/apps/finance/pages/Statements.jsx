// Trading & Profit-and-Loss account, Cash Flow (receipts & payments), Ratio analysis.
import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { tradingPL, cashFlow, ratios } from '../utils/financialStatements.js'
import { fmtAmt, fyRange, currentFY } from '../utils/financeConstants.js'
import { downloadXlsx, printReport } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, DateRange, ExportBar, Empty, cardCls } from '../components/FinanceUI.jsx'

const TABS = [['trading', 'Trading & P&L'], ['cashflow', 'Cash Flow'], ['ratios', 'Ratio Analysis']]
const Row = ({ label, value, bold, indent, tone = '', hint }) => (
  <div className={`flex justify-between py-1 text-sm ${bold ? 'font-bold border-t border-slate-200 mt-1 pt-2' : ''} ${indent ? 'pl-4 text-slate-600' : ''} ${tone}`} title={hint}>
    <span>{label}</span><span>{value === null || value === undefined ? '—' : typeof value === 'number' ? fmtAmt(value) : value}</span>
  </div>
)
const Card = ({ title, children, accent = 'text-blue-600' }) => <div className={`${cardCls} p-5`}><p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>{title}</p>{children}</div>

export default function Statements() {
  const { tab = 'trading' } = useParams()
  const navigate = useNavigate()
  const { raw, allLines, accounts, loading } = useFinanceData()
  const [company, setCompany] = useState('UIPL')
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const args = { company, from: period.from, to: period.to }
  const pl = useMemo(() => tradingPL(allLines, accounts, args), [allLines, accounts, company, period]) // eslint-disable-line react-hooks/exhaustive-deps
  const cf = useMemo(() => cashFlow(allLines, accounts, args), [allLines, accounts, company, period]) // eslint-disable-line react-hooks/exhaustive-deps
  const rt = useMemo(() => ratios(allLines, accounts, args), [allLines, accounts, company, period]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = TABS.find(t => t[0] === tab)?.[1]
  const gpLabel = pl.grossProfit >= 0 ? 'Gross profit' : 'Gross loss'
  const npLabel = pl.netProfit >= 0 ? 'Net profit' : 'Net loss'

  const rows = () => {
    if (tab === 'trading') return [['Particulars', 'Amount'], ['Sales (net of returns)', pl.sales], ['Opening stock', pl.openingStock], ['Purchases (net of returns)', pl.purchases], ...pl.direct.filter(d => d.code !== '5000').map(d => [d.name, d.amount]), ['Closing stock', -pl.closingStock], ['Cost of goods sold', pl.cogs], [gpLabel, pl.grossProfit], ...pl.otherIncome.map(r => [r.name, r.amount]), ...pl.indirect.map(r => [r.name, -r.amount]), [npLabel, pl.netProfit]]
    if (tab === 'cashflow') return [['Particulars', 'Inflow', 'Outflow'], ['Opening cash & bank', cf.opening, ''], ...cf.sections.flatMap(s => [[s.section.toUpperCase(), '', ''], ...s.items.map(i => [i.label, i.inflow, i.outflow]), ['Net ' + s.section, s.inflow - s.outflow, '']]), ['Net change', cf.netChange, ''], ['Closing cash & bank', cf.closing, '']]
    return [['Ratio', 'Value'], ...rt.items.map(i => [i.label, i.value ?? 'n/a'])]
  }
  const title = `${label} — ${company} ${period.from} to ${period.to}`

  return (
    <ReportShell title={label} loading={loading} subtitle={tab === 'trading' ? 'Gross and net profit for the period, with opening and closing stock.' : tab === 'cashflow' ? 'Where cash and bank money came from and went, grouped by what it was for.' : 'Liquidity, margins and working-capital days.'}
      exportBar={<ExportBar onXlsx={() => downloadXlsx(title, [{ name: label, rows: rows() }])} onPrint={() => printReport({ title: label, subtitle: `${company} · ${period.from} to ${period.to}`, rows: rows() })} />}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">{TABS.map(([k, l]) => <button key={k} onClick={() => navigate(`/finance/statements/${k}`)} className={`px-3 py-1.5 font-medium ${k === tab ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>
        <DateRange from={period.from} to={period.to} onChange={setPeriod} />
      </>}>
      {(raw?.accounts || []).length === 0 && <Empty>Seed the Chart of Accounts first (Finance → Chart of Accounts).</Empty>}

      {tab === 'trading' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Trading account">
            <Row label="Opening stock" value={pl.openingStock} />
            <Row label="Purchases (net of returns)" value={pl.purchases} />
            {pl.direct.filter(d => d.code !== '5000').map(d => <Row key={d.code} label={d.name} value={d.amount} indent />)}
            {pl.residualStock !== 0 && <Row label="Stock adjustments (journals)" value={pl.residualStock} indent />}
            <Row label="Less: closing stock" value={-pl.closingStock} />
            <Row label="Cost of goods sold" value={pl.cogs} bold />
            <Row label="Sales (net of returns)" value={pl.sales} />
            <Row label={gpLabel} value={Math.abs(pl.grossProfit)} bold tone={pl.grossProfit >= 0 ? 'text-green-700' : 'text-red-600'} />
          </Card>
          <Card title="Profit & loss account" accent="text-purple-600">
            <Row label={gpLabel + ' b/d'} value={pl.grossProfit} />
            {pl.otherIncome.map(r => <Row key={r.code} label={r.name} value={r.amount} indent />)}
            <Row label="Total income" value={pl.grossProfit + pl.totalOtherIncome} bold />
            <p className="text-xs font-semibold text-slate-400 uppercase mt-3 mb-1">Indirect expenses</p>
            {pl.indirect.length === 0 && <p className="text-sm text-slate-400 italic">None</p>}
            {pl.indirect.map(r => <Row key={r.code} label={r.name} value={r.amount} indent />)}
            <Row label="Total expenses" value={pl.totalIndirect} bold />
            <Row label={npLabel} value={Math.abs(pl.netProfit)} bold tone={pl.netProfit >= 0 ? 'text-green-700' : 'text-red-600'} />
          </Card>
        </div>
      )}

      {tab === 'cashflow' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Opening cash &amp; bank</p><p className="text-xl font-bold">₹{fmtAmt(cf.opening)}</p></div>
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Net change</p><p className={`text-xl font-bold ${cf.netChange >= 0 ? 'text-green-700' : 'text-red-600'}`}>₹{fmtAmt(cf.netChange)}</p></div>
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Closing cash &amp; bank</p><p className="text-xl font-bold">₹{fmtAmt(cf.closing)}</p></div>
          </div>
          {cf.sections.map(s => (
            <Card key={s.section} title={`${s.section} activities`} accent={{ operating: 'text-blue-600', investing: 'text-orange-600', financing: 'text-purple-600' }[s.section]}>
              {s.items.length === 0 && <p className="text-sm text-slate-400 italic">No cash movement</p>}
              {s.items.map(i => (
                <div key={i.label} className="grid grid-cols-12 text-sm py-1"><span className="col-span-6">{i.label}</span><span className="col-span-3 text-right text-green-700">{i.inflow ? fmtAmt(i.inflow) : ''}</span><span className="col-span-3 text-right text-red-600">{i.outflow ? fmtAmt(i.outflow) : ''}</span></div>
              ))}
              <Row label={`Net ${s.section}`} value={s.inflow - s.outflow} bold />
            </Card>
          ))}
          <p className="text-xs text-slate-400">Built from the bank and cash entries of each voucher, split across the other side of that voucher in proportion to the amounts (a payment covering both a bill and a charge is divided between them). Transfers between your own cash and bank accounts are excluded.</p>
        </div>
      )}

      {tab === 'ratios' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {rt.items.map(i => (
              <div key={i.key} className={`${cardCls} p-4`} title={i.hint}>
                <p className="text-xs text-slate-400 uppercase">{i.label}</p>
                <p className="text-2xl font-bold text-slate-800">{i.value === null ? 'n/a' : fmtAmt(i.value)}</p>
                <p className="text-xs text-slate-400 mt-1">{i.hint}</p>
              </div>
            ))}
          </div>
          <Card title="Inputs used">
            <Row label="Cash & bank" value={rt.cash} /><Row label="Receivables" value={rt.receivables} /><Row label="Stock in hand" value={rt.stock} />
            <Row label="Payables" value={rt.payables} /><Row label="Current assets" value={rt.currentAssets} bold /><Row label="Current liabilities (payables, GST, TDS, other)" value={rt.currentLiab} />
          </Card>
          <p className="text-xs text-slate-400">Balances are as at the end of the chosen period; days ratios use the number of days in the period ({rt.days}).</p>
        </>
      )}
    </ReportShell>
  )
}
