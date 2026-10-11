// "Paid / Part paid / Unpaid" chip for an invoice or bill, from payStatus().
import React from 'react'
import { fmtAmt } from '../utils/financeConstants.js'

export default function PayStatus({ st, today }) {
  if (!st) return <span className="text-slate-300">—</span>
  const overdue = st.state !== 'paid' && st.dueDate && today && st.dueDate < today
  if (st.state === 'paid') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Paid</span>
  return (
    <span className="whitespace-nowrap">
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${st.state === 'part' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{st.state === 'part' ? 'Part paid' : 'Unpaid'}</span>
      <span className="text-xs text-slate-500 ml-1.5">{fmtAmt(st.pending)} due{overdue ? <span className="text-red-600"> · overdue</span> : null}</span>
    </span>
  )
}
