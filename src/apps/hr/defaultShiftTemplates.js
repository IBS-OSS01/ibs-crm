import { doc, getDocs, collection, setDoc } from 'firebase/firestore'

// Starting shift templates — seeded once so there's something to assign on
// day one. Admins can add/edit/delete more from HR > Shifts.
export const DEFAULT_SHIFT_TEMPLATES = [
  { id: 'general', name: 'General', startTime: '09:00', endTime: '18:00', isSystem: true },
  { id: 'morning', name: 'Morning', startTime: '06:00', endTime: '14:00', isSystem: true },
  { id: 'night',   name: 'Night',   startTime: '22:00', endTime: '06:00', isSystem: true },
]

// Idempotent: only seeds if the collection is completely empty, so it never
// overwrites templates an admin has already added or edited.
export async function ensureDefaultShiftTemplates(db) {
  const snap = await getDocs(collection(db, 'hr_shift_templates'))
  if (!snap.empty) return
  await Promise.all(DEFAULT_SHIFT_TEMPLATES.map(t => setDoc(doc(db, 'hr_shift_templates', t.id), t)))
}
