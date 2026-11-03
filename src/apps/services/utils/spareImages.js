// Photos of spare parts. Each picture is shrunk in the browser before it is saved (longest side 800 px or less, about 60 KB),
// a tiny 120 px thumbnail is kept with it for the tables, and at most 5 pictures are kept per item.
// The pictures are stored as small documents in finance_attachments (entityType 'spare_item') — the same store the Finance
// bills use — so the item records themselves stay light; the item only carries `thumb` (first picture) and `imageCount`.
import { addDoc, collection, deleteDoc, doc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { compressImage, listAttachments } from '../../finance/utils/attachments'

export const MAX_IMAGES = 5
export const ENTITY = 'spare_item'
const PHOTO = { dims: [800, 640, 512, 400], target: 60 * 1024 }

const approxBytes = (dataUrl) => Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)

async function makeThumb(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, 120 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  const url = c.toDataURL('image/webp', 0.6)
  return url.startsWith('data:image/webp') ? url : c.toDataURL('image/jpeg', 0.6)
}

// File → { name, mime, data, bytes, originalBytes, thumb }
export async function prepareSpareImage(file) {
  if (!file.type.startsWith('image/')) throw new Error(`“${file.name}” is not a picture.`)
  const data = await compressImage(file, PHOTO)
  const thumb = await makeThumb(file)
  const ext = data.startsWith('data:image/webp') ? 'webp' : 'jpg'
  return { name: `${file.name.replace(/\.[^.]+$/, '')}.${ext}`, mime: data.slice(5, data.indexOf(';')), data, bytes: approxBytes(data), originalBytes: file.size, thumb }
}

export const listSpareImages = (itemId) => listAttachments(ENTITY, itemId)

export async function saveSpareImages(itemId, images, { user, profile } = {}) {
  const base = Date.now()
  for (let n = 0; n < images.length; n++) {
    const it = images[n]
    await addDoc(collection(db, 'finance_attachments'), {
      entityType: ENTITY, entityId: itemId, company: '', name: it.name, mime: it.mime, data: it.data, thumb: it.thumb || '', bytes: it.bytes, originalBytes: it.originalBytes || 0,
      createdAt: new Date(base + n).toISOString(), createdBy: user?.uid || '', createdByName: profile?.name || user?.email || '',
    })
  }
}

export const deleteSpareImage = (id) => deleteDoc(doc(db, 'finance_attachments', id))

export const kb = (n) => `${Math.max(1, Math.round((n || 0) / 1024))} KB`
