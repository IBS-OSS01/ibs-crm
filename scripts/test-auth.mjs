// Tests the Worker's own sign-in against a LOCAL Worker + D1 (see test-cloudflare.mjs for how to start it; the Worker needs SESSION_SECRET=test-secret).
//   node scripts/test-auth.mjs
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

const BASE = process.env.API || 'http://127.0.0.1:8787'
const cfDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cloudflare')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m) } }
const post = async (p, body, token) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}) })
  return { status: r.status, body: await r.json() }
}
const sql = (q) => execSync(`npx wrangler d1 execute ibs-data --local --command "${q}"`, { cwd: cfDir, stdio: 'pipe' })

sql('DELETE FROM accounts; DELETE FROM docs; DELETE FROM colstamp;')
sql(`INSERT INTO docs (col,id,data,v,u) VALUES ('users','admin1','{\\"role\\":\\"admin\\",\\"email\\":\\"boss@x.com\\"}',1,1)`)
sql(`INSERT INTO accounts (email, uid, created) VALUES ('boss@x.com','admin1',1)`)

// no password yet → cannot sign in
ok((await post('/v1/auth/login', { email: 'boss@x.com', password: 'whatever1' })).status === 401, 'account without a password cannot sign in')

// the first admin's setup link is seeded by SQL (as it is in real life); everyone after that is invited by an admin
let tok = null
{
  sql(`UPDATE accounts SET setup_hash = '${createHash('sha256').update('seed-token').digest('hex')}', setup_exp = ${Date.now() + 86400000} WHERE email='boss@x.com'`)
  const weak = await post('/v1/auth/setup', { token: 'seed-token', password: 'short' })
  ok(weak.status === 400 && weak.body.error.code === 'weak-password', 'setup: short password refused')
  const bad = await post('/v1/auth/setup', { token: 'nope', password: 'longenough1' })
  ok(bad.status === 400 && bad.body.error.code === 'invalid-link', 'setup: wrong token refused')
  const good = await post('/v1/auth/setup', { token: 'seed-token', password: 'correct horse 1' })
  ok(good.status === 200 && good.body.token && good.body.uid === 'admin1', 'setup: password set, signed in')
  ok((await post('/v1/auth/setup', { token: 'seed-token', password: 'another one 22' })).status === 400, 'setup: link works only once')
}

// sign in
ok((await post('/v1/auth/login', { email: 'boss@x.com', password: 'wrong password' })).status === 401, 'login: wrong password → 401')
const li = await post('/v1/auth/login', { email: 'BOSS@x.com ', password: 'correct horse 1' })
ok(li.status === 200 && li.body.token, 'login: right password (email case/space-insensitive)')
tok = li.body.token

// data calls need a valid token
const list = await post('/v1/list', { col: 'users' }, tok)
ok(list.status === 200 && list.body.docs?.length === 1, 'data: valid token reads users')
ok((await post('/v1/list', { col: 'users' }, tok.slice(0, -3) + 'abc')).status === 401, 'data: tampered token → 401')
ok((await post('/v1/list', { col: 'users' }, 'junk')).status === 401, 'data: junk token → 401')
ok((await post('/v1/list', { col: 'users' })).status === 403, 'data: no token → denied')
ok(!!(await post('/v1/auth/refresh', {}, tok)).body.token, 'refresh gives a new token')

// admin creates a person with a setup link, who then signs in and cannot do admin things
const inv = await post('/v1/auth/admin/invite', { email: 'Sales@x.com' }, tok)
ok(inv.status === 200 && inv.body.setupToken && inv.body.uid, 'admin: invite returns uid and a setup token')
sql(`INSERT INTO docs (col,id,data,v,u) VALUES ('users','${inv.body.uid}','{\\"role\\":\\"sales\\",\\"email\\":\\"sales@x.com\\"}',1,1)`)
const su = await post('/v1/auth/setup', { token: inv.body.setupToken, password: 'sales password 1' })
ok(su.status === 200 && su.body.email === 'sales@x.com', 'invited person sets a password and is in')
ok((await post('/v1/auth/admin/invite', { email: 'x@x.com' }, su.body.token)).status === 403, 'non-admin cannot invite')
ok((await post('/v1/auth/admin/invite', { email: 'x@x.com' })).status === 403, 'nobody-signed-in cannot invite')
const direct = await post('/v1/auth/admin/invite', { email: 'direct@x.com', password: 'direct password 1' }, tok)
ok(direct.status === 200 && !direct.body.setupToken, 'admin: invite with a password sets it directly')
ok((await post('/v1/auth/admin/invite', { email: 'sales@x.com', uid: 'someone-else' }, tok)).status === 409, 'admin: email already tied to another person → 409')

// change own password
ok((await post('/v1/auth/change', { old: 'bad', password: 'brand new pass 1' }, su.body.token)).status === 400, 'change: wrong current password refused')
ok((await post('/v1/auth/change', { old: 'sales password 1', password: 'brand new pass 1' }, su.body.token)).status === 200, 'change: own password changed')
ok((await post('/v1/auth/login', { email: 'sales@x.com', password: 'sales password 1' })).status === 401, 'change: old password no longer works')
ok((await post('/v1/auth/login', { email: 'sales@x.com', password: 'brand new pass 1' })).status === 200, 'change: new password works')

// login email change keeps the password
ok((await post('/v1/auth/admin/email', { uid: inv.body.uid, email: 'sales2@x.com' }, tok)).status === 200, 'admin: login email changed')
ok((await post('/v1/auth/login', { email: 'sales2@x.com', password: 'brand new pass 1' })).status === 200, 'new login email works with the same password')
ok((await post('/v1/auth/login', { email: 'sales@x.com', password: 'brand new pass 1' })).status === 401, 'old login email stops working')

// switching a person off blocks sign-in, refresh and data
sql(`UPDATE docs SET data = '{\\"role\\":\\"sales\\",\\"active\\":false}' WHERE col='users' AND id='${inv.body.uid}'`)
const dis = await post('/v1/auth/login', { email: 'sales2@x.com', password: 'brand new pass 1' })
ok(dis.status === 403 && dis.body.error.code === 'account-disabled', 'disabled person cannot sign in')
ok((await post('/v1/auth/refresh', {}, su.body.token)).status === 403, 'disabled person cannot refresh')
ok((await post('/v1/list', { col: 'crm_customers' }, su.body.token)).status === 403, 'disabled person cannot read data')

// lock-out after repeated wrong passwords
for (let i = 0; i < 5; i++) await post('/v1/auth/login', { email: 'direct@x.com', password: 'nope nope nope' })
const locked = await post('/v1/auth/login', { email: 'direct@x.com', password: 'direct password 1' })
ok(locked.status === 429, 'five wrong passwords lock the account')

// remove a login
ok((await post('/v1/auth/admin/remove', { uid: inv.body.uid }, tok)).status === 200, 'admin: login removed')
ok((await post('/v1/auth/refresh', {}, su.body.token)).status === 401, 'removed login cannot refresh (→ 401, app signs out)')

console.log(fail ? `\n❌ ${pass} passed, ${fail} failed` : `\n✅ ${pass} passed, 0 failed`)
process.exit(fail ? 1 : 0)
