// lib/model.ts — the value model, its validation, and the farm-plan economics.
// Standard library only; deterministic (seeded PRNG, no clock, no Math.random).
//
// THE MODEL (stated once here, and again on the page):
//   implied_value = sizeCurve(tvl) * (1 + 0.25 * clamp(change_7d_frac, -0.60, +1.20))
//   sizeCurve(tvl) = 10 ^ (3.4745 + 0.4513 * log10(tvl))
// The coefficients come from a Huber fit of log10(mcap) on log10(tvl) across the
// 99 comparables (protocols with a positive market cap and TVL, minus CEX, versioned
// names, stable-like categories and bridges). The growth tilt is FIXED, not fitted.
// No age feature, no market-cap floor, no category effects: all three were tested
// against time-split validation and made it worse (see validation()).

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null; // PER CENT in the snapshot: 26.3009 means +26.3009%
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  /** Model inputs, echoed so the page needs no second lookup. */
  tvl_usd: number;
  change_7d: number | null;
  category: string | null;
  chains: string[];
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  /** Multiple of TVL, for the page. */
  multiple: number;
  growth_mult: number;
  /** Bootstrap band: P10-P90 of the prediction, and of the rank, over 200 refits. */
  band_p10_usd: number;
  band_p90_usd: number;
  rank_lo: number;
  rank_hi: number;
  /** Farm plan, netted twice (point value and band low), in the default assumptions. */
  farm: FarmPlan;
  farm_steps: string[];
}

export interface FarmPlan {
  ticket_usd: number;
  hold_weeks: number;
  airdrop_share: number;
  slice_usd: number;
  chain: string;
  gas_usd: number;
  fee_pct: number;
  cash_fees_usd: number;
  gas_total_usd: number;
  forgone_yield_usd: number;
  net_point_usd: number;
  net_low_usd: number;
  hours: number;
  net_per_hour_point: number;
  net_per_hour_low: number;
  verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
}

export const COEF = { intercept: 3.4745, slope: 0.4513 };
export const GROWTH = { clampLo: -0.6, clampHi: 1.2, weight: 0.25 };
export const ASSUMPTIONS = {
  airdrop_share: 0.1, // 10% of the launch goes to depositors, pro rata
  tbill_rate: 0.04, // annual T-bill rate, the forgone yield
  bootstrap: 200,
  seed: 20261114,
};

// ------------------------------------------------------------------ selection

const VERSION_MARKER = /\s+(?:V|v)?\d+(?:\.\d+)?$/;
const NOT_COMPARABLE_CATS = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);

/** Spec rules: positive mcap and TVL; drop CEX, versioned names, stable categories, bridges. */
export function isComparable(p: Protocol): boolean {
  if (!(p.mcap_usd! > 0) || !(p.tvl_usd > 0)) return false;
  if (p.category === 'CEX') return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if ((p.category ?? '').toLowerCase().includes('stable')) return false;
  if (p.category !== null && NOT_COMPARABLE_CATS.has(p.category)) return false;
  return true;
}

export const comparables = (protocols: Protocol[]): Protocol[] => protocols.filter(isComparable);

// ------------------------------------------------------------------ the curve

export const sizeCurve = (tvl: number): number => 10 ** (COEF.intercept + COEF.slope * Math.log10(tvl));

export function growthMultiplier(change_pct: number | null): number {
  const g = change_pct == null ? 0 : change_pct / 100;
  const c = Math.min(GROWTH.clampHi, Math.max(GROWTH.clampLo, g));
  return 1 + GROWTH.weight * c;
}

/** The point prediction in whole dollars; the growth tilt is FIXED, not fitted. */
export function impliedValue(tvl: number, change_pct: number | null): number {
  return Math.round(sizeCurve(tvl) * growthMultiplier(change_pct));
}

// ------------------------------------------------------------------ the fit

export interface Fit {
  intercept: number;
  slope: number;
}

