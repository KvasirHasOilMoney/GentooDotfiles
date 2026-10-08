'use strict';
// The browser game must be a static page that loads the engine as a script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const GAME = path.join(__dirname, '..', '..', 'game');

test('game/index.html is a static page that loads engine.js and ui.js', () => {
  const html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
  assert.match(html, /<script[^>]+src=["']\.?\/?engine\.js["']/);
  assert.match(html, /<script[^>]+src=["']\.?\/?ui\.js["']/);
  assert.ok(!/<script[^>]+src=["']https?:/.test(html), 'no remote scripts');
  for (const id of ['clips', 'funds', 'wire', 'tick']) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  for (const a of ['make', 'wire', 'autoclipper', 'megaclipper', 'extruder', 'marketing']) {
    assert.match(html, new RegExp(`data-action=["']${a}["']`), `missing control data-action="${a}"`);
  }
});

test('ui.js does not reimplement rules or use nondeterminism in the simulation', () => {
  const src = fs.readFileSync(path.join(GAME, 'ui.js'), 'utf8');
  assert.match(src, /PaperclipEngine/);
  assert.ok(!/Math\.random/.test(src));
});
