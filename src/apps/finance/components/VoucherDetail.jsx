// "Voucher display" — the double-entry behind any voucher, plus Edit / Cancel /
// Print / Delete for vouchers that live in finance_vouchers.
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { cancelVoucher, deleteVoucher, getBooksLockDate, VoucherError } from '../utils/voucherService.js'
import { VOUCHER_TYPES, fmtAmt, num } from '../utils/financeConstants.js'
import { amountInWords } from '../utils/indiaConstants.js'
import { Badge, btnGhost, btnPrimary, useFinancePerms } from './FinanceUI.jsx'
import AttachmentPanel from './AttachmentPanel.jsx'
import { PO_TERMS, termsHtml } from '../utils/poTerms.js'

const LEGACY_PAGES = {
  finance_invoices: ['/finance/invoices', 'Invoices'],
  finance_journal_entries: ['/finance/journal', 'Journal Entries'],
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')

function printVoucher(entry, voucher, lines, seller) {
  const meta = VOUCHER_TYPES[entry.kind] || { label: entry.kind }
  const items = (voucher?.items || []).map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.description)}<br><small>${esc(i.hsnCode ? 'HSN/SAC ' + i.hsnCode : '')}</small></td>
    <td style="text-align:right">${esc(i.qty)} ${esc(i.unit)}</td><td style="text-align:right">${fmtAmt(i.rate)}</td><td style="text-align:right">${num(i.gstRate)}%</td><td style="text-align:right">${fmtAmt(i.taxable)}</td></tr>`).join('')
  const entries = lines.map(l => `<tr><td>${esc(l.accountName)}${l.partyName ? ` <small>(${esc(l.partyName)})</small>` : ''}</td>
    <td style="text-align:right">${l.debit ? fmtAmt(l.debit) : ''}</td><td style="text-align:right">${l.credit ? fmtAmt(l.credit) : ''}</td></tr>`).join('')
  const html = `<!DOCTYPE html><html><head><title>${esc(meta.label)} ${esc(entry.number)}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;padding:22px;color:#111}table{width:100%;border-collapse:collapse;margin:8px 0}
    th,td{padding:5px 7px;border-bottom:1px solid #ddd;text-align:left}th{background:#f1f5f9;font-size:11px;text-transform:uppercase}h2{margin:0}small{color:#666}</style></head><body>
    <h2>${esc(seller?.legalName || entry.company)}</h2><div>${esc([seller?.address, seller?.city, seller?.state].filter(Boolean).join(', '))}${seller?.gstin ? ` · GSTIN ${esc(seller.gstin)}` : ''}</div>
    <h3 style="margin:14px 0 4px">${esc(meta.label)} Voucher</h3>
    <div><b>No:</b> ${esc(entry.number)} &nbsp; <b>Date:</b> ${esc(entry.date)} ${entry.partyName ? `&nbsp; <b>Party:</b> ${esc(entry.partyName)}` : ''}
    ${voucher?.refNumber ? `&nbsp; <b>Ref:</b> ${esc(voucher.refNumber)}` : ''}</div>
    ${items ? `<table><thead><tr><th>#</th><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">GST</th><th style="text-align:right">Taxable</th></tr></thead><tbody>${items}</tbody></table>` : ''}
    ${(voucher?.gstLines || []).map(g => `<div style="text-align:right">${esc(g.label)}: ${fmtAmt(g.amount)}</div>`).join('')}
    ${voucher?.tds?.applicable ? `<div style="text-align:right">TDS (${esc(voucher.tds.section)} @ ${voucher.tds.rate}%): ${fmtAmt(voucher.tds.amount)}</div>` : ''}
    <div style="text-align:right;font-size:14px;margin-top:6px"><b>Amount: ₹${fmtAmt(entry.amount)}</b></div>
    <div style="font-style:italic;color:#444">${esc(amountInWords(entry.amount))}</div>
    ${entry.narration ? `<p><b>Narration:</b> ${esc(entry.narration)}</p>` : ''}
    <h4 style="margin-bottom:0">Ledger entries</h4><table><thead><tr><th>Account</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr></thead><tbody>${entries}</tbody></table>
    <div style="margin-top:40px;text-align:right">Authorised signatory</div>
    ${(voucher?.voucherType === 'purchase_order' || entry.kind === 'purchase_order') ? `<div style="page-break-before:always">${termsHtml(voucher?.termsAndConditions || PO_TERMS)}</div>` : ''}</body></html>`
  const w = window.open('', '_blank', 'width=900,height=800')
  if (!w) { alert('The print window was blocked — allow pop-ups and try again.'); return }
  w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400)
}

export default function VoucherDetail({ entry, voucher, lines, seller, stockItems = [], extraActions = [], onClose, onChanged }) {
  const itemName = (id) => stockItems.find(i => i.id === id)?.name || id
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const { canWrite, isAdmin } = useFinancePerms()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!entry) return null
  const meta = VOUCHER_TYPES[entry.kind] || { label: entry.kind, color: 'bg-slate-100 text-slate-600' }
  const isNewVoucher = entry.collection === 'finance_vouchers'
  const cancelled = voucher?.status === 'cancelled'
  const legacy = LEGACY_PAGES[entry.collection]
  const totalDr = lines.reduce((s, l) => s + num(l.debit), 0)

  const doCancel = async () => {
    const reason = window.prompt('Reason for cancelling this voucher (kept in the audit trail):')
    if (!reason) return
    setBusy(true); setErr('')
    try {
      const lockedUpTo = await getBooksLockDate(voucher.company)
      await cancelVoucher(voucher.id, voucher, reason, { user, profile: userProfile, lockedUpTo })
      onChanged?.(); onClose()
    } catch (e) { setErr(e instanceof VoucherError ? e.message : 'Error: ' + e.message) }
    finally { setBusy(false) }
  }
  const doDelete = async () => {
    if (!window.confirm('Permanently delete this cancelled voucher? The audit trail keeps a copy.')) return
    setBusy(true); setErr('')
    try { await deleteVoucher(voucher.id, voucher, { user, profile: userProfile }); onChanged?.(); onClose() }
    catch (e) { setErr(e instanceof VoucherError ? e.message : 'Error: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/70 w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color={meta.color}>{meta.label}</Badge>
              <span className="font-mono text-sm text-slate-700">{entry.number}</span>
              {cancelled && <Badge color="bg-red-100 text-red-700">CANCELLED</Badge>}
              {entry.memo && <Badge color="bg-slate-100 text-slate-500">Not booked</Badge>}
            </div>
            <p className="text-sm text-slate-500 mt-1">{entry.date} · {entry.company}{entry.partyName ? ` · ${entry.partyName}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}
          {entry.memo && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">{entry.memoLabel === 'Purchase Order' ? 'A purchase order is an order-tracking document — it has no accounting entry. Stock and the payable are created when you enter the vendor’s bill (Pending POs → Create bill).' : `${entry.memoLabel || 'This document'} is a memorandum — it doesn’t hit the books until it’s converted to a Tax Invoice.`}</p>}

          {voucher?.items?.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Items</p>
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400 uppercase"><tr><th className="text-left py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">GST</th><th className="text-right">Taxable</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {voucher.items.map((i, n) => (
                    <tr key={n}><td className="py-1.5 text-slate-700">{i.description}{i.hsnCode && <span className="text-xs text-slate-400"> · HSN {i.hsnCode}</span>}</td>
                      <td className="text-right">{i.qty} {i.unit}</td><td className="text-right">{fmtAmt(i.rate)}</td><td className="text-right">{num(i.gstRate)}%</td><td className="text-right">{fmtAmt(i.taxable)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right text-sm text-slate-600 mt-1 space-y-0.5">
                {(voucher.gstLines || []).map(g => <div key={g.label}>{g.label}: {fmtAmt(g.amount)}</div>)}
                {voucher.tds?.applicable && <div>TDS {voucher.tds.section} @ {voucher.tds.rate}%: − {fmtAmt(voucher.tds.amount)}</div>}
              </div>
            </div>
          )}

          {voucher?.voucherType === 'stock_journal' && (
            <div className="text-sm text-slate-700 space-y-1">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{voucher.type === 'transfer' ? 'Godown transfer' : voucher.type === 'manufacture' ? 'Manufacturing' : 'Stock adjustment'}</p>
              {(voucher.lines || []).map((l, i) => <p key={i}>{itemName(l.itemId)} · qty {l.qty}{l.mode === 'set' ? ' (counted)' : ''}</p>)}
              {(voucher.consume || []).map((l, i) => <p key={'c' + i}>Used: {itemName(l.itemId)} · {l.qty}</p>)}
              {(voucher.produce || []).map((l, i) => <p key={'p' + i}>Made: {itemName(l.itemId)} · {l.qty}</p>)}
              <p className="text-xs text-slate-400">Stock journals change quantities (and, via the stock valuation, Stock in Hand) — see the Item Ledger for the effect.</p>
            </div>
          )}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Ledger entries</p>
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 uppercase"><tr><th className="text-left py-1">Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-1.5 text-slate-700">{l.accountName}{l.partyName && <span className="text-xs text-slate-400"> ({l.partyName})</span>}{l.bankAccountId && <span className="text-xs text-slate-400"> · bank</span>}</td>
                    <td className="text-right">{l.debit ? fmtAmt(l.debit) : ''}</td><td className="text-right">{l.credit ? fmtAmt(l.credit) : ''}</td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-slate-400">{entry.memo ? 'No ledger impact.' : cancelled ? 'Cancelled — no ledger impact.' : 'No entries.'}</td></tr>}
              </tbody>
              {lines.length > 0 && <tfoot><tr className="font-bold border-t border-slate-200"><td className="py-1.5">Total</td><td className="text-right">{fmtAmt(totalDr)}</td><td className="text-right">{fmtAmt(totalDr)}</td></tr></tfoot>}
            </table>
          </div>

          {isNewVoucher && voucher && <AttachmentPanel entityType={voucher.voucherType} entityId={voucher.id} company={voucher.company} editable={canWrite && !cancelled} />}
          {entry.narration && <p className="text-sm text-slate-600"><b>Narration:</b> {entry.narration}</p>}
          {(voucher?.voucherType === 'purchase_order' || entry.kind === 'purchase_order') && <details className="text-sm"><summary className="cursor-pointer text-blue-700 font-medium">Terms &amp; conditions (printed with this order)</summary><pre className="whitespace-pre-wrap text-xs text-slate-600 mt-2 max-h-72 overflow-y-auto font-sans">{voucher?.termsAndConditions || PO_TERMS}</pre></details>}
          {cancelled && <p className="text-sm text-red-600"><b>Cancelled:</b> {voucher.cancelReason} — {voucher.cancelledByName}, {voucher.cancelledAt?.slice(0, 10)}</p>}
          {voucher && <p className="text-xs text-slate-400">Created by {voucher.createdByName || '—'} on {voucher.createdAt?.slice(0, 10)}{voucher.revision > 1 ? ` · revision ${voucher.revision}, last edited by ${voucher.updatedByName || '—'} on ${voucher.updatedAt?.slice(0, 10)}` : ''}</p>}
        </div>

        <div className="flex items-center gap-2 p-4 border-t border-slate-100 flex-wrap">
          {!entry.memo && <button onClick={() => printVoucher(entry, voucher, lines, seller)} className={btnGhost}>🖨 Print</button>}
          {isNewVoucher && canWrite && !cancelled && voucher?.voucherType !== 'payroll' && (
            <>
              <button onClick={() => { onClose(); navigate(`/finance/vouchers/${entry.voucherType}?edit=${entry.id}`) }} className={btnPrimary}>✏️ Edit</button>
              <button onClick={() => { onClose(); navigate(`/finance/vouchers/${entry.voucherType}?clone=${entry.id}`) }} className={btnGhost} title="Start a new entry from this one">⧉ Clone</button>
              <button onClick={doCancel} disabled={busy} className="px-3 py-1.5 bg-white border border-red-300 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg disabled:opacity-50">Cancel voucher</button>
            </>
          )}
          {isNewVoucher && isAdmin && cancelled && <button onClick={doDelete} disabled={busy} className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg disabled:opacity-50">Delete permanently</button>}
          {extraActions.map(a => <button key={a.label} onClick={() => { onClose(); a.onClick() }} className={a.primary ? btnPrimary : btnGhost}>{a.label}</button>)}
          {legacy && !extraActions.length && <button onClick={() => { onClose(); navigate(legacy[0]) }} className={btnGhost}>Open in {legacy[1]} →</button>}
          <button onClick={onClose} className={`${btnGhost} ml-auto`}>Close</button>
        </div>
      </div>
    </div>
  )
}