/** Ordinary least squares of y on x; the bootstrap's refit. */
export function ols(xs: number[], ys: number[]): Fit {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/**
 * Huber fit: OLS first, then reweight points whose residual is beyond 1.5 x the
 * MAD-based scale by scale/|residual| and refit, until the coefficients settle.
 * The spec's published line (3.4745, 0.4513) is what this reproduces on the 99.
 */
export function huber(xs: number[], ys: number[]): Fit {
  const n = xs.length;
  let w = new Array<number>(n).fill(1);
  let fit = ols(xs, ys);
  for (let iter = 0; iter < 50; iter++) {
    const res = xs.map((x, i) => ys[i] - (fit.intercept + fit.slope * x));
    const abs = res.map(Math.abs).sort((a, b) => a - b);
    const scale = Math.max(1e-9, abs[Math.floor(n / 2)] / 0.6745);
    w = res.map((r) => {
      const a = Math.abs(r);
      return a <= 1.5 * scale ? 1 : (1.5 * scale) / a;
    });
    const sw = w.reduce((s, v) => s + v, 0);
    const mx = xs.reduce((s, v, i) => s + w[i] * v, 0) / sw;
    const my = ys.reduce((s, v, i) => s + w[i] * v, 0) / sw;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += w[i] * (xs[i] - mx) ** 2;
      sxy += w[i] * (xs[i] - mx) * (ys[i] - my);
    }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    const next = { intercept: my - slope * mx, slope };
    const moved = Math.abs(next.intercept - fit.intercept) + Math.abs(next.slope - fit.slope);
    fit = next;
    if (moved < 1e-10) break;
  }
  return fit;
}

// ------------------------------------------------------------------ PRNG

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

// ------------------------------------------------------------------ validation

export interface ValidationLine {
  name: string;
  miss: number;
  within3x: number;
  within10x: number;
}

export interface Validation {
  comparables: number;
  model: { loo: ValidationLine; timeSplit: ValidationLine; newest33: ValidationLine };
  flat: { loo: ValidationLine; timeSplit: ValidationLine };
  flatMultiple: number;
  cutoff: string;
}

const missFactor = (pred: number, act: number): number => Math.max(pred / act, act / pred);

function summarise(name: string, pairs: Array<[number, number]>): ValidationLine {
  const miss = pairs.map(([p, a]) => missFactor(p, a));
  const sorted = [...miss].sort((a, b) => a - b);
  const median = sorted.length === 0 ? NaN : pct(sorted, 0.5);
  // Growth is not available retrospectively for the comparables' own history, so the
  // backtest predicts with the size curve alone (g = 0): the growth tilt is fixed and
  // small, and applying a 2026 one-week move to a 2022 test point would be leakage.
  return {
    name,
    miss: Math.round(median * 100) / 100,
    within3x: Math.round((100 * miss.filter((m) => m <= 3).length) / Math.max(1, miss.length) * 10) / 10,
    within10x: Math.round((100 * miss.filter((m) => m <= 10).length) / Math.max(1, miss.length) * 10) / 10,
  };
}

/** Fit on the given indices (of the comparables) and predict the held-out ones. */
function holdout(fit: Fit, p: Protocol): number {
  return 10 ** (fit.intercept + fit.slope * Math.log10(p.tvl_usd));
}

