/**
 * Summarizes edition JSON under Data/Awards/editions per catalog award.
 * Use after imports to see years present, category counts, TMDB coverage, dataSource mix.
 *
 *   node scripts/check-awards-coverage.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG = path.join(REPO_ROOT, "Pitflix.API", "Data", "Awards", "catalog.json");
const EDITIONS = path.join(REPO_ROOT, "Pitflix.API", "Data", "Awards", "editions");

/** Minimum categories before flagging (loose — older Globes may have fewer files). */
const WARN_MIN_CATS = {
  "academy-awards": 8,
  "primetime-emmys": 2,
  bafta: 6,
  "golden-globes": 3,
};

function loadCatalog() {
  const j = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  return (j.awards ?? []).map((a) => a.id);
}

function scanAward(awardId) {
  const dir = path.join(EDITIONS, awardId);
  if (!fs.existsSync(dir)) {
    return { awardId, files: [], error: "no directory" };
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const year = parseInt(f.replace(/\.json$/i, ""), 10);
      const fp = path.join(dir, f);
      let row = {
        year,
        categories: 0,
        nominees: 0,
        withTmdb: 0,
        winners: 0,
        dataSource: "",
      };
      try {
        const j = JSON.parse(fs.readFileSync(fp, "utf8"));
        row.dataSource = String(j.dataSource ?? "").slice(0, 48);
        const cats = j.categories ?? [];
        row.categories = cats.length;
        for (const c of cats) {
          for (const n of c.nominees ?? []) {
            row.nominees++;
            if (n.tmdbId != null && n.tmdbId > 0) row.withTmdb++;
            if (n.winner) row.winners++;
          }
        }
      } catch {
        row.error = "parse";
      }
      return row;
    })
    .filter((r) => Number.isFinite(r.year))
    .sort((a, b) => a.year - b.year);

  return { awardId, files };
}

function main() {
  const awards = loadCatalog();
  console.log(`Catalog awards: ${awards.join(", ")}\n`);

  for (const awardId of awards) {
    const { files, error } = scanAward(awardId);
    if (error) {
      console.log(`## ${awardId}\n  (${error})\n`);
      continue;
    }
    const years = files.map((f) => f.year);
    const minY = years.length ? Math.min(...years) : null;
    const maxY = years.length ? Math.max(...years) : null;
    const warnMin = WARN_MIN_CATS[awardId] ?? 1;
    const thin = files.filter((f) => f.categories < warnMin && !f.error);
    const noTmdb = files.filter((f) => f.nominees > 0 && f.withTmdb === 0);

    console.log(`## ${awardId}`);
    console.log(`  editions: ${files.length}  year span: ${minY ?? "—"}–${maxY ?? "—"}`);
    if (thin.length) {
      console.log(`  WARN categories < ${warnMin}: ${thin.map((t) => t.year).join(", ")}`);
    }
    if (noTmdb.length && noTmdb.length <= 15) {
      console.log(`  NOTE all nominees missing tmdbId: ${noTmdb.map((t) => t.year).join(", ")}`);
    } else if (noTmdb.length > 15) {
      console.log(`  NOTE ${noTmdb.length} editions have no tmdbId on nominees (bulk Wikipedia/Wikidata import)`);
    }
    const bySource = new Map();
    for (const f of files) {
      const k = f.dataSource || "(none)";
      bySource.set(k, (bySource.get(k) ?? 0) + 1);
    }
    console.log(`  dataSource counts:`);
    for (const [k, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${n}x  ${k}`);
    }
    console.log("");
  }
}

main();
