'use strict';
// Reference rules for the paperclip game. This file IS the executable spec:
// SPEC.md describes it in prose, and where the two disagree, this file wins.
// judge/ is read-only for every contributor once frozen.

const C = Object.freeze({
  MAX_TICKS: 2000000,
  MAX_ACTIONS_PER_TICK: 1000,
  START_WIRE: 1000,
  START_PRICE: 25,
  MIN_PRICE: 1,
  MAX_PRICE: 10000,
  DEMAND_K: 320,
  WIRE_BASE_START: 2000,
  WIRE_BASE_MIN: 1000,
  WIRE_BASE_MAX: 3000,
  WIRE_WALK_PERIOD: 250,
  WIRE_PRESSURE_PER_SPOOL: 100,
  SPOOL: 1000,
  AUTO_COST_START: 500,
  AUTO_RATE: 100,
  MEGA_UNLOCK_AUTOS: 50,
  MEGA_COST_START: 1000000,
  MEGA_RATE: 50000,
  EXTRUDER_COST_START: 2000000,
  EXTRUDER_RATE: 500,
  MARKETING_COST_START: 10000,
  MARKETING_MAX_LEVEL: 30,
  UPGRADES: Object.freeze({
    autoboost: Object.freeze({ bit: 1, cost: 50000 }),
    bigspool: Object.freeze({ bit: 2, cost: 300000 }),
    megaboost: Object.freeze({ bit: 4, cost: 100000000 }),
  }),
});

// Field order is part of the spec: stateHash hashes these fields in this order.
const FIELDS = [
  'seed', 'rng', 'tick', 'clips', 'inventory', 'wire', 'funds', 'price',
  'marketing', 'mktPermille', 'nextMarketingCost',
  'autoclippers', 'nextAutoCost', 'megaclippers', 'nextMegaCost',
  'extruders', 'nextExtruderCost', 'upgrades',
  'autoRate', 'megaRate', 'spool',
  'wireBase', 'wirePressure', 'progress', 'lastMakeTick',
];

function fmix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function nextRng(s) {
  let x = s.rng;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  s.rng = x;
  return x;
}

function createState(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('seed must be a uint32');
  return {
    seed,
    rng: fmix32(seed ^ 0x9e3779b9) || 1,
    tick: 0,
    clips: 0,
    inventory: 0,
    wire: C.START_WIRE,
    funds: 0,
    price: C.START_PRICE,
    marketing: 1,
    mktPermille: 1000,
    nextMarketingCost: C.MARKETING_COST_START,
    autoclippers: 0,
    nextAutoCost: C.AUTO_COST_START,
    megaclippers: 0,
    nextMegaCost: C.MEGA_COST_START,
    extruders: 0,
    nextExtruderCost: C.EXTRUDER_COST_START,
    upgrades: 0,
    autoRate: C.AUTO_RATE,
    megaRate: C.MEGA_RATE,
    spool: C.SPOOL,
    wireBase: C.WIRE_BASE_START,
    wirePressure: 0,
    progress: 0,
    lastMakeTick: -1,
  };
}

const grow10 = (c) => c + Math.ceil(c / 10);

function wirePrice(s) { return s.wireBase + s.wirePressure; }

// Applies one action at the current tick (before step()). Returns true if it
// took effect, false if it was rejected (state is then unchanged).
function applyAction(s, type, arg) {
  switch (type) {
    case 'make':
      if (s.lastMakeTick === s.tick || s.wire < 1) return false;
      s.wire -= 1; s.clips += 1; s.inventory += 1; s.lastMakeTick = s.tick;
      return true;
    case 'price':
      if (!Number.isInteger(arg) || arg < C.MIN_PRICE || arg > C.MAX_PRICE) return false;
      s.price = arg;
      return true;
    case 'wire': {
      const cost = wirePrice(s);
      if (s.funds < cost) return false;
      s.funds -= cost; s.wire += s.spool; s.wirePressure += C.WIRE_PRESSURE_PER_SPOOL;
      return true;
    }
    case 'marketing':
      if (s.marketing >= C.MARKETING_MAX_LEVEL || s.funds < s.nextMarketingCost) return false;
      s.funds -= s.nextMarketingCost;
      s.marketing += 1; s.mktPermille *= 2; s.nextMarketingCost *= 4;
      return true;
    case 'autoclipper':
      if (s.funds < s.nextAutoCost) return false;
      s.funds -= s.nextAutoCost; s.autoclippers += 1; s.nextAutoCost = grow10(s.nextAutoCost);
      return true;
    case 'megaclipper':
      if (s.autoclippers < C.MEGA_UNLOCK_AUTOS || s.funds < s.nextMegaCost) return false;
      s.funds -= s.nextMegaCost; s.megaclippers += 1; s.nextMegaCost = grow10(s.nextMegaCost);
      return true;
    case 'extruder':
      if (s.funds < s.nextExtruderCost) return false;
      s.funds -= s.nextExtruderCost; s.extruders += 1; s.nextExtruderCost = grow10(s.nextExtruderCost);
      return true;
    case 'upgrade': {
      const u = Object.prototype.hasOwnProperty.call(C.UPGRADES, arg) ? C.UPGRADES[arg] : null;
      if (!u || (s.upgrades & u.bit) || s.funds < u.cost) return false;
      s.funds -= u.cost; s.upgrades |= u.bit;
      if (arg === 'autoboost') s.autoRate = 250;
      else if (arg === 'bigspool') s.spool = 3000;
      else if (arg === 'megaboost') s.megaRate = 100000;
      return true;
    }
    default:
      return false;
  }
}

// Advances one tick. RNG draws do not depend on player actions.
function step(s) {
  if (s.tick % C.WIRE_WALK_PERIOD === 0) {
    const r = nextRng(s);
    s.wireBase = Math.min(C.WIRE_BASE_MAX, Math.max(C.WIRE_BASE_MIN, s.wireBase + (r % 201) - 100));
  }
  s.wire += s.extruders * C.EXTRUDER_RATE;
  s.progress += s.autoclippers * s.autoRate + s.megaclippers * s.megaRate;
  const made = Math.min(Math.floor(s.progress / 1000), s.wire);
  s.wire -= made; s.clips += made; s.inventory += made;
  s.progress = Math.min(s.progress - made * 1000, 999);
  const r = nextRng(s);
  const demandMilli = Math.floor(s.mktPermille * C.DEMAND_K / (s.price * s.price));
  const want = Math.floor(demandMilli / 1000) + ((r % 1000) < (demandMilli % 1000) ? 1 : 0);
  const sold = Math.min(want, s.inventory);
  s.inventory -= sold; s.funds += sold * s.price;
  s.wirePressure -= Math.ceil(s.wirePressure / 1000);
  s.tick += 1;
}

// FNV-1a 32-bit over the decimal rendering of FIELDS joined by ','.
function stateHash(s) {
  const str = FIELDS.map((k) => String(s[k])).join(',');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function checkSafe(s) {
  for (const k of FIELDS) if (!Number.isSafeInteger(s[k])) throw new Error(`state.${k} is not a safe integer: ${s[k]}`);
}

module.exports = { C, FIELDS, createState, applyAction, step, stateHash, wirePrice, checkSafe };
