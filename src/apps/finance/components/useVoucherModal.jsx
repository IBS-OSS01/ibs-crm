// One-liner for any report: `const { open, modal } = useVoucherModal({ raw, allLines, reload })`,
// call open(entry) from a row click and render {modal}.
import React, { useMemo, useState } from 'react'
import VoucherDetail from './VoucherDetail.jsx'
import { groupBySource } from '../utils/statements.js'

export function useVoucherModal({ raw, allLines, reload }) {
  const [entry, setEntry] = useState(null)
  const grouped = useMemo(() => groupBySource(allLines), [allLines])
  let modal = null
  if (entry && raw) {
    let lines = grouped.get(entry.lineKey) || []
    // A legacy payable produces two events (bill, then payment) under one source id — show only the one that was clicked.
    if (entry.collection === 'finance_payables') lines = lines.filter(l => l.date === entry.date)
    const voucher = entry.collection === 'finance_vouchers' ? raw.vouchers.find(v => v.id === entry.id) : null
    modal = (
      <VoucherDetail entry={entry} voucher={voucher} lines={lines} seller={raw.companySettings?.[entry.company]}
        onClose={() => setEntry(null)} onChanged={reload} />
    )
  }
  return { open: setEntry, modal }
}
