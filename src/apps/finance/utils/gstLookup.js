// GST Taxpayer Lookup — gstincheck.co.in API
// Simple GET request, no headers needed.
// Endpoint: https://sheet.gstincheck.co.in/check/{API_KEY}/{GSTIN}
// Docs: https://documenter.getpostman.com/view/66843/2sBXirj8Lf

const GST_API_KEY  = '1a2e0619bd8ea535b1ade4e66d69aab7'
const GST_API_BASE = 'https://sheet.gstincheck.co.in/check'

/**
 * Fetch taxpayer details from GST portal by GSTIN.
 * Returns a normalised object ready to auto-fill forms.
 * Throws an Error (with .message) if GSTIN not found or API fails.
 */
export async function fetchGstinDetails(gstin) {
  const cleanGstin = gstin.toUpperCase().trim()
  const url = `${GST_API_BASE}/${GST_API_KEY}/${cleanGstin}`

  let json
  try {
    const res = await fetch(url)
    json = await res.json()
  } catch (e) {
    throw new Error('Network error — check internet connection')
  }

  // flag: true = found, false = not found / error
  if (!json?.flag || !json.data) {
    throw new Error(json?.message || 'GSTIN not found or invalid')
  }

  const d   = json.data
  const adr = d.pradr?.addr || {}

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
    status:       d.sts      || 'Unknown',  // "Active" | "Cancelled"
    businessType: d.ctb      || '',   // "Private Limited Company" | "Proprietorship"
    regType:      d.dty      || '',   // "Regular" | "Composition"
    state:        adr.stcd   || '',   // "Maharashtra"
    address:      d.pradr?.adr || '', // full formatted address string
    city,                             // "Pune"
    pincode:      adr.pncd   || '',   // "411014"
  }
}
