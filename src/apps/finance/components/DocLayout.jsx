// The common layout of a document form (purchase bill / order, credit and debit notes) — the same look as the sales invoice form:
//   a grey band with the party and supply, a white body with the document's details, the item table, notes + totals.
// These are presentational pieces — each form keeps its own state and saving.
import React from 'react'
import SearchSelect from './SearchSelect.jsx'
import { formInputCls } from './FinanceUI.jsx'

export const Band = ({ children }) => <div className="bg-slate-50 border-y border-slate-200 px-6 py-5 space-y-4">{children}</div>
export const Body = ({ children }) => <div className="px-6 py-5 space-y-4">{children}</div>

// one labelled row: label on the left (red when required), field on the right
export function FRow({ label, req, hint, children }) {
  return (
    <div className="flex gap-4 items-start">
      <label className={`w-44 shrink-0 pt-2 text-sm ${req ? 'text-red-500' : 'text-slate-700'}`}>{label}{req ? '*' : ''}</label>
      <div className="flex-1 min-w-0">{children}{hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}</div>
    </div>
  )
}
export const ReadBox = ({ children, mono }) => <div className={`max-w-sm px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 ${mono ? 'font-mono' : ''}`}>{children || '—'}</div>

const cap = 'text-xs font-semibold uppercase tracking-wide text-slate-500'
const addr = (p = {}) => [p.address, p.area, [p.city, p.state, p.pincode].filter(Boolean).join(', ')].filter(Boolean)

// "Customer / Vendor Name*" picker with currency, and under it the party's billing address and GST details.
export function PartyBlock({ label, options, value, onPick, name, gstin, pan, master, currency = 'INR', required = true, children }) {
  const m = master || {}
  const lines = addr(m)
  return (
    <>
      <FRow label={label} req>
        <div className="flex gap-2 max-w-xl">
          <div className="flex-1"><SearchSelect value={value} onChange={onPick} className={formInputCls} required={required} placeholder="Select or type to search…" options={options} /></div>
          <span className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-600 whitespace-nowrap">{currency}</span>
        </div>
      </FRow>
      {name && (
        <div className="md:pl-[11rem] grid md:grid-cols-2 gap-x-8 gap-y-3 text-sm text-slate-700">
          <div><p className={cap}>Billing address</p><div className="mt-1"><p className="font-semibold">{name}</p>{lines.length ? lines.map((l, i) => <p key={i}>{l}</p>) : <p className="text-amber-600 text-xs">No address on file — add it in Customers / Vendors</p>}</div></div>
          <div>
            <p className={cap}>GST details</p>
            <p className="mt-1">GST Treatment: <b className="font-medium">{gstin ? 'Registered Business - Regular' : 'Unregistered Business'}</b></p>
            <p>GSTIN: <span className="font-mono text-xs">{gstin || '—'}</span>{pan ? <span className="text-xs text-slate-500"> · PAN {pan}</span> : null}</p>
            <p className="text-xs text-slate-500">{[m.contactPerson || m.ownerName, m.phone, m.email].filter(Boolean).join(' · ')}</p>
          </div>
        </div>)}
      {children}
    </>
  )
}

// supply chip (intra / inter) shown beside the supply rows
export const SupplyChip = ({ ready, supplyType }) => (
  <span className={`ml-3 text-xs font-medium ${!ready ? 'text-slate-400' : supplyType === 'intra' ? 'text-green-700' : 'text-orange-700'}`}>{!ready ? '' : supplyType === 'intra' ? '✓ Intra-state → CGST + SGST' : '↗ Inter-state → IGST'}</span>
)

// the item table in a bordered card with a heading and an "Add New Row" button under it
export function ItemCard({ children, onAdd }) {
  return (
    <>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200"><p className="text-sm font-semibold text-slate-700">Item Table</p></div>
        <div className="p-2">{children}</div>
      </div>
      {onAdd && <button type="button" onClick={onAdd} className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium">⊕ Add New Row</button>}
    </>
  )
}

// notes / extras on the left, totals on the right
export function NotesTotals({ left, right }) {
  return (
    <div className="grid md:grid-cols-[1.3fr_1fr] gap-6 pt-2 items-start">
      <div className="space-y-3">{left}</div>
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-5">{right}</div>
    </div>
  )
}
