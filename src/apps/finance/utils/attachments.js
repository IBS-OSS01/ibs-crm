// Attachments (bills, receipts, photos of items) kept in the smallest practical form.
//
// The free Firebase plan has no file storage, so files live in Firestore as small data
// URLs (one document per file, collection finance_attachments). To keep that tiny:
//   • pictures are resized and re-encoded (WebP, falling back to JPEG) to about 200 KB;
//   • a PDF up to ~450 KB is stored as it is; a larger PDF is turned into compressed
//     page pictures (first 10 pages), because a PDF can't be shrunk in the browser;
//   • anything else is refused.
import { collection, addDoc, getDocs, deleteDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'

export const MAX_DOC_CHARS = 900000          // Firestore document limit is 1 MiB; leave headroom
const IMG_TARGET = 220 * 1024
const PDF_AS_IS = 450 * 1024
const PDF_MAX_PAGES = 10

const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob) })
const approxBytes = (dataUrl) => Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)

async function canvasToSmall(canvas) {
  let best = null
  for (const q of [0.72, 0.6, 0.5, 0.4, 0.3]) {
    const url = canvas.toDataURL('image/webp', q)               // browsers without WebP silently return PNG
    const out = url.startsWith('data:image/webp') ? url : canvas.toDataURL('image/jpeg', q)
    if (!best || out.length < best.length) best = out
    if (approxBytes(out) <= IMG_TARGET) return out
  }
  return best
}

export async function compressImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  let best = null
  for (const maxDim of [1600, 1280, 1024, 800, 640]) {
    const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height)
    const url = await canvasToSmall(c)
    if (!best || url.length < best.length) best = url
    if (approxBytes(url) <= IMG_TARGET) break
  }
  bmp.close?.()
  return best
}

async function pdfToImages(file) {
  const pdfjs = await import('pdfjs-dist/build/pdf.js')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const out = []
  for (let n = 1; n <= Math.min(pdf.numPages, PDF_MAX_PAGES); n++) {
    const page = await pdf.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(2, 1100 / base.width) })
    const c = document.createElement('canvas'); c.width = Math.round(viewport.width); c.height = Math.round(viewport.height)
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    out.push(await canvasToSmall(c))
  }
  return { images: out, totalPages: pdf.numPages }
}

// → { items: [{ name, mime, data, bytes, originalBytes, group?, page?, pages? }], note }
export async function prepareFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const isImg = file.type.startsWith('image/')
  if (!isPdf && !isImg) throw new Error(`“${file.name}” is not a picture or PDF.`)
  const base = file.name.replace(/\.[^.]+$/, '')
  if (isImg) {
    const data = await compressImage(file)
    if (data.length > MAX_DOC_CHARS) throw new Error(`“${file.name}” is still too large after compression — use a smaller picture.`)
    return { items: [{ name: `${base}.${data.startsWith('data:image/webp') ? 'webp' : 'jpg'}`, mime: data.slice(5, data.indexOf(';')), data, bytes: approxBytes(data), originalBytes: file.size }], note: `${Math.round(file.size / 1024)} KB → ${Math.round(approxBytes(data) / 1024)} KB` }
  }
  if (file.size <= PDF_AS_IS) {
    const data = await toDataUrl(file)
    if (data.length > MAX_DOC_CHARS) throw new Error(`“${file.name}” is too large.`)
    return { items: [{ name: file.name, mime: 'application/pdf', data, bytes: file.size, originalBytes: file.size }], note: `PDF kept as is (${Math.round(file.size / 1024)} KB)` }
  }
  let res
  try { res = await pdfToImages(file) } catch (e) { throw new Error(`“${file.name}” is a large PDF and could not be converted (${e.message}). Attach a photo of the bill instead.`) }
  const group = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const items = res.images.map((data, i) => ({ name: `${base}-p${i + 1}.${data.startsWith('data:image/webp') ? 'webp' : 'jpg'}`, mime: data.slice(5, data.indexOf(';')), data, bytes: approxBytes(data), originalBytes: i === 0 ? file.size : 0, group, page: i + 1, pages: res.images.length }))
  if (items.some(i => i.data.length > MAX_DOC_CHARS)) throw new Error(`“${file.name}” is too detailed to shrink — attach a photo of the bill instead.`)
  return { items, note: `PDF of ${res.totalPages} page(s) turned into ${items.length} compressed picture(s), ${Math.round(file.size / 1024)} KB → ${Math.round(items.reduce((s, i) => s + i.bytes, 0) / 1024)} KB${res.totalPages > PDF_MAX_PAGES ? ` (only the first ${PDF_MAX_PAGES} pages kept)` : ''}` }
}

const COL = 'finance_attachments'
export async function listAttachments(entityType, entityId) {
  if (!entityId) return []
  const snap = await getDocs(query(collection(db, COL), where('entityType', '==', entityType), where('entityId', '==', entityId)))
  const a = []; snap.forEach(d => a.push({ id: d.id, ...d.data() }))
  return a.sort((x, y) => (x.createdAt || '').localeCompare(y.createdAt || '') || (x.page || 0) - (y.page || 0))
}
export async function uploadAttachments(items, { entityType, entityId, company, user, profile }) {
  for (const it of items) {
    await addDoc(collection(db, COL), {
      entityType, entityId, company: company || '', name: it.name, mime: it.mime, data: it.data, bytes: it.bytes, originalBytes: it.originalBytes || 0,
      ...(it.group ? { group: it.group, page: it.page, pages: it.pages } : {}),
      createdAt: new Date().toISOString(), createdBy: user?.uid || '', createdByName: profile?.name || user?.email || '',
    })
  }
}
export const deleteAttachment = (id) => deleteDoc(doc(db, COL, id))

export const dataUrlToBlobUrl = (dataUrl) => {
  const [head, b64] = dataUrl.split(',')
  const bin = atob(b64); const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([arr], { type: head.slice(5, head.indexOf(';')) }))
}