export function validation(comps: Protocol[]): Validation {
  const lx = comps.map((p) => Math.log10(p.tvl_usd));
  const ly = comps.map((p) => Math.log10(p.mcap_usd!));

  // Leave-one-out on the Huber-robust line.
  const loo: Array<[number, number]> = comps.map((p, i) => {
    const xs = lx.filter((_, j) => j !== i);
    const ys = ly.filter((_, j) => j !== i);
    return [holdout(huber(xs, ys), p), p.mcap_usd!];
  });

  // Calendar time split: fit on listed before 2024-01-01, test on 2024 or later.
  const early: number[] = [];
  const late: number[] = [];
  comps.forEach((p, i) => {
    const y = p.listed_at ? Number(p.listed_at.slice(0, 4)) : 0;
    if (y > 0 && p.listed_at! < '2024-01-01') early.push(i);
    else if (p.listed_at && p.listed_at >= '2024-01-01') late.push(i);
  });
  const fitEarly = early.length > 2 ? huber(early.map((i) => lx[i]), early.map((i) => ly[i])) : { intercept: COEF.intercept, slope: COEF.slope };
  const timeSplit: Array<[number, number]> = late.map((i) => [holdout(fitEarly, comps[i]), comps[i].mcap_usd!]);

  // Newest 33: fit on the rest, test on the 33 with the latest listing dates.
  const dated = comps.map((p, i) => ({ i, d: p.listed_at ?? '' })).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const newest = dated.slice(-33).map((x) => x.i);
  const newestSet = new Set(newest);
  const rest = comps.map((_, i) => i).filter((i) => !newestSet.has(i));
  const fitRest = rest.length > 2 ? huber(rest.map((i) => lx[i]), rest.map((i) => ly[i])) : fitEarly;
  const newest33: Array<[number, number]> = newest.map((i) => [holdout(fitRest, comps[i]), comps[i].mcap_usd!]);

  // The flat multiple: one number, market cap / TVL, the honest baseline.
  const flatMultiple = comps.reduce((s, p) => s + p.mcap_usd!, 0) / comps.reduce((s, p) => s + p.tvl_usd, 0);
  const flatLoo: Array<[number, number]> = comps.map((p) => [p.tvl_usd * flatMultiple, p.mcap_usd!]);
  const flatSplit: Array<[number, number]> = late.map((i) => [comps[i].tvl_usd * flatMultiple, comps[i].mcap_usd!]);

  return {
    comparables: comps.length,
    model: {
      loo: summarise('leave-one-out', loo),
      timeSplit: summarise('time-split 2024+', timeSplit),
      newest33: summarise('newest 33', newest33),
    },
    flat: {
      loo: summarise('flat multiple, leave-one-out', flatLoo),
      timeSplit: summarise('flat multiple, time-split 2024+', flatSplit),
    },
    flatMultiple: Math.round(flatMultiple * 10000) / 10000,
    cutoff: '2024-01-01',
  };
}

// ------------------------------------------------------------------ the band

export interface BandCfg {
  resamples: number;
  seed: number;
}

/** Fixed-coefficient prediction with g = 0, used to keep the band comparable. */
const curveAt = (fit: Fit, tvl: number): number => 10 ** (fit.intercept + fit.slope * Math.log10(tvl));

/**
 * Bootstrap refits: resample the comparables with replacement, refit, re-predict every
 * board protocol, and keep the P10-P90 of the prediction and of the rank across refits.
 * Seeded, so two runs are byte-identical.
 */
