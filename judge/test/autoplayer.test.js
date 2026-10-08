'use strict';
// The autoplayer must regenerate the committed replay byte-for-byte, and must
// produce valid rejection-free replays on other seeds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ref = require('../rules.js');
const { validateReplay, runReplay } = require('../replay.js');

const ROOT = path.join(__dirname, '..', '..');
const PLAY = path.join(ROOT, 'autoplayer', 'play.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-judge-'));

function play(args) {
  execFileSync(process.execPath, [PLAY, ...args], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], timeout: 600000 });
}

test('autoplayer regenerates replays/seed42.json exactly', { timeout: 700000 }, () => {
  const out = path.join(tmp, 'seed42.json');
  play(['--seed', '42', '--out', out]);
  assert.ok(fs.readFileSync(out).equals(fs.readFileSync(path.join(ROOT, 'replays', 'seed42.json'))), 'regenerated replay differs from committed replay');
});

for (const seed of [7, 2026]) {
  test(`autoplayer produces a valid replay for seed ${seed} at 200000 ticks`, { timeout: 700000 }, () => {
    const out = path.join(tmp, `seed${seed}.json`);
    play(['--seed', String(seed), '--ticks', '200000', '--out', out]);
    const r = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepEqual(validateReplay(r), []);
    assert.equal(r.seed, seed);
    assert.equal(r.ticks, 200000);
    const res = runReplay(ref, r);
    assert.equal(res.rejected, 0, `first rejected: ${JSON.stringify(res.firstRejected)}`);
    assert.equal(res.clips, r.expect.clips);
    assert.equal(res.hash, r.expect.hash);
    assert.ok(res.clips > 1000, 'autoplayer should do better than the starting wire');
  });
}

test('autoplayer source is deterministic (no Math.random / Date)', () => {
  const dir = path.join(ROOT, 'autoplayer');
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    if (!String(f).endsWith('.js') || String(f).includes('test')) continue;
    const src = fs.readFileSync(path.join(dir, String(f)), 'utf8');
    assert.ok(!/Math\.random|Date\.now|new Date|performance\.now/.test(src), `${f} uses a nondeterministic source`);
  }
});
