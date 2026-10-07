import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { verifyAccess, resetAccessCache, accessConfig } from '../functions/_shared/access.js';
import * as apiGuard from '../functions/api/admin/_middleware.js';
import * as pageGuard from '../functions/admin/_middleware.js';
import * as admin from '../functions/api/admin/scores.js';
import * as root from '../functions/index.js';

const migration = readFileSync(new URL('../migrations/0001_create_scores.sql', import.meta.url), 'utf8');
const ISSUER = 'https://pini.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const ADMIN = 'admin@example.com';
const ENV = { ACCESS_TEAM_DOMAIN: 'pini', ACCESS_AUD: AUD, ADMIN_EMAILS: `other@example.com, ${ADMIN.toUpperCase()}` };
const now = () => Math.floor(Date.now() / 1000);

const pair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const strangerPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256' };

const b64url = bytes => Buffer.from(bytes).toString('base64url');
async function sign(claims, { key = pair.privateKey, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' } } = {}) {
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(signature))}`;
}
const claims = (extra = {}) => ({ iss: ISSUER, aud: [AUD], email: ADMIN, iat: now(), nbf: now(), exp: now() + 3600, ...extra });

let certFetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  assert.equal(String(url), `${ISSUER}/cdn-cgi/access/certs`);
  certFetches++;
  return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
};
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { resetAccessCache(); certFetches = 0; });

const request = (token, { url = 'https://admin.semina.be/api/admin/scores', cookie = false, ...init } = {}) => {
  const headers = new Headers(init.headers);
  if (token) headers.set(cookie ? 'cookie' : 'cf-access-jwt-assertion', cookie ? `x=1; CF_Authorization=${token}` : token);
  return new Request(url, { ...init, headers });
};

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  return {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) { params = values; return statement; },
        async all() { return { results: db.prepare(sql).all(...params).map(row => ({ ...row })) }; },
        async first() { const row = db.prepare(sql).get(...params); return row ? { ...row } : null; },
        async run() {
          const info = db.prepare(sql).run(...params);
          return { meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes } };
        },
      };
      return statement;
    },
    seed(rows) { for (const [name, score, category] of rows) db.prepare('INSERT INTO scores (name, score, category) VALUES (?, ?, ?)').run(name, score, category); },
  };
}

test('a valid Access token for an admin email is accepted, from the header or the cookie', async () => {
  const token = await sign(claims());
  assert.equal(await verifyAccess(request(token), ENV), ADMIN);
  assert.equal(await verifyAccess(request(token, { cookie: true }), ENV), ADMIN);
  assert.equal(certFetches, 1, 'signing keys are cached');
});

test('missing configuration keeps the admin closed', async () => {
  const token = await sign(claims());
  for (const key of Object.keys(ENV)) {
    const env = { ...ENV, [key]: '' };
    await assert.rejects(verifyAccess(request(token), env), { status: 503 }, key);
  }
  assert.equal(accessConfig({ ...ENV, ACCESS_TEAM_DOMAIN: 'https://pini.cloudflareaccess.com/' }).issuer, ISSUER);
});

test('bad tokens are rejected', async () => {
  const cases = {
    'no token': '',
    'garbage': 'not-a-jwt',
    'wrong email': await sign(claims({ email: 'someone@else.com' })),
    'no email (service token)': await sign(claims({ email: undefined })),
    'wrong audience': await sign(claims({ aud: ['another-app'] })),
    'wrong issuer': await sign(claims({ iss: 'https://evil.cloudflareaccess.com' })),
    'expired': await sign(claims({ exp: now() - 3600 })),
    'not yet valid': await sign(claims({ nbf: now() + 3600 })),
    'unknown key id': await sign(claims(), { header: { alg: 'RS256', kid: 'k2' } }),
    'alg none': await sign(claims(), { header: { alg: 'none', kid: 'k1' } }),
    'forged signature': await sign(claims(), { key: strangerPair.privateKey }),
  };
  const [head, , signature] = (await sign(claims({ email: 'someone@else.com' }))).split('.');
  cases['tampered payload'] = `${head}.${b64url(JSON.stringify(claims()))}.${signature}`;
  for (const [name, token] of Object.entries(cases)) {
    await assert.rejects(verifyAccess(request(token), ENV), { status: 403 }, name);
  }
});

test('the admin API middleware blocks requests without a valid token', async () => {
  let reached = false;
  const next = async () => { reached = true; return new Response('ok'); };
  const denied = await apiGuard.onRequest({ request: request(''), env: ENV, data: {}, next });
  assert.equal(denied.status, 403);
  assert.equal(reached, false);
  const data = {};
  const allowed = await apiGuard.onRequest({ request: request(await sign(claims())), env: ENV, data, next });
  assert.equal(allowed.status, 200);
  assert.equal(data.adminEmail, ADMIN);
});

test('the dashboard page is guarded too', async () => {
  const next = async () => new Response('<html>', { headers: { 'cache-control': 'public, max-age=600' } });
  const url = 'https://semina.be/admin/';
  assert.equal((await pageGuard.onRequest({ request: request('', { url }), env: ENV, data: {}, next })).status, 403);
  const page = await pageGuard.onRequest({ request: request(await sign(claims()), { url }), env: ENV, data: {}, next });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
});

test('admins see every global board and can clear one or all of them', async () => {
  const DB = fakeD1();
  DB.seed([['Alpha', 900, 'arcade-falling'], ['Bravo', 1200, 'arcade-falling'], ['Cee', 300, 'arcade-stationary']]);
  const env = { ...ENV, DB };
  const listed = await (await admin.onRequestGet({ env, data: { adminEmail: ADMIN } })).json();
  assert.equal(listed.admin, ADMIN);
  assert.deepEqual(listed.boards.map(board => [board.category, board.total, board.scores.map(row => row.name)]),
    [['arcade-falling', 2, ['Bravo', 'Alpha']], ['arcade-stationary', 1, ['Cee']]]);

  const del = query => admin.onRequestDelete({ env, request: new Request(`https://admin.semina.be/api/admin/scores${query}`, { method: 'DELETE' }) });
  assert.equal((await del('?category=zen-falling')).status, 400);
  assert.equal((await del('')).status, 400);
  assert.deepEqual(await (await del('?category=arcade-falling')).json(), { category: 'arcade-falling', deleted: 2 });
  const after = await (await admin.onRequestGet({ env, data: {} })).json();
  assert.deepEqual(after.boards.map(board => board.total), [0, 1]);
  assert.deepEqual(await (await del('?category=all')).json(), { category: 'all', deleted: 1 });
});

test('clearing refuses cross-origin requests', async () => {
  const DB = fakeD1();
  DB.seed([['Alpha', 900, 'arcade-falling']]);
  const response = await admin.onRequestDelete({ env: { DB }, request: new Request('https://admin.semina.be/api/admin/scores?category=all', {
    method: 'DELETE', headers: { origin: 'https://evil.example' } }) });
  assert.equal(response.status, 403);
  const listed = await (await admin.onRequestGet({ env: { DB }, data: {} })).json();
  assert.equal(listed.boards[0].total, 1);
});

test('the admin hostname opens the dashboard at its root', async () => {
  const next = async () => new Response('game');
  const redirect = await root.onRequest({ request: new Request('https://admin.semina.be/'), env: {}, next });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://admin.semina.be/admin/');
  assert.equal(await (await root.onRequest({ request: new Request('https://semina.be/'), env: {}, next })).text(), 'game');
});
