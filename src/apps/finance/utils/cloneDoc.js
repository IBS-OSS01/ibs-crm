// "Clone" — start a new document from an existing one (same party, lines, ledgers and narration). What belongs to the
// original alone is left behind: its number, bank clearing, settlement of bills, vendor's invoice number, cancellation
// and the audit stamps. The form opens with today's date and saves as a brand-new entry.
const DROP = ['id', 'voucherNumber', 'status', 'cancelReason', 'cancelledAt', 'cancelledBy', 'cancelledByName', 'createdAt', 'createdBy', 'createdByName',
  'updatedAt', 'updatedBy', 'updatedByName', 'revision', 'refNumber', 'dueDate', 'allocations', 'bankLineKey', 'reconciledOn', 'clearedOn',
  'purchaseOrderId', 'purchaseOrderNumber', 'source', 'importRef', 'expenseRef', 'zohoOrderId', 'zohoBillId', 'zohoInvoiceId']

export function cloneVoucher(v, today) {
  const c = { ...v }
  DROP.forEach(k => delete c[k])
  return { ...c, date: today, allocations: [], _clone: true }
}

// an invoice / order / pro-forma on the Invoices page → the form fields for a new one
export function cloneInvoiceItems(items) {
  return (items || []).map(({ invoicedQty, cancelledQty, ...rest }) => ({ ...rest }))
}
