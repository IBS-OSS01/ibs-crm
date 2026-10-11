// Inventory reports — the "in and out ledger": Stock Summary, Item Stock Ledger,
// Movement Analysis, Godown-wise stock, Reorder status, Pending Purchase Orders.
import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { poProgress } from '../utils/purchaseOrders.js'
import { fmtAmt, todayStr, fyRange, currentFY, r2, num } from '../utils/financeConstants.js'
import { downloadXlsx, printReport } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, DateRange, ExportBar, Empty, Badge, cardCls, inputCls, thCls, btnPrimary } from '../components/FinanceUI.jsx'

const TABS = [['summary', 'Stock Summary'], ['ledger', 'Item Ledger (In / Out)'], ['movement', 'Movement Analysis'], ['godown', 'Godown-wise'], ['reorder', 'Reorder Status'], ['orders', 'Pending Purchase Orders']]
const Th = ({ children, right }) => <th className={`${thCls} ${right ? 'text-right' : 'text-left'}`}>{children}</th>
const Td = ({ children, right, mono, cls = '' }) => <td className={`px-3 py-2 ${right ? 'text-right' : ''} ${mono ? 'font-mono text-xs' : ''} ${cls}`}>{children}</td>
const Q = ({ v }) => <>{v ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }) : <span className="text-slate-300">—</span>}</>
const A = ({ v }) => <>{v ? fmtAmt(v) : <span className="text-slate-300">—</span>}</>

const KIND_LABEL = {
  opening: 'Opening stock', purchase: 'Purchase', purchase_return: 'Purchase return', sale: 'Sale', sales_return: 'Sales return', receipt: 'Goods received',
  adjustment_in: 'Adjustment (+)', adjustment_out: 'Adjustment (−)', adjustment_set: 'Physical count', consumption: 'Consumed', transfer: 'Transfer', mfg_consume: 'Used in manufacturing', mfg_produce: 'Manufactured',
}

