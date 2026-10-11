// Voucher entry hub — one page per voucher type with a recent-vouchers list and
// Tally-style function-key shortcuts (F4 Contra, F5 Payment, F6 Receipt, F9 Purchase,
// Ctrl+F8 Credit Note, Ctrl+F9 Debit Note, Esc closes the form).
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { VOUCHER_TYPES, NEW_VOUCHER_TYPES, fmtAmt } from '../utils/financeConstants.js'
import { PurchaseForm, NoteForm } from '../components/VoucherForms.jsx'
import { PaymentForm, ReceiptForm, ContraForm } from '../components/SettlementForms.jsx'
import { PurchaseOrderForm, StockJournalForm } from '../components/InventoryForms.jsx'
import { pendingPoLines } from '../utils/purchaseOrders.js'
import { creditDaysFromTerms } from '../components/formShared.jsx'
import { useVoucherModal } from '../components/useVoucherModal.jsx'
import BillsImport from '../components/BillsImport.jsx'
import ExpensesImport from '../components/ExpensesImport.jsx'
import PayStatus from '../components/PayStatus.jsx'
import { openBillMap, payStatus } from '../utils/outstanding.js'
import { ReportShell, CompanyToggle, Badge, Empty, cardCls, btnPrimary, btnGhost, inputCls, useFinancePerms } from '../components/FinanceUI.jsx'

const EXTERNAL = { sales: '/finance/invoices', journal: '/finance/journal' }
const FKEYS = { F4: 'contra', F5: 'payment', F6: 'receipt', F9: 'purchase' }
const CTRL_FKEYS = { F5: 'purchase_order', F7: 'stock_journal', F8: 'credit_note', F9: 'debit_note' }

