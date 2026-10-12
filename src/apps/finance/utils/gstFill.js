// Fill a customer's / vendor's missing address from the GST portal (by GSTIN). Only blank fields are filled — anything
// already entered is kept, and the name is never changed (ledger lines are matched by name).
import { doc, updateDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { fetchGstinDetails } from './gstLookup.js'
import { INDIA_STATES } from './indiaConstants.js'
import { isValidGstin } from './financeConstants.js'

export const needsAddress = (p) => !String(p.address || '').trim() || !String(p.city || '').trim() || !String(p.pincode || '').trim()
export const canFillFromGst = (p) => isValidGstin(String(p.gstin || '').trim().toUpperCase()) && needsAddress(p)

// the fields a lookup result would add to this record
export function gstFillPatch(p, d) {
  const patch = {}
  const put = (k, v) => { if (v && !String(p[k] || '').trim()) patch[k] = String(v).trim() }
  put('address', d.address); put('city', d.city); put('pincode', d.pincode); put('pan', d.pan); put('state', d.state)
  const st = INDIA_STATES.find(s => s.name === (patch.state || p.state)); if (st && !p.stateCode) patch.stateCode = st.code
  return patch
}

// look up one record and save what was missing; returns the patch (empty when nothing was missing)
export async function fillFromGst(coll, p) {
  const d = await fetchGstinDetails(String(p.gstin).trim())
  const patch = gstFillPatch(p, d)
  if (Object.keys(patch).length) { await updateDoc(doc(db, coll, p.id), { ...patch, updatedAt: new Date().toISOString() }); Object.assign(p, patch) }
  return patch
}
