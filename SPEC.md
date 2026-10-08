# Paperclips: spec and interface contracts

A deterministic incremental paperclip game, playable in a browser, plus an
autoplayer. The objective for the autoplayer is to maximize `clips` at seed 42
after exactly 2,000,000 ticks, with every test passing and the replay
reproducing exactly.

## Authority and ownership

`judge/` is the referee and is read-only for everyone, lead included. Its
`judge/rules.js` is the executable rules spec; where this prose and that file
disagree, `rules.js` wins. Anyone may read `judge/`; nobody edits it.

| Path | Owner | Notes |
|---|---|---|
| `SPEC.md`, `package.json`, `.claude/`, `README.md` | lead | |
| `judge/` | nobody (frozen) | rules, replay runner, verifier, conformance tests |
| `game/engine.js`, `game/test/` | engine agent | rules implementation for browser and Node |
| `game/index.html`, `game/ui.js`, `game/style.css` | ui agent | browser front end |
| `autoplayer/`, `replays/` | autoplayer agent | strategy + the committed seed-42 replay |

Each agent works in its own git worktree and touches only its paths.

`npm test` runs every test (`judge/test`, plus `game/test` and
`autoplayer/test` if present). `node judge/verify.js` prints the score.

## Rules

All quantities are integers (JavaScript safe integers); money is in cents.
A run has a seed (uint32) and lasts `ticks` ticks (at most 2,000,000).

State fields, in hash order: `seed, rng, tick, clips, inventory, wire, funds,
price, marketing, mktPermille, nextMarketingCost, autoclippers, nextAutoCost,
megaclippers, nextMegaCost, extruders, nextExtruderCost, upgrades, autoRate,
megaRate, spool, wireBase, wirePressure, progress, lastMakeTick`.

Initial state: `rng = fmix32(seed ^ 0x9e3779b9) || 1` (murmur3 finalizer),
wire 1000, price 25, marketing level 1 at 1000 permille, funds 0,
autoclipper cost 500, megaclipper cost 1,000,000, extruder cost 2,000,000,
marketing cost 10,000, autoRate 100, megaRate 50,000, spool 1000, wireBase
2000, wirePressure 0, progress 0, lastMakeTick −1, everything else 0.

The RNG is xorshift32 (`x^=x<<13; x^=x>>>17; x^=x<<5`, all as uint32).

Within a tick, the player's actions are applied first, in order, then `step`
runs:

1. If `tick % 250 == 0`: draw `r`; `wireBase = clamp(wireBase + r%201 − 100, 1000, 3000)`.
2. `wire += extruders × 500`.
3. `progress += autoclippers × autoRate + megaclippers × megaRate` (milli-clips);
   `made = min(floor(progress/1000), wire)`; wire −= made, clips += made,
   inventory += made; `progress = min(progress − 1000·made, 999)`.
4. Draw `r`; `demandMilli = floor(mktPermille × 320 / price²)`;
   `want = floor(demandMilli/1000) + (r%1000 < demandMilli%1000 ? 1 : 0)`;
   `sold = min(want, inventory)`; inventory −= sold; funds += sold × price.
5. `wirePressure −= ceil(wirePressure/1000)`.
6. `tick += 1`.

RNG draws never depend on the player's actions. Wire costs
`wireBase + wirePressure` per spool.

Actions (`applyAction(state, type, arg)` returns `true` if it took effect,
`false` and leaves the state untouched otherwise):

| type | arg | effect |
|---|---|---|
| `make` | — | once per tick, needs 1 wire: wire −1, clips +1, inventory +1 |
| `price` | integer 1..10000 | sets price |
| `wire` | — | pay wire price; wire += spool; wirePressure += 100 |
| `marketing` | — | level < 30, pay cost; level +1, mktPermille ×2, cost ×4 |
| `autoclipper` | — | pay cost; +1; cost += ceil(cost/10) |
| `megaclipper` | — | needs ≥ 50 autoclippers; pay cost; +1; cost += ceil(cost/10) |
| `extruder` | — | pay cost; +1; cost += ceil(cost/10) |
| `upgrade` | `autoboost` (50,000) / `bigspool` (300,000) / `megaboost` (100,000,000) | one-shot; sets autoRate 250 / spool 3000 / megaRate 100,000; `upgrades` bit 1 / 2 / 4 |

Anything else returns `false`.

## Contract 1: engine (`game/engine.js`)

A single plain-JavaScript file that works both as a CommonJS module in Node
and as a classic `<script>` in a browser, where it defines
`globalThis.PaperclipEngine`. It must not import anything (in particular not
`judge/`) and must not use `Math.random`, `Date` or `performance.now`.

Exports: `C` (deep-equal to `judge/rules.js`'s `C`), `FIELDS` (same array),
`createState(seed)`, `applyAction(state, type, arg) → boolean`,
`step(state)`, `stateHash(state) → 8-hex-digit string`, `wirePrice(state)`.

The state is a plain object whose own keys are exactly `FIELDS`. Callers may
read it, copy it with `{...s}` or `structuredClone`, and the judge's tests
write fields directly; the engine must keep no hidden state outside it.
`stateHash` is FNV-1a 32-bit over `FIELDS.map(k => String(s[k])).join(',')`.

The judge checks this by differential fuzzing against `judge/rules.js`.

## Contract 2: replay format

```json
{"format":1,"seed":42,"ticks":2000000,"expect":{"clips":123,"hash":"0123abcd"},"actions":[[0,"make"],[0,"price",30],[17,"upgrade","autoboost"]]}
```

`actions` entries are `[tick, type]` or `[tick, type, arg]`, sorted by tick
(stable order within a tick is the application order), `0 ≤ tick < ticks`,
at most 1000 per tick. `expect` holds the final `clips` and `stateHash`. A
submitted replay must have zero rejected actions. `judge/replay.js` is the
reference runner.

## Contract 3: browser UI (`game/index.html`, `game/ui.js`, `game/style.css`)

A static page that works from `file://` and from any static server, with no
remote resources. It loads `engine.js` then `ui.js` with plain `<script src>`
tags and uses only `PaperclipEngine` for game logic (no rules in `ui.js`).

It shows at least elements with ids `clips`, `funds`, `wire`, `tick`, and has
buttons or controls carrying `data-action` = `make`, `wire`, `autoclipper`,
`megaclipper`, `extruder`, `marketing`, plus price controls and the three
upgrades. Controls are disabled when the action would be rejected.

Time advances at a selectable speed (pause, 10, 100, 1000 ticks/s, and max).
Every successful player action is recorded with its tick, so the session can
be exported as a format-1 replay. The page can also import a replay JSON file
and play it back (so `replays/seed42.json` can be watched), and can start a
new game from a chosen seed.

## Contract 4: autoplayer (`autoplayer/play.js`)

```
node autoplayer/play.js --seed 42 [--ticks 2000000] [--out replays/seed42.json]
```

Writes a format-1 replay with `expect` filled in, serialized as
`JSON.stringify` of an object with keys in the order `format, seed, ticks,
expect, actions` plus a trailing newline. Output must be a pure function of
the arguments: no `Math.random`, `Date` or wall-clock time limits that change
the result. It simulates with `game/engine.js` (it may use `judge/rules.js`
while the engine is being written, since the API is identical, but the final
version requires `game/engine.js`). A full 2,000,000-tick run should take under
5 minutes (the judge's hard timeout is 10). It must also produce valid,
rejection-free replays for other seeds and shorter `--ticks`.

`replays/seed42.json` is committed and must equal the output of
`node autoplayer/play.js --seed 42` byte for byte.
