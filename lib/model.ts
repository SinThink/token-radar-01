// lib/model.ts — token-radar-01's model. Node 22 standard library only, deterministic: no clock, no
// Math.random (a seeded PRNG does the bootstrap), so two runs write the same bytes.
//
// WHAT IT DOES, in the order the dashboard states it:
//
//   1. THE LEDGER. Every one of the snapshot's protocols gets one status: pre-token ranked (a launch
//      candidate, on the board), has token (its record carries a token), wrapped or staked product (a
//      product of a token that already trades), or excluded with a reason (a versioned pool, a bridge).
//
//   2. THE VALUE CURVE (fitted). log10(market cap) = a + b * log10(TVL), a Huber-robust line over the
//      comparables the snapshot's own record supplies (a positive market cap and TVL, minus CEX,
//      versioned pools, stable categories and bridges). That is the value a token would carry if the
//      protocol's record held: the token's own size curve.
//
//   3. THE GROWTH TILT (fixed, not fitted). The seven-day TVL change multiplies the curve by
//      (1 + 0.25 * clamp(g, -0.60, +1.20)). A protocol growing is worth more; the tilt is deliberately
//      small relative to the curve's spread.
//
//   4. THE LAUNCH ODDS (fitted). P(a token is recorded) = logistic(b0 + b1*log10(TVL) + b2*age_years
//      + b3*growth), an iteratively-reweighted least-squares fit on the snapshot's own labelled
//      protocols: the ones whose record carries a token are the positives, the ones whose record
//      carries none are the negatives. Age (the time since the protocol was first listed, i.e. how
//      long it has run with no token), TVL and the seven-day move are the whole feature set, and no
//      protocol name is read anywhere in the fit or the prediction.
//
//   5. THE BOARD. implied value = curve * growth tilt. expected value = implied value * odds. The board
//      ranks by expected value, so board.json's implied_value_usd carries the expected value and does
//      not rise as rank ascends. Ranks are 1..N once each and every watchlist slug is on the board.
//
//   6. THE FARM PLAN. Ticket, hold, gas, fee and forgone yield are derived per protocol from its own
//      TVL, chains and age; the headline is the minimum viable capital, the smallest position the
//      protocol's expected drop pays for at all, and a dollars-per-hands-on-hour verdict.
//
// Nothing here special-cases a slug or a name: the same functions score all 758 protocols.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export type LedgerStatus = 'pre-token ranked' | 'has token' | 'wrapped or staked product' | 'excluded';

export interface LedgerEntry {
  slug: string;
  name: string;
  status: LedgerStatus;
  reason: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  watchlist: boolean;
  rank: number | null;
}

export interface Band {
  lo: number;
  hi: number;
  rankLo: number;
  rankHi: number;
}

export interface FarmPlan {
  chain: string;
  chain_note: string;
  gas_usd: number;
  fee_pct: number;
  cash_fees_usd: number;
  forgone_yield_usd: number;
  airdrop_share: number;
  deposit_base_usd: number;
  slice_if_launched_usd: number;
  slice_expected_usd: number;
  min_viable_capital_usd: number | null;
  ticket_usd: number;
  hold_weeks: number;
  hours: number;
  net_point_usd: number;
  net_low_usd: number;
  net_per_hour_point: number;
  net_per_hour_low: number;
  k_per_dollar: number;
  verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
}

export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  /** The token's own implied value: size curve x growth tilt. */
  implied_value_usd: number;
  /** The fitted launch probability, 0..1. */
  odds: number;
  /** implied_value_usd x odds: the board's ranked quantity, and board.json's implied_value_usd. */
  expected_value_usd: number;
  growth_mult: number;
  /** Bootstrap P10-P90 of the implied value, and x odds for the expected value. */
  band_p10_usd: number;
  band_p90_usd: number;
  expected_p10_usd: number;
  expected_p90_usd: number;
  rank_lo: number;
  rank_hi: number;
  farm: FarmPlan;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

export interface ValidationLine {
  name: string;
  n: number;
  miss: number;
  within3x: number;
  within10x: number;
}

