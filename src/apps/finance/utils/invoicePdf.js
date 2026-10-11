// A4 tax-invoice PDF built in the browser (text, not a picture), with an empty digital-signature field at the signatory box.
// The PDF can be signed with a DSC (USB token or certificate) in Adobe Acrobat / Reader — or any PDF signer — and then shared;
// the signature field is already positioned where "Authorised Signatory" goes. pdf-lib is loaded on demand.
//
// Standard PDF fonts can only print Latin-1, so the rupee sign is written "Rs." and anything else outside Latin-1 becomes "?".
const A4 = [595.28, 841.89]
const M = 36                                           // page margin

const clean = (s) => String(s ?? '').replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\r/g, '').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?')
const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function buildInvoicePdf({ inv, items, seller = {}, gstLines = [], subTotal, roundOff = 0, total, typeLabel = 'Tax Invoice', totalInWords = '', symbol = 'Rs.' }) {
  const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(`${typeLabel} ${inv.invoiceNumber || ''}`); doc.setProducer('India Business Suite'); doc.setCreator(seller.legalName || inv.company || '')
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const blue = rgb(0.10, 0.34, 0.86), grey = rgb(0.4, 0.4, 0.4), line = rgb(0.8, 0.8, 0.8)

  let page = doc.addPage(A4), y = A4[1] - M
  const W = A4[0] - 2 * M
  const text = (t, x, yy, { size = 9, f = font, color = rgb(0.1, 0.1, 0.1), align = 'left', maxW } = {}) => {
    const s = clean(t); const w = f.widthOfTextAtSize(s, size)
    page.drawText(s, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: yy, size, font: f, color, ...(maxW ? { maxWidth: maxW } : {}) })
  }
  const wrap = (t, maxW, size = 9, f = font) => {                  // greedy word wrap
    const out = []; for (const para of clean(t).split('\n')) {
      let cur = ''; for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = cur ? `${cur} ${word}` : word
        if (f.widthOfTextAtSize(test, size) > maxW && cur) { out.push(cur); cur = word } else cur = test
      }
      out.push(cur)
    } return out
  }
  const hr = (yy, color = line, x1 = M, x2 = A4[0] - M, th = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color })

  // ── header
  text(seller.legalName || inv.company || '', M, y - 14, { size: 15, f: bold, color: blue })
  let ly = y - 28
  const sellerAddr = [seller.address, seller.city, seller.state, seller.pincode].filter(Boolean).join(', ')
  for (const l of wrap(sellerAddr, 290, 9)) { text(l, M, ly, { color: grey }); ly -= 11 }
  if (seller.gstin) { text(`GSTIN: ${seller.gstin}`, M, ly, { f: bold }); ly -= 11 }
  if (seller.companyId) { text(`CIN: ${seller.companyId}`, M, ly, { color: grey }); ly -= 11 }
  if (seller.phone || seller.email) { text([seller.phone, seller.email].filter(Boolean).join('  |  '), M, ly, { color: grey }); ly -= 11 }
  text(typeLabel.toUpperCase(), A4[0] - M, y - 14, { size: 17, f: bold, color: blue, align: 'right' })
  let ry = y - 30
  for (const [k, v] of [['Invoice #', inv.invoiceNumber], ['Date', inv.invoiceDate], inv.poNumber ? ['P.O. #', inv.poNumber] : null, ['Terms', inv.terms], ['Due date', inv.dueDate]].filter(Boolean)) {
    text(`${k}:  ${v || '-'}`, A4[0] - M, ry, { align: 'right' }); ry -= 12
  }
  y = Math.min(ly, ry) - 6; hr(y, blue, M, A4[0] - M, 1.4); y -= 16

  // ── bill to / ship to
  const addr = (name, a, c, s, p, gst) => [name, [a, c, s, p].filter(Boolean).join(', '), gst ? `GSTIN: ${gst}` : ''].filter(Boolean)
  const bill = addr(inv.billToName, inv.billToAddress, inv.billToCity, inv.billToState, inv.billToPincode, inv.billToGstin)
  const ship = inv.sameShipTo !== false ? bill : addr(inv.shipToName || inv.billToName, inv.shipToAddress, inv.shipToCity, inv.shipToState, inv.shipToPincode, inv.shipToGstin)
  const half = (W - 20) / 2
  const block = (title, lines, x) => { let yy = y; text(title, x, yy, { size: 8, f: bold, color: blue }); yy -= 12; lines.forEach((l, i) => { for (const w of wrap(l, half, 9, i === 0 ? bold : font)) { text(w, x, yy, { f: i === 0 ? bold : font }); yy -= 11 } }); return yy }
  const yb = block('BILL TO', bill, M), ys = block('SHIP TO', ship, M + half + 20)
  y = Math.min(yb, ys) - 4
  if (inv.posState) { text(`Place of supply: ${inv.posState}${inv.posStateCode ? ` (${inv.posStateCode})` : ''}`, M, y, { f: bold }); y -= 14 }

  // ── items
  const cols = { n: M, desc: M + 20, qty: M + W - 205, rate: M + W - 100, amt: M + W }          // right edges for qty / rate / amt
  const header = () => {
    page.drawRectangle({ x: M, y: y - 4, width: W, height: 16, color: rgb(0.94, 0.96, 1) })
    text('#', cols.n + 2, y, { size: 8, f: bold }); text('Item & description', cols.desc, y, { size: 8, f: bold })
    text('Qty', cols.qty, y, { size: 8, f: bold, align: 'right' }); text('Rate', cols.rate, y, { size: 8, f: bold, align: 'right' }); text('Amount', cols.amt - 2, y, { size: 8, f: bold, align: 'right' })
    y -= 18
  }
  const newPage = () => { page = doc.addPage(A4); y = A4[1] - M; header() }
  header()
  items.forEach((it, i) => {
    const desc = wrap(it.description || '', cols.qty - cols.desc - 50, 9)
    const sub = it.hsnCode ? `HSN/SAC: ${it.hsnCode}${it.gstRate ? `   GST ${it.gstRate}%` : ''}` : (it.gstRate ? `GST ${it.gstRate}%` : '')
    const h = desc.length * 11 + (sub ? 10 : 0) + 6
    if (y - h < 190) newPage()
    const amt = (Number(it.qty) || 0) * (Number(it.rate) || 0)
    text(String(i + 1), cols.n + 2, y); desc.forEach((d, k) => text(d, cols.desc, y - k * 11))
    if (sub) text(sub, cols.desc, y - desc.length * 11, { size: 7.5, color: grey })
    text(`${it.qty} ${it.unit || ''}`.trim(), cols.qty, y, { align: 'right' }); text(money(it.rate), cols.rate, y, { align: 'right' }); text(money(amt), cols.amt - 2, y, { align: 'right' })
    y -= h; hr(y + 3, rgb(0.92, 0.92, 0.92))
  })

  // ── totals
  if (y < 230) newPage()
  const tot = (label, val, { b = false, line: ln = false } = {}) => { if (ln) hr(y + 10, blue, M + W - 220, M + W, 1); text(label, M + W - 120, y, { f: b ? bold : font, size: b ? 11 : 9, align: 'right' }); text(val, M + W - 2, y, { f: b ? bold : font, size: b ? 11 : 9, align: 'right' }); y -= b ? 16 : 13 }
  y -= 4; tot('Sub total', money(subTotal))
  gstLines.forEach(g => tot(`${g.label}`, money(g.amount)))
  if (Math.abs(roundOff) > 0.004) tot('Rounding', money(roundOff))
  tot(`Total (${symbol})`, `${symbol} ${money(total)}`, { b: true, line: true })
  y -= 2
  for (const l of wrap(`Total in words: ${totalInWords}`, W, 9, font)) { text(l, M, y, { color: grey }); y -= 11 }
  if (inv.isExport) { for (const l of wrap(`Export supply ${inv.exportType === 'WOPAY' ? 'under Letter of Undertaking (LUT) without payment of IGST' : 'with payment of IGST'}`, W, 8)) { text(l, M, y, { color: grey }); y -= 10 } }

  // ── terms & bank (left), signatory (right)
  const footTop = Math.min(y - 14, 215)
  let fy = footTop
  if (inv.termsAndConditions) { text('Terms & conditions', M, fy, { size: 8, f: bold }); fy -= 10; for (const l of wrap(inv.termsAndConditions, 300, 7.5).slice(0, 9)) { text(l, M, fy, { size: 7.5, color: grey }); fy -= 9 } fy -= 4 }
  if (seller.bankAccount) { for (const l of wrap(`Bank: ${seller.bankName || ''}  |  A/C ${seller.bankAccount}  |  IFSC ${seller.ifsc || ''}`, 300, 8)) { text(l, M, fy, { size: 8 }); fy -= 10 } }
  const bx = A4[0] - M - 190, bw = 190, bh = 74, by = Math.max(60, Math.min(fy, footTop) - bh + 20)
  page.drawRectangle({ x: bx, y: by, width: bw, height: bh, borderColor: line, borderWidth: 0.8 })
  text(`For ${seller.legalName || inv.company || ''}`, bx + bw / 2, by + bh - 12, { size: 8, f: bold, align: 'center' })
  text('Authorised Signatory', bx + bw / 2, by + 6, { size: 8, color: grey, align: 'center' })

  // ── the digital-signature field inside that box
  const ctx = doc.context
  const sig = ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('AuthorisedSignatory'), Rect: [bx + 6, by + 18, bx + bw - 6, by + bh - 18], F: 4, P: page.ref })
  const sigRef = ctx.register(sig)
  const annots = page.node.lookup(PDFName.of('Annots'))
  if (annots) annots.push(sigRef); else page.node.set(PDFName.of('Annots'), ctx.obj([sigRef]))
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [sigRef], SigFlags: 3 }))

  // page footer
  doc.getPages().forEach((p, i, all) => p.drawText(`${clean(inv.invoiceNumber || '')}  -  page ${i + 1} of ${all.length}`, { x: A4[0] / 2 - 40, y: 18, size: 7, font, color: grey }))
  return doc.save()
}

export function downloadPdf(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a'); a.href = url; a.download = name.replace(/[\\/:*?"<>|]+/g, '-'); document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
