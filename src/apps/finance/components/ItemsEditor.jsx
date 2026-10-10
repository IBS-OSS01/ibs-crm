// Line-items grid used by Purchase vouchers, Credit Notes and Debit Notes.
// Each row can be linked to an inventory item (so the stock ledger can pick it up)
// or typed free-form; HSN codes auto-fill the GST rate from the HSN master.
import React from 'react'
import { gstRatesFor, num, fmtAmt } from '../utils/financeConstants.js'
import { formInputCls } from './FinanceUI.jsx'

export const UNITS = ['pcs', 'nos', 'set', 'kg', 'ltr', 'mtr', 'sqft', 'box', 'hours', 'days', 'lot']
export const newLine = () => ({ description: '', hsnCode: '', qty: 1, unit: 'pcs', rate: '', discountPct: 0, gstRate: 18, stockItemId: '', sku: '', accountCode: '' })

const cell = 'px-1.5 py-1.5'
const mini = 'w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

export default function ItemsEditor({ items, onChange, computed = [], date, stockItems = [], hsnCodes = [], accounts = [], accountLabel = 'Ledger', defaultAccountCode = '', applyGst = true, readOnly = false }) {
  const rates = gstRatesFor(date)
  const update = (i, patch) => onChange(items.map((it, idx) => idx === i ? { ...it, ...patch } : it))
  const pickStock = (i, id) => {
    const s = stockItems.find(x => x.id === id)
    if (!s) return update(i, { stockItemId: '', sku: '' })
    update(i, {
      stockItemId: s.id, sku: s.sku || '', description: s.name || s.itemName || '', unit: s.unit || items[i].unit,
      hsnCode: s.hsnCode || items[i].hsnCode, gstRate: s.gstRate !== undefined && s.gstRate !== '' ? Number(s.gstRate) : items[i].gstRate,
      rate: items[i].rate || s.purchaseRate || '',
    })
  }
  const onHsn = (i, code) => {
    const h = hsnCodes.find(x => x.code === code)
    update(i, { hsnCode: code, ...(h && h.gstRate !== undefined ? { gstRate: Number(h.gstRate) } : {}) })
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[860px]">
        <thead className="text-xs text-slate-500 uppercase tracking-wide">
          <tr>
            <th className={`${cell} text-left w-44`}>Stock item</th><th className={`${cell} text-left`}>Description</th><th className={`${cell} text-left w-24`}>HSN/SAC</th>
            <th className={`${cell} text-right w-20`}>Qty</th><th className={`${cell} text-left w-20`}>Unit</th><th className={`${cell} text-right w-28`}>Rate</th>
            <th className={`${cell} text-right w-16`}>Disc %</th><th className={`${cell} text-right w-20`}>GST %</th>
            {accounts.length > 0 && <th className={`${cell} text-left w-40`}>{accountLabel}</th>}
            <th className={`${cell} text-right w-28`}>Amount</th><th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className={cell}>
                <select disabled={readOnly} value={it.stockItemId || ''} onChange={e => pickStock(i, e.target.value)} className={mini}>
                  <option value="">— free text —</option>
                  {stockItems.map(s => <option key={s.id} value={s.id}>{s.sku ? `${s.sku} · ` : ''}{s.name || s.itemName}</option>)}
                </select>
              </td>
              <td className={cell}><input disabled={readOnly} value={it.description} onChange={e => update(i, { description: e.target.value })} className={mini} placeholder="Description" /></td>
              <td className={cell}><input disabled={readOnly} value={it.hsnCode} onChange={e => onHsn(i, e.target.value)} list="hsn-list" className={mini} /></td>
              <td className={cell}><input disabled={readOnly} type="number" min="0" step="any" value={it.qty} onChange={e => update(i, { qty: e.target.value })} className={`${mini} text-right`} /></td>
              <td className={cell}><select disabled={readOnly} value={it.unit} onChange={e => update(i, { unit: e.target.value })} className={mini}>{[...new Set([...UNITS, it.unit].filter(Boolean))].map(u => <option key={u}>{u}</option>)}</select></td>
              <td className={cell}><input disabled={readOnly} type="number" min="0" step="any" value={it.rate} onChange={e => update(i, { rate: e.target.value })} className={`${mini} text-right`} /></td>
              <td className={cell}><input disabled={readOnly} type="number" min="0" max="100" step="any" value={it.discountPct} onChange={e => update(i, { discountPct: e.target.value })} className={`${mini} text-right`} /></td>
              <td className={cell}>
                <select disabled={readOnly || !applyGst} value={applyGst ? it.gstRate : 0} onChange={e => update(i, { gstRate: Number(e.target.value) })} className={`${mini} text-right`}>
                  {[...new Set([...rates, Number(it.gstRate)])].filter(r => !Number.isNaN(r)).sort((a, b) => a - b).map(r => <option key={r} value={r}>{r}%{!rates.includes(r) ? ' (old)' : ''}</option>)}
                </select>
              </td>
              {accounts.length > 0 && (
                <td className={cell}>
                  <select disabled={readOnly} value={it.accountCode || defaultAccountCode} onChange={e => update(i, { accountCode: e.target.value })} className={mini}>
                    {accounts.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                  </select>
                </td>
              )}
              <td className={`${cell} text-right pt-2.5 font-medium text-slate-700`}>{fmtAmt(computed[i]?.taxable ?? num(it.qty) * num(it.rate))}</td>
              <td className="pt-2">{!readOnly && items.length > 1 && <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500">✕</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="hsn-list">{hsnCodes.map(h => <option key={h.id || h.code} value={h.code}>{h.description}</option>)}</datalist>
      {!readOnly && <button type="button" onClick={() => onChange([...items, newLine()])} className="mt-2 text-sm text-blue-600 hover:underline">+ Add line</button>}
    </div>
  )
}

export function TotalsBox({ totals, rcm, tds, extra }) {
  return (
    <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
      <div className="flex justify-between text-slate-600"><span>Taxable value</span><span>{fmtAmt(totals.subTotal)}</span></div>
      {totals.gstLines.map(g => <div key={g.label} className="flex justify-between text-slate-500"><span>{g.label}{rcm ? ' (RCM — payable by you)' : ''}</span><span>{fmtAmt(g.amount)}</span></div>)}
      {totals.roundOff !== 0 && <div className="flex justify-between text-slate-400"><span>Round off</span><span>{fmtAmt(totals.roundOff)}</span></div>}
      <div className="flex justify-between font-bold text-slate-800 border-t border-slate-200 pt-1.5"><span>Invoice total</span><span>₹{fmtAmt(totals.total)}</span></div>
      {tds?.applicable && tds.amount > 0 && <div className="flex justify-between text-red-600"><span>Less: TDS {tds.section} @ {tds.rate}%</span><span>− {fmtAmt(tds.amount)}</span></div>}
      {tds?.applicable && tds.amount > 0 && <div className="flex justify-between font-bold text-blue-700"><span>Net payable to vendor</span><span>₹{fmtAmt(totals.total - tds.amount)}</span></div>}
      {extra}
    </div>
  )
}

export { formInputCls }
