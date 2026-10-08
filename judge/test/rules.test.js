'use strict';
// Sanity tests of the reference rules themselves (pins a few numbers).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../rules.js');

test('reference is deterministic and pinned for seed 42', () => {
  const run = () => { const s = R.createState(42); for (let t = 0; t < 10000; t++) { R.applyAction(s, 'make'); R.step(s); } return s; };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.equal(a.clips, 1000);
  assert.equal(R.stateHash(a), PINNED);
});

test('costs grow and actions reject when unaffordable', () => {
  const s = R.createState(1);
  assert.equal(R.applyAction(s, 'autoclipper'), false);
  s.funds = 10000;
  assert.equal(R.applyAction(s, 'autoclipper'), true);
  assert.equal(s.nextAutoCost, 550);
  assert.equal(R.applyAction(s, 'megaclipper'), false);
  assert.equal(R.applyAction(s, 'price', 0), false);
  assert.equal(R.applyAction(s, 'make'), true);
  assert.equal(R.applyAction(s, 'make'), false);
});

const PINNED = '07062fc8';
