'use strict';
// Parameterized greedy policy for the paperclip game.
//
// run(engine, seed, ticks, params, record) simulates a whole game with the
// given engine (game/engine.js or judge/rules.js; identical API) and returns
// { state, actions }. Only actions that the engine accepted are recorded, so
// the replay is rejection-free by construction, and since the policy reads
// nothing but the engine state and its parameters, the output is a pure
// function of (seed, ticks, params).
//
// Economics the policy is built around:
//  * Every clip made counts, sold or not, so all inventory should be sold:
//    selling S clips/tick at the market-clearing price p = sqrt(0.32*mkt/S)
//    earns sqrt(0.32*mkt*S) cents/tick.
//  * Capacity (autoclippers, megaclippers, boosts) is bought greedily by
//    clips/tick gained per cent, saving up for the best option.
//  * Wire comes from extruders (free, 500/tick) and from spools whose price
//    rises by 100 per purchase and decays 0.1%/tick.
//  * Marketing doubles demand (revenue x sqrt 2) for x4 cost; it is bought
//    (and saved for) when its revenue payback time beats the best capacity
//    item's by a tuned factor and is short relative to the ticks left.
//  * Capacity costs do not change with time, so buying as soon as affordable
//    is right; final clips grow only ~log(total revenue) because every
//    producer costs x1.1 more than the last.

const DEFAULTS = Object.freeze({
  makeCap: 50, // hand-make clips (1/tick) while machine capacity is below this many clips/tick
  priceEvery: 25, // once machines run, re-price only every this many ticks
  priceMul: 1.874, // scale on the market-clearing price
  invTau: 24.27, // inventory is drained over this many ticks via the price
  mktBias: 2.456, // marketing preferred when its revenue payback * mktBias <= best capacity payback
  mktRemFrac: 0.3, // and its payback is under this fraction of the remaining ticks
  extCostFrac: 0.4204, // extruder ok when cost <= extCostFrac * next capacity item cost
  wireBuf: 12.37, // keep this many ticks of production in wire stock
  wireMaxRatio: 0.2973, // max spool cost per wire, as a fraction of the clip price
  extRatio: 0.9715, // extruders target: 500*E >= extRatio * capacity
  extPayback: 20000, // buy extruder if it costs <= this many ticks of the spools it replaces
  bigspoolAt: 3, // buy bigspool after this many spools have been bought
  reserveSpools: 0.2102, // funds kept back for wire when wire is short
  endTicks: 20000, // in the last endTicks, buy wire regardless of price
});

