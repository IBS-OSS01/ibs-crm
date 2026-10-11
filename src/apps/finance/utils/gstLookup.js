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

import { gstinToState } from './indiaConstants.js'

// Optional: URL of your own small proxy in front of gstinapi.in (browsers can't call that API directly —
// it sends no CORS headers). See infrastructure/gst-proxy/README.md. When set it is used instead of Appyflow.
const GST_PROXY_URL = import.meta.env.VITE_GST_PROXY_URL || ''
const GST_API_KEY  = import.meta.env.VITE_APPYFLOW_GST_KEY || ''
const GST_API_BASE = 'https://appyflow.in/api/verifyGST'

/**
 * Fetch taxpayer details from GST portal by GSTIN.
 * Returns a normalised object ready to auto-fill forms.
 * Throws an Error (with .message) if GSTIN not found or API fails.
 */
export async function fetchGstinDetails(gstin) {
  const cleanGstin = gstin.toUpperCase().trim()
  const pan = cleanGstin.length >= 12 ? cleanGstin.substring(2, 12) : ''
  // The state is encoded in the first two digits of every GSTIN, so that is the authority for state.
  const stateFromGstin = gstinToState(cleanGstin)

  let out
  if (GST_PROXY_URL) out = await viaProxy(cleanGstin)
  else out = await viaAppyflow(cleanGstin)

  // Sanity checks: a lookup that disagrees with the number we asked about is wrong data, not a result.
  if (out.gstin && out.gstin !== cleanGstin) throw new Error(`The lookup service answered for a different GSTIN (${out.gstin}), so nothing was filled in. This service is unreliable${GST_PROXY_URL ? '' : ' — see infrastructure/gst-proxy/README.md for the free, accurate gstinapi.in option'}; until then enter the details by hand.`)
  if (out.state && stateFromGstin && out.state !== stateFromGstin) {
    throw new Error(`The lookup service returned details for ${out.state}, but GSTIN ${cleanGstin} is registered in ${stateFromGstin}. Its data looks wrong, so nothing was filled in — enter the details by hand, or retry later.`)
  }
  return { ...out, gstin: cleanGstin, pan, state: stateFromGstin || out.state }
}

async function viaProxy(cleanGstin) {
  let json
  try {
    const res = await fetch(`${GST_PROXY_URL.replace(/\/$/, '')}/${encodeURIComponent(cleanGstin)}`)
    json = await res.json()
  } catch (e) { throw new Error('Network error — check internet connection') }
  if (!json?.success || !json.data) throw new Error(json?.error || json?.message || 'GSTIN not found or invalid')
  const d = json.data
  return {
    legalName: d.legal_name || '', tradeName: d.trade_name || '', gstin: d.gstin || '', status: d.status || 'Unknown',
    businessType: d.business_constitution || '', regType: d.taxpayer_type || '',
    state: d.state_code ? gstinToState(d.state_code + 'XXXXXXXXXXXXX') : '', address: d.address || '', city: d.city || '', pincode: d.pincode || '',
  }
}

async function viaAppyflow(cleanGstin) {
  if (!GST_API_KEY) {
    throw new Error('GST lookup is not configured — set VITE_GST_PROXY_URL (recommended) or VITE_APPYFLOW_GST_KEY in .env.local')
  }
  const url = `${GST_API_BASE}?gstNo=${encodeURIComponent(cleanGstin)}&key_secret=${encodeURIComponent(GST_API_KEY)}`
  let json
  try {
    const res = await fetch(url)
    json = await res.json()
  } catch (e) {
    throw new Error('Network error — check internet connection')
  }
  if (json?.error) throw new Error(json.message || 'GSTIN not found or invalid')
  const d = json?.taxpayerInfo || json?.data || json
  if (!d || !(d.gstin || d.lgnm)) throw new Error(json?.message || 'GSTIN not found or invalid')
  const adr = d.pradr?.addr || d.adr || {}
  const city = (adr.dst && adr.dst.trim()) ? adr.dst.trim() : (adr.loc && adr.loc.trim() ? adr.loc.trim() : '')
  return {
    legalName: d.lgnm || '', tradeName: d.tradeNam || '', gstin: d.gstin || '', status: d.sts || d.status || 'Unknown',
    businessType: d.ctb || '', regType: d.dty || '', state: adr.stcd || '', address: d.pradr?.adr || d.adr || '', city, pincode: adr.pncd || '',
  }
}
