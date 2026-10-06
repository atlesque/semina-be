const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, multiplier, WAVES } = require('../scripts/game-engine.js');
const words = [{ word: 'Apple', emoji: '🍎' }, { word: 'Planet', emoji: '🪐' }, { word: 'Pizza', emoji: '🍕' }];
function setup(mode = 'arcade', stationary = false) {
  const events = [];
  const game = createGame({ words, random: () => .4, emit: event => events.push(event) });
  game.start(mode, stationary);
  game.advance(1400);
  return { game, events };
}
let id = 10000;
function object(game, kind = 'target', overrides = {}) {
  const item = { id: ++id, kind, emoji: kind === 'target' ? game.state.target.emoji : kind === 'bomb' ? '💣' : '🐬', lane: 0, age: 0, travel: 5000, ...overrides };
  game.state.objects.push(item);
  return item;
}
function catchTarget(game) { game.resolve(object(game).id, true); }

test('combo scoring applies the tier reached on the current catch', () => {
  assert.deepEqual([1, 4, 5, 9, 10, 19, 20].map(multiplier), [1, 1, 2, 2, 3, 3, 4]);
  const { game } = setup();
  for (let i = 1; i <= 20; i++) {
    const before = game.state.score;
    catchTarget(game);
    assert.equal(game.state.score - before, 100 * multiplier(i) + (i === 8 ? 500 : 0));
  }
  assert.equal(game.state.bestCombo, 20);
});
test('Fever activates after 20 catches, doubles points, cannot refill or overlap', () => {
  const { game, events } = setup();
  for (let i = 0; i < 20; i++) catchTarget(game);
  assert.equal(game.state.feverTime, 8000);
  assert.equal(game.state.feverCharge, 0);
  const before = game.state.score;
  catchTarget(game);
  assert.equal(game.state.score - before, 800);
  for (let i = 0; i < 30; i++) catchTarget(game);
  assert.equal(game.state.feverCharge, 0);
  assert.equal(events.filter(event => event.type === 'fever').length, 1);
  game.advance(8000);
  assert.equal(game.state.feverTime, 0);
  catchTarget(game);
  assert.equal(game.state.feverCharge, 1);
});
test('each catch or escape resolves an object only once', () => {
  const { game } = setup();
  const target = object(game);
  assert.equal(game.resolve(target.id, true), true);
  assert.equal(game.resolve(target.id, true), false);
  assert.equal(game.resolve(target.id, false), false);
  assert.equal(game.state.correct, 1);
  assert.equal(game.state.score, 100);
});
test('decoys damage, break combo, and preserve Fever charge', () => {
  const { game } = setup();
  catchTarget(game);
  game.resolve(object(game, 'decoy').id, true);
  assert.equal(game.state.hearts, 2);
  assert.equal(game.state.combo, 0);
  assert.equal(game.state.feverCharge, 1);
  assert.equal(game.state.mistakes, 1);
});
test('bombs remove five charges without making charge negative', () => {
  const { game } = setup();
  for (let i = 0; i < 7; i++) catchTarget(game);
  game.resolve(object(game, 'bomb').id, true);
  assert.equal(game.state.feverCharge, 2);
  game.advance(700);
  game.resolve(object(game, 'bomb').id, true);
  assert.equal(game.state.feverCharge, 0);
});
test('damage cooldown prevents simultaneous taps from draining hearts', () => {
  const { game } = setup();
  const a = object(game, 'bomb');
  const b = object(game, 'decoy');
  game.resolve(a.id, true);
  game.resolve(b.id, true);
  assert.equal(game.state.hearts, 2);
  assert.equal(game.state.mistakes, 1);
  assert.ok(!game.state.objects.length);
  game.advance(700);
  game.resolve(object(game, 'bomb').id, true);
  assert.equal(game.state.hearts, 1);
});
test('escaped targets reset combo without losing a heart; other escapes are harmless', () => {
  const { game } = setup();
  catchTarget(game);
  game.resolve(object(game, 'decoy').id, false);
  game.resolve(object(game, 'bomb').id, false);
  assert.equal(game.state.combo, 1);
  game.resolve(object(game).id, false);
  assert.equal(game.state.combo, 0);
  assert.equal(game.state.hearts, 3);
});
test('empty lanes have no effect and oldest object in a lane is caught first', () => {
  const { game } = setup();
  assert.equal(game.catchLane(0), false);
  const a = object(game, 'target', { age: 4900 });
  const b = object(game, 'bomb', { age: 4900 });
  game.catchLane(0);
  assert.equal(game.state.correct, 1);
  assert.ok(!game.state.objects.some(o => o.id === a.id));
  assert.ok(game.state.objects.some(o => o.id === b.id));
});
test('lane buttons only catch emojis touching the bottom of the playfield', () => {
  const { game } = setup();
  game.setPlayfieldHeight(416);
  const item = object(game, 'target', { age: 3900 });
  assert.equal(game.catchLane(0), false);
  assert.equal(game.state.combo, 0);
  item.age = 4000;
  assert.equal(game.catchLane(0), true);
  assert.equal(game.state.correct, 1);
});
test('emojis pass through the bottom and stay catchable until fully off screen', () => {
  const { game } = setup();
  game.setPlayfieldHeight(416);
  // Runway is 350px, so a 5000ms fall leaves the screen 62px (about 886ms) after reaching the bottom.
  const item = object(game, 'target', { age: 4990 });
  game.advance(500);
  assert.ok(game.state.objects.includes(item));
  assert.equal(game.catchLane(0), true);
  assert.equal(game.state.correct, 1);
});
test('emojis that leave the screen uncaught count as an escape', () => {
  const { game } = setup();
  game.setPlayfieldHeight(416);
  catchTarget(game);
  const item = object(game, 'target', { age: 5800 });
  game.advance(50);
  assert.ok(game.state.objects.includes(item));
  assert.equal(game.state.combo, 1);
  game.advance(50);
  assert.ok(!game.state.objects.includes(item));
  assert.equal(game.catchLane(0), false);
  assert.equal(game.state.combo, 0);
  assert.equal(game.state.hearts, 3);
});
test('stationary emojis still expire at the end of their travel time', () => {
  const { game } = setup('arcade', true);
  const item = object(game, 'target', { age: 4990 });
  game.advance(50);
  assert.ok(!game.state.objects.includes(item));
});
test('stationary lane buttons catch regardless of fall progress', () => {
  const { game } = setup('arcade', true);
  object(game);
  assert.equal(game.catchLane(0), true);
});
test('pause freezes every simulation value and rejects catches', () => {
  const { game } = setup();
  for (let i = 0; i < 20; i++) catchTarget(game);
  game.resolve(object(game, 'bomb').id, true);
  const target = object(game);
  game.pause();
  const before = structuredClone(game.state);
  game.advance(30000);
  assert.deepEqual(game.state, before);
  assert.equal(game.resolve(target.id, true), false);
  game.resume();
  game.advance(2999);
  assert.equal(game.state.phase, 'resume');
  assert.equal(game.state.elapsed, before.elapsed);
  assert.equal(game.state.feverTime, before.feverTime);
  game.advance(1);
  assert.equal(game.state.phase, 'playing');
});
test('pause during a wave announcement preserves its remaining duration', () => {
  const { game } = setup();
  game.advance(15000);
  game.advance(500);
  game.pause();
  game.advance(100000);
  assert.equal(game.state.countdown, 900);
  game.resume();
  game.advance(3000);
  assert.equal(game.state.phase, 'wave');
  game.advance(900);
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.state.elapsed, 15000);
});
test('wave boundary clears objects without escape penalties and preserves combos and Fever', () => {
  const { game } = setup();
  game.state.waveTime = 14950;
  game.state.elapsed = 14950;
  game.state.combo = 12;
  game.state.feverTime = 5000;
  object(game, 'target', { age: 4990 });
  game.advance(50);
  assert.equal(game.state.phase, 'wave');
  assert.equal(game.state.combo, 12);
  assert.equal(game.state.feverTime, 4950);
  assert.equal(game.state.objects.length, 0);
  const target = game.state.target;
  game.advance(1400);
  catchTarget(game);
  assert.equal(game.state.target, target);
});
test('six waves total exactly 90 seconds of active play', () => {
  const { game } = setup();
  game.advance(90000 + 5 * 1400);
  assert.equal(game.state.phase, 'results');
  assert.equal(game.state.elapsed, 90000);
  assert.equal(game.state.wavesCompleted, 6);
  assert.equal(game.state.hearts, 3);
  assert.equal(game.state.objects.length, 0);
});
test('third damaging catch ends the run, further interaction has no effect', () => {
  const { game, events } = setup();
  for (let i = 0; i < 3; i++) {
    game.resolve(object(game, 'bomb').id, true);
    game.advance(700);
  }
  assert.equal(game.state.phase, 'results');
  assert.equal(game.state.hearts, 0);
  assert.equal(events.filter(e => e.type === 'finish').length, 1);
});
test('wave bonus is fixed, granted once, and optional', () => {
  const { game, events } = setup();
  for (let i = 0; i < 12; i++) catchTarget(game);
  assert.equal(events.filter(e => e.type === 'wave-clear').length, 1);
  assert.equal(game.state.waveAwarded, true);
  game.advance(15000);
  assert.equal(game.state.wave, 1);
  assert.equal(game.state.waveAwarded, false);
});
test('restart clears all state, including phase, cooldown, Fever, objects, and counters', () => {
  const { game } = setup();
  for (let i = 0; i < 20; i++) catchTarget(game);
  game.resolve(object(game, 'bomb').id, true);
  game.pause();
  game.start('arcade', true);
  assert.equal(game.state.phase, 'wave');
  for (const key of ['score', 'combo', 'bestCombo', 'correct', 'mistakes', 'elapsed', 'feverCharge', 'feverTime', 'cooldown', 'wave', 'wavesCompleted']) assert.equal(game.state[key], 0, key);
  assert.equal(game.state.hearts, 3);
  assert.equal(game.state.objects.length, 0);
  assert.equal(game.state.stationary, true);
});
test('stationary and falling runs can both be completed by catch controls', () => {
  for (const stationary of [false, true]) {
    const { game } = setup('arcade', stationary);
    let maxObjects = 0;
    while (game.state.phase !== 'results') {
      game.advance(50);
      maxObjects = Math.max(maxObjects, game.state.objects.length);
      for (const item of [...game.state.objects]) if (item.kind === 'target') game.catchLane(item.lane);
    }
    assert.equal(game.state.wavesCompleted, 6);
    assert.equal(game.state.hearts, 3);
    assert.ok(game.state.score > 10000);
    assert.ok(maxObjects <= (stationary ? 4 : 8));
  }
});
test('spawn composition introduces bombs in wave 3 and enforces density limits', () => {
  for (const stationary of [false, true]) {
    let seed = 42;
    const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
    const game = createGame({ words, random });
    game.start('arcade', stationary);
    let bombs = 0;
    const seen = new Set();
    while (game.state.phase !== 'results') {
      game.advance(50);
      assert.ok(game.state.objects.length <= (stationary ? 4 : 8));
      if (stationary) for (const lane of [0, 1, 2, 3]) assert.ok(game.state.objects.filter(o => o.lane === lane).length <= 1);
      for (const item of game.state.objects) {
        if (item.kind !== 'target') assert.notEqual(item.emoji, game.state.target.emoji);
        if (item.kind === 'bomb' && !seen.has(item.id)) {
          assert.ok(game.state.wave >= 2);
          bombs++;
          seen.add(item.id);
        }
      }
    }
    assert.ok(bombs > 0);
  }
  assert.equal(WAVES[0].interval, 1300);
  assert.equal(WAVES[5].travel, 1400);
});
test('Zen remains untimed, harmless, one point per catch, changing only on a current target', () => {
  const { game } = setup('zen', true);
  const oldTarget = object(game);
  catchTarget(game);
  const currentTarget = game.state.target;
  game.resolve(oldTarget.id, true);
  assert.equal(game.state.target, currentTarget);
  assert.equal(game.state.score, 2);
  game.advance(200000);
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.state.hearts, 3);
  assert.equal(game.state.feverTime, 0);
  assert.equal(game.state.combo, 0);
});
test('short playfields reduce lane density to prevent overlapping touch targets', () => {
  const { game } = setup();
  game.setPlayfieldHeight(100);
  for (let i = 0; i < 200; i++) {
    game.advance(50);
    for (const lane of [0, 1, 2, 3]) {
      // Tiles are 58px and fall along a 34px runway; same-lane tiles must never overlap.
      const tops = game.state.objects.filter(o => o.lane === lane).map(o => 4 + o.age / o.travel * 34).sort((x, y) => x - y);
      for (let j = 1; j < tops.length; j++) assert.ok(tops[j] - tops[j - 1] >= 58);
    }
  }
});
test('identical input traces produce identical results regardless of frame batching', () => {
  const a = setup().game;
  const b = setup().game;
  for (let i = 0; i < 100; i++) {
    a.advance(200);
    for (let j = 0; j < 4; j++) b.advance(50);
    for (const game of [a, b]) {
      for (const item of [...game.state.objects]) if (item.kind === 'target') game.catchLane(item.lane);
    }
    assert.deepEqual(a.state, b.state);
  }
});
