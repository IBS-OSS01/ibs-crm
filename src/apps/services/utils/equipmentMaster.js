// Equipment master: the list of plant / machines that spare parts belong to. Every spare part picks its Equipment Name from here.
// Kept as one settings document (company_settings/equipment_master, like the CRM product list), so it needs no server change;
// administrators maintain it, everyone can read it.
import { doc, getDoc, setDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/app-config'

const REF = () => doc(db, 'company_settings', 'equipment_master')

export const eqKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

export async function loadEquipment() {
  const snap = await getDoc(REF())
  const list = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : []
  return list.filter(e => e && e.name).sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveEquipment(list) {
  await setDoc(REF(), { list, updatedAt: new Date().toISOString() })
}

export const newEquipmentId = () => `eq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
