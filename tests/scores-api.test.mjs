import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import * as api from '../functions/api/scores.js';

const Board = createRequire(import.meta.url)('../scripts/leaderboard.js');
const migration = readFileSync(new URL('../migrations/0001_create_scores.sql', import.meta.url), 'utf8');

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
  assert.equal((await post(env, 'x'.repeat(600))).status, 413);
  assert.equal((await get(env, '?category=nope')).status, 400);
  assert.deepEqual((await (await get(env)).json()).scores, []);
});
test('a missing database binding reports 503', async () => {
  assert.equal((await get({})).status, 503);
  assert.equal((await post({}, { name: 'Pini', score: 100, category: 'arcade-falling' })).status, 503);
});
