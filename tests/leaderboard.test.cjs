const { test } = require('node:test');
const assert = require('node:assert/strict');
const Board = require('../scripts/leaderboard.js');

test('names are 1–12 ASCII letters or digits', () => {
  for (const name of ['a', 'Pini2026', 'ABCDEFGHIJKL']) assert.ok(Board.isValidName(name), name);
  for (const name of ['', 'ABCDEFGHIJKLM', 'two words', 'pini!', 'émile', '<b>', 42, null]) assert.ok(!Board.isValidName(name), String(name));
});
test('typed names are cleaned to the allowed characters and length', () => {
  assert.equal(Board.cleanName(' Pi-ni 😀 2026 '), 'Pini2026');
  assert.equal(Board.cleanName('abcdefghijklmnop'), 'abcdefghijkl');
  assert.equal(Board.cleanName(null), '');
});
test('only positive whole scores under the cap are accepted', () => {
  assert.ok(Board.isValidScore(100));
  assert.ok(Board.isValidScore(Board.MAX_SCORE));
  for (const score of [0, -100, 1.5, Board.MAX_SCORE + 1, '100', NaN]) assert.ok(!Board.isValidScore(score), String(score));
});
test('local boards keep the top ten, highest first, earlier entry wins ties', () => {
  let board = [];
  for (let i = 1; i <= 12; i++) board = Board.addEntry(board, { name: `p${i}`, score: i * 100, at: i }).board;
  assert.equal(board.length, 10);
  assert.deepEqual(board.map(entry => entry.score), [1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300]);
  const tie = Board.addEntry(board, { name: 'late', score: 1100, at: 99 });
  assert.equal(tie.rank, 3);
  const low = Board.addEntry(board, { name: 'low', score: 100, at: 100 });
  assert.equal(low.rank, null);
  assert.ok(!low.board.some(entry => entry.name === 'low'));
});
test('stored entries that fail validation are dropped', () => {
  const { board } = Board.addEntry([{ name: 'bad name', score: 5, at: 1 }, { name: 'ok', score: 'x', at: 2 }], { name: 'ok', score: 5, at: 3 });
  assert.deepEqual(board.map(entry => entry.name), ['ok']);
});
