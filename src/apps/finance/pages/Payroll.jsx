// Finance → Payroll: post a month's salary slips (from HR) to the books, track PF / ESIC dues and payments,
// and edit the statutory rates.
import React, { useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, setDoc } from 'firebase/firestore'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { createVoucher, getBooksLockDate, VoucherError } from '../utils/voucherService.js'
import { mergeStatutory, DEFAULT_STATUTORY, payrollTotals, contributionDue } from '../../hr/utils/statutory.js'
import { fyMonths } from '../utils/tdsReports.js'
import { fmtAmt, fyList, currentFY, todayStr, num, r2 } from '../utils/financeConstants.js'
import { cashBankOptions, Field } from '../components/formShared.jsx'
import { ReportShell, CompanyToggle, Badge, Empty, cardCls, inputCls, formInputCls, thCls, btnPrimary, btnGhost, useFinancePerms } from '../components/FinanceUI.jsx'

const TABS = [['post', 'Post payroll'], ['dues', 'PF & ESIC dues'], ['rates', 'Statutory rates']]
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ml = (ym) => `${MN[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`
const Th = ({ children, right }) => <th className={`${thCls} ${right ? 'text-right' : 'text-left'}`}>{children}</th>
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }
const prevMonth = () => { const d = new Date(); const p = new Date(d.getFullYear(), d.getMonth() - 1, 1); return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}` }

export default function Payroll() {
  const { tab = 'post' } = useParams()
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const { canWrite, isAdmin } = useFinancePerms()
  const { raw, loading, reload } = useFinanceData(['statutoryChallans', 'hrSlips', 'hrEmployees'])
  const [company, setCompany] = useState('UIPL')
  const [month, setMonth] = useState(prevMonth())
  const [fy, setFy] = useState(currentFY())
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [pay, setPay] = useState(null)

  const S = useMemo(() => mergeStatutory(raw?.companySettings?.[company]?.statutory), [raw, company])
  const empById = useMemo(() => Object.fromEntries((raw?.hrEmployees || []).map(e => [e.id, e])), [raw])
  const slips = useMemo(() => (raw?.hrSlips || []).filter(x => x.month === month && true), [raw, month, company, empById])   // UIPL is the employer of everyone, including staff who serve Wayzim
  const t = useMemo(() => payrollTotals(slips, S), [slips, S])
  const posted = (raw?.vouchers || []).find(v => v.voucherType === 'payroll' && v.company === company && v.month === month && v.status !== 'cancelled')
  const banks = useMemo(() => raw ? cashBankOptions(raw, company) : [], [raw, company])

  const missingUan = slips.filter(x => (x.pfEmployee || 0) > 0 && !/^\d{12}$/.test(String(empById[x.employeeId]?.uan || '')))
  const activeNoSlip = (raw?.hrEmployees || []).filter(e => e.active !== false && !slips.some(x => x.employeeId === e.id))

  const post = async () => {
    setMsg(''); setBusy(true)
    try {
      const lockedUpTo = await getBooksLockDate(company)
      const net = r2(t.gross - t.pfEmployee - t.esicEmployee - t.advances - t.otherDeductions)
      await createVoucher({
        voucherType: 'payroll', company, date: lastDay(month), month, total: t.gross,
        payroll: { gross: t.gross, employerPf: t.employerPf, employerEsic: t.esicEmployer, pfCharges: t.pfCharges, net, pfPayable: t.pfPayable, esicPayable: t.esicPayable, advances: t.advances, otherDeductions: t.otherDeductions, pfEmployee: t.pfEmployee, esicEmployee: t.esicEmployee, headcount: t.count },
        narration: `Payroll ${ml(month)} — ${t.count} employee(s)`,
      }, { user, profile: userProfile, lockedUpTo })
      invalidateFinanceCache(); reload(); setMsg(`Payroll for ${ml(month)} posted to the books.`)
    } catch (e) { setMsg(e instanceof VoucherError ? e.message : 'Could not post: ' + e.message) } finally { setBusy(false) }
  }

  // ── dues ──
  const months = useMemo(() => fyMonths(fy), [fy])
  const challans = (raw?.statutoryChallans || []).filter(c => c.company === company)
  const dues = useMemo(() => ['pf', 'esic'].map(kind => ({ kind, rows: months.map(m => {
    const liab = r2((raw?.vouchers || []).filter(v => v.voucherType === 'payroll' && v.company === company && v.month === m && v.status !== 'cancelled').reduce((s, v) => s + num(v.payroll?.[kind === 'pf' ? 'pfPayable' : 'esicPayable']), 0))
    const paidRows = challans.filter(c => c.kind === kind && c.forMonth === m)
    const paid = r2(paidRows.reduce((s, c) => s + num(c.amount), 0))
    const due = contributionDue(m)
    const pending = r2(liab - paid)
    const status = liab === 0 ? 'none' : pending <= 0.5 ? 'paid' : (todayStr() > due ? 'overdue' : 'due')
    return { month: m, liab, paid, pending, due, status, paidRows }
  }) })), [months, raw, company, challans])
  const openPay = (kind, row) => setPay({ kind, forMonth: row?.month || months[0], amount: row ? Math.max(0, row.pending) : '', extra: '', paidOn: todayStr(), bankKey: banks[0]?.key, ref: '', error: '' })
  const savePay = async () => {
    const p = pay
    if (num(p.amount) <= 0) return setPay({ ...p, error: 'Enter the amount paid.' })
    if (!p.ref.trim()) return setPay({ ...p, error: p.kind === 'pf' ? 'Enter the TRRN / challan reference.' : 'Enter the ESIC challan number.' })
    const bank = banks.find(b => b.key === p.bankKey) || banks[0]
    setPay({ ...p, saving: true, error: '' })
    try {
      const lockedUpTo = await getBooksLockDate(company)
      const lines = [{ accountCode: p.kind === 'pf' ? '2610' : '2620', amount: r2(num(p.amount)), description: `${p.kind.toUpperCase()} for ${ml(p.forMonth)}` }]
      if (num(p.extra)) lines.push({ accountCode: '5180', amount: r2(num(p.extra)), description: `Interest / damages on late ${p.kind.toUpperCase()}` })
      const total = r2(lines.reduce((s, l) => s + l.amount, 0))
      const res = await createVoucher({ voucherType: 'payment', company, date: p.paidOn, partyAmount: 0, allocations: [], accountLines: lines, tds: { applicable: false }, bankAccountCode: bank.code, bankAccountId: bank.id, refNumber: p.ref.trim(), narration: `${p.kind.toUpperCase()} contribution for ${ml(p.forMonth)}`, amount: total }, { user, profile: userProfile, lockedUpTo })
      await addDoc(collection(db, 'finance_statutory_challans'), { company, kind: p.kind, forMonth: p.forMonth, amount: r2(num(p.amount)), extra: r2(num(p.extra)), paidOn: p.paidOn, ref: p.ref.trim(), voucherId: res.id, voucherNumber: res.voucherNumber, createdAt: new Date().toISOString(), createdBy: user?.uid || '' })
      invalidateFinanceCache(); reload(); setPay(null); setMsg('Payment recorded.')
    } catch (e) { setPay(x => ({ ...x, saving: false, error: e instanceof VoucherError ? e.message : 'Error: ' + e.message })) }
  }
  const delChallan = async (c) => { if (window.confirm(`Remove the record of ${c.ref}? The payment voucher ${c.voucherNumber || ''} stays in the books — cancel it separately if it was a mistake.`)) { await deleteDoc(doc(db, 'finance_statutory_challans', c.id)); invalidateFinanceCache(); reload() } }

  // ── rates ──
  const [rates, setRates] = useState(null)
  const editing = rates || S
  const setR = (k, v) => setRates({ ...(rates || S), [k]: v })
  const saveRates = async () => {
    const clean = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, ['pfEstablishmentCode', 'esicCode'].includes(k) ? String(v) : num(v)]))
    await setDoc(doc(db, 'company_settings', company), { statutory: clean }, { merge: true })
    invalidateFinanceCache(); reload(); setRates(null); setMsg('Rates saved. New salary slips use them; slips already generated keep their figures.')
  }
  const RATE_FIELDS = [['pfEmployeePct', 'PF — employee %'], ['pfEmployerPct', 'PF — employer total %'], ['pfEpsPct', 'of which EPS %'], ['pfCeiling', 'PF wage ceiling ₹'], ['edliPct', 'EDLI %'], ['pfAdminPct', 'PF admin charge %'], ['pfAdminMin', 'PF admin minimum ₹ / month'], ['wageBasicPct', 'Basic if not recorded (% of gross)'],
    ['esicEmployeePct', 'ESIC — employee %'], ['esicEmployerPct', 'ESIC — employer %'], ['esicCeiling', 'ESIC gross ceiling ₹'], ['esicDailyExempt', 'No employee ESIC at ₹ / day or less']]
  const STAT = { none: ['bg-slate-100 text-slate-500', '—'], paid: ['bg-green-100 text-green-700', 'Paid'], due: ['bg-blue-100 text-blue-700', 'Due'], overdue: ['bg-red-100 text-red-700', 'Overdue'] }
  const label = TABS.find(x => x[0] === tab)?.[1]

  return (
    <ReportShell title={`Payroll — ${label}`} loading={loading} subtitle="Salary slips from HR flow into the books; PF and ESIC are tracked until they are paid."
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">{TABS.map(([k, l]) => <button key={k} onClick={() => navigate(`/finance/payroll/${k}`)} className={`px-3 py-1.5 font-medium ${k === tab ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>
        {tab === 'post' && <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={inputCls} />}
        {tab === 'dues' && <select value={fy} onChange={e => setFy(e.target.value)} className={inputCls}>{fyList().map(f => <option key={f} value={f}>FY 20{f.slice(0, 2)}-{f.slice(3)}</option>)}</select>}
      </>}>
      {msg && <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm flex justify-between"><span>{msg}</span><button onClick={() => setMsg('')}>✕</button></div>}

      {tab === 'post' && (
        <>
          {slips.length === 0 && <Empty>No salary slips for {company} in {ml(month)}. Generate them in HR → Salary first (UIPL is the employer of all staff, including those who serve Wayzim).</Empty>}
          {slips.length > 0 && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {[['Gross salaries', t.gross], ['Net pay to staff', r2(t.gross - t.pfEmployee - t.esicEmployee - t.advances - t.otherDeductions)], ['PF to pay (all)', t.pfPayable], ['ESIC to pay (all)', t.esicPayable]].map(([l, v]) => <div key={l} className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">{l}</p><p className="text-xl font-bold">₹{fmtAmt(v)}</p></div>)}
              </div>
              <div className={`${cardCls} overflow-x-auto`}>
                <table className="w-full text-sm"><thead className="bg-slate-50/80"><tr><Th>Employee</Th><Th right>Gross</Th><Th right>PF (emp)</Th><Th right>ESIC (emp)</Th><Th right>Advances</Th><Th right>Other</Th><Th right>Net pay</Th><Th right>Employer PF + EDLI</Th><Th right>Employer ESIC</Th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {slips.map(x => <tr key={x.id}><td className="px-3 py-2 font-medium">{x.employeeName}</td><td className="px-3 py-2 text-right">{fmtAmt(x.baseSalary)}</td><td className="px-3 py-2 text-right">{fmtAmt(x.pfEmployee)}</td><td className="px-3 py-2 text-right">{fmtAmt(x.esicEmployee)}</td><td className="px-3 py-2 text-right">{fmtAmt(x.advancesDeducted)}</td><td className="px-3 py-2 text-right">{fmtAmt(x.deductions)}</td><td className="px-3 py-2 text-right font-medium">{fmtAmt(x.netSalary)}</td><td className="px-3 py-2 text-right">{fmtAmt(num(x.pfEmployerEps) + num(x.pfEmployerEpf) + num(x.pfEdli))}</td><td className="px-3 py-2 text-right">{fmtAmt(x.esicEmployer)}</td></tr>)}
                  </tbody>
                  <tfoot><tr className="bg-slate-50 font-bold"><td className="px-3 py-2">Total ({t.count})</td><td className="px-3 py-2 text-right">{fmtAmt(t.gross)}</td><td className="px-3 py-2 text-right">{fmtAmt(t.pfEmployee)}</td><td className="px-3 py-2 text-right">{fmtAmt(t.esicEmployee)}</td><td className="px-3 py-2 text-right">{fmtAmt(t.advances)}</td><td className="px-3 py-2 text-right">{fmtAmt(t.otherDeductions)}</td><td className="px-3 py-2 text-right">{fmtAmt(t.gross - t.pfEmployee - t.esicEmployee - t.advances - t.otherDeductions)}</td><td className="px-3 py-2 text-right">{fmtAmt(t.employerPf + t.pfEdli)}</td><td className="px-3 py-2 text-right">{fmtAmt(t.esicEmployer)}</td></tr></tfoot>
                </table>
              </div>
              <p className="text-xs text-slate-500">Plus PF admin charge ₹{fmtAmt(t.pfAdmin)} (0.5% of PF wages, minimum ₹{S.pfAdminMin}). Total employer cost beyond gross: ₹{fmtAmt(t.employerPf + t.pfCharges + t.esicEmployer)}.</p>
              {missingUan.length > 0 && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">UAN missing for {missingUan.map(x => x.employeeName).join(', ')} — needed for the EPFO ECR file (HR → Employees).</div>}
              {activeNoSlip.length > 0 && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">No slip yet for {activeNoSlip.map(e => e.name).join(', ')}.</div>}
              {posted ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">✓ Posted to the books as <b>{posted.voucherNumber}</b> (gross ₹{fmtAmt(posted.payroll?.gross)}). To correct it, cancel that voucher from the Day Book and post again.</div>
              ) : canWrite && (
                <div className={`${cardCls} p-4 space-y-2`}>
                  <p className="text-sm text-slate-700">Posting books, dated {lastDay(month)}: <b>Dr</b> Salaries, Employer PF, Employer ESIC, PF admin &amp; EDLI · <b>Cr</b> Salary Payable (net pay), PF Payable, ESIC Payable{t.advances ? ', Employee Advances' : ''}{t.otherDeductions ? ', Other salary deductions' : ''}.</p>
                  <p className="text-xs text-slate-400">Pay the staff with a Payment voucher against “Salary Payable (2150)” and pay PF / ESIC from the next tab. TDS on salary is not part of this module.</p>
                  <button className={btnPrimary} disabled={busy} onClick={post}>{busy ? 'Posting…' : `Post ${ml(month)} payroll to books`}</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'dues' && (
        <>
          {pay && (
            <div className={`${cardCls} p-4 space-y-3`}>
              <h3 className="font-semibold text-slate-800">Record {pay.kind === 'pf' ? 'PF' : 'ESIC'} payment</h3>
              {pay.error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-600 text-sm">{pay.error}</div>}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="For month"><select value={pay.forMonth} onChange={e => setPay({ ...pay, forMonth: e.target.value })} className={formInputCls}>{months.map(m => <option key={m} value={m}>{ml(m)}</option>)}</select></Field>
                <Field label="Amount (₹)"><input type="number" min="0" step="any" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} className={formInputCls} /></Field>
                <Field label="Interest / damages (₹)"><input type="number" min="0" step="any" value={pay.extra} onChange={e => setPay({ ...pay, extra: e.target.value })} className={formInputCls} /></Field>
                <Field label="Paid on"><input type="date" value={pay.paidOn} onChange={e => setPay({ ...pay, paidOn: e.target.value })} className={formInputCls} /></Field>
                <Field label="Paid from"><select value={pay.bankKey} onChange={e => setPay({ ...pay, bankKey: e.target.value })} className={formInputCls}>{banks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
                <Field label={pay.kind === 'pf' ? 'TRRN / challan ref' : 'ESIC challan no.'}><input value={pay.ref} onChange={e => setPay({ ...pay, ref: e.target.value })} className={formInputCls} /></Field>
              </div>
              <div className="flex gap-2"><button className={btnPrimary} disabled={pay.saving} onClick={savePay}>{pay.saving ? 'Saving…' : 'Save (also books the bank payment)'}</button><button className={btnGhost} onClick={() => setPay(null)}>Cancel</button></div>
            </div>
          )}
          {dues.map(({ kind, rows }) => (
            <div key={kind} className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="font-semibold text-slate-800">{kind === 'pf' ? 'Provident Fund (EPFO)' : 'ESIC'}</h3>{canWrite && !pay && <button className="text-sm text-blue-600 hover:underline" onClick={() => openPay(kind)}>+ Record a payment</button>}</div>
              <div className={`${cardCls} overflow-x-auto`}>
                <table className="w-full text-sm"><thead className="bg-slate-50/80"><tr><Th>Month</Th><Th right>Payable (posted payroll)</Th><Th right>Paid</Th><Th right>Pending</Th><Th>Due</Th><Th>Status</Th><Th>Reference</Th><Th /></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(r => <tr key={r.month}><td className="px-3 py-2 font-medium">{ml(r.month)}</td><td className="px-3 py-2 text-right">{r.liab ? fmtAmt(r.liab) : '—'}</td><td className="px-3 py-2 text-right">{r.paid ? fmtAmt(r.paid) : '—'}</td><td className={`px-3 py-2 text-right ${r.pending > 0.5 ? 'text-red-600 font-medium' : ''}`}>{r.pending > 0.5 ? fmtAmt(r.pending) : '—'}</td><td className="px-3 py-2">{r.liab ? r.due : '—'}</td><td className="px-3 py-2"><Badge color={STAT[r.status][0]}>{STAT[r.status][1]}</Badge></td>
                      <td className="px-3 py-2 font-mono text-xs">{r.paidRows.map(c => <span key={c.id} className="mr-2">{c.ref}{canWrite && <button className="ml-1 text-red-400" onClick={() => delChallan(c)}>×</button>}</span>)}</td>
                      <td className="px-3 py-2 text-right">{canWrite && r.pending > 0.5 && !pay && <button className="text-xs text-blue-600 hover:underline" onClick={() => openPay(kind, r)}>Pay</button>}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-400">Both are due on the 15th of the next month. Interest (12% a year) and, for PF, damages on late payment are not calculated — enter what the portal charges in “Interest / damages”. Only months whose payroll has been posted show a payable.</p>
        </>
      )}

      {tab === 'rates' && (
        <div className={`${cardCls} p-4 space-y-3`}>
          <p className="text-sm text-slate-600">Defaults are the long-standing statutory rates. Change them here if the law changes — it applies to salary slips generated afterwards. Have your CA confirm the current figures.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {RATE_FIELDS.map(([k, l]) => <Field key={k} label={l}><input type="number" step="any" min="0" disabled={!isAdmin} value={editing[k]} onChange={e => setR(k, e.target.value)} className={formInputCls} /></Field>)}
            <Field label="PF establishment code"><input disabled={!isAdmin} value={editing.pfEstablishmentCode} onChange={e => setR('pfEstablishmentCode', e.target.value)} className={formInputCls} /></Field>
            <Field label="ESIC code number"><input disabled={!isAdmin} value={editing.esicCode} onChange={e => setR('esicCode', e.target.value)} className={formInputCls} /></Field>
          </div>
          {isAdmin ? <div className="flex gap-2"><button className={btnPrimary} disabled={!rates} onClick={saveRates}>Save rates</button>{rates && <button className={btnGhost} onClick={() => setRates(null)}>Reset</button>}<button className="text-xs text-slate-500 hover:underline" onClick={() => setRates({ ...DEFAULT_STATUTORY })}>Load defaults</button></div> : <p className="text-xs text-slate-400">Only an admin can change the rates.</p>}
        </div>
      )}
    </ReportShell>
  )
}