export function bootstrapBands(
  comps: Protocol[],
  board: Protocol[],
  cfg: BandCfg = { resamples: ASSUMPTIONS.bootstrap, seed: ASSUMPTIONS.seed },
): Map<string, { lo: number; hi: number; rankLo: number; rankHi: number }> {
  const lx = comps.map((p) => Math.log10(p.tvl_usd));
  const ly = comps.map((p) => Math.log10(p.mcap_usd!));
  const g = board.map((p) => growthMultiplier(p.change_7d));
  const lt = board.map((p) => Math.log10(p.tvl_usd));
  const n = comps.length;
  const preds: number[][] = board.map(() => []);
  const ranks: number[][] = board.map(() => []);
  const rng = mulberry32(cfg.seed);

  for (let b = 0; b < cfg.resamples; b++) {
    const bx: number[] = [];
    const by: number[] = [];
    for (let k = 0; k < n; k++) {
      const i = Math.floor(rng() * n);
      bx.push(lx[i]);
      by.push(ly[i]);
    }
    const fit = ols(bx, by);
    const vals = lt.map((x, i) => curveAt(fit, 10 ** x) * g[i]);
    vals.forEach((v, i) => preds[i].push(v));
    // Rank in this refit, 1 = most valuable, ties broken by board order (stable, deterministic).
    const order = vals.map((v, i) => i).sort((a, c) => vals[c] - vals[a] || a - c);
    order.forEach((i, pos) => ranks[i].push(pos + 1));
  }

  const out = new Map<string, { lo: number; hi: number; rankLo: number; rankHi: number }>();
  board.forEach((p, i) => {
    const ps = [...preds[i]].sort((a, b) => a - b);
    const rs = [...ranks[i]].sort((a, b) => a - b);
    out.set(p.slug, {
      lo: Math.round(pct(ps, 0.1)),
      hi: Math.round(pct(ps, 0.9)),
      rankLo: pct(rs, 0.1),
      rankHi: pct(rs, 0.9),
    });
  });
  return out;
}

// ------------------------------------------------------------------ farm costs

/**
 * Per-chain gas and fee assumptions (documented on the page's Method tab). gas_usd is
 * the all-in gas/priority fee for the ~9 transactions a plan needs; fee_pct is the
 * round-trip protocol fee (deposit + exit) on the ticket. Ethereum is expensive, Base
 * and Solana are cheap; that spread is why the same plan nets differently per chain.
 */
