import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import * as api from '../functions/api/scores.js';

const Board = createRequire(import.meta.url)('../scripts/leaderboard.js');
const migration = ['0001_create_scores.sql', '0002_score_origin.sql']
  .map(file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')).join('\n');

// A minimal stand-in for the D1 binding, backed by an in-memory SQLite database.
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
    rows() { return db.prepare('SELECT * FROM scores ORDER BY id').all().map(row => ({ ...row })); },
  };
}
const post = (env, body) => api.onRequestPost({
  env, request: new Request('https://example.test/api/scores', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const get = (env, query = '') => api.onRequestGet({ env, request: new Request(`https://example.test/api/scores${query}`) });

test('server rules match the shared client rules', () => {
  assert.equal(api.NAME_PATTERN.source, Board.NAME_PATTERN.source);
  assert.deepEqual(api.CATEGORIES, Board.CATEGORIES);
  assert.equal(api.MAX_SCORE, Board.MAX_SCORE);
  assert.equal(api.BOARD_SIZE, Board.BOARD_SIZE);
});
test('a valid score is stored and ranked within its category', async () => {
  const env = { DB: fakeD1() };
  assert.equal((await post(env, { name: 'Alpha', score: 900, category: 'arcade-falling' })).status, 201);
  await post(env, { name: 'Other', score: 5000, category: 'arcade-stationary' });
  const response = await post(env, { name: 'Bravo', score: 900, category: 'arcade-falling' });
  const body = await response.json();
  assert.equal(body.rank, 2, 'ties rank behind the earlier score');
  assert.deepEqual(body.scores.map(row => row.name), ['Alpha', 'Bravo']);
  const listed = await (await get(env, '?category=arcade-falling')).json();
  assert.deepEqual(listed.scores.map(row => [row.name, row.score]), [['Alpha', 900], ['Bravo', 900]]);
});
test('the board returns only the top ten', async () => {
  const env = { DB: fakeD1() };
  for (let i = 1; i <= 12; i++) await post(env, { name: `p${i}`, score: i * 100, category: 'arcade-falling' });
  const { scores } = await (await get(env)).json();
  assert.equal(scores.length, 10);
  assert.equal(scores[0].score, 1200);
});
test('invalid submissions are rejected and not stored', async () => {
  const env = { DB: fakeD1() };
  const bad = [
    { name: 'two words', score: 100, category: 'arcade-falling' },
    { name: 'ABCDEFGHIJKLM', score: 100, category: 'arcade-falling' },
    { name: '', score: 100, category: 'arcade-falling' },
    { name: 'Pini', score: 0, category: 'arcade-falling' },
    { name: 'Pini', score: 1.5, category: 'arcade-falling' },
    { name: 'Pini', score: '100', category: 'arcade-falling' },
    { name: 'Pini', score: api.MAX_SCORE + 1, category: 'arcade-falling' },
    { name: 'Pini', score: 100, category: 'zen-falling' },
    null,
  ];
  for (const body of bad) assert.equal((await post(env, body)).status, 400, JSON.stringify(body));
  assert.equal((await post(env, '{not json')).status, 400);
  assert.equal((await post(env, 'x'.repeat(9000))).status, 413);
  assert.equal((await get(env, '?category=nope')).status, 400);
  assert.deepEqual((await (await get(env)).json()).scores, []);
});
test('a missing database binding reports 503', async () => {
  assert.equal((await get({})).status, 503);
  assert.equal((await post({}, { name: 'Pini', score: 100, category: 'arcade-falling' })).status, 503);
});

const SIGNALS = {
  platform: 'MacIntel', languages: ['nl-BE', 'en'], timezone: 'Europe/Brussels', screen: '1512x982x30',
  hardwareConcurrency: 10, webdriver: false, canvas: '1a2b3c4d', fonts: ['Arial', 'Menlo'], audio: '124.04347527',
};
const postFrom = (env, body, { headers = {}, cf } = {}) => {
  const request = new Request('https://semina.be/api/scores', { method: 'POST', headers, body: JSON.stringify(body) });
  if (cf) Object.defineProperty(request, 'cf', { value: cf });
  return api.onRequestPost({ env, request });
};

test('each score records the IP, Cloudflare details and the hashed browser fingerprint', async () => {
  const DB = fakeD1();
  const headers = { 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0 Test', 'x-forwarded-for': '198.51.100.1' };
  const cf = { country: 'BE', asn: 5432, asOrganization: 'Proximus', city: 'Ghent', colo: 'BRU', botManagement: { score: 1 } };
  assert.equal((await postFrom({ DB }, { name: 'Alpha', score: 900, category: 'arcade-falling', fingerprint: SIGNALS }, { headers, cf })).status, 201);
  // Same signals in another key order, with junk the server drops, give the same fingerprint.
  const shuffled = Object.fromEntries(Object.entries(SIGNALS).reverse());
  await postFrom({ DB }, { name: 'Bravo', score: 800, category: 'arcade-falling', fingerprint: { ...shuffled, nested: { a: 1 }, 'bad key': 1 } }, { headers });
  const [alpha, bravo] = DB.rows();
  assert.equal(alpha.ip, '203.0.113.7', 'the IP comes from Cloudflare, not X-Forwarded-For');
  assert.equal(alpha.country, 'BE');
  assert.equal(alpha.asn, 5432);
  assert.equal(alpha.user_agent, 'Mozilla/5.0 Test');
  assert.deepEqual(JSON.parse(alpha.request_meta), { asOrganization: 'Proximus', city: 'Ghent', colo: 'BRU' });
  assert.match(alpha.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(alpha.fingerprint_data), SIGNALS);
  assert.equal(bravo.fingerprint, alpha.fingerprint);
  assert.equal(bravo.fingerprint_data, alpha.fingerprint_data);
});

test('a score without a usable or small enough fingerprint is still saved', async () => {
  const DB = fakeD1();
  for (const fingerprint of [undefined, null, 'abc', [1, 2], {}, Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, 'x'.repeat(200)]))]) {
    assert.equal((await postFrom({ DB }, { name: 'Pini', score: 100, category: 'arcade-falling', fingerprint })).status, 201);
  }
  assert.deepEqual(DB.rows().map(row => [row.fingerprint, row.fingerprint_data, row.ip]), Array(6).fill([null, null, null]));
});

test('fingerprint signals are clipped to safe sizes', () => {
  const clean = JSON.parse(api.cleanFingerprint({ renderer: 'r'.repeat(500), fonts: ['f'.repeat(100), 3, 'Arial'], ok: true, n: Infinity }));
  assert.equal(clean.renderer.length, 200);
  assert.deepEqual(clean.fonts, ['f'.repeat(80), 'Arial']);
  assert.equal(clean.ok, true);
  assert.equal('n' in clean, false);
});