export default function Vouchers() {
  const { type = 'purchase' } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { canWrite } = useFinancePerms()
  const data = useFinanceData(['hsnCodes', 'tdsSections', 'costCentres'])
  const { raw, loading, reload } = data
  const { open, modal } = useVoucherModal({ raw, allLines: data.allLines, reload })
  const [company, setCompany] = useState('UIPL')
  const [q, setQ] = useState('')
  const today = new Date().toLocaleDateString('en-CA')
  const openBills = useMemo(() => (type === 'purchase' && data.allLines ? openBillMap(data.allLines, { kind: 'payable', company, asOf: today }) : null), [data.allLines, type, company, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const [showImport, setShowImport] = useState('')

  const editId = params.get('edit')
  const creating = params.get('new') === '1'
  const showForm = canWrite && (creating || !!editId)
  const poId = params.get('po')
  const prefill = useMemo(() => {
    if (!poId || !raw) return null
    const po = raw.vouchers.find(v => v.id === poId); if (!po) return null
    const vend = (raw.vendors || []).find(v => v.id === po.partyId)
    const lines = pendingPoLines(po, raw.vouchers)
    return { company: po.company, partyId: po.partyId, warehouseId: po.warehouseId, purchaseOrderId: po.id, purchaseOrderNumber: po.voucherNumber, applyGst: po.applyGst, creditDays: creditDaysFromTerms(vend?.paymentTerms),
      items: lines.map(l => ({ ...l.item, qty: l.pending, poLine: l.index })), narration: `Against ${po.voucherNumber}` }
  }, [poId, raw])
  const editing = useMemo(() => editId && raw ? raw.vouchers.find(v => v.id === editId) : null, [editId, raw])

  const closeForm = () => setParams({}, { replace: true })
  const saved = () => { invalidateFinanceCache(); reload(); closeForm() }

  // Tally-style keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && showForm) { closeForm(); return }
      let t = null
      if (e.ctrlKey && CTRL_FKEYS[e.key]) t = CTRL_FKEYS[e.key]
      else if (!e.ctrlKey && !e.altKey && FKEYS[e.key]) t = FKEYS[e.key]
      if (t) { e.preventDefault(); navigate(`/finance/vouchers/${t}?new=1`) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showForm, navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (EXTERNAL[type]) navigate(EXTERNAL[type], { replace: true }) }, [type, navigate])

  const entries = useMemo(() => {
    if (!raw) return []
    return buildVoucherIndex(raw)
      .filter(e => e.kind === type && e.company === company && (!q || `${e.number} ${e.partyName} ${e.narration}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.number).localeCompare(String(a.number)))
      .slice(0, 300)
  }, [raw, type, company, q])

  if (!VOUCHER_TYPES[type] || EXTERNAL[type]) return null
  const label = VOUCHER_TYPES[type].label
  const newType = NEW_VOUCHER_TYPES.includes(type)

  const form = (() => {
    if (!showForm || !raw) return null
    if (editId && !editing) return <div className={`${cardCls} p-5 text-sm text-slate-500`}>Voucher not found (it may live in an older module — open it from its original page).</div>
    const props = { data, initial: editing || undefined, onSaved: saved, onCancel: closeForm }
    switch (type) {
      case 'purchase': return <PurchaseForm {...props} prefill={prefill} />
      case 'purchase_order': return <PurchaseOrderForm {...props} />
      case 'stock_journal': return <StockJournalForm {...props} />
      case 'credit_note': case 'debit_note': return <NoteForm type={type} {...props} />
      case 'payment': return <PaymentForm {...props} />
      case 'receipt': return <ReceiptForm {...props} />
      case 'contra': return <ContraForm {...props} />
      default: return null
    }
  })()

  return (
    <ReportShell title={`${label} Vouchers`} loading={loading}
      subtitle="Record transactions the Tally way — every voucher posts balanced double entries and feeds GST, outstanding and the statements."
      exportBar={canWrite && newType && !showForm ? <span className="flex gap-2">{type === 'purchase' && <button onClick={() => setShowImport('bills')} className={btnGhost}>⬆ Import bills from Zoho</button>}{type === 'payment' && <button onClick={() => setShowImport('expenses')} className={btnGhost}>⬆ Import expenses from Zoho</button>}<button onClick={() => setParams({ new: '1' })} className={btnPrimary}>+ New {label} <span className="opacity-60 text-xs ml-1">{VOUCHER_TYPES[type].fkey}</span></button></span> : null}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm flex-wrap">
          {NEW_VOUCHER_TYPES.map(t => <button key={t} onClick={() => navigate(`/finance/vouchers/${t}`)} className={`px-3 py-1.5 font-medium ${t === type ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{VOUCHER_TYPES[t].label}</button>)}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className={`${inputCls} w-48`} />
      </>}>
      {!canWrite && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">You have view-only access to Finance — vouchers can be opened but not created or edited.</div>}
      {form}
      {showImport === 'bills' && <BillsImport onClose={() => { setShowImport(''); invalidateFinanceCache(); reload() }} />}
      {showImport === 'expenses' && <ExpensesImport onClose={() => { setShowImport(''); invalidateFinanceCache(); reload() }} />}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
            <th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Voucher #</th><th className="text-left px-4 py-3">Particulars</th>
            <th className="text-left px-4 py-3">Narration</th><th className="text-right px-4 py-3">Amount</th>{type === 'purchase' && <th className="text-left px-4 py-3">Payment</th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map(e => (
              <tr key={e.key} onClick={() => open(e)} className="cursor-pointer hover:bg-blue-50/40">
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{e.date}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{e.number}{e.cancelled && <span className="ml-1"><Badge color="bg-red-100 text-red-700">Cancelled</Badge></span>}{e.legacy && <span className="ml-1"><Badge>older module</Badge></span>}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{e.partyName || '—'}</td>
                <td className="px-4 py-2.5 text-slate-500 truncate max-w-xs">{e.narration}</td>
                <td className={`px-4 py-2.5 text-right font-medium ${e.cancelled ? 'line-through text-slate-300' : ''}`}>{fmtAmt(e.amount)}</td>
                {type === 'purchase' && <td className="px-4 py-2.5">{e.cancelled || e.mirror ? <span className="text-slate-300">—</span> : <PayStatus st={payStatus(openBills || new Map(), e.lineKey, e.amount)} today={today} />}</td>}
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={5}><Empty>No {label.toLowerCase()} vouchers for {company} yet.{canWrite && newType ? ' Click “New” to record one.' : ''}</Empty></td></tr>}
          </tbody>
        </table>
      </div>
      {modal}
    </ReportShell>
  )
}
