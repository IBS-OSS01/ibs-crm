// Bank reconciliation: import the bank's statement, match it to the bank book, see what is
// uncleared and whether the books agree with the statement balance.
import React, { useMemo, useState } from 'react'
import { collection, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { useNavigate } from 'react-router-dom'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { parseBankStatement, bookEntries, autoMatch, reconciliation, stmtSig } from '../utils/bankRecon.js'
import { fmtAmt, todayStr } from '../utils/financeConstants.js'
import { downloadXlsx } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, ExportBar, Badge, Empty, cardCls, inputCls, thCls, btnPrimary, btnGhost, useFinancePerms } from '../components/FinanceUI.jsx'

const Th = ({ children, right }) => <th className={`${thCls} ${right ? 'text-right' : 'text-left'}`}>{children}</th>

export default function BankRecon() {
  const navigate = useNavigate()
  const { canWrite } = useFinancePerms()
  const { user } = useAuth()
  const { raw, allLines, loading, reload } = useFinanceData(['bankStatements'])
  const [company, setCompany] = useState('UIPL')
  const [bankId, setBankId] = useState('')
  const [asOf, setAsOf] = useState(todayStr())
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState('')

  const banks = (raw?.bankAccounts || []).filter(b => b.company === company && b.type !== 'cash' && b.active !== false)
  const hasUnassigned = useMemo(() => allLines.some(l => l.accountCode === '1100' && l.company === company && !l.bankAccountId && l.sourceType !== 'opening'), [allLines, company])
  const entries = useMemo(() => bookEntries(allLines, { company, bankAccountId: bankId }), [allLines, company, bankId])
  const statement = useMemo(() => (raw?.bankStatements || []).filter(s => s.company === company && (s.bankAccountId || '') === bankId).sort((a, b) => a.date.localeCompare(b.date)), [raw, company, bankId])
  const rec = useMemo(() => reconciliation(statement, entries, asOf), [statement, entries, asOf])
  const entryByKey = Object.fromEntries(entries.map(e => [e.key, e]))
  const matchedKeys = new Set(statement.map(s => s.matchedKey).filter(Boolean))
  const freeEntries = entries.filter(e => !e.opening && !matchedKeys.has(e.key))

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    setMsg(''); setBusy(true)
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true })
      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' })
      const { lines, error } = parseBankStatement(matrix)
      if (error) { setMsg(error); return }
      const have = new Set(statement.map(stmtSig))
      const fresh = lines.filter(l => !have.has(stmtSig(l)))
      let batch = writeBatch(db), n = 0
      for (const l of fresh) {
        batch.set(doc(collection(db, 'finance_bank_statement_lines')), { ...l, company, bankAccountId: bankId, matchedKey: '', importedAt: new Date().toISOString(), importedBy: user?.uid || '' })
        if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db) }
      }
      if (n % 400) await batch.commit()
      invalidateFinanceCache(); reload()
      setMsg(`Imported ${fresh.length} line(s)${lines.length - fresh.length ? `, skipped ${lines.length - fresh.length} already imported` : ''}.`)
    } catch (err) { setMsg('Could not import: ' + err.message) }
    finally { setBusy(false); e.target.value = '' }
  }

  const runAuto = async () => {
    setBusy(true)
    try {
      const props = autoMatch(statement, entries)
      let batch = writeBatch(db), n = 0
      for (const p of props) { batch.update(doc(db, 'finance_bank_statement_lines', p.statementId), { matchedKey: p.key, matchedAt: new Date().toISOString() }); if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db) } }
      if (n % 400) await batch.commit()
      invalidateFinanceCache(); reload(); setMsg(`${props.length} line(s) matched automatically (same amount, within 7 days).`)
    } catch (err) { setMsg('Matching failed: ' + err.message) }
    finally { setBusy(false) }
  }
  const match = async (s, key) => { await updateDoc(doc(db, 'finance_bank_statement_lines', s.id), { matchedKey: key, matchedAt: new Date().toISOString() }); invalidateFinanceCache(); reload() }
  const clearStatement = async () => {
    if (!window.confirm('Remove ALL imported statement lines for this bank account? Matching will be lost. (Vouchers are not touched.)')) return
    setBusy(true)
    for (const s of statement) await deleteDoc(doc(db, 'finance_bank_statement_lines', s.id))
    invalidateFinanceCache(); reload(); setBusy(false)
  }

  const bankName = bankId ? banks.find(b => b.id === bankId)?.name : 'Bank (default / unassigned)'

  return (
    <ReportShell title="Bank Reconciliation" loading={loading} subtitle="Match the bank's statement to your bank book and see what has not cleared."
      exportBar={<ExportBar onXlsx={() => downloadXlsx(`Bank reconciliation ${company} ${asOf}`, [
        { name: 'Summary', rows: [['Item', 'Amount'], ['Balance as per books', rec.bookBalance], ['Less: deposits not yet credited by bank', -rec.depositsInTransit], ['Add: cheques / payments not yet debited by bank', rec.chequesOutstanding], ['Add: bank credits not in books', rec.bankOnlyNet], ['Expected bank balance', rec.expected], ['Balance per bank statement', rec.stmtBalance ?? ''], ['Difference', rec.difference ?? '']] },
        { name: 'Uncleared in books', rows: [['Date', 'Voucher', 'Particulars', 'Deposit', 'Payment'], ...rec.uncleared.map(e => [e.date, e.number, e.party, e.debit, e.credit])] },
        { name: 'Not in books', rows: [['Date', 'Description', 'Ref', 'Withdrawal', 'Deposit'], ...rec.bankOnly.map(s => [s.date, s.description, s.ref, s.debit, s.credit])] }])} />}
      filters={<>
        <CompanyToggle value={company} onChange={c => { setCompany(c); setBankId('') }} />
        <select value={bankId} onChange={e => setBankId(e.target.value)} className={inputCls}>
          {(hasUnassigned || banks.length === 0) && <option value="">Bank (default / unassigned)</option>}
          {banks.map(b => <option key={b.id} value={b.id}>{b.name}{b.accountNumber ? ` ••${String(b.accountNumber).slice(-4)}` : ''}</option>)}
        </select>
        <label className="text-sm text-slate-500 flex items-center gap-2">As of <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={inputCls} /></label>
      </>}>
      {msg && <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm flex justify-between"><span>{msg}</span><button onClick={() => setMsg('')}>✕</button></div>}
      {canWrite && (
        <div className={`${cardCls} p-3 flex gap-3 items-center flex-wrap text-sm`}>
          <label className={`${btnGhost} cursor-pointer`}>{busy ? 'Working…' : '⬆ Import statement (Excel / CSV)'}<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} disabled={busy} /></label>
          <button className={btnPrimary} onClick={runAuto} disabled={busy || !statement.some(s => !s.matchedKey)}>Auto-match</button>
          {statement.length > 0 && <button className="text-red-500 hover:underline text-xs" onClick={clearStatement}>Clear imported statement</button>}
          <span className="text-xs text-slate-400">Needs columns for Date, Narration/Description, Withdrawal/Debit and Deposit/Credit (and Balance, for the final check).</span>
        </div>
      )}

      <div className={`${cardCls} p-5 max-w-2xl`}>
        <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3">Reconciliation statement — {bankName} as of {asOf}</p>
        {[['Balance as per books', rec.bookBalance], ['Less: deposits recorded but not yet credited by the bank', -rec.depositsInTransit], ['Add: payments recorded but not yet debited by the bank', rec.chequesOutstanding], ['Add: bank credits not yet in the books (net of charges)', rec.bankOnlyNet]].map(([l, v]) => (
          <div key={l} className="flex justify-between py-1 text-sm"><span>{l}</span><span>{fmtAmt(v)}</span></div>
        ))}
        <div className="flex justify-between py-1.5 text-sm font-bold border-t border-slate-200 mt-1"><span>Expected balance per bank</span><span>{fmtAmt(rec.expected)}</span></div>
        <div className="flex justify-between py-1 text-sm"><span>Balance per bank statement</span><span>{rec.stmtBalance === null ? <span className="text-slate-400">no balance column imported</span> : fmtAmt(rec.stmtBalance)}</span></div>
        {rec.difference !== null && <div className={`flex justify-between py-1.5 text-sm font-bold ${Math.abs(rec.difference) < 0.5 ? 'text-green-700' : 'text-red-600'}`}><span>{Math.abs(rec.difference) < 0.5 ? '✓ Reconciled' : 'Unreconciled difference'}</span><span>{fmtAmt(rec.difference)}</span></div>}
      </div>

      <h3 className="font-semibold text-slate-800">Bank statement lines ({statement.length})</h3>
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm"><thead className="bg-slate-50/80"><tr><Th>Date</Th><Th>Description</Th><Th>Ref</Th><Th right>Withdrawal</Th><Th right>Deposit</Th><Th>Matched to</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {statement.map(s => {
              const e = s.matchedKey ? entryByKey[s.matchedKey] : null
              return (
                <tr key={s.id} className={!s.matchedKey ? 'bg-amber-50/40' : ''}>
                  <td className="px-3 py-2 whitespace-nowrap">{s.date}</td><td className="px-3 py-2">{s.description}</td><td className="px-3 py-2 font-mono text-xs">{s.ref}</td>
                  <td className="px-3 py-2 text-right">{s.debit ? fmtAmt(s.debit) : ''}</td><td className="px-3 py-2 text-right">{s.credit ? fmtAmt(s.credit) : ''}</td>
                  <td className="px-3 py-2">
                    {e ? <span className="text-green-700">{e.number} · {e.date} {canWrite && <button className="text-xs text-slate-400 hover:text-red-500 ml-1" onClick={() => match(s, '')}>unmatch</button>}</span>
                      : s.matchedKey ? <span className="text-amber-600">entry changed — <button className="text-xs underline" onClick={() => match(s, '')}>unmatch</button></span>
                      : canWrite ? (
                        <span className="flex gap-1 items-center">
                          <select value={pick} onChange={ev => setPick(ev.target.value)} className="px-2 py-1 border border-slate-300 rounded text-xs max-w-[220px]">
                            <option value="">Pick a book entry…</option>
                            {freeEntries.filter(x => s.credit ? x.debit > 0 : x.credit > 0).map(x => <option key={x.key} value={x.key}>{x.date} · {x.number} · {fmtAmt(x.debit || x.credit)}</option>)}
                          </select>
                          <button className="text-xs text-blue-600 hover:underline disabled:opacity-40" disabled={!pick} onClick={() => { match(s, pick); setPick('') }}>match</button>
                          <button className="text-xs text-slate-500 hover:underline" onClick={() => navigate(`/finance/vouchers/${s.credit ? 'receipt' : 'payment'}?new=1`)}>+ entry</button>
                        </span>) : <Badge color="bg-amber-100 text-amber-700">not in books</Badge>}
                  </td>
                </tr>
              )
            })}
            {statement.length === 0 && <tr><td colSpan={6}><Empty>No statement imported for this account yet.</Empty></td></tr>}
          </tbody>
        </table>
      </div>

      <h3 className="font-semibold text-slate-800">Entries in the books not matched to the statement ({freeEntries.length})</h3>
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm"><thead className="bg-slate-50/80"><tr><Th>Date</Th><Th>Voucher</Th><Th>Particulars</Th><Th right>Deposit</Th><Th right>Payment</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {freeEntries.map(e => <tr key={e.key}><td className="px-3 py-2">{e.date}</td><td className="px-3 py-2 font-mono text-xs">{e.number}</td><td className="px-3 py-2">{e.party}</td><td className="px-3 py-2 text-right">{e.debit ? fmtAmt(e.debit) : ''}</td><td className="px-3 py-2 text-right">{e.credit ? fmtAmt(e.credit) : ''}</td></tr>)}
            {freeEntries.length === 0 && <tr><td colSpan={5}><Empty>Everything in the bank book is matched.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Older Payments In / Expenses / Payables pages feed the bank book without a bank-account link, so they appear only under “Bank (default / unassigned)”. Assign bank accounts when you enter new vouchers for exact per-account reconciliation.</p>
    </ReportShell>
  )
}
