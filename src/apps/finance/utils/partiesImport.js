// Reading a contacts export (Zoho Books "Contacts" / "Vendors" CSV) into customers and vendors.
// Pure functions — the modal does the Firestore writes.
import { INDIA_STATES, gstinToState } from './indiaConstants.js'
import { isValidGstin } from './financeConstants.js'

const s = (v) => String(v ?? '').replace(/^'+/, '').trim()
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export const cleanPhone = (v) => {
  const raw = s(v); if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (/^\+?91/.test(raw) && digits.length === 12) return digits.slice(2)
  if (digits.length === 10) return digits
  return raw.replace(/\s+/g, ' ')              // foreign numbers stay as written
}

const stateName = (name, gstin) => {
  const hit = INDIA_STATES.find(x => x.name.toLowerCase() === s(name).toLowerCase())
  return hit?.name || (gstin ? gstinToState(gstin) : '') || ''
}

const creditDaysOf = (days, label) => {
  const n = Number(days)
  if (Number.isFinite(n) && n > 0) return n
  return /end of the month/i.test(label || '') ? 30 : 0
}
const termsLabel = (days, label) => {
  const d = creditDaysOf(days, label)
  return d === 0 ? 'Due on Receipt' : `Net ${d}`
}

// Zoho TDS tags → this app's section codes
export function tdsFromZoho(name, pct, code) {
  const text = `${name || ''} ${code || ''}`
  const rate = Number(pct) || Number((String(name).match(/(\d+(?:\.\d+)?)\s*%/) || [])[1]) || 0
  if (/194\s*C/i.test(text) || /contractor/i.test(text)) return { section: '194C', rate }
  if (/194\s*J/i.test(text) || /professional_fees|professional fees/i.test(text)) return { section: rate && rate <= 2 ? '194J-T' : '194J-P', rate: rate || 10 }
  if (/194\s*H/i.test(text)) return { section: '194H', rate: rate || 2 }
  if (/194\s*I/i.test(text)) return { section: rate && rate <= 2 ? '194I-A' : '194I-B', rate: rate || 10 }
  return { section: '', rate: 0 }
}

const STATUTORY = /provident fund|income tax|goods and services tax|professional tax|customs|government of|^gst$|^tds$|\besic\b/i

// rows: array of objects keyed by the CSV header
export function parseContacts(rows, kind) {
  const seen = new Set()
  const out = []
  rows.forEach((r, i) => {
    const display = s(r['Display Name'] || r['Contact Name'] || r['Company Name'])
    if (!display) return
    const gstin = s(r['GST Identification Number (GSTIN)']).toUpperCase()
    const company = s(r['Company Name'])
    const addr = [s(r['Billing Address']), s(r['Billing Street2'])].filter(Boolean).join(', ')
    const country = s(r['Billing Country'])
    const person = [s(r['First Name']), s(r['Last Name'])].filter(Boolean).join(' ')
    const key = `${norm(display)}|${gstin}`
    const statutory = STATUTORY.test(display)
    const looksLikePerson = !gstin && !company && !addr
    const row = {
      line: i + 2, name: display, gstin, gstinOk: !gstin || isValidGstin(gstin), pan: gstin.length === 15 ? gstin.slice(2, 12) : '',
      contactPerson: person && norm(person) !== norm(display) ? person : '', phone: cleanPhone(r['Phone'] || r['MobilePhone'] || r['Billing Phone']), email: s(r['EmailID']),
      address: addr, city: s(r['Billing City']), state: country && !/india/i.test(country) ? '' : stateName(r['Billing State'], gstin), pincode: s(r['Billing Code']).replace(/\D/g, '').slice(0, 6) || '', country: country || 'India',
      gstTreatment: s(r['GST Treatment']), active: !/inactive/i.test(s(r['Status'])),
      creditDays: creditDaysOf(r['Payment Terms'], r['Payment Terms Label']), paymentTerms: termsLabel(r['Payment Terms'], r['Payment Terms Label']),
      notes: s(r['Notes']), duplicateInFile: seen.has(key), statutory, looksLikePerson,
    }
    seen.add(key)
    if (kind === 'vendor') {
      const t = tdsFromZoho(r['TDS Name'], r['TDS Percentage'], r['TDS Section Code'])
      Object.assign(row, { tdsSection: t.section, tdsRate: t.rate, msmeNo: s(r['MSME/Udyam No']), bankName: s(r['Vendor Bank Name']), bankAccount: s(r['Vendor Bank Account Number']), ifsc: s(r['Vendor Bank Code']) })
    } else {
      Object.assign(row, { shipTo: [s(r['Shipping Address']), s(r['Shipping Street2']), s(r['Shipping City']), s(r['Shipping State']), s(r['Shipping Code'])].filter(Boolean).join(', '), creditLimit: Number(r['Credit Limit']) || 0 })
    }
    // individuals (Zoho "consumer", no GSTIN) are usually staff / walk-ins, not trade parties — left for the user to tick
    row.looksLikePerson = looksLikePerson || (/consumer/i.test(row.gstTreatment) && !gstin)
    row.include = !row.duplicateInFile && !statutory && !row.looksLikePerson
    out.push(row)
  })
  return out
}

export function matchParty(row, existing, kind) {
  const nameOf = (x) => (kind === 'vendor' ? x.vendorName : x.shopName)
  const gst = (x) => String(x.gstin || '').toUpperCase()
  // same GSTIN = same party; a different GSTIN under the same name is another branch (its own record), never an overwrite
  if (row.gstin) {
    const byGstin = existing.find(x => gst(x) === row.gstin)
    if (byGstin) return byGstin
  }
  return existing.find(x => norm(nameOf(x)) === norm(row.name) && !(row.gstin && gst(x) && gst(x) !== row.gstin)) || null
}

// → the document body for crm_customers / finance_vendors
export function toDoc(row, kind) {
  if (kind === 'vendor') {
    return {
      vendorName: row.name, contactPerson: row.contactPerson, phone: row.phone, email: row.email, address: row.address, city: row.city, state: row.state, pincode: row.pincode,
      gstin: row.gstin, pan: row.pan, paymentTerms: row.paymentTerms, bankName: row.bankName, bankAccount: row.bankAccount, ifsc: row.ifsc,
      ...(row.tdsSection ? { tdsSection: row.tdsSection, tdsRate: row.tdsRate } : {}), ...(row.msmeNo ? { msmeNo: row.msmeNo } : {}),
      gstTreatment: row.gstTreatment, country: row.country, notes: row.notes, active: row.active,
    }
  }
  return {
    shopName: row.name, ownerName: row.contactPerson, phone: row.phone, email: row.email, address: row.address, city: row.city, state: row.state, pincode: row.pincode,
    gstin: row.gstin, pan: row.pan, creditLimit: row.creditLimit, creditDays: row.creditDays, gstTreatment: row.gstTreatment, country: row.country,
    ...(row.shipTo ? { shippingAddress: row.shipTo } : {}), notes: row.notes, active: row.active,
  }
}
