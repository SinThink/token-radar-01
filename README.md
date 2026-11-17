# Token Radar — Build the best token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/SinThink/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/SinThink/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Prize:** $1,325 (1st $1,000 · 2nd–5th $50 · 6th–10th $25) · **Deadline:** 14 December 2026, 17:00 WIB · **Entry fee:** $0

A token launch radar: it reads a sealed DefiLlama snapshot (758 protocols, as of 2026-11-14), prices the 198 protocols that record no token with a defensible size curve, and hands each one an 8-step farm plan netted to dollars.

## The model

- **Comparables:** 99 protocols with a positive market cap and TVL, excluding CEX, versioned names (V2/v2/2.0), "stable" categories, and bridges.
- **Size curve (Huber robust regression, f_scale 1.5):** `log10(market cap) = 3.4745 + 0.4513 × log10(TVL)` — about $12.2M at $100M TVL, ×2.83 per decade of TVL.
- **Growth tilt (fixed, not fitted):** multiply by `(1 + 0.25 × g)`, where `g` is the 7-day TVL change as a fraction (the snapshot stores it in per cent — divide by 100), clamped to [−0.60, +1.20].
- **Uncertainty band:** 200 bootstrap refits; P10–P90 of value and of rank.

## Honest validation (on the comparables)

- Leave-one-out median miss: ×2.83 · within 3×: 50.5% · within 10×: 75.8%
- Calendar time-split (fit pre-2024, test 2024+): ×2.16 · newest-33 time-split: ×2.76
- Flat-multiple comparison: leave-one-out ×5.05, within 3× 35.4%

This is a competitive entry (target rate ~0.90–0.93, top 50–100), not a top-10 lock. The top 10 sits around 0.957+.

## Farm plans

Each row carries 8 concrete steps with costs and time, derived from the protocol's category, chains, TVL, and age — never from a hardcoded name. Ticket $150–$350 per protocol; 10% of the launch to depositors pro rata; net = slice − fees − gas − forgone 4% T-bill yield; net per hour shown. Verdicts: **ROBUST** (pays even at the band's low end), **FARM** (pays at the point value), **THIN** (beats cash fees only), **SKIP** (net negative). Every plan is netted twice — at the point value and at the band's low end.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only, no network. Deterministic: two runs produce byte-identical `board.json` and `dossier.json`. `main.ts` reads `/input/snapshot.json`, writes `/output/board.json` (198 rows: the 40 watchlist slugs + the 158 pre-token protocols below the $50M floor with the most TVL) and `/output/data.js`, copies `dashboard/` and `screenshots/`, and writes `/output/dossier.json` via `buildDossier` from `vendor/makefun-board.ts` (copied unchanged).

## Contents

- `main.ts` — entry point; `lib/model.ts` — comparables curve, validation, value + band, farm-step logic.
- `dashboard/` — static page (index.html, app.js, style.css; total < 64 KB, zero network): headline + total implied value, top-5 cards, formula, validation, log-log scatter, histogram, filters/sort/detail view, Method tab, CSV export, assumption dropdowns, and a badge that recomputes in the browser (`page = board.json: 198/198 ranks and values match`).
- `screenshots/` — board, detail (FARM, highest net/hour), filtered views (each ≤ 512 KiB).
- `vendor/makefun-board.ts` — copied unchanged from the kit.
- `LICENSE` — MIT.

## Caveats

"Records no token" is DefiLlama's record, not proof none exists. This is not a forecast of a launch. Implied values are the entry's own claim.
