// Shared India-specific constants used across Finance pages

export const INDIA_STATES = [
  { name: 'Andhra Pradesh',           code: '28' },
  { name: 'Arunachal Pradesh',        code: '12' },
  { name: 'Assam',                    code: '18' },
  { name: 'Bihar',                    code: '10' },
  { name: 'Chhattisgarh',             code: '22' },
  { name: 'Goa',                      code: '30' },
  { name: 'Gujarat',                  code: '24' },
  { name: 'Haryana',                  code: '06' },
  { name: 'Himachal Pradesh',         code: '02' },
  { name: 'Jharkhand',                code: '20' },
  { name: 'Karnataka',                code: '29' },
  { name: 'Kerala',                   code: '32' },
  { name: 'Madhya Pradesh',           code: '23' },
  { name: 'Maharashtra',              code: '27' },
  { name: 'Manipur',                  code: '14' },
  { name: 'Meghalaya',                code: '17' },
  { name: 'Mizoram',                  code: '15' },
  { name: 'Nagaland',                 code: '13' },
  { name: 'Odisha',                   code: '21' },
  { name: 'Punjab',                   code: '03' },
  { name: 'Rajasthan',                code: '08' },
  { name: 'Sikkim',                   code: '11' },
  { name: 'Tamil Nadu',               code: '33' },
  { name: 'Telangana',                code: '36' },
  { name: 'Tripura',                  code: '16' },
  { name: 'Uttar Pradesh',            code: '09' },
  { name: 'Uttarakhand',              code: '05' },
  { name: 'West Bengal',              code: '19' },
  { name: 'Andaman & Nicobar',        code: '35' },
  { name: 'Chandigarh',               code: '04' },
  { name: 'Dadra & Nagar Haveli',     code: '26' },
  { name: 'Delhi',                    code: '07' },
  { name: 'Jammu & Kashmir',          code: '01' },
  { name: 'Ladakh',                   code: '38' },
  { name: 'Lakshadweep',              code: '31' },
  { name: 'Puducherry',               code: '34' },
]

// Given a state name, return "Name (code)" label
export const stateLabel = (name) => {
  const s = INDIA_STATES.find(x => x.name === name)
  return s ? `${s.name} (${s.code})` : name || ''
}

// Given a GSTIN, extract state code (first 2 chars)
export const gstinToStateCode = (gstin) => (gstin || '').slice(0, 2)

// Given a GSTIN, look up state name
export const gstinToState = (gstin) => {
  const code = gstinToStateCode(gstin)
  return INDIA_STATES.find(s => s.code === code)?.name || ''
}

// Indian number system: amount → words
export function amountInWords(amount) {
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
    'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ]
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  const two = (n) => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
  const three = (n) => n < 100 ? two(n) : ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '')

  const n = Math.floor(amount)
  const paise = Math.round((amount - n) * 100)
  if (n === 0 && paise === 0) return 'Indian Rupee Zero Only'

  const crore   = Math.floor(n / 10000000)
  const lakh    = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const rest    = n % 1000

  let w = ''
  if (crore)    w += three(crore) + ' Crore '
  if (lakh)     w += two(lakh) + ' Lakh '
  if (thousand) w += two(thousand) + ' Thousand '
  if (rest)     w += three(rest)
  w = w.trim()
  if (paise)    w += ' and ' + two(paise) + ' Paise'
  return 'Indian Rupee ' + w + ' Only'
}

// Determine GST type: intra-state → CGST+SGST, inter-state → IGST
export const gstType = (sellerStateCode, posStateCode) => {
  if (!posStateCode || !sellerStateCode) return 'IGST'
  return sellerStateCode === posStateCode ? 'INTRA' : 'IGST'
}
