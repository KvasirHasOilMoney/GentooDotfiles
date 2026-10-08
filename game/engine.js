// Paperclip game rules engine (SPEC.md contract 1).
// Bit-for-bit identical to judge/rules.js. Works as a CommonJS module in Node
// and as a classic <script> in a browser (defines globalThis.PaperclipEngine).
// No imports, no wall-clock or ambient randomness: all state lives in the
// plain state object, whose own keys are exactly FIELDS.
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  }
  if (root) root.PaperclipEngine = api;
})(
  typeof globalThis !== 'undefined' ? globalThis
    : typeof self !== 'undefined' ? self
    : typeof window !== 'undefined' ? window
    : this,
  function () {
    'use strict';

    var C = Object.freeze({
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

    // Hash order is part of the spec.
    var FIELDS = [
      'seed', 'rng', 'tick', 'clips', 'inventory', 'wire', 'funds', 'price',
      'marketing', 'mktPermille', 'nextMarketingCost',
      'autoclippers', 'nextAutoCost', 'megaclippers', 'nextMegaCost',
      'extruders', 'nextExtruderCost', 'upgrades',
      'autoRate', 'megaRate', 'spool',
      'wireBase', 'wirePressure', 'progress', 'lastMakeTick',
    ];
    var NFIELDS = FIELDS.length;

    // Hoisted constants for the hot path.
    var WALK = C.WIRE_WALK_PERIOD;
    var WB_MIN = C.WIRE_BASE_MIN;
    var WB_MAX = C.WIRE_BASE_MAX;
    var EXT_RATE = C.EXTRUDER_RATE;
    var DEMAND_K = C.DEMAND_K;

    function fmix32(h) {
      h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
      h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      return h >>> 0;
    }

    function createState(seed) {
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('seed must be a uint32');
      return {
        seed: seed,
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

    function wirePrice(s) { return s.wireBase + s.wirePressure; }

    // Applies one action at the current tick (before step()). Returns true if
    // it took effect; false leaves the state untouched.
    function applyAction(s, type, arg) {
      var c;
      switch (type) {
        case 'make':
          if (s.lastMakeTick === s.tick || s.wire < 1) return false;
          s.wire -= 1; s.clips += 1; s.inventory += 1; s.lastMakeTick = s.tick;
          return true;
        case 'price':
          if (!Number.isInteger(arg) || arg < C.MIN_PRICE || arg > C.MAX_PRICE) return false;
          s.price = arg;
          return true;
        case 'wire':
          c = s.wireBase + s.wirePressure;
          if (s.funds < c) return false;
          s.funds -= c; s.wire += s.spool; s.wirePressure += C.WIRE_PRESSURE_PER_SPOOL;
          return true;
        case 'marketing':
          if (s.marketing >= C.MARKETING_MAX_LEVEL || s.funds < s.nextMarketingCost) return false;
          s.funds -= s.nextMarketingCost;
          s.marketing += 1; s.mktPermille *= 2; s.nextMarketingCost *= 4;
          return true;
        case 'autoclipper':
          c = s.nextAutoCost;
          if (s.funds < c) return false;
          s.funds -= c; s.autoclippers += 1; s.nextAutoCost = c + Math.ceil(c / 10);
          return true;
        case 'megaclipper':
          c = s.nextMegaCost;
          if (s.autoclippers < C.MEGA_UNLOCK_AUTOS || s.funds < c) return false;
          s.funds -= c; s.megaclippers += 1; s.nextMegaCost = c + Math.ceil(c / 10);
          return true;
        case 'extruder':
          c = s.nextExtruderCost;
          if (s.funds < c) return false;
          s.funds -= c; s.extruders += 1; s.nextExtruderCost = c + Math.ceil(c / 10);
          return true;
        case 'upgrade': {
          var bit, cost;
          if (arg === 'autoboost') { bit = 1; cost = 50000; }
          else if (arg === 'bigspool') { bit = 2; cost = 300000; }
          else if (arg === 'megaboost') { bit = 4; cost = 100000000; }
          else return false;
          if ((s.upgrades & bit) || s.funds < cost) return false;
          s.funds -= cost; s.upgrades |= bit;
          if (bit === 1) s.autoRate = 250;
          else if (bit === 2) s.spool = 3000;
          else s.megaRate = 100000;
          return true;
        }
        default:
          return false;
      }
    }

    // Advances one tick. Allocation-free. RNG draws never depend on actions.
    function step(s) {
      var x = s.rng, r;
      var tick = s.tick;
      if (tick % WALK === 0) {
        x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
        var wb = s.wireBase + (x % 201) - 100;
        s.wireBase = wb > WB_MAX ? WB_MAX : (wb < WB_MIN ? WB_MIN : wb);
      }
      var wire = s.wire + s.extruders * EXT_RATE;
      var progress = s.progress + s.autoclippers * s.autoRate + s.megaclippers * s.megaRate;
      var made = Math.floor(progress / 1000);
      if (made > wire) made = wire;
      wire -= made;
      s.wire = wire;
      s.clips += made;
      var inventory = s.inventory + made;
      progress -= made * 1000;
      s.progress = progress < 999 ? progress : 999;

      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      s.rng = x;
      r = x;
      var price = s.price;
      var demandMilli = Math.floor(s.mktPermille * DEMAND_K / (price * price));
      var want = Math.floor(demandMilli / 1000) + ((r % 1000) < (demandMilli % 1000) ? 1 : 0);
      var sold = want < inventory ? want : inventory;
      s.inventory = inventory - sold;
      s.funds += sold * price;
      var wp = s.wirePressure;
      s.wirePressure = wp - Math.ceil(wp / 1000);
      s.tick = tick + 1;
    }

    // FNV-1a 32-bit over FIELDS rendered with String() and joined by ','.
    function stateHash(s) {
      var h = 0x811c9dc5;
      for (var f = 0; f < NFIELDS; f++) {
        if (f > 0) h = Math.imul(h ^ 44, 0x01000193); // ','
        var str = String(s[FIELDS[f]]);
        for (var i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
      }
      var hex = (h >>> 0).toString(16);
      while (hex.length < 8) hex = '0' + hex;
      return hex;
    }

    function checkSafe(s) {
      for (var f = 0; f < NFIELDS; f++) {
        var k = FIELDS[f];
        if (!Number.isSafeInteger(s[k])) throw new Error('state.' + k + ' is not a safe integer: ' + s[k]);
      }
    }

    return {
      C: C,
      FIELDS: FIELDS,
      createState: createState,
      applyAction: applyAction,
      step: step,
      stateHash: stateHash,
      wirePrice: wirePrice,
      checkSafe: checkSafe,
    };
  }
);
