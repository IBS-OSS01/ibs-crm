// Tests src/lib/cfBackend.js (the app's Firestore-style data layer) against the LOCAL Worker.
//   cd cloudflare && npx wrangler d1 execute ibs-data --local --file=schema.sql && npx wrangler dev --local --var DEV_AUTH:1 --port 8787
//   node scripts/test-cf-client.mjs
import { build } from '../node_modules/esbuild/lib/main.js'
import { execSync } from 'child_process'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL, fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(path.join(tmpdir(), 'cfclient-'))
const stub = path.join(dir, 'firebase-config.js')
writeFileSync(stub, `export const auth = { currentUser: { uid: 'sales1', getIdToken: async () => 'x' }, authStateReady: async () => {}, onAuthStateChanged(fn) { fn({ uid: 'sales1' }) } }`)
const out = path.join(dir, 'cfBackend.mjs')
await build({
  entryPoints: [path.join(root, 'src/lib/cfBackend.js')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  define: { 'import.meta.env': '{"VITE_API_URL":"http://127.0.0.1:8787"}' },
  plugins: [{ name: 'stub-config', setup(b) { b.onResolve({ filter: /firebase-config$/ }, () => ({ path: stub })) } }],
})

// count the requests the client makes, and identify as a signed-in user for the Worker's local test mode
const realFetch = globalThis.fetch
const calls = []
globalThis.fetch = (url, init = {}) => { calls.push(String(url).replace(/.*\/v1\//, '')); return realFetch(url, { ...init, headers: { ...(init.headers || {}), 'X-Dev-Uid': globalThis.__uid || 'sales1' } }) }
const raw = async (p, body, uid = 'sales1') => (await realFetch('http://127.0.0.1:8787/v1/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dev-Uid': uid }, body: JSON.stringify(body) })).json()

const sql = (q) => execSync(`npx wrangler d1 execute ibs-data --local --command "${q}"`, { cwd: path.join(root, 'cloudflare'), stdio: 'pipe' })
sql('DELETE FROM docs; DELETE FROM colstamp;')
sql(`INSERT INTO docs (col,id,data,v,u) VALUES ('users','sales1','{\\"role\\":\\"sales\\"}',1,1)`)

const m = await import(pathToFileURL(out).href)
let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('  ✗ ' + msg) } }
const db = {}
const listed = () => calls.filter(c => c === 'list').length

// create + read
const ref = await m.addDoc(m.collection(db, 'crm_customers'), { name: 'Acme', city: 'Pune', n: 1 })
ok(ref.id.length === 20, 'addDoc gives a 20-character id')
let snap = await m.getDocs(m.collection(db, 'crm_customers'))
ok(snap.size === 1 && snap.docs[0].id === ref.id && snap.docs[0].data().name === 'Acme', 'getDocs returns what was added')
const lists1 = listed()
snap = await m.getDocs(m.collection(db, 'crm_customers'))
ok(listed() === lists1, 'a second read of the same collection downloads nothing')

// update with server time / increment, and the local copy follows
await m.updateDoc(m.doc(db, 'crm_customers', ref.id), { n: m.increment(4), seenAt: m.serverTimestamp(), 'geo.lat': 18.5 })
const g = await m.getDoc(m.doc(db, 'crm_customers', ref.id))
ok(g.data().n === 5 && /^\d{4}-/.test(g.data().seenAt) && g.data().geo.lat === 18.5, 'updateDoc applies increment, server time and dotted paths')
snap = await m.getDocs(m.collection(db, 'crm_customers'))
ok(snap.docs[0].data().n === 5 && listed() === lists1, 'the local copy shows the update without another download')

