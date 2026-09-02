import { doc, getDocs, collection, setDoc } from 'firebase/firestore'

// The departments the app shipped with, hardcoded until now. Seeded once so
// existing data (every hr_employees.department value) keeps matching.
export const DEFAULT_DEPARTMENTS = [
  { id: 'sales',      name: 'Sales',      isSystem: true },
  { id: 'delivery',   name: 'Delivery',   isSystem: true },
  { id: 'warehouse',  name: 'Warehouse',  isSystem: true },
  { id: 'admin',      name: 'Admin',      isSystem: true },
  { id: 'accounts',   name: 'Accounts',   isSystem: true },
  { id: 'management', name: 'Management', isSystem: true },
  { id: 'other',      name: 'Other',      isSystem: true },
]

// Idempotent: only seeds if the departments collection is completely empty,
// so it never overwrites departments an admin has already added or edited.
export async function ensureDefaultDepartments(db) {
  const snap = await getDocs(collection(db, 'departments'))
  if (!snap.empty) return
  await Promise.all(DEFAULT_DEPARTMENTS.map(d => setDoc(doc(db, 'departments', d.id), d)))
}