export const CHAIN_COSTS: Record<string, { gas_usd: number; fee_pct: number; note: string }> = {
  Ethereum: { gas_usd: 42, fee_pct: 0.5, note: '~9 txs at ~$4.6 avg gas' },
  Arbitrum: { gas_usd: 2.7, fee_pct: 0.4, note: 'L2, cheap calldata' },
  Optimism: { gas_usd: 2.4, fee_pct: 0.4, note: 'L2, op-stack' },
  Base: { gas_usd: 1.2, fee_pct: 0.35, note: 'L2, cheapest op-stack' },
  Polygon: { gas_usd: 1.6, fee_pct: 0.4, note: 'PoS, low fees' },
  Avalanche: { gas_usd: 3.1, fee_pct: 0.45, note: 'C-chain' },
  Binance: { gas_usd: 1.4, fee_pct: 0.4, note: 'BSC, 3 gwei class' },
  Solana: { gas_usd: 0.4, fee_pct: 0.3, note: 'priority fee plus base' },
  Sui: { gas_usd: 0.6, fee_pct: 0.3, note: 'object model, cheap' },
  Sonic: { gas_usd: 0.8, fee_pct: 0.35, note: 'Fantom successor' },
  Mantle: { gas_usd: 1.1, fee_pct: 0.35, note: 'L2, low fees' },
  Linea: { gas_usd: 2.2, fee_pct: 0.4, note: 'L2, zk' },
  Scroll: { gas_usd: 2.0, fee_pct: 0.4, note: 'L2, zk' },
  'zkSync Era': { gas_usd: 2.5, fee_pct: 0.42, note: 'L2, zk' },
  Monad: { gas_usd: 0.5, fee_pct: 0.3, note: 'parallel EVM' },
  Hyperliquid: { gas_usd: 0.3, fee_pct: 0.25, note: 'cheap, few contracts' },
  Berachain: { gas_usd: 1.3, fee_pct: 0.4, note: 'EVM, new' },
  Plasma: { gas_usd: 1.0, fee_pct: 0.35, note: 'EVM L1' },
  Injective: { gas_usd: 0.6, fee_pct: 0.3, note: 'Cosmos, cheap' },
  Cosmos: { gas_usd: 0.7, fee_pct: 0.3, note: 'Cosmos hub class' },
  Osmosis: { gas_usd: 0.5, fee_pct: 0.3, note: 'Cosmos appchain' },
  Bitcoin: { gas_usd: 6.0, fee_pct: 0.3, note: 'utxo, multisig, pricey' },
  Tron: { gas_usd: 2.0, fee_pct: 0.4, note: 'energy model' },
  Celo: { gas_usd: 0.3, fee_pct: 0.3, note: 'stable-fee L2' },
  Morph: { gas_usd: 1.2, fee_pct: 0.4, note: 'L2' },
  Kava: { gas_usd: 0.6, fee_pct: 0.3, note: 'Cosmos-EVM' },
  Fraxtal: { gas_usd: 0.9, fee_pct: 0.35, note: 'L2, cheap' },
  Unichain: { gas_usd: 0.8, fee_pct: 0.35, note: 'op-stack L2' },
  Ink: { gas_usd: 0.9, fee_pct: 0.35, note: 'op-stack L2' },
  'X Layer': { gas_usd: 0.7, fee_pct: 0.3, note: 'polygon CDK' },
  Starknet: { gas_usd: 3.5, fee_pct: 0.45, note: 'zk, pricier calldata' },
  Aptos: { gas_usd: 0.4, fee_pct: 0.3, note: 'move, cheap' },
  Stellar: { gas_usd: 0.2, fee_pct: 0.25, note: 'very cheap' },
  Fantom: { gas_usd: 0.9, fee_pct: 0.35, note: 'EVM L1' },
  Blast: { gas_usd: 1.0, fee_pct: 0.35, note: 'L2' },
  Dymension: { gas_usd: 0.5, fee_pct: 0.3, note: 'Cosmos rollup hub' },
  Near: { gas_usd: 0.3, fee_pct: 0.25, note: 'cheap' },
  Sei: { gas_usd: 0.6, fee_pct: 0.3, note: 'EVM-Cosmos' },
  TON: { gas_usd: 0.2, fee_pct: 0.25, note: 'cheap' },
  Mode: { gas_usd: 1.0, fee_pct: 0.35, note: 'op-stack' },
  Metis: { gas_usd: 1.0, fee_pct: 0.35, note: 'L2' },
  zkLink: { gas_usd: 2.0, fee_pct: 0.4, note: 'zk L3' },
  CORE: { gas_usd: 2.0, fee_pct: 0.4, note: 'BTC-aligned EVM' },
  Hemi: { gas_usd: 1.5, fee_pct: 0.4, note: 'bitcoin EVM' },
  BOB: { gas_usd: 1.6, fee_pct: 0.4, note: 'bitcoin L2' },
  Merlin: { gas_usd: 1.6, fee_pct: 0.4, note: 'bitcoin L2' },
  Taiko: { gas_usd: 2.0, fee_pct: 0.4, note: 'zk L2' },
  BSquared: { gas_usd: 1.8, fee_pct: 0.4, note: 'bitcoin L2' },
  ZetaChain: { gas_usd: 1.2, fee_pct: 0.35, note: 'omnichain' },
  Sonic_EVM: { gas_usd: 0, fee_pct: 0, note: 'unused placeholder' },
};

// Cheap-to-expensive ordering used to choose a default chain when several are listed.
const CHAIN_RANK: Record<string, number> = {
  Solana: 1, TON: 1, Stellar: 1, Near: 1, Sui: 2, Aptos: 2, Hyperliquid: 2,
  Monad: 2, Celo: 2, Base: 3, Injective: 3, Cosmos: 3, Osmosis: 3,
  Arbitrum: 4, Optimism: 4, Unichain: 4, Ink: 4, Fraxtal: 4, Blast: 4, Mode: 4,
  Polygon: 5, Binance: 5, Sonic: 5, Mantle: 5, Avalanche: 5, Kava: 5, Sei: 5,
  Linea: 6, Scroll: 6, Plasma: 6, Metis: 6, Morph: 6, 'X Layer': 6, Fantom: 6,
  'zkSync Era': 7, Starknet: 7, Berachain: 7, BOB: 7, Hemi: 7, Merlin: 7, BSquared: 7, Taiko: 7, CORE: 7,
  Ethereum: 9, Bitcoin: 10, Tron: 8, zkLink: 8, ZetaChain: 8, Dymension: 6,
};

