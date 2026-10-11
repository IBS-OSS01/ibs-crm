// One-liner for any report: `const { open, openKey, modal } = useVoucherModal({ raw, allLines, reload })`,
// call open(entry) — or openKey('invoice:<id>' / 'purchase:<id>' / 'receipt:<id>' …) — from a row click and render {modal}.
// extraActions(entry) → [{ label, onClick, primary }] adds page-specific buttons (e.g. "Edit invoice") to the detail window.
import React, { useMemo, useState } from 'react'
import VoucherDetail from './VoucherDetail.jsx'
import { groupBySource } from '../utils/statements.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { r2, num } from '../utils/financeConstants.js'

// a sales invoice shown like a voucher: items with their taxable value, tax lines, creator
const invoiceView = (inv) => inv && ({
  ...inv, voucherType: 'invoice',
  items: (inv.items || []).map(i => ({ ...i, taxable: r2(num(i.qty) * num(i.rate)) })),
  createdByName: inv.createdByName || '', revision: 1,
})

export function useVoucherModal({ raw, allLines, reload, extraActions }) {
  const [entry, setEntry] = useState(null)
  const grouped = useMemo(() => groupBySource(allLines || []), [allLines])
  const index = useMemo(() => (raw ? buildVoucherIndex(raw) : []), [raw])
  const openKey = (k) => { const e = index.find(x => x.lineKey === k || x.key === k); if (e) setEntry(e) }
  let modal = null
  if (entry && raw) {
    let lines = grouped.get(entry.lineKey) || []
    // A legacy payable produces two events (bill, then payment) under one source id — show only the one that was clicked.
    if (entry.collection === 'finance_payables') lines = lines.filter(l => l.date === entry.date)
    const voucher = entry.collection === 'finance_vouchers' ? raw.vouchers.find(v => v.id === entry.id)
      : entry.collection === 'finance_invoices' ? invoiceView((raw.invoices || []).find(v => v.id === entry.id)) : null
    modal = (
      <VoucherDetail entry={entry} voucher={voucher} lines={lines} seller={raw.companySettings?.[entry.company]} stockItems={raw.stockItems}
        extraActions={extraActions ? extraActions(entry) : []} onClose={() => setEntry(null)} onChanged={reload} />
    )
  }
  return { open: setEntry, openKey, modal }
}
