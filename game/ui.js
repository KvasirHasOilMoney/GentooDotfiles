'use strict';
// Browser front end for the paperclip game. Every rule lives in
// PaperclipEngine (game/engine.js); this file only drives time, records the
// player's actions, renders the state and imports/exports format-1 replays.
(function () {
  const E = globalThis.PaperclipEngine;
  const $ = (id) => document.getElementById(id);

  if (!E) {
    document.body.insertAdjacentHTML('afterbegin',
      '<p class="msg error">engine.js did not load: PaperclipEngine is missing.</p>');
    return;
  }

  const MAX_TICKS = E.C.MAX_TICKS;
  const MAX_PER_TICK = E.C.MAX_ACTIONS_PER_TICK;
  const MAX_FRAME_MS = 12; // time budget per frame at max speed

  // ---- session state -------------------------------------------------------
  let state;           // engine state
  let recorded;        // [[tick, type] | [tick, type, arg]] successful player actions
  let playback = null; // { replay, index, rejected } while watching a replay
  let speed = 10;      // ticks per second, 0 = paused, Infinity = max
  let carry = 0;       // fractional ticks owed at fixed speeds
  let lastFrame = null;
  let ticksThisSecond = 0, rateWindowStart = 0, measuredRate = 0;

  function newGame(seed) {
    state = E.createState(seed);
    recorded = [];
    playback = null;
    carry = 0;
    setMessage('');
    $('priceInput').value = state.price;
  }

  // ---- formatting ----------------------------------------------------------
  const intFmt = new Intl.NumberFormat('en-US');
  const fmtInt = (n) => intFmt.format(n);
  function fmtMoney(cents) {
    const neg = cents < 0; const c = Math.abs(cents);
    return (neg ? '−$' : '$') + intFmt.format(Math.floor(c / 100)) + '.' + String(c % 100).padStart(2, '0');
  }

  // ---- actions -------------------------------------------------------------
  const controls = Array.from(document.querySelectorAll('[data-action]'));

  // The argument a control would send right now (undefined for argument-less actions).
  function argFor(el) {
    const type = el.dataset.action;
    if (type === 'price') {
      if (el.dataset.set) {
        const v = $('priceInput').value.trim();
        return /^\d+$/.test(v) ? Number(v) : NaN;
      }
      return state.price + Number(el.dataset.delta);
    }
    if (type === 'upgrade') return el.dataset.arg;
    return undefined;
  }

  function actionsAtCurrentTick() {
    let n = 0;
    for (let i = recorded.length - 1; i >= 0 && recorded[i][0] === state.tick; i--) n++;
    return n;
  }

  function canAct() {
    return !playback && state.tick < MAX_TICKS && actionsAtCurrentTick() < MAX_PER_TICK;
  }

  // Would the engine accept this action? Asks the engine on a throwaway copy.
  function wouldAccept(type, arg) {
    return E.applyAction({ ...state }, type, arg);
  }

  function act(type, arg) {
    if (!canAct()) return false;
    if (!E.applyAction(state, type, arg)) return false;
    recorded.push(arg === undefined ? [state.tick, type] : [state.tick, type, arg]);
    dirty = true;
    return true;
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    ev.preventDefault();
    act(el.dataset.action, argFor(el));
    if (el.dataset.action === 'price') $('priceInput').value = state.price;
    render();
  });

  $('priceForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const btn = ev.currentTarget.querySelector('[data-action]');
    if (!btn.disabled) { act('price', argFor(btn)); render(); }
  });
  $('priceInput').addEventListener('input', () => { dirty = true; render(); });

  // ---- speed ---------------------------------------------------------------
  const speedButtons = Array.from(document.querySelectorAll('[data-speed]'));
  function setSpeed(v) {
    speed = v === 'max' ? Infinity : Number(v);
    carry = 0;
    for (const b of speedButtons) b.setAttribute('aria-pressed', String(b.dataset.speed === String(v)));
  }
  for (const b of speedButtons) b.addEventListener('click', () => setSpeed(b.dataset.speed));

  // ---- simulation ----------------------------------------------------------
  function tickLimit() { return playback ? playback.replay.ticks : MAX_TICKS; }

  // Advances up to n ticks (applying replay actions during playback).
  // Returns the number of ticks actually run.
  function runTicks(n) {
    const limit = tickLimit();
    let done = 0;
    while (done < n && state.tick < limit) {
      if (playback) applyReplayActions();
      E.step(state);
      done++;
    }
    if (state.tick >= limit) reachedLimit();
    return done;
  }

  function applyReplayActions() {
    const p = playback, acts = p.replay.actions;
    while (p.index < acts.length && acts[p.index][0] === state.tick) {
      const a = acts[p.index++];
      if (E.applyAction(state, a[1], a[2])) recorded.push(a.slice());
      else p.rejected++;
    }
  }

  function reachedLimit() {
    if (playback) {
      const p = playback, r = p.replay;
      playback = null;
      const hash = E.stateHash(state);
      let msg = `Replay finished at tick ${fmtInt(state.tick)}: ${fmtInt(state.clips)} clips, hash ${hash}`;
      if (p.rejected) msg += `, ${p.rejected} rejected action(s)`;
      if (r.expect) {
        const ok = r.expect.clips === state.clips && r.expect.hash === hash;
        msg += ok ? ' (matches expect).' : ` (MISMATCH: expected ${fmtInt(r.expect.clips)} clips, hash ${r.expect.hash}).`;
        setMessage(msg, !ok);
      } else setMessage(msg + '.');
      setSpeed(0);
      $('priceInput').value = state.price;
    } else {
      setSpeed(0);
      setMessage(`Reached the ${fmtInt(MAX_TICKS)}-tick limit. Export your replay or start a new game.`);
    }
  }

  function frame(now) {
    if (lastFrame === null) { lastFrame = now; rateWindowStart = now; }
    const dt = Math.min(now - lastFrame, 250);
    lastFrame = now;
    let ran = 0;
    if (speed === Infinity) {
      const start = performance.now();
      do { ran += runTicks(512); } while (speed === Infinity && state.tick < tickLimit() && performance.now() - start < MAX_FRAME_MS);
    } else if (speed > 0) {
      carry += speed * dt / 1000;
      const n = Math.floor(carry);
      carry -= n;
      ran = runTicks(n);
    }
    if (ran) dirty = true;
    ticksThisSecond += ran;
    if (now - rateWindowStart >= 1000) {
      measuredRate = ticksThisSecond * 1000 / (now - rateWindowStart);
      ticksThisSecond = 0; rateWindowStart = now;
    }
    render();
    requestAnimationFrame(frame);
  }

  // ---- rendering (once per frame) ------------------------------------------
  let dirty = true;
  const textCache = new Map();
  function setText(id, text) {
    if (textCache.get(id) === text) return;
    textCache.set(id, text);
    $(id).textContent = text;
  }

  const upCostEls = Array.from(document.querySelectorAll('[data-upcost]'));
  for (const el of upCostEls) {
    const u = E.C.UPGRADES[el.dataset.upcost];
    el.textContent = u ? fmtMoney(u.cost) : '';
  }

  function render() {
    if (!dirty) return;
    dirty = false;
    const s = state;
    setText('clips', fmtInt(s.clips));
    setText('funds', fmtMoney(s.funds));
    setText('wire', fmtInt(s.wire));
    setText('inventory', fmtInt(s.inventory));
    setText('tick', fmtInt(s.tick));
    setText('seed', String(s.seed));
    setText('hash', E.stateHash(s));
    setText('price', fmtMoney(s.price));
    setText('spool', fmtInt(s.spool));
    setText('wirePrice', fmtMoney(E.wirePrice(s)));
    setText('autoclippers', fmtInt(s.autoclippers));
    setText('nextAutoCost', fmtMoney(s.nextAutoCost));
    setText('megaclippers', fmtInt(s.megaclippers));
    setText('nextMegaCost', fmtMoney(s.nextMegaCost));
    setText('extruders', fmtInt(s.extruders));
    setText('nextExtruderCost', fmtMoney(s.nextExtruderCost));
    setText('marketing', String(s.marketing));
    setText('nextMarketingCost', fmtMoney(s.nextMarketingCost));
    setText('actionCount', fmtInt(recorded.length));
    setText('mode', playback ? `Replay ${Math.floor(100 * s.tick / Math.max(1, playback.replay.ticks))}%` : 'Live');
    setText('rate', speed === 0 ? 'Paused' : `${fmtInt(Math.round(measuredRate))} ticks/s`);

    const allowed = canAct();
    for (const el of controls) {
      const ok = allowed && wouldAccept(el.dataset.action, argFor(el));
      if (el.disabled === ok) el.disabled = !ok;
    }
    for (const el of upCostEls) {
      const u = E.C.UPGRADES[el.dataset.upcost];
      el.classList.toggle('owned', !!(u && (s.upgrades & u.bit)));
    }
    $('exportReplay').disabled = !!playback;
  }

  // ---- replays -------------------------------------------------------------
  // Builds a format-1 replay of this session. If actions were taken at the
  // current (not yet stepped) tick, the replay covers one more tick so they
  // are inside [0, ticks); expect is computed on a copy stepped once.
  function buildReplay() {
    let ticks = state.tick, fin = state;
    if (recorded.length && recorded[recorded.length - 1][0] >= state.tick) {
      fin = { ...state };
      E.step(fin);
      ticks = fin.tick;
    }
    return {
      format: 1,
      seed: state.seed,
      ticks,
      expect: { clips: fin.clips, hash: E.stateHash(fin) },
      actions: recorded.map((a) => a.slice()),
    };
  }

  $('exportReplay').addEventListener('click', () => {
    if (playback) return;
    const r = buildReplay();
    const blob = new Blob([JSON.stringify(r) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `paperclips-seed${r.seed}-t${r.ticks}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setMessage(`Exported ${fmtInt(r.actions.length)} actions over ${fmtInt(r.ticks)} ticks (${r.expect.hash}).`);
  });

  // Structural checks only; whether actions are accepted is the engine's call.
  function checkReplay(r) {
    if (!r || typeof r !== 'object') return 'not a JSON object';
    if (r.format !== 1) return 'format must be 1';
    if (!Number.isInteger(r.seed) || r.seed < 0 || r.seed > 0xffffffff) return 'seed must be a uint32';
    if (!Number.isInteger(r.ticks) || r.ticks < 0 || r.ticks > MAX_TICKS) return `ticks must be in [0, ${MAX_TICKS}]`;
    if (!Array.isArray(r.actions)) return 'actions must be an array';
    let prev = 0;
    for (let i = 0; i < r.actions.length; i++) {
      const a = r.actions[i];
      if (!Array.isArray(a) || a.length < 2 || a.length > 3 || !Number.isInteger(a[0]) || typeof a[1] !== 'string') return `actions[${i}] is malformed`;
      if (a[0] < prev || a[0] >= r.ticks) return `actions[${i}] tick ${a[0]} is out of order or range`;
      prev = a[0];
    }
    return null;
  }

  function startPlayback(r) {
    newGame(r.seed);
    playback = { replay: r, index: 0, rejected: 0 };
    $('seedInput').value = r.seed;
    if (speed === 0) setSpeed('max');
    dirty = true;
    if (r.ticks === 0) reachedLimit();
    else setMessage(`Playing back ${fmtInt(r.actions.length)} actions over ${fmtInt(r.ticks)} ticks…`);
  }

  $('importReplay').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      let r;
      try { r = JSON.parse(text); } catch (e) { setMessage('Not valid JSON: ' + e.message, true); return; }
      const err = checkReplay(r);
      if (err) { setMessage('Invalid replay: ' + err, true); return; }
      startPlayback(r);
    }, (e) => setMessage('Could not read file: ' + e.message, true));
  });

  $('newForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = $('seedInput').value.trim();
    const seed = /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(seed) || seed > 0xffffffff) { setMessage('Seed must be an integer in [0, 4294967295].', true); return; }
    newGame(seed);
    dirty = true;
    render();
  });

  function setMessage(text, isError) {
    const el = $('message');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  // Small hook for automated checks and the console.
  globalThis.PaperclipUI = {
    get state() { return state; },
    get playing() { return !!playback; },
    exportReplay: buildReplay,
    setSpeed,
  };

  newGame(42);
  render();
  requestAnimationFrame(frame);
})();