export function chainCost(chain: string): { gas_usd: number; fee_pct: number } {
  return CHAIN_COSTS[chain] ?? { gas_usd: 3, fee_pct: 0.5 };
}

/** The chain a plan runs on: the cheapest chain the protocol actually lists. */
export function planChain(chains: string[]): string {
  if (chains.length === 0) return 'Ethereum';
  return [...chains].sort((a, b) => (CHAIN_RANK[a] ?? 8) - (CHAIN_RANK[b] ?? 8) || (a < b ? -1 : a > b ? 1 : 0))[0];
}

/** Ticket: $150-$350, smaller for smaller and younger protocols, larger for the big names. */
export function ticketFor(tvl: number, ageDays: number | null): number {
  const sizeScore = Math.min(1, Math.max(0, (Math.log10(tvl) - Math.log10(5e6)) / (Math.log10(3e9) - Math.log10(5e6))));
  const ageScore = ageDays == null ? 0.5 : Math.min(1, Math.max(0, ageDays / 900));
  const blended = 0.7 * sizeScore + 0.3 * ageScore;
  return Math.round((150 + 200 * blended) / 10) * 10;
}

/** Hold: longer for bigger, slower protocols (90-180 days). */
export function holdWeeksFor(tvl: number, ageDays: number | null): number {
  const sizeScore = Math.min(1, Math.max(0, (Math.log10(tvl) - Math.log10(5e6)) / (Math.log10(3e9) - Math.log10(5e6))));
  const ageScore = ageDays == null ? 0.5 : Math.min(1, Math.max(0, ageDays / 900));
  return Math.round(8 + 8 * (0.6 * sizeScore + 0.4 * ageScore));
}

