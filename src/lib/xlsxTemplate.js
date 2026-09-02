import * as XLSX from 'xlsx'

// Builds a one-sheet .xlsx workbook from a header row + data rows and
// triggers a browser download. Used for downloadable bulk-upload templates.
export function downloadXlsxTemplate(filename, headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = headers.map(h => ({ wch: Math.max(12, String(h).length + 4) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Template')
  XLSX.writeFile(wb, filename)
}

// Reads the first sheet of an uploaded .xlsx/.xls File and returns
// { headers, rows } — rows are objects keyed by the header row, mirroring
// what a CSV parser would produce. All cell values are coerced to trimmed
// strings so downstream parsing (parseInt etc.) stays consistent regardless
// of whether Excel stored a cell as text or a number.
export function parseXlsxFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows2d = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
        if (!rows2d.length) { resolve({ headers: [], rows: [] }); return }
        const headers = (rows2d[0] || []).map(h => String(h ?? '').trim())
        const rows = rows2d.slice(1)
          .map(r => {
            const row = {}
            headers.forEach((h, i) => { row[h] = String(r[i] ?? '').trim() })
            return row
          })
          .filter(r => Object.values(r).some(v => v))
        resolve({ headers, rows })
      } catch (e) { reject(e) }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}
