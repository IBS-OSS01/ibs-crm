import { doc, getDocs, collection, setDoc } from 'firebase/firestore'

// Built-in roles that always exist so the app keeps working even before
// anyone visits the Roles tab. 'admin' is special-cased throughout the app
// (full access, can't be deleted/disabled) — don't repurpose this id.
export const DEFAULT_ROLES = [
  { id: 'admin', name: 'Admin', departments: [], isSystem: true },
  { id: 'service_manager', name: 'Service Manager', departments: ['SERVICES'], isSystem: true },
  { id: 'user', name: 'User', departments: [], isSystem: true },
]

// Idempotent: only seeds if the roles collection is completely empty, so it
// never overwrites roles an admin has already created or edited.
export async function ensureDefaultRoles(db) {
  const snap = await getDocs(collection(db, 'roles'))
  if (!snap.empty) return
  await Promise.all(DEFAULT_ROLES.map(r => setDoc(doc(db, 'roles', r.id), r)))
}