function run(E, seed, ticks, params, record) {
  const P = Object.assign({}, DEFAULTS, params || {});
  const s = E.createState(seed);
  const acts = record ? [] : null;
  const MEGA_UNLOCK = E.C.MEGA_UNLOCK_AUTOS;
  const MKT_MAX = E.C.MARKETING_MAX_LEVEL;
  const BIG = E.C.UPGRADES.bigspool;
  const AB = E.C.UPGRADES.autoboost;
  const MB = E.C.UPGRADES.megaboost;
  let spoolsBought = 0;

  const act = (type, arg) => {
    if (!E.applyAction(s, type, arg)) return false;
    if (acts) acts.push(arg === undefined ? [s.tick, type] : [s.tick, type, arg]);
    return true;
  };

  for (let t = 0; t < ticks; t++) {
    const rem = ticks - t;
    let n = 0; // actions this tick (max 1000)

    const making = s.autoclippers * s.autoRate + s.megaclippers * s.megaRate < P.makeCap * 1000;
    if (making && s.wire >= 1) { act('make'); n++; }

    // Capacity in clips/tick (float) and wire inflow.
    const capOf = () => (s.autoclippers * s.autoRate + s.megaclippers * s.megaRate) / 1000 + (making ? 1 : 0);
    let cap = capOf();
    const wireIn = () => 500 * s.extruders;

    // --- bigspool ---
    if (!(s.upgrades & BIG.bit) && s.funds >= BIG.cost && spoolsBought >= P.bigspoolAt) {
      if (act('upgrade', 'bigspool')) n++;
    }

    // --- Wire spools: keep production fed ---
    {
      const need = cap * P.wireBuf - wireIn() * P.wireBuf;
      const endgame = rem <= P.endTicks;
      while (n < 990 && s.wire < need) {
        const cost = s.wireBase + s.wirePressure;
        if (!endgame && cost / s.spool > P.wireMaxRatio * s.price) break;
        if (endgame && s.wire >= cap * rem) break;
        if (!act('wire')) break;
        spoolsBought++; n++;
      }
    }

    // --- Capacity vs marketing (greedy, revenue payback comparison) ---
    // Keep enough funds for a spool while wire inflow does not cover capacity.
    // Never spend below what is needed to buy the next spool once the wire
    // and inventory on hand are sold (otherwise the game can stall).
    let reserve = 0;
    if (wireIn() < capOf()) {
      const spoolCost = s.wireBase + s.wirePressure;
      if (s.wire < capOf() * P.wireBuf * 2) reserve = spoolCost * P.reserveSpools;
      reserve = Math.max(reserve, spoolCost - (s.inventory + s.wire) * Math.max(1, s.price - 1) / 2);
    }
    while (n < 990) {
      cap = capOf();
      let best = null, bestGain = 0, bestCost = 0, bestEff = 0;
      const consider = (name, gain, cost) => {
        const eff = gain / cost;
        if (eff > bestEff) { best = name; bestGain = gain; bestCost = cost; bestEff = eff; }
      };
      consider('autoclipper', s.autoRate / 1000, s.nextAutoCost);
      if (s.autoclippers >= MEGA_UNLOCK) consider('megaclipper', s.megaRate / 1000, s.nextMegaCost);
      else {
        // a megaclipper needs the remaining autoclippers first: rate the bundle
        let c = s.nextMegaCost, g = s.megaRate / 1000, ac = s.nextAutoCost;
        for (let a = s.autoclippers; a < MEGA_UNLOCK; a++) { c += ac; ac += Math.ceil(ac / 10); g += s.autoRate / 1000; }
        if (g / c > bestEff) { best = 'autoclipper'; bestGain = s.autoRate / 1000; bestCost = s.nextAutoCost; bestEff = g / c; }
      }
      if (!(s.upgrades & AB.bit) && s.autoclippers > 0) consider('autoboost', s.autoclippers * (250 - s.autoRate) / 1000, AB.cost);
      if (!(s.upgrades & MB.bit) && s.megaclippers > 0) consider('megaboost', s.megaclippers * (100000 - s.megaRate) / 1000, MB.cost);

      // Marketing: compare revenue payback times.
      if (s.marketing < MKT_MAX && Number.isSafeInteger(s.nextMarketingCost * 4)) {
        const S = Math.max(cap, 0.1);
        const R = Math.sqrt(0.32 * s.mktPermille * S);
        const pm = s.nextMarketingCost / ((Math.SQRT2 - 1) * R);
        const dRc = best ? R * (Math.sqrt(1 + bestGain / S) - 1) : 0;
        const pc = best ? bestCost / dRc : Infinity;
        if (pm <= rem * P.mktRemFrac && pm * P.mktBias <= pc) {
          if (s.funds - s.nextMarketingCost >= reserve && act('marketing')) { n++; continue; }
          break; // save for it
        }
      }

      // Extruder: when wire inflow is short of capacity and it is cheap.
      if (wireIn() < cap * P.extRatio) {
        const c = s.nextExtruderCost;
        const spoolPerWire = (s.wireBase + s.wirePressure) / s.spool;
        if (s.funds - c >= reserve && (c <= P.extCostFrac * bestCost || c <= P.extPayback * 500 * spoolPerWire) && act('extruder')) { n++; continue; }
      }

      if (!best || s.funds - bestCost < reserve) break;
      if (best === 'autoboost' || best === 'megaboost') { if (!act('upgrade', best)) break; }
      else if (!act(best)) break;
      n++;
    }

    // --- Price: clear production plus a share of inventory ---
    {
      cap = capOf();
      const avail = s.wire + wireIn();
      const prod = Math.min(cap, avail + (making ? 1 : 0));
      const S = prod + s.inventory / P.invTau;
      if (S > 0 && (making || t % P.priceEvery === 0)) {
        let p = Math.round(P.priceMul * Math.sqrt(0.32 * s.mktPermille / S));
        if (p < 1) p = 1; else if (p > 10000) p = 10000;
        if (p !== s.price) act('price', p);
      }
    }

    E.step(s);
  }
  return { state: s, actions: acts };
}

module.exports = { run, DEFAULTS };