export function ageDaysOn(p: Protocol, asOf: string): number | null {
  if (!p.listed_at) return null;
  const then = Date.parse(`${p.listed_at}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((now - then) / 86400000));
}

/**
 * The economics, netted twice: the slice is `airdrop_share` of the implied value times
 * the ticket's share of a $5M reference float (a documented convention: the drop's
 * float is assumed small relative to the protocol, so the slice scales with ticket).
 * net = slice - cash fees - gas - forgone yield(4% x hold). Hands-on hours = setup + work.
 */
export function farmPlan(
  p: Protocol,
  value: number,
  valueLow: number,
  ageDays: number | null,
  airdropShare = ASSUMPTIONS.airdrop_share,
): { plan: FarmPlan; hours: number } {
  const chain = planChain(p.chains);
  const cost = chainCost(chain);
  const ticketUsd = ticketFor(p.tvl_usd, ageDays);
  const holdWeeks = holdWeeksFor(p.tvl_usd, ageDays);

  // Slice: 10% of the implied value, scaled to the ticket against a $5M reference float.
  // At the $250 default ticket that is 5% of the implied value; it scales linearly.
  const REFERENCE_FLOAT = 5_000_000;
  const sliceAt = (v: number): number => (v * airdropShare * ticketUsd) / REFERENCE_FLOAT;

  const cashFees = (ticketUsd * cost.fee_pct) / 100;
  const gas = cost.gas_usd;
  const forgone = (ticketUsd * ASSUMPTIONS.tbill_rate * holdWeeks * 7) / 365;

  const netPoint = sliceAt(value) - cashFees - gas - forgone;
  const netLow = sliceAt(valueLow) - cashFees - gas - forgone;

  // Hands-on hours: setup (wallet, funding, approvals) + per-product work, scaled with chain count.
  const hours = Math.round((1.5 + 0.35 * Math.min(8, p.chains.length) + (ageDays != null && ageDays < 180 ? 0.5 : 0)) * 10) / 10;

  const verdict: FarmPlan['verdict'] = netLow > 0 ? 'ROBUST' : netPoint > 0 ? 'FARM' : netPoint > -cashFees ? 'THIN' : 'SKIP';

  return {
    hours,
    plan: {
      ticket_usd: ticketUsd,
      hold_weeks: holdWeeks,
      airdrop_share: airdropShare,
      slice_usd: Math.round(sliceAt(value)),
      chain,
      gas_usd: gas,
      fee_pct: cost.fee_pct,
      cash_fees_usd: Math.round(cashFees * 100) / 100,
      gas_total_usd: gas,
      forgone_yield_usd: Math.round(forgone * 100) / 100,
      net_point_usd: Math.round(netPoint),
      net_low_usd: Math.round(netLow),
      hours,
      net_per_hour_point: Math.round((netPoint / hours) * 10) / 10,
      net_per_hour_low: Math.round((netLow / hours) * 10) / 10,
      verdict,
    },
  };
}

// ------------------------------------------------------------------ farm steps

const money = (n: number): string =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;

/**
 * Eight concrete steps, derived only from the protocol's category, chains, TVL and age.
 * No protocol name is read here beyond the display name the step quotes; the branch
 * is on category and chain, never on slug.
 */
export function farmSteps(p: Protocol, plan: FarmPlan, ageDays: number | null): string[] {
  const cat = (p.category ?? '').toLowerCase();
  const chain = plan.chain;
  const tvl = money(p.tvl_usd);
  const years = ageDays == null ? null : ageDays / 365;

  let work: string;
  if (/dex|exchange/.test(cat)) {
    work = `provide ${money(plan.ticket_usd)} of two-sided liquidity in a main pool (fees accrue to you while you hold)`;
  } else if (/lending|cdp|collateral|uncollateralized/.test(cat)) {
    work = `supply ${money(plan.ticket_usd)} and borrow 40% against it in a second asset, then repay`;
  } else if (/yield|vault|basis|funding|farm|aggregat|leveraged/.test(cat)) {
    work = `deposit ${money(plan.ticket_usd)} into the flagship vault and leave it for the hold`;
  } else if (/derivative|perp|synthetic|options/.test(cat)) {
    work = `deposit ${money(plan.ticket_usd)} of margin and open a small hedged position`;
  } else if (/rwa|collector|real estate/.test(cat)) {
    work = `subscribe ${money(plan.ticket_usd)} to one tokenised treasury or credit tranche`;
  } else if (/restak|staking|staked/.test(cat)) {
    work = `delegate ${money(plan.ticket_usd)} through the protocol's operator set`;
  } else if (/bridge/.test(cat)) {
    work = `route ${money(plan.ticket_usd)} across the bridge and back once, keeping the receipt`;
  } else if (/curator|capital allocator|asset manag/.test(cat)) {
    work = `deposit ${money(plan.ticket_usd)} into the curator's best-rated vault`;
  } else if (/chain|rollup/.test(cat)) {
    work = `bridge ${money(plan.ticket_usd)} onto the chain and use two of its apps`;
  } else {
    work = `deposit ${money(plan.ticket_usd)} into the protocol's main product and hold`;
  }

  const multiChain = p.chains.length > 1;
  const steps = [
    `Set up a fresh ${chain} wallet funded with ${money(plan.ticket_usd)} plus about ${money(plan.gas_usd)} of gas; never reuse an address you have already farmed with.`,
    `On ${chain}, run the core action: ${work}. Confirm the position shows in the protocol's own UI before you log it.`,
    `Add a second qualifying action so the address reads as a user, not a one-shot: a swap of ${money(Math.round(plan.ticket_usd * 0.2))} on the same venue, or a repay-and-redraw cycle.`,
    multiChain
      ? `Use ${p.chains.length} listed chains (${p.chains.slice(0, 3).join(', ')}) for at least one small action each, so one chain counts as activity and another as loyalty.`
      : `Keep the address a single-chain user: with ${p.chains.length} listed chain, depth on ${chain} counts for more than a spray across chains.`,
    `Hold for ${plan.hold_weeks} weeks (${money(plan.forgone_yield_usd)} of forgone 4% T-bill yield on the ticket); snapshots usually land after a points season, so do not exit early.`,
    `Log every step in a dated sheet: tx hashes, gas paid (${money(plan.gas_usd)} budget), fees (${plan.fee_pct}% round trip), and the ${tvl} TVL at entry.`,
    `Follow the protocol's announcements and its own docs for a points or season programme${p.listed_at ? `; it has been tracked since ${p.listed_at}` : ''}${years != null && years < 1 ? ', so a first season may still be open' : years != null ? ', so an early allocation is more likely than a first one' : ''}.`,
    `Exit or roll by week ${plan.hold_weeks}: with ${plan.net_per_hour_point.toFixed(1)} dollars per hands-on hour at the point value and ${plan.net_per_hour_low.toFixed(1)} at the band low, ${plan.verdict.toLowerCase()} is the verdict.`,
  ];
  return steps;
}

