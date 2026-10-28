// Helpers for spare-part items (the Items catalog + its Excel upload).
// A spare part is told apart by Item Name + Make + Equipment Name + Specifications/Models — the sheet has no SKU column,
// so the app gives every new item a SKU of its own (SP-00001, SP-00002 …).

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

export const itemKey = (i) => [i.name ?? i.itemName, i.make, i.equipmentName, i.specifications].map(norm).join('|')

// Next free SP-00001 style SKU, counting the SKUs already used (and any handed out earlier in the same upload).
export function makeSkuGenerator(items) {
  let max = 0
  for (const i of items) { const m = /^SP-(\d+)$/i.exec(String(i.sku || '').trim()); if (m) max = Math.max(max, parseInt(m[1], 10)) }
  return () => `SP-${String(++max).padStart(5, '0')}`
}

// "https://a/1.jpg, https://a/2.jpg" or one per line → ['https://a/1.jpg', 'https://a/2.jpg']
export const parseImages = (s) => String(s ?? '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean)

export const isHttpLink = (s) => /^https?:\/\//i.test(String(s || '').trim())
