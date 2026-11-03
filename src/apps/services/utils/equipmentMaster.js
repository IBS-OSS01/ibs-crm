// Equipment master: the list of plant / machines that spare parts belong to. Every spare part picks its Equipment Name from here.
// Kept as one document in finance_attachments (id equipment_master) because that collection is open to every signed-in user, so
// service managers can maintain it too and no server change is needed. (It used to sit in company_settings, which only an admin may write —
// that copy is still read when the new one does not exist yet.)
import { doc, getDoc, setDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'

const REF = () => doc(db, 'finance_attachments', 'equipment_master')

export const eqKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

export async function loadEquipment() {
  let snap = await getDoc(REF())
  if (!snap.exists()) snap = await getDoc(doc(db, 'company_settings', 'equipment_master'))
  const list = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : []
  return list.filter(e => e && e.name).sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveEquipment(list) {
  await setDoc(REF(), { entityType: 'equipment_master', entityId: 'equipment_master', list, updatedAt: new Date().toISOString() })
}

export const newEquipmentId = () => `eq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
