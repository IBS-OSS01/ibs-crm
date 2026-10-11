// Keeps the original bank-statement file (PDF / Excel / CSV) that was imported, so it can be downloaded again later
// to confirm any line. The free Firebase plan has no file storage, so the file is stored untouched in Firestore:
// a small index record in finance_bank_statement_files plus the file's bytes, cut into ~700 KB base64 chunks
// (a Firestore document is limited to 1 MiB) in finance_attachments.
import { addDoc, collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'

const META = 'finance_bank_statement_files'
const CHUNKS = 'finance_attachments'
const TYPE = 'bank_statement_file'
const CHUNK_CHARS = 700000
export const MAX_STATEMENT_BYTES = 8 * 1024 * 1024

const toBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).slice(String(r.result).indexOf(',') + 1))
  r.onerror = rej
  r.readAsDataURL(file)
})

export async function saveStatementFile(file, { company, bankAccountId, bankName, from, to, lineCount, user }) {
  if (file.size > MAX_STATEMENT_BYTES) throw new Error(`“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB — too large to keep a copy (limit ${MAX_STATEMENT_BYTES / 1048576} MB).`)
  const b64 = await toBase64(file)
  const metaRef = doc(collection(db, META))
  const n = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS))
  for (let i = 0; i < n; i++) {
    await addDoc(collection(db, CHUNKS), {
      entityType: TYPE, entityId: metaRef.id, chunk: i, chunks: n, name: file.name, mime: file.type || 'application/octet-stream',
      data: b64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS), company, createdAt: new Date().toISOString(),
    })
  }
  await setDoc(metaRef, {
    company, bankAccountId: bankAccountId || '', bankName: bankName || '', fileName: file.name, mime: file.type || 'application/octet-stream', size: file.size, chunks: n,
    from: from || '', to: to || '', lineCount: lineCount || 0, importedAt: new Date().toISOString(), importedBy: user?.uid || '', importedByName: user?.email || '',
  })
  return metaRef.id
}

export async function listStatementFiles(company) {
  const snap = await getDocs(query(collection(db, META), where('company', '==', company)))
  const out = []; snap.forEach(d => out.push({ id: d.id, ...d.data() }))
  return out.sort((a, b) => (b.importedAt || '').localeCompare(a.importedAt || ''))
}

async function fetchChunks(id) {
  const snap = await getDocs(query(collection(db, CHUNKS), where('entityType', '==', TYPE), where('entityId', '==', id)))
  const parts = []; snap.forEach(d => parts.push(d.data()))
  return parts.sort((a, b) => a.chunk - b.chunk)
}

// Re-assembles the original file and hands it to the browser as a download.
export async function downloadStatementFile(meta) {
  const parts = await fetchChunks(meta.id)
  if (!parts.length || parts.length !== (meta.chunks || parts.length)) throw new Error('The stored copy is incomplete.')
  const bin = atob(parts.map(p => p.data).join(''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: meta.mime || 'application/octet-stream' }))
  const a = document.createElement('a'); a.href = url; a.download = meta.fileName; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function deleteStatementFile(meta) {
  const snap = await getDocs(query(collection(db, CHUNKS), where('entityType', '==', TYPE), where('entityId', '==', meta.id)))
  for (const d of snap.docs) await deleteDoc(d.ref)
  await deleteDoc(doc(db, META, meta.id))
}
