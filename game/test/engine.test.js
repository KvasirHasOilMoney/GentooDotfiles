'use strict';
// Engine-owned tests: long-horizon differential checks against the frozen
// reference, edge cases, and a coarse speed check for step().
const test = require('node:test');
const assert = require('node:assert/strict');
const ref = require('../../judge/rules.js');
const E = require('../engine.js');

function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; }; }

test('pinned seed-42 make-only run matches the reference pin', () => {
  const s = E.createState(42);
  for (let t = 0; t < 10000; t++) { E.applyAction(s, 'make'); E.step(s); }
  assert.equal(s.clips, 1000);
  assert.equal(E.stateHash(s), '07062fc8');
});

test('idle run of MAX_TICKS matches the reference exactly', () => {
  const a = ref.createState(42), b = E.createState(42);
  for (let t = 0; t < E.C.MAX_TICKS; t++) { ref.step(a); E.step(b); }
  assert.deepEqual(b, a);
});

test('late-game economy (huge funds, many machines, all upgrades) matches', () => {
  for (const seed of [0, 42, 0xffffffff]) {
    const a = ref.createState(seed), b = E.createState(seed);
    const r = rng(seed + 5);
    for (const s of [a, b]) { s.funds = 5e13; s.mktPermille = 1000 * 2 ** 20; }
    const buys = ['autoclipper', 'megaclipper', 'extruder', 'marketing', 'wire', 'make'];
    for (let t = 0; t < 200000; t++) {
      if (t === 10) {
        for (const u of ['autoboost', 'bigspool', 'megaboost', 'autoboost', 'toString', '__proto__']) {
          assert.equal(E.applyAction(b, 'upgrade', u), ref.applyAction(a, 'upgrade', u), u);
        }
      }
      if (t % 7 === 0) {
        const type = buys[r() % buys.length];
        assert.equal(E.applyAction(b, type), ref.applyAction(a, type), `${type} at ${t}`);
      }
      if (t % 1013 === 0) {
        const p = 1 + (r() % 200);
        assert.equal(E.applyAction(b, 'price', p), ref.applyAction(a, 'price', p));
      }
      ref.step(a); E.step(b);
    }
    ref.checkSafe(a);
    assert.deepEqual(b, a);
    assert.equal(E.stateHash(b), ref.stateHash(a));
  }
});

test('rejected actions leave the state untouched', () => {
  const s = E.createState(1);
  const before = { ...s };
  const cases = [['autoclipper'], ['megaclipper'], ['extruder'], ['marketing'], ['wire'],
    ['price', 0], ['price', 10001], ['price', 2.5], ['price', '25'],
    ['upgrade', 'autoboost'], ['upgrade', 'x'], ['upgrade', 'hasOwnProperty'], ['bogus']];
  for (const [type, arg] of cases) assert.equal(E.applyAction(s, type, arg), false, `${type} ${arg}`);
  assert.deepEqual(s, before);
});

test('createState rejects non-uint32 seeds like the reference', () => {
  for (const seed of [-1, 2 ** 32, 1.5, '1', NaN]) {
    assert.throws(() => E.createState(seed));
    assert.throws(() => ref.createState(seed));
  }
});

test('step is fast enough for the autoplayer', () => {
  const s = E.createState(42);
  s.autoclippers = 60; s.megaclippers = 3; s.extruders = 2;
  const t0 = process.hrtime.bigint();
  for (let t = 0; t < 2000000; t++) E.step(s);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 2000, `2M steps took ${ms.toFixed(0)} ms`);
});
