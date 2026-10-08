'use strict';
// Replay validation and execution, shared by verify.js and the tests.
// Works with any engine exposing the contract in SPEC.md (judge/rules.js or game/engine.js).

const { C } = require('./rules.js');

function validateReplay(r) {
  const errs = [];
  if (!r || typeof r !== 'object') return ['replay is not an object'];
  if (r.format !== 1) errs.push('format must be 1');
  if (!Number.isInteger(r.seed) || r.seed < 0 || r.seed > 0xffffffff) errs.push('seed must be a uint32');
  if (!Number.isInteger(r.ticks) || r.ticks < 0 || r.ticks > C.MAX_TICKS) errs.push(`ticks must be an integer in [0, ${C.MAX_TICKS}]`);
  if (!Array.isArray(r.actions)) { errs.push('actions must be an array'); return errs; }
  let prev = 0, run = 0;
  for (let i = 0; i < r.actions.length && errs.length < 20; i++) {
    const a = r.actions[i];
    if (!Array.isArray(a) || a.length < 2 || a.length > 3 || !Number.isInteger(a[0]) || typeof a[1] !== 'string') {
      errs.push(`actions[${i}] must be [tick, type] or [tick, type, arg]`); continue;
    }
    if (a[0] < prev) errs.push(`actions[${i}] tick ${a[0]} is before previous tick ${prev}`);
    if (a[0] < 0 || a[0] >= r.ticks) errs.push(`actions[${i}] tick ${a[0]} outside [0, ticks)`);
    run = a[0] === prev ? run + 1 : 1;
    if (run > C.MAX_ACTIONS_PER_TICK) errs.push(`more than ${C.MAX_ACTIONS_PER_TICK} actions at tick ${a[0]}`);
    prev = a[0];
  }
  if (r.expect !== undefined) {
    if (!r.expect || !Number.isSafeInteger(r.expect.clips) || typeof r.expect.hash !== 'string') errs.push('expect must be {clips, hash}');
  }
  return errs;
}

// Runs a replay. Returns { state, hash, clips, rejected, firstRejected, checkpoints }.
// checkpoints[k] is the state hash after (k+1)*every ticks.
function runReplay(engine, r, every = 100000) {
  const s = engine.createState(r.seed);
  const acts = r.actions;
  let i = 0, rejected = 0, firstRejected = null;
  const checkpoints = [];
  for (let t = 0; t < r.ticks; t++) {
    while (i < acts.length && acts[i][0] === t) {
      const a = acts[i];
      if (!engine.applyAction(s, a[1], a[2])) {
        rejected++;
        if (firstRejected === null) firstRejected = { index: i, action: a };
      }
      i++;
    }
    engine.step(s);
    if ((t + 1) % every === 0) checkpoints.push(engine.stateHash(s));
  }
  return { state: s, hash: engine.stateHash(s), clips: s.clips, rejected, firstRejected, checkpoints };
}

module.exports = { validateReplay, runReplay };
