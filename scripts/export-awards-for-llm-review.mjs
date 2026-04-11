/**
 * Bundles all Pitflix awards edition JSON + catalog for external review (e.g. ChatGPT file upload).
 *
 * Writes UTF-8 JSON under Pitflix.API/Data/Awards/_review_for_chatgpt/
 *   - manifest.json — byte sizes, year ranges, edition counts
 *   - catalog.json — copy of awards catalog
 *   - <awardId>.json — { awardId, name, editions: [ full per-year objects as on disk ] }
 *   - all-awards.json — { exportedAt, catalog, awards: { academy-awards: [...], ... } } (large)
 *
 * Usage (repo root): node scripts/export-awards-for-llm-review.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DATA_AWARDS = path.join(REPO, "Pitflix.API", "Data", "Awards");
const EDITIONS_ROOT = path.join(DATA_AWARDS, "editions");
const OUT_DIR = path.join(DATA_AWARDS, "_review_for_chatgpt");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function listAwardIds() {
  if (!fs.existsSync(EDITIONS_ROOT)) return [];
  return fs.readdirSync(EDITIONS_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

function loadAllEditions(awardId) {
  const dir = path.join(EDITIONS_ROOT, awardId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    const y = parseInt(path.basename(f, ".json"), 10);
    if (!Number.isFinite(y)) continue;
    const full = path.join(dir, f);
    try {
      const doc = readJson(full);
      out.push({
        ...doc,
        _sourceFile: `editions/${awardId}/${f}`,
      });
    } catch (e) {
      out.push({
        awardId,
        year: y,
        _error: String(e.message),
        _sourceFile: `editions/${awardId}/${f}`,
      });
    }
  }
  out.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  return out;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const catalogPath = path.join(DATA_AWARDS, "catalog.json");
  const catalog = fs.existsSync(catalogPath) ? readJson(catalogPath) : { awards: [] };
  const nameById = Object.fromEntries((catalog.awards ?? []).map((a) => [a.id, a.name]));

  const awardIds = listAwardIds();
  const manifest = {
    exportedAt: new Date().toISOString(),
    purpose:
      "Full awards dataset for human/LLM QA. Cross-check nominees and winners against AMPAS, Television Academy, BAFTA, Golden Globes. Note: tmdbId may be null in files; API can resolve at runtime.",
    files: [],
    awards: [],
  };

  fs.writeFileSync(path.join(OUT_DIR, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n", "utf8");
  manifest.files.push({ path: "catalog.json", bytes: fs.statSync(path.join(OUT_DIR, "catalog.json")).size });

  const bundleAwards = {};

  for (const awardId of awardIds.sort()) {
    const editions = loadAllEditions(awardId);
    const years = editions.map((e) => e.year).filter((y) => Number.isFinite(y));
    const payload = {
      awardId,
      displayName: nameById[awardId] ?? awardId,
      editionCount: editions.length,
      yearMin: years.length ? Math.min(...years) : null,
      yearMax: years.length ? Math.max(...years) : null,
      editions,
    };

    bundleAwards[awardId] = editions;

    const outPath = path.join(OUT_DIR, `${awardId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    const st = fs.statSync(outPath);
    manifest.files.push({ path: `${awardId}.json`, bytes: st.size });
    manifest.awards.push({
      awardId,
      displayName: payload.displayName,
      editions: editions.length,
      yearMin: payload.yearMin,
      yearMax: payload.yearMax,
    });
  }

  const allPath = path.join(OUT_DIR, "all-awards.json");
  const allPayload = {
    exportedAt: manifest.exportedAt,
    catalog,
    awards: bundleAwards,
  };
  fs.writeFileSync(allPath, JSON.stringify(allPayload, null, 2) + "\n", "utf8");
  manifest.files.push({ path: "all-awards.json", bytes: fs.statSync(allPath).size });

  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const readme = `Pitflix awards — bundle for external review (ChatGPT, Claude, etc.)
Generated: ${manifest.exportedAt}

WHAT IS HERE
- manifest.json   — sizes and year coverage per award
- catalog.json    — in-app award list (Oscars, Emmys, BAFTA, Globes)
- <awardId>.json  — one file per award; full edition JSON (categories + nominees + dataSource)
- all-awards.json — everything in one file (may be large; use per-award files if upload limits)

HOW TO USE WITH CHATGPT
1. Upload manifest.json first and ask for a coverage summary.
2. Upload one <awardId>.json at a time (or all-awards.json if it fits) and ask:
   - Compare nominees and winners to official ceremony results for sample years.
   - Flag sparse editions (single category, winner-only notes, wikidata seeds).
   - Flag inconsistent category ids or impossible duplicate winners.
3. Official references: oscars.org, emmys.com, bafta.org, goldenglobes.com (verify eligibility years differ from ceremony years for some awards).

SOURCE OF TRUTH IN REPO
Pitflix.API/Data/Awards/editions/<awardId>/<year>.json
The _sourceFile field on each edition mirrors this path (without leading Data/Awards/).

Re-generate this folder:
  node scripts/export-awards-for-llm-review.mjs
`;

  fs.writeFileSync(path.join(OUT_DIR, "README.txt"), readme, "utf8");

  console.error(`Wrote ${OUT_DIR}`);
  console.error(`  files: ${manifest.files.length}  awards: ${manifest.awards.length}`);
  for (const a of manifest.awards) {
    console.error(`  - ${a.awardId}: ${a.editions} editions (${a.yearMin ?? "?"}–${a.yearMax ?? "?"})`);
  }
  console.error(`  largest: ${manifest.files.reduce((m, f) => (f.bytes > m ? f.bytes : m), 0)} bytes`);
}

main();
