// Invoice a sales order — all of it, or part of it. Choose the quantity to bill on each line (or an agreed percentage of the
// order: "30% advance", "70% on completion"); what is not billed stays open on the order for the next invoice.
import React, { useMemo, useState } from 'react'
import { remainingQty, qtysForPercent, qtysForBalance, invoiceFromOrder, orderProgress } from '../utils/salesOrders.js'
import { fmtAmt, todayStr, r2 } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls } from './FinanceUI.jsx'

const TERMS = { 'Due on Receipt': 0, 'Net 15': 15, 'Net 30': 30, 'Net 45': 45, 'Net 60': 60 }
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

export default function ConvertOrderModal({ order, sellerStateCode, onClose, onConfirm }) {
  const [qtys, setQtys] = useState(() => qtysForBalance(order).map(String))
  const [date, setDate] = useState(todayStr())
  const [terms, setTerms] = useState(order.terms || 'Due on Receipt')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const prog = orderProgress(order)
  const nums = qtys.map(q => Number(q) || 0)
  const calc = useMemo(() => invoiceFromOrder(order, nums, { sellerStateCode }), [order, qtys, sellerStateCode]) // eslint-disable-line react-hooks/exhaustive-deps
  const over = (order.items || []).findIndex((it, i) => nums[i] > remainingQty(it) + 0.00005)
  const anything = nums.some(q => q > 0)
  const setAll = (arr) => setQtys(arr.map(q => String(Math.round(q * 10000) / 10000)))
  const dueDate = addDays(date, TERMS[terms] ?? 0)

  const go = async () => {
    setErr('')
    if (!anything) return setErr('Enter a quantity to invoice on at least one line.')
    if (over >= 0) return setErr(`Line ${over + 1}: more than what is left to invoice.`)
    setBusy(true)
    try { await onConfirm({ qtys: nums, date, dueDate, terms, note: note.trim() }) } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`${cardCls} w-full max-w-5xl p-5 space-y-3 max-h-[94vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h3 className="text-lg font-bold text-slate-800">Invoice sales order {order.invoiceNumber}</h3>
            <p className="text-xs text-slate-400">{order.billToName}{order.poNumber ? ` · PO ${order.poNumber}` : ''} · ordered {fmtAmt(prog.valueOrdered)} before tax, invoiced so far {fmtAmt(prog.valueInvoiced)}. Bill all of it or only part — the rest stays open for the next invoice.</p></div>
          {!busy && <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>}
        </div>
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}

        <div className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-slate-500">Quick fill:</span>
          <button className={btnGhost} onClick={() => setAll(qtysForBalance(order))}>Whole balance</button>
          {[30, 50, 70].map(p => <button key={p} className={btnGhost} onClick={() => setAll(qtysForPercent(order, p))}>{p}% of the order</button>)}
          <label className="flex items-center gap-1 text-slate-500 ml-2">other % <input type="number" min="0" max="100" className="w-16 px-2 py-1 border border-slate-300 rounded text-sm" onChange={e => e.target.value && setAll(qtysForPercent(order, Number(e.target.value)))} /></label>
          <button className="text-xs text-slate-500 hover:underline ml-auto" onClick={() => setQtys((order.items || []).map(() => '0'))}>Clear</button>
        </div>

        <div className="overflow-auto rounded-lg border border-slate-200 max-h-[40vh]">
          <table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0"><tr><th className="text-left px-3 py-2">Item</th><th className="text-right px-2">Rate</th><th className="text-right px-2">Ordered</th><th className="text-right px-2">Invoiced</th><th className="text-right px-2">Left</th><th className="text-right px-2 w-32">Invoice now</th><th className="text-right px-3">Taxable</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{(order.items || []).map((it, i) => {
              const left = remainingQty(it), bad = nums[i] > left + 0.00005
              return (
                <tr key={i} className={left <= 0.00005 ? 'opacity-50' : ''}>
                  <td className="px-3 py-1.5 max-w-sm"><div className="truncate" title={it.description}>{it.description}</div>{it.hsnCode && <div className="text-xs text-slate-400">HSN/SAC {it.hsnCode} · GST {it.gstRate || 0}%</div>}</td>
                  <td className="text-right px-2">{fmtAmt(it.rate)}</td><td className="text-right px-2">{it.qty} {it.unit}</td><td className="text-right px-2 text-slate-500">{it.invoicedQty || 0}</td><td className="text-right px-2 font-medium">{left}</td>
                  <td className="px-2"><input type="number" step="any" min="0" disabled={left <= 0.00005} value={qtys[i]} onChange={e => setQtys(q => q.map((v, n) => n === i ? e.target.value : v))} className={`w-full px-2 py-1 border rounded text-right text-sm ${bad ? 'border-red-400 bg-red-50' : 'border-slate-300'}`} /></td>
                  <td className="text-right px-3">{fmtAmt(r2(nums[i] * (Number(it.rate) || 0)))}</td>
                </tr>)
            })}</tbody></table>
        </div>

        <div className="grid md:grid-cols-4 gap-3 items-end">
          <label className="text-xs text-slate-500">Invoice date<input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" /></label>
          <label className="text-xs text-slate-500">Payment terms<select value={terms} onChange={e => setTerms(e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm">{Object.keys(TERMS).map(t => <option key={t}>{t}</option>)}</select></label>
          <div className="text-xs text-slate-500">Due date<div className="mt-1 px-3 py-2 bg-slate-100 rounded-lg text-sm text-slate-700">{dueDate}</div></div>
          <label className="text-xs text-slate-500 md:col-span-1">Agreement / milestone (optional)<input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. 30% advance against ABG" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" /></label>
        </div>

        <div className="flex justify-between items-center border-t border-slate-100 pt-3">
          <div className="text-sm text-slate-600">{anything ? <>Taxable <b>{fmtAmt(calc.subTotal)}</b>{calc.gstLines.map(g => <span key={g.label}> · {g.label} <b>{fmtAmt(g.amount)}</b></span>)} · <span className="text-base font-bold text-slate-800">Invoice total ₹{fmtAmt(calc.total)}</span></> : 'Nothing selected yet.'}</div>
          <div className="flex gap-2"><button className={btnPrimary} disabled={busy || !anything} onClick={go}>{busy ? 'Creating…' : 'Create invoice'}</button><button className={btnGhost} disabled={busy} onClick={onClose}>Cancel</button></div>
        </div>
      </div>
    </div>
  )
}