// ------------------------------------------------------------------ the board

export interface BuiltBoard {
  rows: Row[];
  totalValue: number;
  watchlistTop: Array<{ slug: string; name: string; net_per_hour_point: number }>;
}

/**
 * 198 rows: the 40 watchlist protocols plus the 158 pre-token protocols below the
 * floor with the most TVL. Ranking is by implied value, descending, ties broken by
 * TVL then slug: deterministic, and never non-increasing in rank.
 */
export function buildBoard(snapshot: {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}): BuiltBoard {
  const { as_of, floor_usd, protocols, watchlist } = snapshot;
  const wl = new Set(watchlist);
  const noToken = protocols.filter((p) => p.mcap_usd == null || p.mcap_usd <= 0);

  const below = noToken
    .filter((p) => !wl.has(p.slug) && p.tvl_usd < floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 158);

  const board = [...noToken.filter((p) => wl.has(p.slug)), ...below].sort((a, b) => (a.tvl_usd === b.tvl_usd ? (a.slug < b.slug ? -1 : 1) : b.tvl_usd - a.tvl_usd));

  const bands = bootstrapBands(comparables(protocols), board);

  const scored = board
    .map((p) => {
      const value = impliedValue(p.tvl_usd, p.change_7d);
      return { p, value, age: ageDaysOn(p, as_of) };
    })
    .sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: Row[] = scored.map(({ p, value, age }, i) => {
    const band = bands.get(p.slug) ?? { lo: value, hi: value, rankLo: i + 1, rankHi: i + 1 };
    const { plan } = farmPlan(p, value, band.lo, age);
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: value,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      category: p.category,
      chains: p.chains,
      listed_at: p.listed_at,
      age_days: age,
      watchlist: wl.has(p.slug),
      multiple: Math.round((value / p.tvl_usd) * 10000) / 10000,
      growth_mult: Math.round(growthMultiplier(p.change_7d) * 10000) / 10000,
      band_p10_usd: band.lo,
      band_p90_usd: band.hi,
      rank_lo: band.rankLo,
      rank_hi: band.rankHi,
      farm: plan,
      farm_steps: farmSteps(p, plan, age),
    };
  });

  const watchlistTop = rows
    .filter((r) => r.watchlist)
    .sort((a, b) => b.farm.net_per_hour_point - a.farm.net_per_hour_point)
    .slice(0, 3)
    .map((r) => ({ slug: r.slug, name: r.name, net_per_hour_point: r.farm.net_per_hour_point }));

  return { rows, totalValue: rows.reduce((s, r) => s + r.implied_value_usd, 0), watchlistTop };
}