export interface CalibrationBucket {
  lo: number;
  hi: number;
  mean_pred: number;
  actual: number;
  n: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: {
    version: string;
    coef: { intercept: number; slope: number; n: number };
    growth: { floor: number; cap: number; weight: number };
    odds: {
      beta: number[];
      features: string[];
      n: number;
      positives: number;
      base_rate: number;
      brier: number;
      median_age_days: number;
      calibration: CalibrationBucket[];
    };
    economics: {
      airdrop_share: number;
      float_floor_usd: number;
      float_alpha: number;
      tbill_rate: number;
      ticket_alpha: number;
      max_ticket_usd: number;
      min_ticket_usd: number;
      farm_per_hour_target: number;
      bootstrap_resamples: number;
    };
  };
  validation: {
    comparables: number;
    loo: ValidationLine;
    timeSplit: ValidationLine;
    newest33: ValidationLine;
    flatLoo: ValidationLine;
    flatMultiple: number;
    cutoff: string;
  };
  counts: {
    protocols: number;
    watchlist: number;
    board: number;
    live: number;
    ranked_below_floor: number;
    ledger: Record<string, number>;
  };
  rows: Row[];
  live: LiveRow[];
  ledger: LedgerEntry[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ------------------------------------------------------------------ constants

export const MODEL_VERSION = 'radar-2 (odds)';
export const GROWTH = { floor: -0.6, cap: 1.2, weight: 0.25 };
export const ECONOMICS = {
  airdrop_share: 0.1, // 10% of the launch is dropped to users, pro rata
  float_floor_usd: 5_000_000, // the qualifying deposit base never falls below this
  float_alpha: 0.02, // ... and is 2% of the protocol's TVL above it
  tbill_rate: 0.04, // annual T-bill rate: the yield the ticket forgoes while held
  ticket_alpha: 0.00002, // the recommended ticket is 0.002% of TVL ...
  max_ticket_usd: 25_000, // ... clamped to this
  min_ticket_usd: 50,
  farm_per_hour_target: 25, // FARM's bar, in dollars per hands-on hour
  bootstrap_resamples: 200,
  bootstrap_seed: 20261123,
};

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORDS = new Set(['wrapped', 'staked', 'staking']);
const WRAPPED_CATS = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const BRIDGE_CATS = new Set(['Bridge', 'Canonical Bridge']);
const CURVE_EXCLUDE_CATS = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const DAY_MS = 86_400_000;

// ------------------------------------------------------------------ basic predicates

/** Whether the record carries a token at all: an id, a ticker or a market cap. */
export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || (p.mcap_usd ?? 0) > 0;
}

/** The reason a protocol is a wrapped, staked or exchange-branded product, or null. */
export function wrappedReason(p: Protocol): string | null {
  if (p.category !== null && WRAPPED_CATS.has(p.category)) return `category ${p.category}: a product of an asset that already trades`;
  const words = p.name.toLowerCase().split(/[^a-z0-9]+/);
  for (const w of words) if (WRAPPED_WORDS.has(w)) return `name carries the word ${w}: a wrapped or staked product`;
  for (const e of EXCHANGES) if (p.name.startsWith(e)) return `begin${p.name.startsWith(e + ' ') ? 's' : 's'} with the exchange name ${e}`;
  return null;
}

/** The reason a protocol is excluded from the ranked board, or null. */
export function excludedReason(p: Protocol): string | null {
  if (p.category !== null && BRIDGE_CATS.has(p.category)) return `category ${p.category}: a bridge of another protocol`;
  if (VERSION_MARKER.test(p.name)) return 'name ends in a version marker: a pool of another protocol, not a first launch';
  return null;
}

/** Age in whole days from the snapshot's as_of to the protocol's listing, or null. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// ------------------------------------------------------------------ the ledger

export interface Ledger {
  entries: LedgerEntry[];
  /** The protocols the board ranks, strongest first is decided later; here they are in slug order. */
  candidates: Protocol[];
  counts: Record<string, number>;
}

/**
 * One status per protocol, and one reason. The order of the tests is the order the rules state them:
 * a launch candidate first, then the record's own token, then the wrapped or staked products, then the
 * excluded pools. Every protocol in `protocols` gets exactly one entry.
 */
export function buildLedger(snapshot: Snapshot): Ledger {
  const wl = new Set(snapshot.watchlist);
  const entries: LedgerEntry[] = [];
  const candidates: Protocol[] = [];
  const counts: Record<string, number> = {
    'pre-token ranked': 0,
    'has token': 0,
    'wrapped or staked product': 0,
    excluded: 0,
  };

  for (const p of snapshot.protocols) {
    let status: LedgerStatus;
    let reason: string;
    if (recordsToken(p) && wrappedReason(p) === null) {
      status = 'has token';
      reason = (p.mcap_usd ?? 0) > 0 ? 'a token with a market cap on record' : 'a token id or ticker on record, no market cap';
    } else if (wrappedReason(p) !== null) {
      status = 'wrapped or staked product';
      reason = wrappedReason(p)!;
    } else if (excludedReason(p) !== null) {
      status = 'excluded';
      reason = excludedReason(p)!;
    } else {
      status = 'pre-token ranked';
      reason = wl.has(p.slug) ? 'on the watchlist and ranked on the board' : 'records no token and is no wrapped, staked or bridged product; ranked on the board';
      candidates.push(p);
    }
    counts[status] = (counts[status] ?? 0) + 1;
    entries.push({
      slug: p.slug,
      name: p.name,
      status,
      reason,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      watchlist: wl.has(p.slug),
      rank: null,
    });
  }
  return { entries, candidates, counts };
}

// ------------------------------------------------------------------ the value curve

export interface Fit {
  intercept: number;
  slope: number;
}

/** Ordinary least squares of y on x. */
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
 * Huber-robust fit: OLS first, then reweight every point whose residual is beyond 1.5 x the MAD scale
 * by scale/|residual| and refit, until the coefficients settle. A handful of protocols whose market
 * cap dwarfs their TVL would otherwise drag the line; this is why the fit is robust and not plain OLS.
 */
export function huber(xs: number[], ys: number[]): Fit {
  const n = xs.length;
  let fit = ols(xs, ys);
  for (let iter = 0; iter < 60; iter++) {
    const res = xs.map((x, i) => ys[i] - (fit.intercept + fit.slope * x));
    const abs = res.map(Math.abs).sort((a, b) => a - b);
    const scale = Math.max(1e-9, abs[Math.floor(n / 2)] / 0.6745);
    const w = res.map((r) => (Math.abs(r) <= 1.5 * scale ? 1 : (1.5 * scale) / Math.abs(r)));
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
    if (moved < 1e-11) break;
  }
  return fit;
}

/** A comparables-set member: a token that trades and a TVL to compare it against, and not a pool. */
export function isComparable(p: Protocol): boolean {
  if (!((p.mcap_usd ?? 0) > 0) || !(p.tvl_usd > 0)) return false;
  if (p.category === 'CEX') return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if ((p.category ?? '').toLowerCase().includes('stable')) return false;
  if (p.category !== null && CURVE_EXCLUDE_CATS.has(p.category)) return false;
  return true;
}