// queries
for (const [i, c] of ['Mumbai', 'Pune', 'Delhi', 'Pune'].entries()) await m.setDoc(m.doc(db, 'crm_customers', 'c' + i), { name: 'N' + i, city: c, n: i })
let q = await m.getDocs(m.query(m.collection(db, 'crm_customers'), m.where('city', '==', 'Pune'), m.orderBy('n', 'desc')))
ok(q.size === 3 && q.docs[0].data().n === 5 && q.docs[2].data().n === 1, 'where + orderBy desc')
q = await m.getDocs(m.query(m.collection(db, 'crm_customers'), m.where('city', 'in', ['Mumbai', 'Delhi'])))
ok(q.size === 2, 'where in')
q = await m.getDocs(m.query(m.collection(db, 'crm_customers'), m.orderBy('n', 'asc'), m.limit(2)))
ok(q.size === 2 && q.docs[0].data().n === 0, 'orderBy + limit')

// batches over the per-request limit are split
const before = calls.filter(c => c === 'commit').length
const b = m.writeBatch(db)
for (let i = 0; i < 70; i++) b.set(m.doc(db, 'tasks', 't' + String(i).padStart(3, '0')), { i })
await b.commit()
ok(calls.filter(c => c === 'commit').length - before === 3 && (await m.getDocs(m.collection(db, 'tasks'))).size === 70, 'a 70-document batch goes in 3 requests and all arrive')
b.delete(m.doc(db, 'tasks', 't000')); await b.commit()
ok((await m.getDocs(m.collection(db, 'tasks'))).size === 69, 'delete through a batch')

// transactions: counter + document together, and a retry when someone else changes the counter in the middle
const counter = m.doc(db, 'finance_counters', 'UIPL_purchase_26-27')
let attempts = 0
const num = await m.runTransaction(db, async (tx) => {
  attempts++
  const s = await tx.get(counter)
  const next = s.exists() ? s.data().next : 1
  if (attempts === 1) await raw('commit', { ops: [{ t: 'set', col: 'finance_counters', id: 'UIPL_purchase_26-27', data: { next: 10 } }] })     // another user got there first
  tx.set(counter, { next: next + 1 })
  tx.set(m.doc(db, 'finance_vouchers', 'v-' + next), { number: next })
  return next
})
ok(attempts === 2 && num === 10, 'a transaction that lost a race re-reads and retries (got number 10, not 1)')
ok((await m.getDoc(counter)).data().next === 11, 'the counter moved on exactly once')

// another user's change appears (after the freshness window), with one cheap check + one download
await raw('commit', { ops: [{ t: 'set', col: 'crm_customers', id: 'theirs', data: { name: 'Theirs', city: 'Goa', n: 9 } }] }, 'sales1')
await new Promise(r => setTimeout(r, 15500))
const l0 = listed(), s0 = calls.filter(c => c === 'stamps').length
snap = await m.getDocs(m.collection(db, 'crm_customers'))
ok(snap.docs.some(d => d.id === 'theirs') && listed() - l0 === 1 && calls.filter(c => c === 'stamps').length - s0 === 1, "someone else's change is picked up: one stamp check, one download")
const l1 = listed()
await new Promise(r => setTimeout(r, 15500))
snap = await m.getDocs(m.collection(db, 'crm_customers'))
ok(listed() === l1 && snap.size === 6, 'when nothing changed the check finds out cheaply and downloads nothing')

// permission errors carry Firestore-style codes
let code = ''
try { await m.setDoc(m.doc(db, 'finance_accounts', 'a1'), { code: '1000' }) } catch (e) { code = e.code }
ok(code === 'permission-denied', 'a refused write throws with code permission-denied')

// onSnapshot: first snapshot, then local writes notify
const seen = []
const unsub = m.onSnapshot(m.query(m.collection(db, 'crm_customers'), m.where('city', '==', 'Goa')), s => seen.push(s.size))
await new Promise(r => setTimeout(r, 400))
await m.setDoc(m.doc(db, 'crm_customers', 'g2'), { city: 'Goa' })
await new Promise(r => setTimeout(r, 400))
unsub()
ok(seen[0] === 1 && seen[seen.length - 1] === 2, 'onSnapshot reports the first result and then your own changes')

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
