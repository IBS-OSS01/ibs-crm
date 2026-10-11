// Turn bank-statement lines that are not in the books yet into real entries (receipt / payment / contra vouchers).
// Every line gets a suggestion from what the bank narrative says; nothing is posted until the user presses Create.
import React, { useMemo, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { createVoucher, getBooksLockDate } from '../utils/voucherService.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { suggestAll, buildVoucher, bankLineKey } from '../utils/bankEntries.js'
import { customerOptions, vendorOptions, groupFlag } from './formShared.jsx'
import { fmtAmt } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls, Badge } from './FinanceUI.jsx'

const sel = 'px-2 py-1 border border-slate-300 rounded text-xs max-w-[230px] bg-white'
const KINDS = { receipt: 'Receipt', payment: 'Payment', contra: 'Transfer (contra)' }

export default function BankEntriesModal({ lines, company, bank, banks, raw, accounts, onClose, onDone }) {
  const { user, userProfile } = useAuth()
  const customers = useMemo(() => customerOptions(raw, company), [raw, company])
  const vendors = useMemo(() => vendorOptions(raw), [raw])
  const bankList = useMemo(() => banks.filter(b => b.id !== bank.id), [banks, bank.id])
  const ledgers = useMemo(() => (accounts || []).filter(a => a.isActive !== false && !['1100', '1110'].includes(a.code)).sort((a, b) => a.code.localeCompare(b.code)), [accounts])
  const lineById = useMemo(() => Object.fromEntries(lines.map(l => [l.id, l])), [lines])

  const [rows, setRows] = useState(() => suggestAll(lines, { customers, vendors, banks: banks.map(b => ({ id: b.id, name: b.name, bankName: b.bankName, accountNumber: b.accountNumber })), employees: (raw?.hrEmployees || []).map(e => e.name).filter(Boolean), thisBankId: bank.id })
    .map(r => ({ ...r, include: !(r.kind === 'contra' && !r.otherBankId) })))
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)

  const patch = (lineId, p) => setRows(rs => rs.map(r => r.lineId === lineId ? { ...r, ...p } : r))
  const setKind = (r, kind) => patch(r.lineId, { kind, partyId: '', partyName: '', partyType: '', otherBankId: kind === 'contra' ? r.otherBankId : '', accountCode: kind === 'contra' ? '' : (r.accountCode || (kind === 'receipt' ? '2900' : '5900')), review: true })
  const setTarget = (r, v) => {
    if (v.startsWith('p:')) {
      const id = v.slice(2), p = (r.kind === 'receipt' ? customers : vendors).find(x => x.id === id)
      patch(r.lineId, { partyId: id, partyName: p?.name || '', partyType: r.kind === 'receipt' ? 'customer' : 'vendor', accountCode: '', review: false })
    } else patch(r.lineId, { accountCode: v.slice(2), partyId: '', partyName: '', partyType: '', review: false })
    setEditing('')
  }
  const complete = (r) => r.kind === 'contra' ? !!r.otherBankId : !!(r.partyId || r.accountCode)
  const shown = rows.filter(r => filter === 'all' || (filter === 'review' ? r.review : r.kind === filter))
  const chosen = rows.filter(r => r.include && complete(r))
  const sum = (k) => rows.filter(r => r.include && r.kind === k).reduce((s, r) => s + (lineById[r.lineId].credit || lineById[r.lineId].debit), 0)

  const run = async () => {
    setBusy(true); setProgress(0)
    const failed = []; let made = 0
    try {
      const lockedUpTo = await getBooksLockDate(company)
      for (const r of chosen) {
        const line = lineById[r.lineId]
        try {
          const other = r.kind === 'contra' ? bankList.find(b => b.id === r.otherBankId) : null
          const flag = r.kind === 'receipt' && company === 'UIPL' && r.partyName ? groupFlag(raw, r.partyName) : null
          const data = buildVoucher({ ...r, otherBank: other && { id: other.id, name: other.name } }, line, { company, bank: { id: bank.id, name: bank.name }, interCompanyFlag: flag })
          const { id } = await createVoucher(data, { user, profile: userProfile, lockedUpTo })
          await updateDoc(doc(db, 'finance_bank_statement_lines', line.id), { matchedKey: bankLineKey(data.voucherType, id, line), matchedAt: new Date().toISOString(), createdFromStatement: true })
          made++
        } catch (e) {
          failed.push({ line, error: e.message })
          if (failed.length >= 3 && made === 0) break      // e.g. books locked — don't hammer
        }
        setProgress(p => p + 1)
      }
    } finally {
      invalidateFinanceCache(); setBusy(false); setResult({ made, failed })
      onDone?.()
    }
  }

  const label = (r) => r.kind === 'contra' ? (bankList.find(b => b.id === r.otherBankId)?.name || '— choose the other bank —')
    : r.partyName || (r.accountCode ? `${r.accountCode} ${ledgers.find(a => a.code === r.accountCode)?.name || ''}` : '— choose —')

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`${cardCls} w-full max-w-6xl p-5 space-y-3 max-h-[94vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h3 className="text-lg font-bold text-slate-800">Create entries from the bank statement</h3>
            <p className="text-xs text-slate-400">{bank.name} · {lines.length} line(s) not yet in the books. Check each suggestion — change the type, party or ledger where it is wrong, untick what you do not want. Nothing is posted until you press Create.</p></div>
          {!busy && <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>}
        </div>
        {result && (
          <div className={`p-3 rounded-lg text-sm border ${result.failed.length ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
            Done — {result.made} entr{result.made === 1 ? 'y' : 'ies'} created and matched to the statement.{result.failed.length > 0 && <> {result.failed.length} could not be created: {result.failed.slice(0, 3).map(f => `${f.line.date} ${fmtAmt(f.line.credit || f.line.debit)} — ${f.error}`).join('; ')}</>}
          </div>
        )}
        {!result && <>
          <div className="flex flex-wrap gap-2 items-center text-sm">
            {[['all', `All (${rows.length})`], ['review', `Needs a look (${rows.filter(r => r.review).length})`], ['receipt', `Receipts (${rows.filter(r => r.kind === 'receipt').length})`], ['payment', `Payments (${rows.filter(r => r.kind === 'payment').length})`], ['contra', `Transfers (${rows.filter(r => r.kind === 'contra').length})`]].map(([k, l]) =>
              <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1 rounded-full border text-xs font-medium ${filter === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300'}`}>{l}</button>)}
            <span className="text-xs text-slate-500 ml-auto">Selected {chosen.length}: receipts {fmtAmt(sum('receipt'))} · payments {fmtAmt(sum('payment'))} · transfers {fmtAmt(sum('contra'))}</span>
          </div>
          <div className="overflow-auto rounded-lg border border-slate-200 max-h-[58vh]">
            <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase sticky top-0"><tr><th className="px-2 py-2 w-8" /><th className="text-left px-2">Date</th><th className="text-left px-2">Bank narrative</th><th className="text-right px-2">Amount</th><th className="text-left px-2">Entry</th><th className="text-left px-2">Party / ledger</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{shown.map(r => {
                const l = lineById[r.lineId], ok = complete(r)
                return (
                  <tr key={r.lineId} className={`${r.include && ok ? '' : 'opacity-50'} ${r.review ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-2"><input type="checkbox" checked={r.include && ok} disabled={!ok} onChange={e => patch(r.lineId, { include: e.target.checked })} /></td>
                    <td className="px-2 whitespace-nowrap">{l.date}</td>
                    <td className="px-2 py-1.5 max-w-sm truncate" title={l.description}>{l.description}</td>
                    <td className={`px-2 text-right whitespace-nowrap font-medium ${l.credit ? 'text-green-700' : 'text-slate-700'}`}>{l.credit ? '+' : '−'}{fmtAmt(l.credit || l.debit)}</td>
                    <td className="px-2"><select value={r.kind} onChange={e => setKind(r, e.target.value)} className={sel}>{Object.entries(KINDS).filter(([k]) => k === 'contra' || (k === 'receipt') === (l.credit > 0)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                    <td className="px-2">
                      {editing === r.lineId ? (r.kind === 'contra'
                        ? <select autoFocus value={r.otherBankId} onChange={e => { patch(r.lineId, { otherBankId: e.target.value, review: false, include: !!e.target.value }); setEditing('') }} onBlur={() => setEditing('')} className={sel}><option value="">— choose —</option>{bankList.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                        : <select autoFocus value={r.partyId ? `p:${r.partyId}` : r.accountCode ? `a:${r.accountCode}` : ''} onChange={e => e.target.value && setTarget(r, e.target.value)} onBlur={() => setEditing('')} className={sel}>
                          <option value="">— choose —</option>
                          <optgroup label={r.kind === 'receipt' ? 'Customers' : 'Vendors'}>{(r.kind === 'receipt' ? customers : vendors).map(p => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
                          <optgroup label="Ledger accounts">{ledgers.map(a => <option key={a.code} value={`a:${a.code}`}>{a.code} {a.name}</option>)}</optgroup>
                        </select>)
                        : <button className="text-left hover:underline" onClick={() => setEditing(r.lineId)} title={r.reason}><span className={ok ? 'text-slate-800' : 'text-red-600'}>{label(r)}</span> <span className="text-slate-400">· {r.reason}</span></button>}
                      {r.review && <Badge color="bg-amber-100 text-amber-700">check</Badge>}
                    </td>
                  </tr>)
              })}</tbody></table>
          </div>
          <p className="text-xs text-slate-500">Receipts and payments to a customer / vendor are booked <b>on account</b> — allocate them to invoices or bills afterwards (Outstanding, or edit the voucher). Lines that could not be identified are parked in a clearing ledger (Other Current Liabilities / Miscellaneous Expenses) with the bank narrative, so the bank balance is right; re-classify them when you know what they are.</p>
        </>}
        <div className="flex gap-2 items-center">
          {!result && <button className={btnPrimary} disabled={busy || !chosen.length} onClick={run}>{busy ? `Creating… ${progress}/${chosen.length}` : `Create ${chosen.length} entr${chosen.length === 1 ? 'y' : 'ies'}`}</button>}
          {!busy && <button className={btnGhost} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>}
        </div>
      </div>
    </div>
  )
}