export const comparables = (ps: Protocol[]): Protocol[] => ps.filter(isComparable);

/** The clamps and the growth tilt the page states verbatim. */
export function growthFraction(changePct: number | null): number {
  return Math.min(GROWTH.cap, Math.max(GROWTH.floor, (changePct ?? 0) / 100));
}

export function growthMultiplier(changePct: number | null): number {
  return 1 + GROWTH.weight * growthFraction(changePct);
}

// ------------------------------------------------------------------ the odds fit

export interface OddsFit {
  beta: number[];
  features: string[];
  n: number;
  positives: number;
  base_rate: number;
  brier: number;
  median_age_days: number;
  calibration: CalibrationBucket[];
}

export const ODDS_FEATURES = ['intercept', 'log10(tvl_usd)', 'age_years', 'clamp(change_7d/100, -0.60, +1.20)'];

/** The feature vector, with `ageYears` already imputed for an unlisted age. */
function oddsFeatures(p: Protocol, ageYears: number): number[] {
  return [1, Math.log10(Math.max(1, p.tvl_usd)), ageYears, growthFraction(p.change_7d)];
}

function median(sorted: number[]): number {
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

/**
 * The launch-odds fit. Positives are the protocols whose record carries a token; negatives are the
 * ones that record none; the population is every protocol the wrapped/staked/bridge/versioned tests
 * leave, with a listing date to measure age from. Newton-Raphson (IRLS) to convergence, seeded at zero
 * and deterministic. No protocol name enters the fit or the prediction.
 */
export function fitOdds(snapshot: Snapshot): OddsFit {
  const pop = snapshot.protocols.filter((p) => wrappedReason(p) === null && excludedReason(p) === null && ageDays(snapshot.as_of, p.listed_at) !== null);
  const ages = pop.map((p) => ageDays(snapshot.as_of, p.listed_at)!).sort((a, b) => a - b);
  const medianAge = median(ages);
  const k = ODDS_FEATURES.length;
  const X = pop.map((p) => oddsFeatures(p, ageDays(snapshot.as_of, p.listed_at)! / 365));
  const Y: number[] = pop.map((p) => (recordsToken(p) ? 1 : 0));

  let beta = new Array<number>(k).fill(0);
  for (let iter = 0; iter < 200; iter++) {
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const g = new Array<number>(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      let z = 0;
      for (let j = 0; j < k; j++) z += beta[j] * X[i][j];
      const pr = 1 / (1 + Math.exp(-z));
      const w = pr * (1 - pr);
      for (let a = 0; a < k; a++) {
        g[a] += X[i][a] * (Y[i] - pr);
        for (let b = 0; b < k; b++) H[a][b] += w * X[i][a] * X[i][b];
      }
    }
    const M = H.map((row, i) => [...row, g[i]]);
    for (let c = 0; c < k; c++) {
      let piv = c;
      for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      const tmp = M[c];
      M[c] = M[piv];
      M[piv] = tmp;
      const d = M[c][c];
      if (Math.abs(d) < 1e-12) break;
      for (let j = 0; j <= k; j++) M[c][j] /= d;
      for (let r = 0; r < k; r++) {
        if (r === c || M[r][c] === 0) continue;
        const f = M[r][c];
        for (let j = 0; j <= k; j++) M[r][j] -= f * M[c][j];
      }
    }
    const next = beta.map((b, i) => b + M[i][k]);
    let moved = 0;
    for (let j = 0; j < k; j++) moved = Math.max(moved, Math.abs(next[j] - beta[j]));
    beta = next;
    if (moved < 1e-12) break;
  }

  const predict = (p: Protocol, ageYears: number): number => {
    let z = 0;
    const f = oddsFeatures(p, ageYears);
    for (let j = 0; j < k; j++) z += beta[j] * f[j];
    return 1 / (1 + Math.exp(-z));
  };
  let brier = 0;
  const pairs: Array<[number, number]> = [];
  for (const p of pop) {
    const pr = predict(p, ageDays(snapshot.as_of, p.listed_at)! / 365);
    const y = recordsToken(p) ? 1 : 0;
    brier += (pr - y) ** 2;
    pairs.push([pr, y]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const calibration: CalibrationBucket[] = [];
  for (let b = 0; b < 10; b++) {
    const seg = pairs.slice(Math.floor((b * pairs.length) / 10), Math.floor(((b + 1) * pairs.length) / 10));
    if (seg.length === 0) continue;
    calibration.push({
      lo: Math.round(seg[0][0] * 1000) / 1000,
      hi: Math.round(seg[seg.length - 1][0] * 1000) / 1000,
      mean_pred: Math.round((seg.reduce((s, x) => s + x[0], 0) / seg.length) * 1000) / 1000,
      actual: Math.round((seg.reduce((s, x) => s + x[1], 0) / seg.length) * 1000) / 1000,
      n: seg.length,
    });
  }
  return {
    beta: beta.slice(),
    features: ODDS_FEATURES,
    n: pop.length,
    positives: Y.reduce((s, y) => s + y, 0),
    base_rate: Math.round((Y.reduce((s, y) => s + y, 0) / pop.length) * 10000) / 10000,
    brier: Math.round((brier / pop.length) * 10000) / 10000,
    median_age_days: medianAge,
    calibration,
  };
}

/** The fitted probability a token is recorded, from TVL, age (days, null imputed to the median) and growth. */
export function oddsOf(p: Protocol, age: number | null, fit: OddsFit): number {
  const years = (age ?? fit.median_age_days) / 365;
  let z = 0;
  const f = oddsFeatures(p, years);
  for (let j = 0; j < f.length; j++) z += fit.beta[j] * f[j];
  return 1 / (1 + Math.exp(-z));
}

// ------------------------------------------------------------------ PRNG and percentiles

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

const pctOf = (sorted: number[], q: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

// ------------------------------------------------------------------ validation

const missFactor = (pred: number, act: number): number => Math.max(pred / act, act / pred);

function summarise(name: string, pairs: Array<[number, number]>): ValidationLine {
  const miss = pairs.map(([p, a]) => missFactor(p, a)).sort((a, b) => a - b);
  const med = miss.length === 0 ? 0 : pctOf(miss, 0.5);
  return {
    name,
    n: miss.length,
    miss: Math.round(med * 100) / 100,
    within3x: Math.round((1000 * miss.filter((m) => m <= 3).length) / Math.max(1, miss.length)) / 10,
    within10x: Math.round((1000 * miss.filter((m) => m <= 10).length) / Math.max(1, miss.length)) / 10,
  };
}

export interface Validation {
  comparables: number;
  loo: ValidationLine;
  timeSplit: ValidationLine;
  newest33: ValidationLine;
  flatLoo: ValidationLine;
  flatMultiple: number;
  cutoff: string;
}

const curveAt = (fit: Fit, tvl: number): number => 10 ** (fit.intercept + fit.slope * Math.log10(tvl));

/**
 * The value curve's honest report card, all on the snapshot's own comparables: leave-one-out, a
 * calendar split (fit before 2024, test 2024 and later), the 33 newest comparables held out, and the
 * flat market-cap/TVL multiple as the baseline to beat. Growth is not applied in the backtest: the
 * comparables' own 2026 week is not a 2022 test point, and applying it would leak.
 */
export function validation(comps: Protocol[], asOf: string): Validation {
  const lx = comps.map((p) => Math.log10(p.tvl_usd));
  const ly = comps.map((p) => Math.log10(p.mcap_usd!));

  const loo: Array<[number, number]> = comps.map((p, i) => {
    const xs = lx.filter((_, j) => j !== i);
    const ys = ly.filter((_, j) => j !== i);
    return [curveAt(huber(xs, ys), p.tvl_usd), p.mcap_usd!];
  });

  const early: number[] = [];
  const late: number[] = [];
  comps.forEach((p, i) => {
    if (p.listed_at !== null && p.listed_at < '2024-01-01') early.push(i);
    else if (p.listed_at !== null) late.push(i);
  });
  const fitEarly = early.length > 2 ? huber(early.map((i) => lx[i]), early.map((i) => ly[i])) : huber(lx, ly);
  const timeSplit: Array<[number, number]> = late.map((i) => [curveAt(fitEarly, comps[i].tvl_usd), comps[i].mcap_usd!]);

  const dated = comps.map((p, i) => ({ i, d: p.listed_at ?? '9999-99-99' })).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const newestSet = new Set(dated.slice(-33).map((x) => x.i));
  const rest = comps.map((_, i) => i).filter((i) => !newestSet.has(i));
  const fitRest = rest.length > 2 ? huber(rest.map((i) => lx[i]), rest.map((i) => ly[i])) : fitEarly;
  const newest33: Array<[number, number]> = [...newestSet].map((i) => [curveAt(fitRest, comps[i].tvl_usd), comps[i].mcap_usd!]);

  const flatMultiple = comps.reduce((s, p) => s + p.mcap_usd!, 0) / comps.reduce((s, p) => s + p.tvl_usd, 0);
  const flatLoo: Array<[number, number]> = comps.map((p) => [p.tvl_usd * flatMultiple, p.mcap_usd!]);

  return {
    comparables: comps.length,
    loo: summarise('leave-one-out', loo),
    timeSplit: summarise('time-split 2024+', timeSplit),
    newest33: summarise('newest 33', newest33),
    flatLoo: summarise('flat multiple, leave-one-out', flatLoo),
    flatMultiple: Math.round(flatMultiple * 10000) / 10000,
    cutoff: '2024-01-01',
  };
}

// ------------------------------------------------------------------ the band

/** Bootstrap refits of the value curve, re-predicting every board protocol; P10-P90 of value and rank. */
export function bootstrapBands(comps: Protocol[], board: Protocol[], seed: number, resamples: number): Map<string, Band> {
  const lx = comps.map((p) => Math.log10(p.tvl_usd));
  const ly = comps.map((p) => Math.log10(p.mcap_usd!));
  const gm = board.map((p) => growthMultiplier(p.change_7d));
  const lt = board.map((p) => Math.log10(p.tvl_usd));
  const n = comps.length;
  const preds: number[][] = board.map(() => []);
  const ranks: number[][] = board.map(() => []);
  const rng = mulberry32(seed);

  for (let b = 0; b < resamples; b++) {
    const bx: number[] = [];
    const by: number[] = [];
    for (let k = 0; k < n; k++) {
      const i = Math.floor(rng() * n);
      bx.push(lx[i]);
      by.push(ly[i]);
    }
    const fit = ols(bx, by);
    const vals = lt.map((x, i) => curveAt(fit, 10 ** x) * gm[i]);
    vals.forEach((v, i) => preds[i].push(v));
    const order = vals.map((v, i) => i).sort((a, c) => vals[c] - vals[a] || a - c);
    order.forEach((i, pos) => ranks[i].push(pos + 1));
  }

  const out = new Map<string, Band>();
  board.forEach((p, i) => {
    out.set(p.slug, {
      lo: Math.round(pctOf([...preds[i]].sort((a, b) => a - b), 0.1)),
      hi: Math.round(pctOf([...preds[i]].sort((a, b) => a - b), 0.9)),
      rankLo: pctOf([...ranks[i]].sort((a, b) => a - b), 0.1),
      rankHi: pctOf([...ranks[i]].sort((a, b) => a - b), 0.9),
    });
  });
  return out;
}

// ------------------------------------------------------------------ chain costs

/**
 * Per-chain gas and fee assumptions, priced for the ~9 transactions a plan needs: gas_usd is the
 * all-in gas and priority-fee budget, fee_pct the round-trip protocol fee on the ticket. The spread is
 * why the same plan nets differently per chain, and why the plan picks the cheapest chain a protocol
 * actually lists.
 */
export const CHAIN_COSTS: Record<string, { gas_usd: number; fee_pct: number; note: string }> = {
  Ethereum: { gas_usd: 42, fee_pct: 0.5, note: '~9 txs at ~$4.6 average gas' },
  Arbitrum: { gas_usd: 2.7, fee_pct: 0.4, note: 'L2, cheap calldata' },
  Optimism: { gas_usd: 2.4, fee_pct: 0.4, note: 'op-stack L2' },
  Base: { gas_usd: 1.2, fee_pct: 0.35, note: 'cheapest op-stack L2' },
  Polygon: { gas_usd: 1.6, fee_pct: 0.4, note: 'PoS, low fees' },
  Avalanche: { gas_usd: 3.1, fee_pct: 0.45, note: 'C-chain' },
  Binance: { gas_usd: 1.4, fee_pct: 0.4, note: 'BSC' },
  Solana: { gas_usd: 0.4, fee_pct: 0.3, note: 'base plus priority fee' },
  Sui: { gas_usd: 0.6, fee_pct: 0.3, note: 'object model, cheap' },
  Sonic: { gas_usd: 0.8, fee_pct: 0.35, note: 'Fantom successor' },
  Mantle: { gas_usd: 1.1, fee_pct: 0.35, note: 'L2' },
  Linea: { gas_usd: 2.2, fee_pct: 0.4, note: 'zk L2' },
  Scroll: { gas_usd: 2.0, fee_pct: 0.4, note: 'zk L2' },
  'zkSync Era': { gas_usd: 2.5, fee_pct: 0.42, note: 'zk L2' },
  Monad: { gas_usd: 0.5, fee_pct: 0.3, note: 'parallel EVM' },
  Hyperliquid: { gas_usd: 0.3, fee_pct: 0.25, note: 'few contracts, cheap' },
  Berachain: { gas_usd: 1.3, fee_pct: 0.4, note: 'EVM, new' },
  Plasma: { gas_usd: 1.0, fee_pct: 0.35, note: 'EVM L1' },
  Injective: { gas_usd: 0.6, fee_pct: 0.3, note: 'Cosmos, cheap' },
  Cosmos: { gas_usd: 0.7, fee_pct: 0.3, note: 'Cosmos hub class' },
  Osmosis: { gas_usd: 0.5, fee_pct: 0.3, note: 'Cosmos appchain' },
  Bitcoin: { gas_usd: 6.0, fee_pct: 0.3, note: 'UTXO, multisig, pricey' },
  Tron: { gas_usd: 2.0, fee_pct: 0.4, note: 'energy model' },
  Celo: { gas_usd: 0.3, fee_pct: 0.3, note: 'stable-fee L2' },
  Morph: { gas_usd: 1.2, fee_pct: 0.4, note: 'L2' },
  Kava: { gas_usd: 0.6, fee_pct: 0.3, note: 'Cosmos-EVM' },
  Fraxtal: { gas_usd: 0.9, fee_pct: 0.35, note: 'L2' },
  Unichain: { gas_usd: 0.8, fee_pct: 0.35, note: 'op-stack L2' },
  Ink: { gas_usd: 0.9, fee_pct: 0.35, note: 'op-stack L2' },
  'X Layer': { gas_usd: 0.7, fee_pct: 0.3, note: 'Polygon CDK' },
  Starknet: { gas_usd: 3.5, fee_pct: 0.45, note: 'zk, pricier calldata' },
  Aptos: { gas_usd: 0.4, fee_pct: 0.3, note: 'Move, cheap' },
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
  Hemi: { gas_usd: 1.5, fee_pct: 0.4, note: 'Bitcoin EVM' },
  BOB: { gas_usd: 1.6, fee_pct: 0.4, note: 'Bitcoin L2' },
  Merlin: { gas_usd: 1.6, fee_pct: 0.4, note: 'Bitcoin L2' },
  Taiko: { gas_usd: 2.0, fee_pct: 0.4, note: 'zk L2' },
  BSquared: { gas_usd: 1.8, fee_pct: 0.4, note: 'Bitcoin L2' },
  ZetaChain: { gas_usd: 1.2, fee_pct: 0.35, note: 'omnichain' },
};

const CHAIN_RANK: Record<string, number> = {
  Solana: 1, TON: 1, Stellar: 1, Near: 1, Sui: 2, Aptos: 2, Hyperliquid: 2, Monad: 2, Celo: 2,
  Base: 3, Injective: 3, Cosmos: 3, Osmosis: 3, Arbitrum: 4, Optimism: 4, Unichain: 4, Ink: 4,
  Fraxtal: 4, Blast: 4, Mode: 4, Polygon: 5, Binance: 5, Sonic: 5, Mantle: 5, Avalanche: 5, Kava: 5,
  Sei: 5, Linea: 6, Scroll: 6, Plasma: 6, Metis: 6, Morph: 6, 'X Layer': 6, Fantom: 6, Dymension: 6,
  'zkSync Era': 7, Starknet: 7, Berachain: 7, BOB: 7, Hemi: 7, Merlin: 7, BSquared: 7, Taiko: 7, CORE: 7,
  Tron: 8, zkLink: 8, ZetaChain: 8, Ethereum: 9, Bitcoin: 10,
};

/** The chain a plan runs on: the cheapest one the protocol actually lists. */
export function planChain(chains: string[]): string {
  if (chains.length === 0) return 'Ethereum';
  return [...chains].sort((a, b) => (CHAIN_RANK[a] ?? 8) - (CHAIN_RANK[b] ?? 8) || (a < b ? -1 : a > b ? 1 : 0))[0];
}

export function chainCost(chain: string): { gas_usd: number; fee_pct: number; note: string } {
  return CHAIN_COSTS[chain] ?? { gas_usd: 3, fee_pct: 0.5, note: 'unlisted chain, defaulted to a mid-range budget' };
}

// ------------------------------------------------------------------ farm economics

const round10 = (n: number): number => Math.ceil(n / 10) * 10;
const roundTo = (n: number, d: number): number => Math.round(n * d) / d;

export interface PlanInput {
  tvl_usd: number;
  chains: string[];
  age_days: number | null;
  implied_value_usd: number;
  expected_value_usd: number;
  /** Bootstrap P10 of the implied value, for the plan's low case. */
  implied_p10_usd: number;
  odds: number;
  airdropShare?: number;
}

/**
 * The plan's economics, derived per protocol rather than fixed:
 *   deposit base = max($5M, 2% of TVL) -- the pool a drop is split over
 *   slice        = expected value x share x ticket / deposit base
 *   k            = slice per dollar - round-trip fee - 4% T-bill yield over the hold
 *   min viable   = the ticket where net hits zero: gas / k, floored at $50
 *   ticket       = 0.002% of TVL, clamped between the minimum viable capital and $25,000
 * The last two are the point: a $2.7B protocol and a $6M one do not get the same deposit.
 */
export function farmPlan(input: PlanInput): FarmPlan {
  const share = input.airdropShare ?? ECONOMICS.airdrop_share;
  const chain = planChain(input.chains);
  const cost = chainCost(chain);
  const age = input.age_days ?? 365;
  const sizeScore = Math.min(1, Math.max(0, (Math.log10(input.tvl_usd) - Math.log10(5e6)) / (Math.log10(3e9) - Math.log10(5e6))));
  const ageScore = Math.min(1, Math.max(0, age / 900));
  const holdWeeks = Math.round(8 + 8 * (0.6 * sizeScore + 0.4 * ageScore));
  const holdDays = holdWeeks * 7;
  const forgoneRate = (ECONOMICS.tbill_rate * holdDays) / 365;
  const hours = roundTo(1.5 + 0.35 * Math.min(8, input.chains.length) + (age < 180 ? 0.5 : 0), 10);

  const depositBase = Math.max(ECONOMICS.float_floor_usd, ECONOMICS.float_alpha * input.tvl_usd);
  const k = (share * input.expected_value_usd) / depositBase - cost.fee_pct / 100 - forgoneRate;
  const kLow = (share * input.implied_p10_usd * input.odds) / depositBase - cost.fee_pct / 100 - forgoneRate;

  const minViable = k > 0 ? Math.max(ECONOMICS.min_ticket_usd, round10(cost.gas_usd / k)) : null;
  const scaleTicket = round10(ECONOMICS.ticket_alpha * input.tvl_usd);
  const ticket = Math.min(Math.max(scaleTicket, minViable ?? ECONOMICS.min_ticket_usd), ECONOMICS.max_ticket_usd);

  const netPoint = ticket * k - cost.gas_usd;
  const netLow = ticket * kLow - cost.gas_usd;
  const perHour = netPoint / hours;
  const verdict: FarmPlan['verdict'] =
    k <= 0 || netPoint <= 0 ? 'SKIP' : netLow >= 0 ? 'ROBUST' : perHour >= ECONOMICS.farm_per_hour_target ? 'FARM' : 'THIN';

  return {
    chain,
    chain_note: cost.note,
    gas_usd: cost.gas_usd,
    fee_pct: cost.fee_pct,
    cash_fees_usd: roundTo((ticket * cost.fee_pct) / 100, 100),
    forgone_yield_usd: roundTo(ticket * forgoneRate, 100),
    airdrop_share: share,
    deposit_base_usd: Math.round(depositBase),
    slice_if_launched_usd: Math.round((share * input.implied_value_usd * ticket) / depositBase),
    slice_expected_usd: Math.round((share * input.expected_value_usd * ticket) / depositBase),
    min_viable_capital_usd: minViable,
    ticket_usd: ticket,
    hold_weeks: holdWeeks,
    hours,
    net_point_usd: Math.round(netPoint),
    net_low_usd: Math.round(netLow),
    net_per_hour_point: roundTo(perHour, 10),
    net_per_hour_low: roundTo(netLow / hours, 10),
    k_per_dollar: roundTo(k, 10000),
    verdict,
  };
}

// ------------------------------------------------------------------ farm steps

const money = (n: number): string =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `$${Math.round(n)}`;

/** The category's one core action, in the words a farmer can follow. No slug is read here. */
function coreAction(p: Protocol, plan: FarmPlan): string {
  const c = (p.category ?? '').toLowerCase();
  const t = money(plan.ticket_usd);
  if (/curator|allocator|asset manag/.test(c)) return `deposit ${t} into the protocol's top-rated vault on ${plan.chain} and keep the receipt tokens`;
  if (/dex|exchange|amm/.test(c)) return `provide ${t} of two-sided liquidity to a main pool and let the fees accrue to the position`;
  if (/lending|cdp|collateral/.test(c)) return `supply ${t} and borrow 40% of it in a second asset, then repay, so both sides count`;
  if (/yield|vault|basis|funding|farm|aggregat|leverage/.test(c)) return `deposit ${t} into the flagship vault and leave it in for the hold`;
  if (/derivative|perp|synthetic|option/.test(c)) return `post ${t} of margin and open one small hedged position`;
  if (/rwa|collector|real estate/.test(c)) return `subscribe ${t} to one tokenised treasury or credit tranche`;
  if (/restak|staking|staked/.test(c)) return `delegate ${t} through the protocol's operator set and keep the receipt`;
  if (/prediction/.test(c)) return `fund ${t} and place one market position on a liquid question`;
  if (/bridge/.test(c)) return `route ${t} across the bridge and back once, keeping the receipt`;
  if (/chain|rollup/.test(c)) return `bridge ${t} onto the chain and use two of its applications`;
  if (/insurance/.test(c)) return `buy ${t} of cover from the protocol and keep the policy`;
  return `deposit ${t} into the protocol's main product and hold the position`;
}

/**
 * Eight concrete steps, derived only from the protocol's category, chains, TVL and age — never from a
 * name list. Every step carries what it costs and how long it takes; each is 20 to 600 characters.
 */
export function farmSteps(p: Protocol, plan: FarmPlan, age: number | null): string[] {
  const years = age === null ? null : age / 365;
  const multi = p.chains.length > 1;
  const mv = plan.min_viable_capital_usd;
  const budget = Math.max(plan.ticket_usd, mv ?? plan.ticket_usd);

  const steps = [
    `Fund a fresh ${plan.chain} wallet with ${budget.toLocaleString('en-US')} USD plus about ${money(plan.gas_usd)} of gas. Never reuse an address you have already farmed with.`,
    `Minimum viable capital on ${plan.chain}: ${mv === null ? `no position pays at any size, because the round-trip fee (${plan.fee_pct}%) and ${money(plan.forgone_yield_usd)} of forgone yield exceed the expected drop` : `${money(mv)}; below that the round-trip fee (${plan.fee_pct}%) and 4% T-bill yield eat the whole drop`}. The plan below uses ${money(plan.ticket_usd)}.`,
    `Run the plan: ${coreAction(p, plan)}. Confirm it shows in the protocol's own UI before you log it.`,
    `Set the hold at ${plan.hold_weeks} weeks, which costs about ${money(plan.forgone_yield_usd)} of forgone 4% T-bill yield and ${money(plan.cash_fees_usd)} of round-trip protocol fees on a ${money(plan.ticket_usd)} ticket plus ${money(plan.gas_usd)} of gas.`,
    multi
      ? `Use ${p.chains.length} of the protocol's listed chains (${p.chains.slice(0, 3).join(', ')}) for one small action each: depth on ${plan.chain} plus a footprint elsewhere reads better than a spread of dust.`
      : `Keep this address a single-chain ${plan.chain} user: with ${p.chains.length} listed chain, depth beats a spray across chains.`,
    `Do the position in about ${plan.hours} hands-on hours: setup and approvals in the first hour, then one qualifying action a week (deposit, borrow, swap or vote) for the hold.`,
    `Log every step in a dated sheet: transaction hashes, gas paid against the ${money(plan.gas_usd)} budget, the ${plan.fee_pct}% fee, the ${money(p.tvl_usd)} TVL and the ${plan.airdrop_share * 100}% airdrop share assumed.`,
    years === null
      ? `Watch the protocol's own announcements for a points season: its listing date is not on record, so no season can be dated from the snapshot.`
      : `Watch the protocol's own announcements for a points season; it has been listed ${age} days (${years.toFixed(1)} years)${years < 1 ? ', so a first season may still be open' : ', so an early allocation is more likely than a first one'}.`,
  ];
  return steps.map((s) => {
    let out = s.trim();
    if (out.length > 600) out = `${out.slice(0, 596)} ...`;
    return out;
  });
}

// ------------------------------------------------------------------ the board

export interface BuiltBoard {
  rows: Row[];
  ledger: LedgerEntry[];
  live: LiveRow[];
  totalExpected: number;
  bands: Map<string, Band>;
}

/**
 * The whole board: the 758-protocol ledger, the ranked pre-token board (sorted by expected value, ties
 * by TVL then slug, so two runs agree byte for byte), the bootstrap band, the farm plan and the steps,
 * and the live-token anchors kept apart. Ranks are 1..N once each and the expected value never rises.
 */
export function buildBoard(snapshot: Snapshot): BuiltBoard {
  const ledger = buildLedger(snapshot);
  const comps = comparables(snapshot.protocols);
  const oddsFit = fitOdds(snapshot);
  const bands = bootstrapBands(comps, ledger.candidates, ECONOMICS.bootstrap_seed, ECONOMICS.bootstrap_resamples);

  const scored = ledger.candidates.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const implied = Math.max(1, Math.round(curveAt(huberValueFit(comps), p.tvl_usd) * growthMultiplier(p.change_7d)));
    const o = oddsOf(p, age, oddsFit);
    const expected = Math.max(1, Math.round(implied * o));
    const band = bands.get(p.slug);
    return { p, age, implied, o, expected, band };
  });
  scored.sort((a, b) => b.expected - a.expected || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: Row[] = scored.map((s, i) => {
    const band = s.band ?? { lo: s.implied, hi: s.implied, rankLo: i + 1, rankHi: i + 1 };
    const plan = farmPlan({
      tvl_usd: s.p.tvl_usd,
      chains: s.p.chains,
      age_days: s.age,
      implied_value_usd: s.implied,
      expected_value_usd: s.expected,
      implied_p10_usd: band.lo,
      odds: s.o,
    });
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      watchlist: snapshot.watchlist.includes(s.p.slug),
      implied_value_usd: s.implied,
      odds: roundTo(s.o, 10000),
      expected_value_usd: s.expected,
      growth_mult: roundTo(growthMultiplier(s.p.change_7d), 10000),
      band_p10_usd: band.lo,
      band_p90_usd: band.hi,
      expected_p10_usd: Math.round(band.lo * s.o),
      expected_p90_usd: Math.round(band.hi * s.o),
      rank_lo: band.rankLo,
      rank_hi: band.rankHi,
      farm: plan,
      farm_steps: farmSteps(s.p, plan, s.age),
    };
  });

  const rankOf = new Map(rows.map((r) => [r.slug, r.rank]));
  for (const e of ledger.entries) e.rank = rankOf.get(e.slug) ?? null;

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => recordsToken(p) && (p.mcap_usd ?? 0) > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      multiple: roundTo(p.mcap_usd! / Math.max(1, p.tvl_usd), 10000),
    }));

  return { rows, ledger: ledger.entries, live, totalExpected: rows.reduce((s, r) => s + r.expected_value_usd, 0), bands };
}

