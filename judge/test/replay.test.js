'use strict';
// The submitted seed-42 replay must be valid, full-length, rejection-free,
// reproduce exactly on both engines, and match its recorded expectation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ref = require('../rules.js');
const { validateReplay, runReplay } = require('../replay.js');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'replays', 'seed42.json');

test('seed-42 replay reproduces exactly', () => {
  const replay = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  assert.deepEqual(validateReplay(replay), []);
  assert.equal(replay.seed, 42);
  assert.equal(replay.ticks, ref.C.MAX_TICKS);
  assert.ok(replay.expect, 'replay must record expect {clips, hash}');
  const a = runReplay(ref, replay);
  ref.checkSafe(a.state);
  assert.equal(a.rejected, 0, `rejected actions, first: ${JSON.stringify(a.firstRejected)}`);
  assert.equal(a.clips, replay.expect.clips);
  assert.equal(a.hash, replay.expect.hash);
  const again = runReplay(ref, replay);
  assert.equal(again.hash, a.hash);
  const b = runReplay(require(path.join(ROOT, 'game', 'engine.js')), replay);
  assert.deepEqual(b.checkpoints, a.checkpoints);
  assert.equal(b.hash, a.hash);
});
