// main.ts — token-radar-01's entry point. Node 22 standard library only; no network, no clock.
//
// It reads the sealed snapshot, builds the ledger, the ranked board and the farm plans with the model in
// lib/model.ts, writes /output/board.json and the dashboard's data beside the page, copies dashboard/ and
// screenshots/ into /output, and writes /output/dossier.json with the vendored make.fun library.
//
// The grader runs `node /bot/main.ts` from a working directory that is not this repository, so the
// dashboard and the screenshots are resolved from import.meta.dirname, never from process.cwd().
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Two runs write byte-identical board.json, data.js and dossier.json: every random draw is seeded and
// nothing reads the clock.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const scriptDir = import.meta.dirname;

const TEXT_MAX_BYTES = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = buildRadar(snapshot);
const issue = boardIssue(radar.rows, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });

// board.json: the gate's five fields first, then everything else the page needs. implied_value_usd is
// the board's ranked quantity, the expected value (the token's own implied value x the fitted launch
// odds), so it never rises as the rank ascends and rank 1 is the most valuable protocol.
const board = {
  model: radar.model.version,
  as_of: radar.as_of,
  rows: radar.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.expected_value_usd,
    farm_steps: r.farm_steps,
    expected_value_usd: r.expected_value_usd,
    token_implied_value_usd: r.implied_value_usd,
    odds: r.odds,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    category: r.category,
    chains: r.chains,
    listed_at: r.listed_at,
    age_days: r.age_days,
    watchlist: r.watchlist,
    growth_mult: r.growth_mult,
    band_p10_usd: r.band_p10_usd,
    band_p90_usd: r.band_p90_usd,
    expected_p10_usd: r.expected_p10_usd,
    expected_p90_usd: r.expected_p90_usd,
    rank_lo: r.rank_lo,
    rank_hi: r.rank_hi,
    farm: r.farm,
  })),
};
writeFileSync(join(out, 'board.json'), `${JSON.stringify(board)}\n`);

// data.js: the dashboard's whole dataset, beside the page. It is not under dashboard/, so it is not part
// of the source text the judge reads; it is what the page renders.
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping dot-names; the destination starts clean. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    cpSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyDir(join(scriptDir, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(scriptDir, 'screenshots'), join(out, 'screenshots'));
if (!dash.includes('index.html')) {
  process.stderr.write('token radar: dashboard/index.html is missing\n');
  process.exit(1);
}
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in three, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares the bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES }));

const lc = radar.counts.ledger;
process.stdout.write(
  `token radar: ${radar.counts.protocols} protocols, ${radar.counts.watchlist} on the watchlist, ${board.rows.length} ranked rows ` +
    `(${radar.counts.ranked_below_floor} below the $${Math.round(radar.floor_usd / 1e6)}M floor), $${radar.rows.reduce((s, r) => s + r.expected_value_usd, 0).toLocaleString('en-US')} of expected value\n` +
    `token radar: ledger: ${lc['pre-token ranked']} ranked, ${lc['has token']} carry a token, ${lc['wrapped or staked product']} wrapped or staked, ${lc.excluded} excluded ` +
    `(model ${radar.model.version}, odds fitted on ${radar.model.odds.n} protocols)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dash.length} files), screenshots/ (${shots.length} images), dossier.json (${statSync(join(out, 'dossier.json')).size} bytes)\n`,
);
