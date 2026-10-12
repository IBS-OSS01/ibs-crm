// TDS compliance workspace: dashboard (liability vs deposits, due dates, interest estimate),
// deduction register, challans, quarterly statement data, deductee statements,
// TDS receivable (deducted by customers) and the section master.
import React, { useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, setDoc } from '../../../lib/cachedFirestore'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { createVoucher, getBooksLockDate, VoucherError } from '../utils/voucherService.js'
import { deductionRows, monthlyPosition, quarterData, lateFee, deducteeSummary, receivableRows, fyMonths, QUARTERS, returnDueDate } from '../utils/tdsReports.js'
import { DEFAULT_TDS_SECTIONS } from '../utils/tdsMaster.js'
import { fmtAmt, fyList, currentFY, fyRange, todayStr, isValidPan, num, r2 } from '../utils/financeConstants.js'
import { downloadXlsx, printReport } from '../utils/exportUtils.js'
import { cashBankOptions, tdsSectionList, Field } from '../components/formShared.jsx'
import { ReportShell, CompanyToggle, ExportBar, Badge, Empty, cardCls, inputCls, formInputCls, thCls, btnPrimary, btnGhost, useFinancePerms } from '../components/FinanceUI.jsx'

const TABS = [['dashboard', 'Dashboard'], ['register', 'Deduction Register'], ['challans', 'Challans'], ['returns', 'Quarterly Statements'], ['certificates', 'Deductee Statements'], ['receivable', 'TDS Receivable'], ['sections', 'Sections & Rates']]
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ml = (ym) => `${MONTH_NAMES[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`
const Th = ({ children, right }) => <th className={`${thCls} ${right ? 'text-right' : 'text-left'}`}>{children}</th>
const Td = ({ children, right, mono, cls = '' }) => <td className={`px-3 py-2 ${right ? 'text-right' : ''} ${mono ? 'font-mono text-xs' : ''} ${cls}`}>{children}</td>
const A = ({ v }) => <>{v ? fmtAmt(v) : <span className="text-slate-300">—</span>}</>
const Table = ({ head, children, empty }) => <div className={`${cardCls} overflow-x-auto`}><table className="w-full text-sm"><thead className="bg-slate-50/80"><tr>{head}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table>{empty}</div>
const STATUS = {
  none: ['bg-slate-100 text-slate-500', 'Nothing deducted'], paid: ['bg-green-100 text-green-700', 'Deposited on time'], 'paid-late': ['bg-amber-100 text-amber-700', 'Deposited late'],
  pending: ['bg-blue-100 text-blue-700', 'Due'], overdue: ['bg-red-100 text-red-700', 'Overdue'],
}

