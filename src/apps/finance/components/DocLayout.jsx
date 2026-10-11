// The common layout of a purchase document (bill or order), matching the sales invoice form:
//   1 party card (name picker + the party's details)  2 supply  3 document details  4 item table  5 notes + totals.
// These are presentational pieces — each form keeps its own state and saving.
import React from 'react'
import SearchSelect from './SearchSelect.jsx'
import { Field } from './formShared.jsx'
import { formInputCls } from './FinanceUI.jsx'

const panel = 'rounded-xl border border-slate-200 bg-slate-50 p-4'
const cap = 'text-xs font-bold uppercase tracking-wide text-slate-500'
const addr = (p = {}) => [p.address, p.area, [p.city, p.state, p.pincode].filter(Boolean).join(', ')].filter(Boolean)

// Vendor picker on the left (children = extra fields under it), the vendor's details on the right.
export function VendorCard({ vendors, vendorId, onPick, vendor, required = true, children }) {
  const m = vendor?.raw || {}
  const lines = addr(m)
  return (
    <div className="grid md:grid-cols-[1fr_1.2fr] gap-5">
      <div className="space-y-3">
        <Field label="Vendor name *"><SearchSelect value={vendorId} onChange={onPick} className={formInputCls} required={required} placeholder="Select or type to search a vendor…" options={vendors.map(v => ({ value: v.id, label: v.name }))} /></Field>
        {children}
      </div>
      <div className={`${panel} space-y-3`}>
        <p className="text-sm font-semibold text-slate-800">{vendor ? `${vendor.name}'s details` : 'Vendor details'}</p>
        {!vendor ? <p className="text-xs text-slate-400">Pick a vendor to see their address and GST details.</p> : (
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div><p className={cap}>Billing address</p>{lines.length ? lines.map((l, i) => <p key={i} className="text-slate-700">{l}</p>) : <p className="text-amber-600 text-xs">No address on file — add it under Vendors</p>}</div>
            <div className="space-y-1">
              <p className={cap}>GST details</p>
              <p className="text-slate-700">GST treatment: <b>{vendor.gstin ? 'Registered business' : 'Unregistered business'}</b></p>
              <p className="text-slate-700 font-mono text-xs">{vendor.gstin || 'No GSTIN'}{vendor.pan ? ` · PAN ${vendor.pan}` : ''}</p>
              <p className="text-slate-500 text-xs">{[m.contactPerson, m.phone, m.email].filter(Boolean).join(' · ')}</p>
              <p className="text-slate-500 text-xs">{m.paymentTerms ? `Terms: ${m.paymentTerms}` : ''}</p>
            </div>
          </div>)}
      </div>
    </div>
  )
}

// Source / destination of supply and the tax switches.
export function SupplyRow({ sourceState, destState, supplyType, hasVendor, children }) {
  return (
    <div className={`${panel} space-y-3`}>
      <div className="grid md:grid-cols-3 gap-4 items-end">
        <Field label="Source of supply"><div className={`${formInputCls} bg-slate-100`}>{sourceState || '—'}</div></Field>
        <Field label="Destination of supply"><div className={`${formInputCls} bg-slate-100`}>{destState || '—'}</div></Field>
        <div className={`text-xs px-3 py-2 rounded-lg font-medium ${!hasVendor ? 'bg-slate-100 text-slate-400' : supplyType === 'intra' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>{!hasVendor ? 'Pick a vendor' : supplyType === 'intra' ? '✓ Intra-state supply → CGST + SGST' : '↗ Inter-state supply → IGST'}</div>
      </div>
      {children}
    </div>
  )
}

// Notes / extras on the left, totals on the right.
export function NotesTotals({ left, right }) {
  return (
    <div className="grid md:grid-cols-[1.3fr_1fr] gap-5 items-start">
      <div className="space-y-3">{left}</div>
      <div className={panel}>{right}</div>
    </div>
  )
}
