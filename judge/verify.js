#!/usr/bin/env node
'use strict';
// Usage: node judge/verify.js [replay.json]   (default: replays/seed42.json)
// Validates the replay, runs it on the reference rules and on game/engine.js,
// and prints the score. Exit code 0 only if everything matches.

const fs = require('fs');
const path = require('path');
const ref = require('./rules.js');
const { validateReplay, runReplay } = require('./replay.js');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'replays', 'seed42.json'));
const replay = JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const errs = validateReplay(replay);
if (errs.length) fail(`invalid replay:\n  ${errs.join('\n  ')}`);

const a = runReplay(ref, replay);
ref.checkSafe(a.state);
if (a.rejected) fail(`${a.rejected} rejected actions; first: ${JSON.stringify(a.firstRejected)}`);

let game = null;
try { game = require(path.join(__dirname, '..', 'game', 'engine.js')); } catch (e) { fail(`cannot load game/engine.js: ${e.message}`); }
const b = runReplay(game, replay);
for (let k = 0; k < a.checkpoints.length; k++) {
  if (a.checkpoints[k] !== b.checkpoints[k]) fail(`game/engine.js diverges from reference by tick ${(k + 1) * 100000}`);
}
if (a.hash !== b.hash) fail('game/engine.js final hash differs from reference');
if (replay.expect && (replay.expect.clips !== a.clips || replay.expect.hash !== a.hash)) {
  fail(`replay expects clips=${replay.expect.clips} hash=${replay.expect.hash}, got clips=${a.clips} hash=${a.hash}`);
}

console.log(JSON.stringify({ file: path.relative(process.cwd(), file), seed: replay.seed, ticks: replay.ticks, actions: replay.actions.length, clips: a.clips, hash: a.hash }));
