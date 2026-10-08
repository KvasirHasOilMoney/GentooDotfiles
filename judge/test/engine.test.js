'use strict';
// Differential conformance: game/engine.js must match judge/rules.js exactly.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const ref = require('../rules.js');

const ENGINE = path.join(__dirname, '..', '..', 'game', 'engine.js');
const game = require(ENGINE);

const TYPES = ['make', 'price', 'wire', 'marketing', 'autoclipper', 'megaclipper', 'extruder', 'upgrade', 'bogus'];
const UPG = ['autoboost', 'bigspool', 'megaboost', 'nope', undefined];

function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; }; }

function randomAction(r) {
  const type = TYPES[r() % TYPES.length];
  let arg;
  if (type === 'price') arg = [0, 1, 2, 7, 25, 100, 9999, 10000, 10001, 3.5, '25'][r() % 11];
  if (type === 'upgrade') arg = UPG[r() % UPG.length];
  return [type, arg];
}

test('engine exports the contract', () => {
  for (const k of ['C', 'FIELDS', 'createState', 'applyAction', 'step', 'stateHash', 'wirePrice']) assert.ok(k in game, `missing export ${k}`);
  assert.deepEqual(game.FIELDS, ref.FIELDS);
  assert.deepEqual(JSON.parse(JSON.stringify(game.C)), JSON.parse(JSON.stringify(ref.C)));
});

test('createState matches for many seeds', () => {
  for (const seed of [0, 1, 42, 7, 123456789, 0xffffffff]) {
    const a = ref.createState(seed), b = game.createState(seed);
    assert.deepEqual(Object.keys(b).sort(), [...ref.FIELDS].sort());
    assert.deepEqual(b, a);
    assert.equal(game.stateHash(b), ref.stateHash(a));
  }
});

test('stateHash matches on arbitrary states', () => {
  const r = rng(99);
  for (let i = 0; i < 200; i++) {
    const s = ref.createState(r());
    for (const k of ref.FIELDS) s[k] = r() % 1000000;
    assert.equal(game.stateHash({ ...s }), ref.stateHash(s));
  }
});

// Random play with periodic state injection so expensive branches get exercised.
for (const seed of [1, 2, 3, 42, 777, 31337]) {
  test(`differential fuzz seed ${seed}`, () => {
    const r = rng(seed * 2654435761);
    const a = ref.createState(seed), b = game.createState(seed);
    for (let t = 0; t < 60000; t++) {
      if (t % 5000 === 0) {
        const boost = { funds: r() % 5 === 0 ? 2e11 : r() % 2000000, autoclippers: r() % 80, megaclippers: r() % 5,
          extruders: r() % 3, wire: r() % 50000, inventory: r() % 100000, mktPermille: 1000 << (r() % 6) };
        for (const k of Object.keys(boost)) if (r() % 2) { a[k] = boost[k]; b[k] = boost[k]; }
      }
      const n = r() % 4;
      for (let j = 0; j < n; j++) {
        const [type, arg] = randomAction(r);
        assert.equal(game.applyAction(b, type, arg), ref.applyAction(a, type, arg), `applyAction ${type} ${arg} at tick ${t}`);
      }
      ref.step(a); game.step(b);
      if (t % 997 === 0) assert.equal(game.stateHash(b), ref.stateHash(a), `hash diverged at tick ${t}`);
    }
    assert.deepEqual(b, a);
  });
}

test('engine loads as a browser script and exposes PaperclipEngine', () => {
  const src = fs.readFileSync(ENGINE, 'utf8');
  const ctx = { window: {} };
  ctx.globalThis = ctx; ctx.self = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const E = ctx.PaperclipEngine || ctx.window.PaperclipEngine;
  assert.ok(E, 'PaperclipEngine global not defined');
  const s = E.createState(42);
  E.step(s);
  const t = ref.createState(42); ref.step(t);
  assert.equal(E.stateHash(s), ref.stateHash(t));
});

test('engine source is deterministic (no Math.random / Date)', () => {
  const src = fs.readFileSync(ENGINE, 'utf8');
  assert.ok(!/Math\.random|Date\.now|new Date|performance\.now/.test(src));
});
