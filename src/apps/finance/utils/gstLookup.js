// GST Taxpayer Lookup — Appyflow (https://appyflow.in/verify-gst/)
// Switched from gstincheck.co.in after its free quota (20 test requests)
// ran out. Appyflow's free tier is 50 requests/month; get a key_secret at
// https://dashboard.gstapi.appyflow.in/ and set VITE_APPYFLOW_GST_KEY in
// .env.local (never commit the real key — .env.local is gitignored).
//
// Endpoint: GET https://appyflow.in/api/verifyGST?gstNo={GSTIN}&key_secret={KEY}
// Docs: https://appyflow.in/verify-gst/#docs
//
// Both this and the old provider are thin wrappers around the same
// government "Search Taxpayer" data, so the underlying field names
// (lgnm, tradeNam, pradr.addr, ctb, dty, sts/stj...) are shared — the
// parsing below reads defensively across the small naming differences
// seen between providers rather than assuming one exact shape.

const GST_API_KEY  = import.meta.env.VITE_APPYFLOW_GST_KEY || ''
const GST_API_BASE = 'https://appyflow.in/api/verifyGST'

/**
 * Fetch taxpayer details from GST portal by GSTIN.
 * Returns a normalised object ready to auto-fill forms.
 * Throws an Error (with .message) if GSTIN not found or API fails.
 */
export async function fetchGstinDetails(gstin) {
  const cleanGstin = gstin.toUpperCase().trim()

  if (!GST_API_KEY) {
    throw new Error('GST lookup is not configured — set VITE_APPYFLOW_GST_KEY in .env.local (get a free key at dashboard.gstapi.appyflow.in)')
  }

  const url = `${GST_API_BASE}?gstNo=${encodeURIComponent(cleanGstin)}&key_secret=${encodeURIComponent(GST_API_KEY)}`

  let json
  try {
    const res = await fetch(url)
    json = await res.json()
  } catch (e) {
    throw new Error('Network error — check internet connection')
  }

  if (json?.error) {
    throw new Error(json.message || 'GSTIN not found or invalid')
  }

  // Appyflow nests the result under taxpayerInfo; be tolerant of a flatter
  // shape too in case that changes.
  const d = json?.taxpayerInfo || json?.data || json
  if (!d || !(d.gstin || d.lgnm)) {
    throw new Error(json?.message || 'GSTIN not found or invalid')
  }

  const adr = d.pradr?.addr || d.adr || {}

  // Prefer district for city; fall back to locality
  const city = (adr.dst && adr.dst.trim())
    ? adr.dst.trim()
    : (adr.loc && adr.loc.trim() ? adr.loc.trim() : '')

  // PAN is embedded in GSTIN: characters 3–12 (0-indexed 2–11)
  const pan = cleanGstin.length >= 12 ? cleanGstin.substring(2, 12) : ''

  return {
    legalName:    d.lgnm     || '',   // "UDISHTHA INNOVATIONS PRIVATE LIMITED"
    tradeName:    d.tradeNam || '',   // trade name
    gstin:        d.gstin    || cleanGstin,
    pan,                              // extracted from GSTIN
    status:       d.sts || d.status || 'Unknown',  // "Active" | "Cancelled"
    businessType: d.ctb      || '',   // "Private Limited Company" | "Proprietorship"
    regType:      d.dty      || '',   // "Regular" | "Composition"
    state:        adr.stcd   || '',   // "Maharashtra"
    address:      d.pradr?.adr || d.adr || '', // full formatted address string
    city,                             // "Pune"
    pincode:      adr.pncd   || '',   // "411014"
  }
}
