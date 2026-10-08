#!/usr/bin/env node
'use strict';
// Autoplayer: node autoplayer/play.js --seed 42 [--ticks 2000000] [--out replays/seed42.json]
// Writes a format-1 replay (SPEC.md contracts 2 and 4). The output is a pure
// function of the arguments: the policy in policy.js is deterministic and its
// parameters below were chosen offline with autoplayer/tune.js.
const fs = require('fs');
const path = require('path');
const engine = require('../game/engine.js');
const { run } = require('./policy.js');

// Tuned for seed 42 at 2,000,000 ticks (see tune.js); also safe for any seed/length.
const PARAMS = Object.freeze({
  makeCap: 50,
  priceEvery: 25,
  priceMul: 1.874,
  invTau: 24.27,
  mktBias: 2.456,
  mktRemFrac: 0.3,
  extCostFrac: 0.4204,
  wireBuf: 12.37,
  wireMaxRatio: 0.2973,
  extRatio: 0.9715,
  extPayback: 20000,
  bigspoolAt: 3,
  reserveSpools: 0.2102,
  endTicks: 20000,
});

function parseArgs(argv) {
  const o = { seed: 42, ticks: engine.C.MAX_TICKS, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--seed') { o.seed = Number(v); i++; }
    else if (k === '--ticks') { o.ticks = Number(v); i++; }
    else if (k === '--out') { o.out = v; i++; }
    else throw new Error(`unknown argument ${k}`);
  }
  if (!Number.isInteger(o.seed) || o.seed < 0 || o.seed > 0xffffffff) throw new Error('--seed must be a uint32');
  if (!Number.isInteger(o.ticks) || o.ticks < 0 || o.ticks > engine.C.MAX_TICKS) throw new Error(`--ticks must be in [0, ${engine.C.MAX_TICKS}]`);
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const { state, actions } = run(engine, o.seed, o.ticks, PARAMS, true);
  const replay = {
    format: 1,
    seed: o.seed,
    ticks: o.ticks,
    expect: { clips: state.clips, hash: engine.stateHash(state) },
    actions,
  };
  const out = o.out || path.join(__dirname, '..', 'replays', `seed${o.seed}.json`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(replay) + '\n');
  process.stderr.write(`seed ${o.seed} ticks ${o.ticks}: clips ${state.clips}, ${actions.length} actions -> ${out}\n`);
}

main();