export default function TdsCompliance() {
  const { tab = 'dashboard' } = useParams()
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const { canWrite } = useFinancePerms()
  const { raw, allLines, loading, reload } = useFinanceData(['tdsSections', 'tdsChallans', 'tdsReturns'])
  const [company, setCompany] = useState('UIPL')
  const [fy, setFy] = useState(currentFY())
  const [quarter, setQuarter] = useState('Q1')
  const [msg, setMsg] = useState('')

  const cs = raw?.companySettings?.[company] || {}
  const asOf = todayStr()
  const range = fyRange(fy)
  const allDeductions = useMemo(() => raw ? deductionRows(raw.vouchers, raw.vendors, { company }) : [], [raw, company])
  const deductions = useMemo(() => allDeductions.filter(d => d.fy === fy), [allDeductions, fy])
  const challans = useMemo(() => (raw?.tdsChallans || []).filter(c => c.company === company && c.fy === fy), [raw, company, fy])
  const months = useMemo(() => monthlyPosition(deductions, challans, { company, fy, asOf }), [deductions, challans, company, fy, asOf])
  const totals = useMemo(() => ({ ded: r2(months.reduce((s, m) => s + m.deducted, 0)), dep: r2(months.reduce((s, m) => s + m.deposited, 0)), int: r2(months.reduce((s, m) => s + m.interest, 0)) }), [months])
  const bookBalance = useMemo(() => r2(allLines.filter(l => l.accountCode === '2500' && l.company === company && (l.date || '') <= asOf).reduce((s, l) => s + l.credit - l.debit, 0)), [allLines, company, asOf])
  const returns = (raw?.tdsReturns || []).filter(r => r.company === company && r.fy === fy)
  const receivable = useMemo(() => raw ? receivableRows(raw.vouchers, { company, from: range.from, to: range.to }) : [], [raw, company, range.from, range.to])
  const sections = tdsSectionList(raw)

  const lockedErr = (e) => (e instanceof VoucherError ? e.message : 'Error: ' + e.message)

  // ── challan form ──
  const [cf, setCf] = useState(null)
  const banks = useMemo(() => raw ? cashBankOptions(raw, company) : [], [raw, company])
  const openChallan = (ym) => {
    const m = months.find(x => x.month === ym)
    setCf({ forMonth: ym || months.find(x => x.pending > 0.5)?.month || months[0].month, section: '', tax: m ? Math.max(0, m.pending) : '', interest: m && m.interest > 0 ? m.interest : '', fee: '', depositDate: todayStr(), bsr: '', serial: '', bankKey: banks[0]?.key, record: true, error: '' })
    navigate('/finance/tds/challans')
  }
  const saveChallan = async () => {
    const f = cf
    if (!f.forMonth) return setCf({ ...f, error: 'Choose the month the tax was deducted in.' })
    if (num(f.tax) <= 0) return setCf({ ...f, error: 'Enter the TDS amount deposited.' })
    if (!/^\d{7}$/.test(f.bsr.trim())) return setCf({ ...f, error: 'BSR code is 7 digits (printed on the challan receipt).' })
    if (!/^\d{1,5}$/.test(f.serial.trim())) return setCf({ ...f, error: 'Challan serial number is up to 5 digits.' })
    const bank = banks.find(b => b.key === f.bankKey) || banks[0]
    setCf({ ...f, saving: true, error: '' })
    try {
      let voucherId = '', voucherNumber = ''
      if (f.record) {
        const lockedUpTo = await getBooksLockDate(company)
        const lines = [{ accountCode: '2500', amount: r2(num(f.tax)), description: `TDS deposited for ${ml(f.forMonth)}` }]
        if (num(f.interest)) lines.push({ accountCode: '5180', amount: r2(num(f.interest)), description: 'Interest on late TDS deposit' })
        if (num(f.fee)) lines.push({ accountCode: '5900', amount: r2(num(f.fee)), description: 'Fee / penalty on TDS' })
        const total = r2(lines.reduce((s, l) => s + l.amount, 0))
        const res = await createVoucher({
          voucherType: 'payment', company, date: f.depositDate, partyAmount: 0, allocations: [], accountLines: lines, tds: { applicable: false },
          bankAccountCode: bank.code, bankAccountId: bank.id, refNumber: `BSR ${f.bsr.trim()} / ${f.serial.trim()}`, narration: `TDS challan for ${ml(f.forMonth)}`, amount: total,
        }, { user, profile: userProfile, lockedUpTo })
        voucherId = res.id; voucherNumber = res.voucherNumber
      }
      await addDoc(collection(db, 'finance_tds_challans'), {
        company, fy, forMonth: f.forMonth, section: f.section, tax: r2(num(f.tax)), interest: r2(num(f.interest)), fee: r2(num(f.fee)), depositDate: f.depositDate,
        bsr: f.bsr.trim(), serial: f.serial.trim(), voucherId, voucherNumber, createdAt: new Date().toISOString(), createdBy: user?.uid || '',
      })
      invalidateFinanceCache(); reload(); setCf(null); setMsg('Challan recorded.')
    } catch (e) { setCf(c => ({ ...c, saving: false, error: lockedErr(e) })) }
  }
  const delChallan = async (c) => {
    if (!window.confirm(`Remove the challan record ${c.bsr}/${c.serial}?${c.voucherNumber ? `\nThe payment voucher ${c.voucherNumber} stays in the books — cancel it separately if it was entered by mistake.` : ''}`)) return
    await deleteDoc(doc(db, 'finance_tds_challans', c.id)); invalidateFinanceCache(); reload()
  }

  // ── returns ──
  const qd = useMemo(() => quarterData(deductions.map(d => ({ ...d })), challans, { company, fy, q: quarter }), [deductions, challans, company, fy, quarter])
  const qRet = returns.find(r => r.quarter === quarter)
  const [filedForm, setFiledForm] = useState({ filedOn: todayStr(), ack: '' })
  const markFiled = async () => {
    if (!filedForm.ack.trim()) return setMsg('Enter the token / acknowledgement number from the filing receipt.')
    await setDoc(doc(db, 'finance_tds_returns', `${company}_${fy}_${quarter}`), { company, fy, quarter, filedOn: filedForm.filedOn, ack: filedForm.ack.trim(), totalTds: qd.totalDeducted, savedAt: new Date().toISOString() })
    invalidateFinanceCache(); reload(); setMsg('Filing recorded.')
  }
  const qWarnings = useMemo(() => {
    const w = []
    const noPan = qd.deductions.filter(d => !isValidPan(d.pan))
    if (noPan.length) w.push(`${new Set(noPan.map(d => d.partyName)).size} deductee(s) have no valid PAN — the statement needs PAN (else the higher rate applies and a default is flagged).`)
    if (!cs.tan) w.push('Your TAN is not set (Company Settings).')
    if (qd.totalDeposited < qd.totalDeducted - 0.5) w.push(`TDS deducted ₹${fmtAmt(qd.totalDeducted)} but only ₹${fmtAmt(qd.totalDeposited)} deposited by challan — the statement will show a short payment.`)
    if (qd.totalDeposited > qd.totalDeducted + 0.5) w.push('Challans exceed the deductions recorded — check the month on each challan.')
    return w
  }, [qd, cs.tan])
  const qLateFee = qRet ? lateFee(qd.totalDeducted, qd.due, qRet.filedOn) : lateFee(qd.totalDeducted, qd.due, asOf)

  const returnSheets = () => [
    { name: 'Deductor', rows: [['Field', 'Value'], ['Deductor name', cs.legalName || company], ['TAN', cs.tan || ''], ['PAN', cs.pan || ''], ['Address', [cs.address, cs.city, cs.state, cs.pincode].filter(Boolean).join(', ')], ['Responsible person', cs.tdsPersonName || ''], ['Designation', cs.tdsPersonDesignation || ''], ['Financial year', `20${fy.slice(0, 2)}-${fy.slice(3)}`], ['Quarter', `${quarter} (${QUARTERS.find(x => x.q === quarter).label})`], ['Total TDS deducted', qd.totalDeducted], ['Total TDS deposited', qd.totalDeposited], ['Statement due date', qd.due]] },
    { name: 'Challans', rows: [['Sr', 'Section', 'BSR code', 'Challan serial', 'Deposit date', 'For month', 'TDS', 'Interest', 'Fee'], ...qd.challans.map((c, i) => [i + 1, c.section || '', c.bsr, c.serial, c.depositDate, c.forMonth, c.tax, c.interest || 0, c.fee || 0])] },
    { name: 'Deductees', rows: [['Sr', 'Deductee PAN', 'Deductee name', 'Section', 'Date of payment / credit', 'Amount paid / credited', 'Rate %', 'TDS deducted', 'Voucher', 'Challan BSR / serial'],
      ...qd.deductions.map((d, i) => { const ch = qd.challans.filter(c => c.forMonth === d.month && (!c.section || c.section === d.section)); return [i + 1, d.pan, d.partyName, d.section, d.date, d.base, d.rate, d.amount, d.voucherNo, ch.map(c => `${c.bsr}/${c.serial}`).join('; ')] })] },
  ]

  // ── certificates (deductee statements) ──
  const people = useMemo(() => deducteeSummary(deductions), [deductions])
  const stmtRows = (pk) => {
    const q = quarterData(deductions, challans, { company, fy, q: quarter })
    return q.deductions.filter(d => (d.partyId || d.partyName) === pk).map(d => {
      const ch = q.challans.filter(c => c.forMonth === d.month && (!c.section || c.section === d.section))
      return { ...d, challan: ch.map(c => `${c.bsr}/${c.serial}`).join(', '), depositDate: ch.map(c => c.depositDate).join(', ') }
    })
  }
  const printStatement = (pk) => {
    const rows = stmtRows(pk); if (!rows.length) return setMsg('No deductions for this deductee in the chosen quarter.')
    const p = rows[0]
    printReport({
      title: `TDS statement — ${p.partyName}`,
      subtitle: `Deductor: ${cs.legalName || company} · TAN ${cs.tan || '—'} · PAN ${cs.pan || '—'}  |  Deductee PAN ${p.pan || '—'}  |  FY ${fy} ${quarter}.  This is a summary of tax deducted from our books; the statutory certificate (Form 131, formerly 16A) must be generated and issued from TRACES.`,
      rows: [['Date', 'Voucher', 'Section', 'Amount paid / credited', 'Rate %', 'TDS deducted', 'Challan BSR / serial', 'Deposit date'], ...rows.map(r => [r.date, r.voucherNo, r.section, r.base, r.rate, r.amount, r.challan || 'not yet deposited', r.depositDate || '']), ['', '', 'Total', r2(rows.reduce((s, r) => s + r.base, 0)), '', r2(rows.reduce((s, r) => s + r.amount, 0)), '', '']],
    })
  }

  // ── sections master ──
  const [secEdit, setSecEdit] = useState({})
  const seeded = (raw?.tdsSections || []).length > 0
  const seedSections = async () => {
    for (const s of DEFAULT_TDS_SECTIONS) await setDoc(doc(db, 'finance_tds_sections', s.code), { ...s, active: true })
    invalidateFinanceCache(); reload(); setMsg('Section master saved — you can now edit rates and thresholds.')
  }
  const saveSection = async (s) => {
    const e = secEdit[s.code]; if (!e) return
    await setDoc(doc(db, 'finance_tds_sections', s.code), { ...s, ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, k === 'name' || k === 'newRef' ? v : num(v)])), updatedAt: new Date().toISOString() }, { merge: true })
    setSecEdit(x => { const n = { ...x }; delete n[s.code]; return n }); invalidateFinanceCache(); reload()
  }
  const setSec = (code, k, v) => setSecEdit(x => ({ ...x, [code]: { ...(x[code] || {}), [k]: v } }))

  const title = TABS.find(t => t[0] === tab)?.[1]
  const exportBar = (() => {
    if (tab === 'register') return <ExportBar onXlsx={() => downloadXlsx(`TDS register ${company} ${fy}`, [{ name: 'Deductions', rows: [['Date', 'Voucher', 'Deductee', 'PAN', 'Section', 'Amount', 'Rate %', 'TDS'], ...deductions.map(d => [d.date, d.voucherNo, d.partyName, d.pan, d.section, d.base, d.rate, d.amount])] }, { name: 'Deductee-wise', rows: [['Deductee', 'PAN', 'Section', 'Entries', 'Amount paid', 'TDS'], ...deducteeSummary(deductions).map(p => [p.partyName, p.pan, p.section, p.count, p.base, p.amount])] }])} />
    if (tab === 'returns') return <ExportBar onXlsx={() => downloadXlsx(`TDS statement ${company} ${fy} ${quarter}`, returnSheets())} />
    if (tab === 'dashboard') return <ExportBar onXlsx={() => downloadXlsx(`TDS position ${company} ${fy}`, [{ name: 'Monthly', rows: [['Month', 'Deducted', 'Deposited', 'Pending', 'Due date', 'Status', 'Interest estimate'], ...months.map(m => [ml(m.month), m.deducted, m.deposited, m.pending, m.due, STATUS[m.status][1], m.interest])] }])} />
    if (tab === 'receivable') return <ExportBar onXlsx={() => downloadXlsx(`TDS receivable ${company} ${fy}`, [{ name: 'Receivable', rows: [['Date', 'Receipt', 'Customer', 'Section', 'Received (gross)', 'TDS deducted by customer'], ...receivable.map(r => [r.date, r.voucherNo, r.partyName, r.section, r.gross, r.amount])] }])} />
    return null
  })()

  return (
    <ReportShell title={`TDS — ${title}`} loading={loading} exportBar={exportBar}
      subtitle="Tax deducted at source on payments to vendors and contractors, plus TDS customers deducted from you."
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm flex-wrap">
          {TABS.map(([k, l]) => <button key={k} onClick={() => navigate(`/finance/tds/${k}`)} className={`px-3 py-1.5 font-medium ${k === tab ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        {tab !== 'sections' && <select value={fy} onChange={e => setFy(e.target.value)} className={inputCls}>{fyList().map(f => <option key={f} value={f}>FY 20{f.slice(0, 2)}-{f.slice(3)}</option>)}</select>}
        {(tab === 'returns' || tab === 'certificates') && <select value={quarter} onChange={e => setQuarter(e.target.value)} className={inputCls}>{QUARTERS.map(q => <option key={q.q} value={q.q}>{q.q} ({q.label})</option>)}</select>}
      </>}>
      {msg && <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm flex justify-between"><span>{msg}</span><button onClick={() => setMsg('')}>✕</button></div>}
      {company === 'Wayzim' && !deductions.length && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">No TDS has been deducted by Wayzim in this year.</div>}

      {tab === 'dashboard' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Deducted this FY</p><p className="text-xl font-bold">₹{fmtAmt(totals.ded)}</p></div>
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Deposited (challans)</p><p className="text-xl font-bold text-green-700">₹{fmtAmt(totals.dep)}</p></div>
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Still to deposit</p><p className={`text-xl font-bold ${totals.ded - totals.dep > 0.5 ? 'text-red-600' : ''}`}>₹{fmtAmt(totals.ded - totals.dep)}</p></div>
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Interest estimate</p><p className="text-xl font-bold text-amber-600">₹{fmtAmt(totals.int)}</p></div>
          </div>
          <p className="text-xs text-slate-500">Books check: TDS Payable (a/c 2500) shows ₹{fmtAmt(bookBalance)} outstanding across all years{Math.abs(bookBalance - (allDeductions.reduce((s, d) => s + d.amount, 0) - (raw?.tdsChallans || []).filter(c => c.company === company).reduce((s, c) => s + num(c.tax), 0))) > 1 ? ' — differs from the register; a journal entry or an unrecorded challan may be the reason.' : ' — matches the register.'}</p>
          <Table head={<><Th>Month</Th><Th right>Deducted</Th><Th right>Deposited</Th><Th right>Pending</Th><Th>Due date</Th><Th>Status</Th><Th right>Interest (est.)</Th><Th /></>}>
            {months.map(m => (
              <tr key={m.month}>
                <Td cls="font-medium">{ml(m.month)}<span className="text-slate-400 text-xs"> · {m.count} entries</span></Td><Td right><A v={m.deducted} /></Td><Td right><A v={m.deposited} /></Td><Td right cls={m.pending > 0.5 ? 'text-red-600 font-medium' : ''}><A v={m.pending} /></Td>
                <Td>{m.due}</Td><Td><Badge color={STATUS[m.status][0]}>{STATUS[m.status][1]}</Badge></Td><Td right><A v={m.interest} /></Td>
                <Td right>{canWrite && m.pending > 0.5 && <button className="text-blue-600 hover:underline text-xs" onClick={() => openChallan(m.month)}>Record challan</button>}</Td>
              </tr>
            ))}
          </Table>
          <Table head={<><Th>Quarter</Th><Th>Statement due</Th><Th right>TDS in quarter</Th><Th>Status</Th><Th right>Late fee (est.)</Th></>}>
            {QUARTERS.map(q => {
              const d = quarterData(deductions, challans, { company, fy, q: q.q }); const r = returns.find(x => x.quarter === q.q); const due = returnDueDate(fy, q.q)
              const fee = r ? lateFee(d.totalDeducted, due, r.filedOn) : (d.totalDeducted ? lateFee(d.totalDeducted, due, asOf) : 0)
              return <tr key={q.q}><Td cls="font-medium">{q.q} <span className="text-slate-400 text-xs">{q.label}</span></Td><Td>{due}</Td><Td right><A v={d.totalDeducted} /></Td>
                <Td>{r ? <Badge color="bg-green-100 text-green-700">Filed {r.filedOn}</Badge> : !d.totalDeducted ? <Badge>Nothing to file</Badge> : asOf > due ? <Badge color="bg-red-100 text-red-700">Overdue</Badge> : <Badge color="bg-blue-100 text-blue-700">Upcoming</Badge>}</Td><Td right><A v={fee} /></Td></tr>
            })}
          </Table>
          <p className="text-xs text-slate-400">Interest: 1.5% per month or part month on tax deposited late, from the date of deduction. Late statement fee: ₹200 per day, capped at the TDS in the statement. Both are estimates — the portal computes the final figures. If your CA has moved to the new Income-tax Act, 2025 section references, the rates here are unchanged but verify the form numbers.</p>
        </>
      )}

      {tab === 'register' && (
        <>
          <Table head={<><Th>Date</Th><Th>Voucher</Th><Th>Deductee</Th><Th>PAN</Th><Th>Section</Th><Th right>Amount</Th><Th right>Rate</Th><Th right>TDS</Th></>} empty={deductions.length === 0 && <Empty>No TDS deducted in FY 20{fy.slice(0, 2)}-{fy.slice(3)}.</Empty>}>
            {deductions.map(d => <tr key={d.key}><Td>{d.date}</Td><Td mono>{d.voucherNo}</Td><Td cls="font-medium">{d.partyName}</Td><Td mono cls={isValidPan(d.pan) ? '' : 'text-red-500'}>{d.pan || 'missing'}</Td><Td>{d.section}</Td><Td right>{fmtAmt(d.base)}</Td><Td right>{d.rate}%</Td><Td right>{fmtAmt(d.amount)}</Td></tr>)}
          </Table>
          <h3 className="font-semibold text-slate-800">Deductee-wise</h3>
          <Table head={<><Th>Deductee</Th><Th>PAN</Th><Th>Section</Th><Th right>Entries</Th><Th right>Paid / credited</Th><Th right>TDS</Th></>} empty={people.length === 0 && <Empty>None.</Empty>}>
            {people.map(p => <tr key={p.key}><Td cls="font-medium">{p.partyName}</Td><Td mono>{p.pan || '—'}</Td><Td>{p.section}</Td><Td right>{p.count}</Td><Td right>{fmtAmt(p.base)}</Td><Td right>{fmtAmt(p.amount)}</Td></tr>)}
          </Table>
        </>
      )}

      {tab === 'challans' && (
        <>
          {canWrite && !cf && <button className={btnPrimary} onClick={() => openChallan()}>+ Record challan</button>}
          {cf && (
            <div className={`${cardCls} p-4 space-y-3`}>
              <h3 className="font-semibold text-slate-800">Record TDS challan deposit</h3>
              {cf.error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-600 text-sm">{cf.error}</div>}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Tax deducted in month"><select value={cf.forMonth} onChange={e => { const m = months.find(x => x.month === e.target.value); setCf({ ...cf, forMonth: e.target.value, tax: m ? Math.max(0, m.pending) : cf.tax }) }} className={formInputCls}>{fyMonths(fy).map(m => <option key={m} value={m}>{ml(m)}</option>)}</select></Field>
                <Field label="Section (optional)"><select value={cf.section} onChange={e => setCf({ ...cf, section: e.target.value })} className={formInputCls}><option value="">All sections</option>{sections.map(s => <option key={s.code}>{s.code}</option>)}</select></Field>
                <Field label="Deposit date"><input type="date" value={cf.depositDate} onChange={e => setCf({ ...cf, depositDate: e.target.value })} className={formInputCls} /></Field>
                <Field label="Paid from"><select value={cf.bankKey} onChange={e => setCf({ ...cf, bankKey: e.target.value })} className={formInputCls}>{banks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
                <Field label="TDS (₹)"><input type="number" min="0" step="any" value={cf.tax} onChange={e => setCf({ ...cf, tax: e.target.value })} className={formInputCls} /></Field>
                <Field label="Interest (₹)"><input type="number" min="0" step="any" value={cf.interest} onChange={e => setCf({ ...cf, interest: e.target.value })} className={formInputCls} /></Field>
                <Field label="Fee / penalty (₹)"><input type="number" min="0" step="any" value={cf.fee} onChange={e => setCf({ ...cf, fee: e.target.value })} className={formInputCls} /></Field>
                <div />
                <Field label="BSR code (7 digits)"><input value={cf.bsr} onChange={e => setCf({ ...cf, bsr: e.target.value })} maxLength={7} className={formInputCls} /></Field>
                <Field label="Challan serial no."><input value={cf.serial} onChange={e => setCf({ ...cf, serial: e.target.value })} maxLength={5} className={formInputCls} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cf.record} onChange={e => setCf({ ...cf, record: e.target.checked })} />Also record the bank payment in the books (Payment voucher: Dr TDS Payable{num(cf.interest) ? ', Dr Interest' : ''}{num(cf.fee) ? ', Dr Misc. expense' : ''} / Cr Bank)</label>
              <div className="flex gap-2"><button className={btnPrimary} disabled={cf.saving} onClick={saveChallan}>{cf.saving ? 'Saving…' : 'Save challan'}</button><button className={btnGhost} onClick={() => setCf(null)}>Cancel</button></div>
            </div>
          )}
          <Table head={<><Th>Deposit date</Th><Th>For month</Th><Th>Section</Th><Th>BSR / serial</Th><Th right>TDS</Th><Th right>Interest</Th><Th right>Fee</Th><Th>Voucher</Th><Th /></>} empty={challans.length === 0 && <Empty>No challans recorded for this year.</Empty>}>
            {[...challans].sort((a, b) => b.depositDate.localeCompare(a.depositDate)).map(c => <tr key={c.id}><Td>{c.depositDate}</Td><Td>{ml(c.forMonth)}</Td><Td>{c.section || 'All'}</Td><Td mono>{c.bsr} / {c.serial}</Td><Td right>{fmtAmt(c.tax)}</Td><Td right><A v={c.interest} /></Td><Td right><A v={c.fee} /></Td><Td mono>{c.voucherNumber || '—'}</Td><Td right>{canWrite && <button className="text-red-500 text-xs hover:underline" onClick={() => delChallan(c)}>Remove</button>}</Td></tr>)}
          </Table>
        </>
      )}

      {tab === 'returns' && (
        <>
          <div className={`${cardCls} p-4 grid md:grid-cols-4 gap-3 text-sm`}>
            <div><p className="text-xs text-slate-400 uppercase">Deductor</p><p className="font-medium">{cs.legalName || company}</p><p className="text-xs text-slate-500">TAN {cs.tan || <span className="text-red-500">not set</span>}</p></div>
            <div><p className="text-xs text-slate-400 uppercase">Statement due</p><p className="font-medium">{qd.due}</p></div>
            <div><p className="text-xs text-slate-400 uppercase">TDS deducted / deposited</p><p className="font-medium">₹{fmtAmt(qd.totalDeducted)} / ₹{fmtAmt(qd.totalDeposited)}</p></div>
            <div><p className="text-xs text-slate-400 uppercase">Late fee (est.)</p><p className="font-medium">{qLateFee ? `₹${fmtAmt(qLateFee)}` : '—'}</p></div>
          </div>
          {qWarnings.length > 0 && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm space-y-1"><b>Check before filing</b>{qWarnings.map(w => <p key={w}>• {w}</p>)}</div>}
          <Table head={<><Th>Deductee</Th><Th>PAN</Th><Th>Section</Th><Th>Date</Th><Th right>Paid / credited</Th><Th right>Rate</Th><Th right>TDS</Th><Th>Challan</Th></>} empty={qd.deductions.length === 0 && <Empty>No deductions in this quarter.</Empty>}>
            {qd.deductions.map(d => { const ch = qd.challans.filter(c => c.forMonth === d.month && (!c.section || c.section === d.section)); return <tr key={d.key}><Td cls="font-medium">{d.partyName}</Td><Td mono cls={isValidPan(d.pan) ? '' : 'text-red-500'}>{d.pan || 'missing'}</Td><Td>{d.section}</Td><Td>{d.date}</Td><Td right>{fmtAmt(d.base)}</Td><Td right>{d.rate}%</Td><Td right>{fmtAmt(d.amount)}</Td><Td mono cls={ch.length ? '' : 'text-red-500'}>{ch.map(c => `${c.bsr}/${c.serial}`).join(', ') || 'not deposited'}</Td></tr> })}
          </Table>
          <div className={`${cardCls} p-4 flex items-end gap-3 flex-wrap text-sm`}>
            {qRet ? <p className="text-green-700">✓ Filed on {qRet.filedOn} · acknowledgement {qRet.ack}</p> : canWrite ? <>
              <Field label="Filed on"><input type="date" value={filedForm.filedOn} onChange={e => setFiledForm({ ...filedForm, filedOn: e.target.value })} className={inputCls} /></Field>
              <Field label="Token / acknowledgement no."><input value={filedForm.ack} onChange={e => setFiledForm({ ...filedForm, ack: e.target.value })} className={inputCls} /></Field>
              <button className={btnPrimary} onClick={markFiled}>Mark as filed</button></> : null}
          </div>
          <p className="text-xs text-slate-400">The Excel export holds the deductor, challan and deductee-wise data in the order the quarterly TDS statement needs. This system cannot generate the FVU file or file with the portal — import the data into the Return Preparation Utility (or your CA's tool), validate with FVU, and upload. Non-salary quarterly statement (formerly Form 26Q); verify the current form number with your CA.</p>
        </>
      )}

      {tab === 'certificates' && (
        <>
          <p className="text-sm text-slate-500">Printable summary of tax deducted per deductee for the chosen quarter. The statutory certificate (Form 131, formerly 16A) can only be generated by TRACES after the statement is filed.</p>
          <Table head={<><Th>Deductee</Th><Th>PAN</Th><Th>Section</Th><Th right>TDS (FY)</Th><Th /></>} empty={people.length === 0 && <Empty>No deductions.</Empty>}>
            {people.map(p => <tr key={p.key}><Td cls="font-medium">{p.partyName}</Td><Td mono>{p.pan || '—'}</Td><Td>{p.section}</Td><Td right>{fmtAmt(p.amount)}</Td><Td right><button className="text-blue-600 hover:underline text-xs" onClick={() => printStatement(p.partyId || p.partyName)}>Print {quarter} statement</button></Td></tr>)}
          </Table>
        </>
      )}

      {tab === 'receivable' && (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm max-w-md">
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">TDS deducted by customers</p><p className="text-xl font-bold">₹{fmtAmt(receivable.reduce((s, r) => s + r.amount, 0))}</p></div>
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Receipts affected</p><p className="text-xl font-bold">{receivable.length}</p></div>
          </div>
          <Table head={<><Th>Date</Th><Th>Receipt</Th><Th>Customer</Th><Th>Section</Th><Th right>Settled (gross)</Th><Th right>TDS deducted</Th></>} empty={receivable.length === 0 && <Empty>No receipts with TDS in this year. Tick “Customer deducted TDS” on a Receipt voucher to track it.</Empty>}>
            {receivable.map(r => <tr key={r.key}><Td>{r.date}</Td><Td mono>{r.voucherNo}</Td><Td cls="font-medium">{r.partyName}</Td><Td>{r.section}</Td><Td right>{fmtAmt(r.gross)}</Td><Td right>{fmtAmt(r.amount)}</Td></tr>)}
          </Table>
          <p className="text-xs text-slate-400">Match this list against Form 26AS / the Annual Information Statement on the income-tax portal before claiming credit — credit is allowed only for tax the customer actually reported and deposited.</p>
        </>
      )}

      {tab === 'sections' && (
        <>
          {!seeded && canWrite && <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm flex items-center justify-between gap-3"><span>The built-in defaults are in use. Save them to the database to edit rates and thresholds (e.g. after a Budget change or your CA's advice).</span><button className={btnPrimary} onClick={seedSections}>Save defaults &amp; enable editing</button></div>}
          <Table head={<><Th>Section</Th><Th>Description</Th><Th>New-Act ref</Th><Th right>Rate (indiv/HUF)</Th><Th right>Rate (others)</Th><Th right>Single limit ₹</Th><Th right>Annual limit ₹</Th><Th /></>}>
            {sections.map(s => { const e = secEdit[s.code] || {}; const val = (k) => e[k] ?? s[k] ?? ''; const edit = seeded && canWrite
              return <tr key={s.code}><Td cls="font-semibold">{s.code}</Td>
                <Td>{edit ? <input value={val('name')} onChange={x => setSec(s.code, 'name', x.target.value)} className={`${inputCls} w-72`} /> : s.name}</Td>
                <Td>{edit ? <input value={val('newRef')} onChange={x => setSec(s.code, 'newRef', x.target.value)} className={`${inputCls} w-28`} placeholder="s.393…" /> : (s.newRef || <span className="text-slate-300">—</span>)}</Td>
                {['rateIndividual', 'rateOthers', 'singleLimit', 'annualLimit'].map(k => <Td key={k} right>{edit ? <input type="number" step="any" min="0" value={val(k)} onChange={x => setSec(s.code, k, x.target.value)} className={`${inputCls} w-24 text-right`} /> : s[k]}</Td>)}
                <Td right>{edit && secEdit[s.code] && <button className="text-blue-600 text-xs hover:underline" onClick={() => saveSection(s)}>Save</button>}</Td></tr> })}
          </Table>
          <p className="text-xs text-slate-400">Seed defaults are for resident payees and reflect long-standing rates; no-PAN deduction at 20% (206AA) is applied automatically in the voucher form. The Income-tax Act, 2025 (effective 1 Apr 2026) re-numbered the sections into s.393 tables — only 194C → s.393(1) Sl.6(i) is filled in; add the others as your CA confirms. TCS and TDS on salary (Form 24Q) are not part of this module.</p>
        </>
      )}
    </ReportShell>
  )
}