export default function StockReports() {
  const { tab = 'summary' } = useParams()
  const navigate = useNavigate()
  const { raw, stock, allLines, loading } = useFinanceData(['stockLevels'])
  const [company, setCompany] = useState('UIPL')
  const [asOf, setAsOf] = useState(todayStr())
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const [itemId, setItemId] = useState('')
  const [wh, setWh] = useState('')
  const [q, setQ] = useState('')
  const [hideZero, setHideZero] = useState(true)

  const items = (raw?.stockItems || []).filter(i => !i.isService)
  const warehouses = raw?.warehouses || []
  const itemById = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])
  const whName = (id) => warehouses.find(w => w.id === id)?.name || id || 'Default'
  const nameOf = (i) => i?.name || i?.itemName || '(deleted item)'

  const mv = useMemo(() => stock.movements.filter(m => m.company === company), [stock, company])

  // balance of every item at a date
  const balances = useMemo(() => {
    const last = {}, whq = {}
    mv.forEach(m => { if (m.date > asOf) return; last[m.itemId] = m; whq[`${m.itemId}|${m.warehouseId}`] = m.whBalQty })
    return { last, whq }
  }, [mv, asOf])

  const summaryRows = useMemo(() => items.map(it => {
    const l = balances.last[it.id]
    const qty = wh ? (balances.whq[`${it.id}|${wh}`] || 0) : (l?.balQty || 0)
    const rate = l?.balRate || num(it.purchaseRate)
    const value = wh ? r2(qty * rate) : (l?.balValue || 0)
    const snap = (raw?.stockLevels || []).filter(s => s.sku === it.sku && (!wh || s.locationId === wh)).reduce((s, x) => s + num(x.qty), 0)
    return { it, qty, rate, value, snap, hasMoves: !!l }
  }).filter(r => (!hideZero || r.qty !== 0) && (!q || `${nameOf(r.it)} ${r.it.sku}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => nameOf(a.it).localeCompare(nameOf(b.it))), [items, balances, wh, hideZero, q, raw])
  const totalValue = r2(summaryRows.reduce((s, r) => s + r.value, 0))
  const bookValue = useMemo(() => r2(allLines.filter(l => l.accountCode === '1400' && l.company === company && (l.date || '') <= asOf).reduce((s, l) => s + l.debit - l.credit, 0)), [allLines, company, asOf])

  // item ledger
  const ledger = useMemo(() => {
    if (!itemId) return null
    const rows = mv.filter(m => m.itemId === itemId && (!wh || m.warehouseId === wh))
    const before = rows.filter(m => m.date < period.from)
    const opening = before.length ? { qty: wh ? before[before.length - 1].whBalQty : before[before.length - 1].balQty, value: wh ? null : before[before.length - 1].balValue } : { qty: 0, value: 0 }
    const inPeriod = rows.filter(m => m.date >= period.from && m.date <= period.to)
    return { opening, rows: inPeriod, inQty: r2(inPeriod.reduce((s, m) => s + m.inQty, 0)), outQty: r2(inPeriod.reduce((s, m) => s + m.outQty, 0)), inVal: r2(inPeriod.reduce((s, m) => s + m.inValue, 0)), outVal: r2(inPeriod.reduce((s, m) => s + m.outValue, 0)) }
  }, [mv, itemId, wh, period])

  // movement analysis (company level, transfers excluded)
  const movement = useMemo(() => {
    const m = {}
    mv.filter(x => !x.transfer).forEach(x => {
      if (x.date > period.to) return
      const r = (m[x.itemId] = m[x.itemId] || { itemId: x.itemId, openQty: 0, openVal: 0, inQty: 0, inVal: 0, outQty: 0, outVal: 0, closeQty: 0, closeVal: 0 })
      if (x.date < period.from) { r.openQty = x.balQty; r.openVal = x.balValue }
      else { r.inQty += x.inQty; r.inVal += x.inValue; r.outQty += x.outQty; r.outVal += x.outValue }
      r.closeQty = x.balQty; r.closeVal = x.balValue
    })
    return Object.values(m).filter(r => r.openQty || r.inQty || r.outQty || r.closeQty).sort((a, b) => nameOf(itemById[a.itemId]).localeCompare(nameOf(itemById[b.itemId])))
  }, [mv, period, itemById]) // eslint-disable-line react-hooks/exhaustive-deps

  const godownRows = useMemo(() => items.map(it => ({ it, perWh: Object.fromEntries(warehouses.map(w => [w.id, balances.whq[`${it.id}|${w.id}`] || 0])), other: Object.entries(balances.whq).filter(([k, v]) => k.startsWith(it.id + '|') && !warehouses.some(w => k === `${it.id}|${w.id}`)).reduce((s, [, v]) => s + v, 0) }))
    .filter(r => Object.values(r.perWh).some(v => v) || r.other).filter(r => !q || `${nameOf(r.it)} ${r.it.sku}`.toLowerCase().includes(q.toLowerCase())), [items, warehouses, balances, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const reorder = useMemo(() => items.map(it => ({ it, qty: balances.last[it.id]?.balQty || 0, min: num(it.minStock) })).filter(r => r.min > 0 && r.qty <= r.min).sort((a, b) => (a.qty - a.min) - (b.qty - b.min)), [items, balances])

  const orders = useMemo(() => (raw?.vouchers || []).filter(v => v.voucherType === 'purchase_order' && v.status !== 'cancelled' && v.company === company)
    .map(po => ({ po, ...poProgress(po, raw.vouchers) })).sort((a, b) => b.po.date.localeCompare(a.po.date)), [raw, company])

  const label = TABS.find(t => t[0] === tab)?.[1] || ''
  const stockNote = items.length === 0
  const noMoves = stock.movements.length === 0

  const sheets = () => {
    if (tab === 'summary') return [['SKU', 'Item', 'Unit', 'Quantity', 'Rate', 'Value'], ...summaryRows.map(r => [r.it.sku || '', nameOf(r.it), r.it.unit || '', r.qty, r.rate, r.value])]
    if (tab === 'ledger' && ledger) return [['Date', 'Particulars', 'Voucher', 'Godown', 'In qty', 'In value', 'Out qty', 'Out value', 'Balance qty', 'Balance value'], ['', 'Opening', '', '', '', '', '', '', ledger.opening.qty, ledger.opening.value ?? ''], ...ledger.rows.map(m => [m.date, KIND_LABEL[m.kind] || m.kind, m.voucherNo, whName(m.warehouseId), m.inQty, m.inValue, m.outQty, m.outValue, wh ? m.whBalQty : m.balQty, m.balValue])]
    if (tab === 'movement') return [['SKU', 'Item', 'Opening qty', 'Opening value', 'Inward qty', 'Inward value', 'Outward qty', 'Outward value', 'Closing qty', 'Closing value'], ...movement.map(r => [itemById[r.itemId]?.sku || '', nameOf(itemById[r.itemId]), r.openQty, r.openVal, r.inQty, r.inVal, r.outQty, r.outVal, r.closeQty, r.closeVal])]
    if (tab === 'godown') return [['SKU', 'Item', ...warehouses.map(w => w.name || w.id), 'Other'], ...godownRows.map(r => [r.it.sku || '', nameOf(r.it), ...warehouses.map(w => r.perWh[w.id]), r.other])]
    if (tab === 'reorder') return [['SKU', 'Item', 'On hand', 'Minimum', 'Short by'], ...reorder.map(r => [r.it.sku || '', nameOf(r.it), r.qty, r.min, r.min - r.qty])]
    return [['PO', 'Date', 'Vendor', 'Item', 'Ordered', 'Billed', 'Pending', 'Status'], ...orders.flatMap(o => o.lines.map(l => [o.po.voucherNumber, o.po.date, o.po.partyName, l.item.description, l.ordered, l.billed, l.pending, o.status]))]
  }

  return (
    <ReportShell title={label} loading={loading} subtitle="Inventory in and out, valued at weighted-average or FIFO cost (set per item)."
      exportBar={<ExportBar onXlsx={() => downloadXlsx(`${label} ${company}`, [{ name: label.slice(0, 30), rows: sheets() }])} onPrint={() => printReport({ title: label, subtitle: `${company} · ${tab === 'ledger' || tab === 'movement' ? `${period.from} to ${period.to}` : `as of ${asOf}`}`, rows: sheets() })} />}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm flex-wrap">
          {TABS.map(([k, l]) => <button key={k} onClick={() => navigate(`/finance/stock/${k}`)} className={`px-3 py-1.5 font-medium ${k === tab ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        {(tab === 'ledger' || tab === 'movement') ? <DateRange from={period.from} to={period.to} onChange={setPeriod} /> :
          tab !== 'orders' && <label className="text-sm text-slate-500 flex items-center gap-2">As of <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={inputCls} /></label>}
        {(tab === 'summary' || tab === 'ledger') && warehouses.length > 0 && <select value={wh} onChange={e => setWh(e.target.value)} className={inputCls}><option value="">All godowns</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}</select>}
        {tab === 'ledger' && <select value={itemId} onChange={e => setItemId(e.target.value)} className={`${inputCls} w-64`}><option value="">— choose item —</option>{items.map(i => <option key={i.id} value={i.id}>{i.sku ? `${i.sku} · ` : ''}{nameOf(i)}</option>)}</select>}
        {(tab === 'summary' || tab === 'godown') && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item / SKU…" className={`${inputCls} w-48`} />}
        {tab === 'summary' && <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} />Hide zero stock</label>}
      </>}>
      {(stockNote || (noMoves && tab !== 'orders')) && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">
          {stockNote ? 'No stock items found. Add items under Services → Items Catalog or Finance → Stock Items.' : 'No stock movements yet. Enter opening stock on Finance → Stock Items, then use Stock Items on Purchase / Sales lines (pick the item, not free text) so movements are tracked.'}
        </div>
      )}

      {tab === 'summary' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Stock value (ledger)</p><p className="text-xl font-bold">₹{fmtAmt(totalValue)}</p></div>
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Stock in Hand (books, a/c 1400)</p><p className="text-xl font-bold">₹{fmtAmt(bookValue)}</p></div>
            <div className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">Items with stock</p><p className="text-xl font-bold">{summaryRows.filter(r => r.qty > 0).length}</p></div>
          </div>
          {!wh && Math.abs(bookValue - r2(items.reduce((s, it) => s + (balances.last[it.id]?.balValue || 0), 0))) > 1 && <p className="text-xs text-amber-600">Ledger value and books differ — a Journal Entry may have been posted directly to Stock in Hand (1400).</p>}
          <div className={`${cardCls} overflow-x-auto`}><table className="w-full text-sm"><thead className="bg-slate-50/80"><tr><Th>SKU</Th><Th>Item</Th><Th>Unit</Th><Th right>Quantity</Th><Th right>Rate</Th><Th right>Value</Th><Th right>Services Stock Levels</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {summaryRows.map(r => (
                <tr key={r.it.id} className={r.qty < 0 ? 'bg-red-50/50' : ''}>
                  <Td mono>{r.it.sku}</Td><Td cls="font-medium text-slate-800">{nameOf(r.it)}{r.qty < 0 && <span className="ml-2"><Badge color="bg-red-100 text-red-700">negative</Badge></span>}</Td><Td>{r.it.unit}</Td>
                  <Td right><Q v={r.qty} /></Td><Td right><A v={r.rate} /></Td><Td right>{fmtAmt(r.value)}</Td>
                  <Td right cls={r.snap && Math.abs(r.snap - r.qty) > 0.001 ? 'text-amber-600' : 'text-slate-400'}>{r.snap || '—'}</Td>
                </tr>
              ))}
              {summaryRows.length === 0 && <tr><td colSpan={7}><Empty>Nothing to show.</Empty></td></tr>}
            </tbody>
            {summaryRows.length > 0 && <tfoot><tr className="bg-slate-50 font-bold"><Td>Total</Td><Td /><Td /><Td /><Td /><Td right>{fmtAmt(totalValue)}</Td><Td /></tr></tfoot>}
          </table></div>
          <p className="text-xs text-slate-400">"Services Stock Levels" is the stocktake figure uploaded in the Services module (shown for comparison; amber = differs from the ledger). The ledger figure is built from opening stock + purchases/sales/adjustments, so the two agree only if both are kept up to date.</p>
        </>
      )}

      {tab === 'ledger' && (!ledger ? <Empty>Choose an item to see its stock ledger.</Empty> : (
        <div className={`${cardCls} overflow-x-auto`}><table className="w-full text-sm">
          <thead className="bg-slate-50/80"><tr><Th>Date</Th><Th>Particulars</Th><Th>Voucher</Th><Th>Godown</Th><Th right>In qty</Th><Th right>In value</Th><Th right>Out qty</Th><Th right>Out value</Th><Th right>Balance qty</Th><Th right>Balance value</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50/60 font-medium"><Td>{period.from}</Td><Td>Opening balance</Td><Td /><Td /><Td /><Td /><Td /><Td /><Td right><Q v={ledger.opening.qty} /></Td><Td right>{ledger.opening.value === null ? '' : fmtAmt(ledger.opening.value)}</Td></tr>
            {ledger.rows.map((m, i) => (
              <tr key={i} className={m.transfer ? 'text-slate-400' : ''}>
                <Td>{m.date}</Td>
                <Td>{KIND_LABEL[m.kind] || m.kind}{m.party ? <span className="text-slate-400"> · {m.party}</span> : null}{m.counterWarehouseId ? <span className="text-slate-400"> ({m.outQty ? '→' : '←'} {whName(m.counterWarehouseId)})</span> : null}</Td>
                <Td mono>{m.voucherNo}</Td><Td>{whName(m.warehouseId)}</Td>
                <Td right><Q v={m.inQty} /></Td><Td right><A v={m.inValue} /></Td><Td right><Q v={m.outQty} /></Td><Td right><A v={m.outValue} /></Td>
                <Td right cls={(wh ? m.whBalQty : m.balQty) < 0 ? 'text-red-600' : ''}><Q v={wh ? m.whBalQty : m.balQty} /></Td><Td right>{m.transfer ? '' : fmtAmt(m.balValue)}</Td>
              </tr>
            ))}
            {ledger.rows.length === 0 && <tr><td colSpan={10}><Empty>No movements in this period.</Empty></td></tr>}
          </tbody>
          <tfoot><tr className="bg-slate-50 font-bold"><Td>Total</Td><Td /><Td /><Td /><Td right><Q v={ledger.inQty} /></Td><Td right>{fmtAmt(ledger.inVal)}</Td><Td right><Q v={ledger.outQty} /></Td><Td right>{fmtAmt(ledger.outVal)}</Td><Td /><Td /></tr></tfoot>
        </table></div>
      ))}

      {tab === 'movement' && (
        <div className={`${cardCls} overflow-x-auto`}><table className="w-full text-sm">
          <thead className="bg-slate-50/80"><tr><Th>Item</Th><Th right>Opening qty</Th><Th right>Opening value</Th><Th right>Inward qty</Th><Th right>Inward value</Th><Th right>Outward qty</Th><Th right>Outward value</Th><Th right>Closing qty</Th><Th right>Closing value</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {movement.map(r => <tr key={r.itemId}><Td cls="font-medium text-slate-800">{nameOf(itemById[r.itemId])}</Td><Td right><Q v={r.openQty} /></Td><Td right><A v={r.openVal} /></Td><Td right><Q v={r.inQty} /></Td><Td right><A v={r.inVal} /></Td><Td right><Q v={r.outQty} /></Td><Td right><A v={r.outVal} /></Td><Td right><Q v={r.closeQty} /></Td><Td right><A v={r.closeVal} /></Td></tr>)}
            {movement.length === 0 && <tr><td colSpan={9}><Empty>No movements.</Empty></td></tr>}
          </tbody>
          {movement.length > 0 && <tfoot><tr className="bg-slate-50 font-bold"><Td>Total</Td><Td /><Td right>{fmtAmt(movement.reduce((s, r) => s + r.openVal, 0))}</Td><Td /><Td right>{fmtAmt(movement.reduce((s, r) => s + r.inVal, 0))}</Td><Td /><Td right>{fmtAmt(movement.reduce((s, r) => s + r.outVal, 0))}</Td><Td /><Td right>{fmtAmt(movement.reduce((s, r) => s + r.closeVal, 0))}</Td></tr></tfoot>}
        </table></div>
      )}

      {tab === 'godown' && (
        <div className={`${cardCls} overflow-x-auto`}><table className="w-full text-sm">
          <thead className="bg-slate-50/80"><tr><Th>Item</Th>{warehouses.map(w => <Th key={w.id} right>{w.name || w.id}</Th>)}<Th right>Other / default</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {godownRows.map(r => <tr key={r.it.id}><Td cls="font-medium text-slate-800">{nameOf(r.it)} <span className="text-slate-400 text-xs">{r.it.sku}</span></Td>{warehouses.map(w => <Td key={w.id} right><Q v={r.perWh[w.id]} /></Td>)}<Td right><Q v={r.other} /></Td></tr>)}
            {godownRows.length === 0 && <tr><td colSpan={warehouses.length + 2}><Empty>No stock recorded against any godown.</Empty></td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'reorder' && (
        <div className={`${cardCls} overflow-x-auto`}><table className="w-full text-sm">
          <thead className="bg-slate-50/80"><tr><Th>SKU</Th><Th>Item</Th><Th right>On hand</Th><Th right>Minimum</Th><Th right>Short by</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {reorder.map(r => <tr key={r.it.id}><Td mono>{r.it.sku}</Td><Td cls="font-medium">{nameOf(r.it)}</Td><Td right cls={r.qty <= 0 ? 'text-red-600' : ''}><Q v={r.qty} /></Td><Td right><Q v={r.min} /></Td><Td right cls="font-semibold">{Math.max(0, r.min - r.qty)}</Td></tr>)}
            {reorder.length === 0 && <tr><td colSpan={5}><Empty>Nothing is at or below its minimum stock.</Empty></td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
          {orders.length === 0 && <Empty>No purchase orders for {company}. Create one from Vouchers → Purchase Order.</Empty>}
          {orders.map(o => (
            <div key={o.po.id} className={`${cardCls} p-4 space-y-2`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div><span className="font-mono text-sm font-semibold">{o.po.voucherNumber}</span><span className="text-slate-400 text-sm"> · {o.po.date} · {o.po.partyName}{o.po.expectedDate ? ` · due ${o.po.expectedDate}` : ''}</span></div>
                <div className="flex items-center gap-2">
                  <Badge color={o.status === 'closed' ? 'bg-green-100 text-green-700' : o.status === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}>{o.status === 'partial' ? 'Partly billed' : o.status}</Badge>
                  {o.status !== 'closed' && <button className={btnPrimary} onClick={() => navigate(`/finance/vouchers/purchase?new=1&po=${o.po.id}`)}>Create bill</button>}
                  <button className="text-xs text-blue-600 hover:underline" onClick={() => navigate(`/finance/vouchers/purchase_order?edit=${o.po.id}`)}>Edit</button>
                </div>
              </div>
              <table className="w-full text-sm"><thead className="text-xs text-slate-400 uppercase"><tr><th className="text-left py-1">Item</th><th className="text-right">Ordered</th><th className="text-right">Billed</th><th className="text-right">Pending</th></tr></thead>
                <tbody>{o.lines.map(l => <tr key={l.index} className="border-t border-slate-100"><td className="py-1">{l.item.description}</td><td className="text-right">{l.ordered}</td><td className="text-right">{l.billed}</td><td className={`text-right font-medium ${l.pending > 0 ? 'text-amber-600' : 'text-green-600'}`}>{l.pending}</td></tr>)}</tbody></table>
              {o.status !== 'closed' && <p className="text-xs text-slate-400">Pending value ≈ ₹{fmtAmt(o.pendingValue)} before GST</p>}
            </div>
          ))}
        </div>
      )}
    </ReportShell>
  )
}

