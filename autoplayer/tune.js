#!/usr/bin/env node
'use strict';
// Offline, deterministic parameter search for autoplayer/policy.js (not used
// by play.js). Coordinate descent with multiplicative steps, evaluated in
// parallel worker threads on judge/rules.js.
// Usage: node autoplayer/tune.js [--seed 42] [--ticks 2000000] [--rounds N]
//                                [--start '{json}'] [--only k1,k2]
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const os = require('os');

if (!isMainThread) {
  const E = require(path.join(__dirname, '..', 'judge', 'rules.js'));
  const { run } = require('./policy.js');
  parentPort.on('message', ({ id, params }) => {
    let clips = 0;
    for (const sd of workerData.seeds) clips += run(E, sd, workerData.ticks, params, false).state.clips;
    parentPort.postMessage({ id, clips });
  });
} else {
  main();
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const seeds = opt('--seed', '42').split(',').map(Number);
  const ticks = +opt('--ticks', 2000000), rounds = +opt('--rounds', 6);
  let step = +opt('--step', 2);
  const { DEFAULTS } = require('./policy.js');
  let cur = Object.assign({}, DEFAULTS, JSON.parse(opt('--start', '{}')));
  const only = opt('--only', null);
  const keys = only ? only.split(',') : Object.keys(cur);

  const N = Math.max(1, os.cpus().length);
  const workers = [], idle = [], pending = new Map(), queue = [];
  let nextId = 0;
  const pump = () => {
    while (idle.length && queue.length) { const w = idle.pop(); w.postMessage(queue.shift()); }
  };
  for (let i = 0; i < N; i++) {
    const w = new Worker(__filename, { workerData: { seeds, ticks } });
    w.on('message', ({ id, clips }) => { pending.get(id)(clips); pending.delete(id); idle.push(w); pump(); });
    workers.push(w); idle.push(w);
  }
  const evalP = (params) => new Promise((res) => { const id = nextId++; pending.set(id, res); queue.push({ id, params }); pump(); });

  (async () => {
    let best = await evalP(cur);
    console.log('start', best, JSON.stringify(cur));
    for (let r = 0; r < rounds; r++) {
      for (const k of keys) {
        const cands = [step, 1 / step, Math.sqrt(step), 1 / Math.sqrt(step)]
          .map((m) => Object.assign({}, cur, { [k]: Number((cur[k] * m).toPrecision(4)) }));
        const res = await Promise.all(cands.map(evalP));
        let bi = -1;
        res.forEach((c, i) => { if (c > best) { best = c; bi = i; } });
        if (bi >= 0) { cur = cands[bi]; console.log(`r${r} ${k}=${cur[k]} -> ${best}`); }
      }
      step = Math.sqrt(step);
      console.log('round', r, best, JSON.stringify(cur));
    }
    console.log('FINAL', best, JSON.stringify(cur));
    for (const w of workers) w.terminate();
  })();
}
