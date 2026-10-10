// Excel / CSV / Print helpers shared by every report. Rows are arrays of cells
// (first row = header). Numbers stay numbers in Excel so the accountant can sum
// columns without cleaning the data first.
import * as XLSX from 'xlsx'

const safeName = (s) => (s || 'report').replace(/[^\w\-]+/g, '_')

export function downloadXlsx(filename, sheets) {
  const wb = XLSX.utils.book_new()
  sheets.forEach(({ name, rows, colWidths }) => {
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = (colWidths || rows[0] || []).map(w => ({ wch: typeof w === 'number' ? w : Math.min(Math.max(String(w ?? '').length + 4, 10), 40) }))
    XLSX.utils.book_append_sheet(wb, ws, (name || 'Sheet1').slice(0, 31))
  })
  XLSX.writeFile(wb, `${safeName(filename)}.xlsx`)
}

export function downloadCsv(filename, rows) {
  const esc = (c) => {
    const s = c == null ? '' : String(c)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${safeName(filename)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${safeName(filename)}.json`; a.click()
  URL.revokeObjectURL(url)
}

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Opens a print-ready HTML table (the browser's "Save as PDF" does the rest —
// same approach as invoices, no PDF library).
export function printReport({ title, subtitle = '', rows, rightAlignFrom = 1 }) {
  const [head, ...body] = rows
  const cell = (c, i, tag) => {
    const isNum = typeof c === 'number'
    const txt = isNum ? c.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : escHtml(c)
    return `<${tag} style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:${isNum || i >= rightAlignFrom && /^[\d,.\-₹ ]+(Dr|Cr)?$/.test(String(c)) ? 'right' : 'left'};${tag === 'th' ? 'background:#f1f5f9;font-size:11px;text-transform:uppercase;' : ''}">${txt}</${tag}>`
  }
  const html = `<!DOCTYPE html><html><head><title>${escHtml(title)}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:18px}h2{margin:0 0 2px}p{margin:0 0 12px;color:#555}table{width:100%;border-collapse:collapse}@media print{body{padding:6px}}</style></head>
  <body><h2>${escHtml(title)}</h2><p>${escHtml(subtitle)}</p>
  <table><thead><tr>${head.map((c, i) => cell(c, i, 'th')).join('')}</tr></thead>
  <tbody>${body.map(r => `<tr>${r.map((c, i) => cell(c, i, 'td')).join('')}</tr>`).join('')}</tbody></table></body></html>`
  const w = window.open('', '_blank', 'width=1000,height=800')
  if (!w) { alert('The print window was blocked by your browser — allow pop-ups for this site and try again.'); return }
  w.document.write(html); w.document.close()
  setTimeout(() => w.print(), 400)
}
