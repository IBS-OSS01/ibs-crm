// Create / edit / cancel / delete for finance_vouchers.
//
// Numbering: the series counter and the voucher are written in ONE Firestore
// transaction, so two people saving at once can't get the same number and a
// failed save can't burn a number. (The older Invoices / Journal pages scan the
// whole collection for max+1, which is race-prone — new vouchers don't.)
//
// Every change also appends a row to finance_audit_log (Tally's "Audit Trail").
import { collection, doc, runTransaction, addDoc, updateDoc, deleteDoc, getDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { fyOf, VOUCHER_TYPES } from './financeConstants.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'

export class VoucherError extends Error {}

// Firestore rejects `undefined` anywhere in a document; a round-trip through JSON drops those keys.
const clean = (o) => JSON.parse(JSON.stringify(o))

export function assertNotLocked(date, lockedUpTo) {
  if (lockedUpTo && date && date <= lockedUpTo) {
    throw new VoucherError(`Books are locked up to ${lockedUpTo}. A voucher dated ${date} can't be created, edited or cancelled — ask an admin to move the lock date if this is intentional.`)
  }
}

const actor = (user, profile) => ({ by: user?.uid || '', byName: profile?.name || profile?.email || user?.email || '' })

async function audit(entry) {
  try { await addDoc(collection(db, 'finance_audit_log'), clean({ at: new Date().toISOString(), ...entry })) }
  catch (e) { console.warn('[finance] audit log write failed', e) }   // never block the real operation on the log
}

const stripForSnapshot = (v) => {
  const { history, ...rest } = v || {}
  return rest
}

export async function createVoucher(data, { user, profile, lockedUpTo } = {}) {
  assertNotLocked(data.date, lockedUpTo)
  const meta = VOUCHER_TYPES[data.voucherType]
  if (!meta) throw new VoucherError(`Unknown voucher type: ${data.voucherType}`)
  const fy = fyOf(data.date)
  const counterRef = doc(db, 'finance_counters', `${data.company}_${data.voucherType}_${fy}`)
  const voucherRef = doc(collection(db, 'finance_vouchers'))
  const number = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const next = snap.exists() ? (snap.data().next || 1) : 1
    const voucherNumber = `${data.company}/${meta.prefix}/${fy}/${String(next).padStart(3, '0')}`
    tx.set(counterRef, { next: next + 1, company: data.company, type: data.voucherType, fy })
    tx.set(voucherRef, clean({
      ...data, voucherNumber, fy, status: 'active', revision: 1,
      createdAt: new Date().toISOString(), createdBy: actor(user, profile).by, createdByName: actor(user, profile).byName,
    }))
    return voucherNumber
  })
  invalidateFinanceCache()
  await audit({ ...actor(user, profile), action: 'create', voucherId: voucherRef.id, voucherNumber: number, voucherType: data.voucherType, company: data.company, date: data.date, amount: data.total || data.amount || data.partyAmount || 0 })
  return { id: voucherRef.id, voucherNumber: number }
}

export async function updateVoucher(id, before, data, { user, profile, lockedUpTo } = {}) {
  assertNotLocked(before.date, lockedUpTo)
  assertNotLocked(data.date, lockedUpTo)
  if (before.status === 'cancelled') throw new VoucherError('A cancelled voucher cannot be edited.')
  const { id: _i, voucherNumber: _n, voucherType: _t, company: _c, createdAt: _ca, createdBy: _cb, createdByName: _cbn, status: _s, revision: _r, history: _h, ...editable } = data
  await updateDoc(doc(db, 'finance_vouchers', id), clean({
    ...editable, revision: (before.revision || 1) + 1,
    updatedAt: new Date().toISOString(), updatedBy: user?.uid || '', updatedByName: actor(user, profile).byName,
  }))
  invalidateFinanceCache()
  await audit({
    ...actor(user, profile), action: 'edit', voucherId: id, voucherNumber: before.voucherNumber, voucherType: before.voucherType,
    company: before.company, date: data.date, amount: data.total ?? data.partyAmount ?? data.amount ?? 0,
    before: JSON.stringify(stripForSnapshot(before)).slice(0, 20000),
  })
}

export async function cancelVoucher(id, voucher, reason, { user, profile, lockedUpTo } = {}) {
  assertNotLocked(voucher.date, lockedUpTo)
  if (!reason || !reason.trim()) throw new VoucherError('A reason is required to cancel a voucher.')
  await updateDoc(doc(db, 'finance_vouchers', id), {
    status: 'cancelled', cancelReason: reason.trim(), cancelledAt: new Date().toISOString(), cancelledBy: user?.uid || '', cancelledByName: actor(user, profile).byName,
  })
  invalidateFinanceCache()
  await audit({ ...actor(user, profile), action: 'cancel', voucherId: id, voucherNumber: voucher.voucherNumber, voucherType: voucher.voucherType, company: voucher.company, date: voucher.date, reason: reason.trim() })
}

// Hard delete is admin-only and only offered for already-cancelled vouchers.
export async function deleteVoucher(id, voucher, { user, profile } = {}) {
  if (voucher.status !== 'cancelled') throw new VoucherError('Cancel the voucher first — only cancelled vouchers can be deleted.')
  await deleteDoc(doc(db, 'finance_vouchers', id))
  invalidateFinanceCache()
  await audit({ ...actor(user, profile), action: 'delete', voucherId: id, voucherNumber: voucher.voucherNumber, voucherType: voucher.voucherType, company: voucher.company, date: voucher.date,
    before: JSON.stringify(stripForSnapshot(voucher)).slice(0, 20000) })
}

export async function getBooksLockDate(company) {
  try {
    const s = await getDoc(doc(db, 'company_settings', company))
    return s.exists() ? (s.data().booksLockedUpTo || '') : ''
  } catch { return '' }
}