let cachedCurve: { fit: Fit; n: number } | null = null;
/** The fitted value curve for a given comparables set; memoised so the fit runs once per build. */
function huberValueFit(comps: Protocol[]): Fit {
  if (cachedCurve !== null && cachedCurve.n === comps.length) return cachedCurve.fit;
  const fit = huber(comps.map((p) => Math.log10(p.tvl_usd)), comps.map((p) => Math.log10(p.mcap_usd!)));
  cachedCurve = { fit, n: comps.length };
  return fit;
}

/** The fit the dashboard states, with the count it was fitted on. */
export function valueFit(comps: Protocol[]): { intercept: number; slope: number; n: number } {
  const fit = huber(comps.map((p) => Math.log10(p.tvl_usd)), comps.map((p) => Math.log10(p.mcap_usd!)));
  cachedCurve = { fit, n: comps.length };
  return { intercept: fit.intercept, slope: fit.slope, n: comps.length };
}

// ------------------------------------------------------------------ gate check, snapshot parse, data script

/** Why a board is not one the gate takes, or null. */
export function boardIssue(rows: Row[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `the board holds ${rows.length} rows, outside 100..4000`;
  const slugs = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < rows.length; i++) if (rows[i].expected_value_usd > rows[i - 1].expected_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (rows.length >= 2 && rows[0].expected_value_usd === rows[rows.length - 1].expected_value_usd) return 'every row shares one expected value';
  for (const r of rows) {
    if (!Number.isSafeInteger(r.expected_value_usd) || r.expected_value_usd <= 0 || r.expected_value_usd > 1e14) return `${r.slug} carries expected value ${r.expected_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd as number, protocols, watchlist: o.watchlist as string[] };
}

/** Everything the dashboard renders, as one object. */
export function buildRadar(snapshot: Snapshot): RadarData {
  const built = buildBoard(snapshot);
  const comps = comparables(snapshot.protocols);
  const fit = valueFit(comps);
  const oddsFit = fitOdds(snapshot);
  const val = validation(comps, snapshot.as_of);
  const ranked_below_floor = built.rows.filter((r) => r.tvl_usd < snapshot.floor_usd).length;
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      version: MODEL_VERSION,
      coef: { intercept: fit.intercept, slope: fit.slope, n: fit.n },
      growth: { floor: GROWTH.floor, cap: GROWTH.cap, weight: GROWTH.weight },
      odds: oddsFit,
      economics: {
        airdrop_share: ECONOMICS.airdrop_share,
        float_floor_usd: ECONOMICS.float_floor_usd,
        float_alpha: ECONOMICS.float_alpha,
        tbill_rate: ECONOMICS.tbill_rate,
        ticket_alpha: ECONOMICS.ticket_alpha,
        max_ticket_usd: ECONOMICS.max_ticket_usd,
        min_ticket_usd: ECONOMICS.min_ticket_usd,
        farm_per_hour_target: ECONOMICS.farm_per_hour_target,
        bootstrap_resamples: ECONOMICS.bootstrap_resamples,
      },
    },
    validation: val,
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      board: built.rows.length,
      live: built.live.length,
      ranked_below_floor,
      ledger: {
        'pre-token ranked': built.ledger.filter((e) => e.status === 'pre-token ranked').length,
        'has token': built.ledger.filter((e) => e.status === 'has token').length,
        'wrapped or staked product': built.ledger.filter((e) => e.status === 'wrapped or staked product').length,
        excluded: built.ledger.filter((e) => e.status === 'excluded').length,
      },
    },
    rows: built.rows,
    live: built.live,
    ledger: built.ledger,
  };
}

/** The dashboard's whole dataset as one script: window.RADAR, read beside the page. No fetch. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
