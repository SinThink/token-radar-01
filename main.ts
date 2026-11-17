// main.ts — reads the snapshot, writes board.json, data.js, copies dashboard/ and
// screenshots/, and writes dossier.json. Node 22 standard library only.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

// ----- args -----
const argv = process.argv.slice(2);
let inputPath = '/input/snapshot.json';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--input' && argv[i + 1]) inputPath = argv[++i]!;
}
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// ----- load -----
const raw = readFileSync(inputPath, 'utf8');
const snapshot = JSON.parse(raw) as {
  as_of: string;
  floor_usd: number;
  protocols: any[];
  watchlist: string[];
};

// ----- build -----
import { buildBoard } from './lib/model.ts';
const board = buildBoard(snapshot);

console.log(`Built ${board.rows.length} rows; total implied value ${board.totalValue.toLocaleString()}`);
console.log('Top 5:');
for (let i = 0; i < 5; i++) {
  const r = board.rows[i]!;
  console.log(`  ${r.rank}. ${r.name} — $${r.implied_value_usd.toLocaleString()} (x${r.multiple})`);
}
console.log('Watchlist top farm:');
for (const t of board.watchlistTop) {
  console.log(`  ${t.name} ${t.slug} — $${t.net_per_hour_point.toFixed(1)}/h`);
}

// ----- write board.json -----
mkdirSync(outDir, { recursive: true });
const boardObj = {
  rows: board.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  })),
};
writeFileSync(join(outDir, 'board.json'), JSON.stringify(boardObj, null, 2) + '\n');

// ----- write data.js -----
const rows = board.rows.map((r) => ({
  slug: r.slug,
  name: r.name,
  rank: r.rank,
  implied_value_usd: r.implied_value_usd,
  tvl_usd: r.tvl_usd,
  change_7d: r.change_7d,
  category: r.category,
  chains: r.chains,
  listed_at: r.listed_at,
  age_days: r.age_days,
  watchlist: r.watchlist,
  multiple: r.multiple,
  growth_mult: r.growth_mult,
  band_p10_usd: r.band_p10_usd,
  band_p90_usd: r.band_p90_usd,
  rank_lo: r.rank_lo,
  rank_hi: r.rank_hi,
  farm: r.farm,
  farm_steps: r.farm_steps,
}));
const dataJs = `/* eslint-disable */\n// auto-generated: the board's data for dashboard/app.js\nconst BOARD_DATA = ${JSON.stringify(rows, null, 0)};\nconst BOARD_TOTAL = ${board.totalValue};\nconst BOARD_AS_OF = ${JSON.stringify(snapshot.as_of)};\nconst COMPARABLES_COUNT = ${board.rows.filter((r: any) => !r.watchlist).length};\n`;
writeFileSync(join(outDir, 'data.js'), dataJs);

// ----- copy dashboard/ and screenshots/ -----
for (const sub of ['dashboard', 'screenshots']) {
  const src = join(process.cwd(), sub);
  if (!existsSync(src)) continue;
  const dst = join(outDir, sub);
  mkdirSync(dst, { recursive: true });
  if (existsSync(dst)) {
    const entries = readdirSync(dst, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dst, e.name);
      if (e.isFile()) try { writeFileSync(p, ''); } catch {}
      else if (e.isDirectory()) {
        // ensure empty dir
        const inner = readdirSync(p, { recursive: true, withFileTypes: true });
        for (const ie of inner) {
          try { writeFileSync(join(p, ie.name), ''); } catch {}
        }
      }
    }
  }
  cpSync(src, dst, { recursive: true });
}

// ----- buildDossier -----
import { buildDossier } from './vendor/makefun-board.ts';
const bytes = buildDossier(outDir, { text_max_bytes: 65536 });
writeFileSync(join(outDir, 'dossier.json'), Buffer.from(bytes));
console.log(`dossier.json written: ${bytes.length.toLocaleString()} bytes`);
