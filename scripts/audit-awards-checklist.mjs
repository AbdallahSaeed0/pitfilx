/**
 * Audit Pitflix edition JSON against the normalized category IDs in
 * awards_data_audit_checklist.docx (extract to scripts/_audit_plain.txt or pass --text=).
 *
 * Usage (repo root): node scripts/audit-awards-checklist.mjs
 * Optional: node scripts/audit-awards-checklist.mjs --years=2018-2026
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EDITIONS = path.join(ROOT, "Pitflix.API", "Data", "Awards", "editions");

/** Checklist "Normalized ID" -> Pitflix `categories[].id` in JSON */
const CHECKLIST_TO_PITFLIX = {
  // Oscars
  "best-international-feature-film": "best-international",
  "best-animated-feature": "best-animated",
  "best-documentary-feature": "best-documentary",
  "best-makeup-and-hair-styling": "best-makeup-hairstyling",
  "best-makeup-and-hairstyling": "best-makeup-hairstyling",
  "best-live-action-short-film": "best-live-action-short",
  "best-animated-short-film": "best-animated-short",
  "best-documentary-short-film": "best-documentary-short",
  // Emmys (checklist naming)
  "outstanding-limited-or-anthology-series": "outstanding-limited-series",
  "lead-actor-drama": "emmy-lead-actor-drama",
  "lead-actress-drama": "emmy-lead-actress-drama",
  "lead-actor-comedy": "emmy-lead-actor-comedy",
  "lead-actress-comedy": "emmy-lead-actress-comedy",
  "lead-actor-limited-anthology-or-movie": "emmy-lead-actor-limited",
  "lead-actress-limited-anthology-or-movie": "emmy-lead-actress-limited",
  "supporting-actor-drama": "emmy-supporting-actor-drama",
  "supporting-actress-drama": "emmy-supporting-actress-drama",
  "supporting-actor-comedy": "emmy-supporting-actor-comedy",
  "supporting-actress-comedy": "emmy-supporting-actress-comedy",
  "supporting-actor-limited-anthology-or-movie": "emmy-supporting-actor-limited",
  "supporting-actress-limited-anthology-or-movie": "emmy-supporting-actress-limited",
  "directing-drama": "emmy-directing-drama",
  "directing-comedy": "emmy-directing-comedy",
  "writing-drama": "emmy-writing-drama",
  "writing-comedy": "emmy-writing-comedy",
  "outstanding-television-movie": "outstanding-television-movie",
  "outstanding-reality-competition-program": "outstanding-reality-competition",
  "outstanding-talk-series": "outstanding-talk-series",
  "outstanding-scripted-variety-series": "outstanding-scripted-variety",
  // BAFTA
  "leading-actor": "best-actor",
  "leading-actress": "best-actress",
  "supporting-actor": "best-supporting-actor",
  "supporting-actress": "best-supporting-actress",
  "original-screenplay": "best-original-screenplay",
  "adapted-screenplay": "best-adapted-screenplay",
  "film-not-in-the-english-language": "best-film-not-english",
  "documentary": "best-documentary",
  "animated-film": "best-animated-film",
  "children-and-family-film": "best-children-family-film",
  "casting": "best-casting",
  "cinematography": "best-cinematography",
  "costume-design": "best-costume-design",
  "editing": "best-editing",
  "make-up-and-hair": "best-makeup-hair",
  "original-score": "best-original-score",
  "production-design": "best-production-design",
  "sound": "best-sound",
  "special-visual-effects": "best-visual-effects",
  "british-short-film": "best-british-short-film",
  "british-short-animation": "best-british-short-animation",
  "ee-rising-star-award": "ee-rising-star",
  "outstanding-debut-by-a-british-writer-director-or-producer": "outstanding-debut-british",
  // Golden Globes
  "best-motion-picture-drama": "best-picture-drama",
  "best-motion-picture-musical-or-comedy": "best-picture-musical-comedy",
  "best-director": "best-director-film",
  "best-screenplay": "best-screenplay-film",
  "best-actor-motion-picture-drama": "best-actor-film-drama",
  "best-actress-motion-picture-drama": "best-actress-film-drama",
  "best-actor-motion-picture-musical-or-comedy": "best-actor-film-comedy",
  "best-actress-motion-picture-musical-or-comedy": "best-actress-film-comedy",
  "best-supporting-actor": "best-supporting-actor-film",
  "best-supporting-actress": "best-supporting-actress-film",
  "best-non-english-language-film": "best-non-english-film",
  "best-original-score": "best-original-score-film",
  "best-original-song": "best-original-song-film",
  "cinematic-and-box-office-achievement": "best-cinematic-box-office",
  "best-television-series-drama": "best-tv-drama",
  "best-television-series-musical-or-comedy": "best-tv-musical-comedy",
  "best-limited-series-anthology-series-or-television-motion-picture": "best-limited-tv",
  "best-actor-television-drama": "best-actor-tv-drama",
  "best-actress-television-drama": "best-actress-tv-drama",
  "best-actor-television-musical-or-comedy": "best-actor-tv-comedy",
  "best-actress-television-musical-or-comedy": "best-actress-tv-comedy",
  "best-actor-limited-series-tv-movie": "best-actor-limited-tv",
  "best-actress-limited-series-tv-movie": "best-actress-limited-tv",
  "best-supporting-actor-television": "best-supporting-actor-tv",
  "best-supporting-actress-television": "best-supporting-actress-tv",
};

const OSCAR_EXPECT = [
  "best-picture",
  "best-director",
  "best-actor",
  "best-actress",
  "best-supporting-actor",
  "best-supporting-actress",
  "best-original-screenplay",
  "best-adapted-screenplay",
  "best-international",
  "best-animated",
  "best-documentary",
  "best-cinematography",
  "best-film-editing",
  "best-production-design",
  "best-costume-design",
  "best-makeup-hairstyling",
  "best-original-score",
  "best-original-song",
  "best-sound",
  "best-visual-effects",
  "best-live-action-short",
  "best-animated-short",
  "best-documentary-short",
];

const EMMY_EXPECT = [
  "outstanding-drama-series",
  "outstanding-comedy-series",
  "outstanding-limited-series",
  "outstanding-television-movie",
  "emmy-lead-actor-drama",
  "emmy-lead-actress-drama",
  "emmy-lead-actor-comedy",
  "emmy-lead-actress-comedy",
  "emmy-lead-actor-limited",
  "emmy-lead-actress-limited",
  "emmy-supporting-actor-drama",
  "emmy-supporting-actress-drama",
  "emmy-supporting-actor-comedy",
  "emmy-supporting-actress-comedy",
  "emmy-supporting-actor-limited",
  "emmy-supporting-actress-limited",
  "emmy-directing-drama",
  "emmy-directing-comedy",
  "emmy-writing-drama",
  "emmy-writing-comedy",
  "outstanding-reality-competition",
  "outstanding-talk-series",
  "outstanding-scripted-variety",
];

const BAFTA_EXPECT = [
  "best-film",
  "outstanding-british-film",
  "best-direction",
  "best-actor",
  "best-actress",
  "best-supporting-actor",
  "best-supporting-actress",
  "best-original-screenplay",
  "best-adapted-screenplay",
  "outstanding-debut-british",
  "best-film-not-english",
  "best-documentary",
  "best-animated-film",
  "best-children-family-film",
  "best-casting",
  "best-cinematography",
  "best-costume-design",
  "best-editing",
  "best-makeup-hair",
  "best-original-score",
  "best-production-design",
  "best-sound",
  "best-visual-effects",
  "best-british-short-film",
  "best-british-short-animation",
  "ee-rising-star",
];

const GLOBE_EXPECT = [
  "best-picture-drama",
  "best-picture-musical-comedy",
  "best-director-film",
  "best-screenplay-film",
  "best-actor-film-drama",
  "best-actress-film-drama",
  "best-actor-film-comedy",
  "best-actress-film-comedy",
  "best-supporting-actor-film",
  "best-supporting-actress-film",
  "best-animated-film",
  "best-non-english-film",
  "best-original-score-film",
  "best-original-song-film",
  "best-cinematic-box-office",
  "best-tv-drama",
  "best-tv-musical-comedy",
  "best-limited-tv",
  "best-actor-tv-drama",
  "best-actress-tv-drama",
  "best-actor-tv-comedy",
  "best-actress-tv-comedy",
  "best-actor-limited-tv",
  "best-actress-limited-tv",
  "best-supporting-actor-tv",
  "best-supporting-actress-tv",
];

function parseYearsArg() {
  const a = process.argv.find((x) => x.startsWith("--years="))?.slice(8);
  if (!a) return [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];
  const [from, to] = a.split("-").map(Number);
  const ys = [];
  for (let y = from; y <= to; y++) ys.push(y);
  return ys;
}

function loadEdition(awardId, year) {
  const p = path.join(EDITIONS, awardId, `${year}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizeCatId(awardId, id) {
  if (awardId === "bafta" && id === "best-director") return "best-direction";
  return id;
}

function summarizeEdition(awardId, doc) {
  if (!doc?.categories) return { status: "invalid", cats: new Set(), winners: 0, nominees: 0, tmdbNull: 0 };
  const cats = new Set();
  let winners = 0;
  let nominees = 0;
  let tmdbNull = 0;
  for (const c of doc.categories) {
    if (c.id) cats.add(normalizeCatId(awardId, c.id));
    for (const n of c.nominees ?? []) {
      nominees++;
      if (n.winner) winners++;
      if (n.tmdbId == null || n.tmdbId === 0) tmdbNull++;
    }
  }
  const ds = String(doc.dataSource ?? "");
  const partial =
    doc.categories.length <= 1 &&
    (ds.toLowerCase().includes("wikidata") || String(doc.notes ?? "").toLowerCase().includes("winner-only"));
  return {
    status: partial ? "partial-seed" : nominees ? "ok" : "empty",
    cats,
    winners,
    nominees,
    tmdbNull,
    dataSource: ds,
    hasPoster: !!(doc.posterPath && String(doc.posterPath).trim()),
    hasBackdrop: !!(doc.backdropPath && String(doc.backdropPath).trim()),
  };
}

function auditAward(awardId, years, expectedIds) {
  const exp = new Set(expectedIds);
  const lines = [];
  lines.push(`\n## ${awardId}`);
  for (const y of years) {
    const doc = loadEdition(awardId, y);
    if (!doc) {
      lines.push(`| ${y} | **Missing** | — | — |`);
      continue;
    }
    const s = summarizeEdition(awardId, doc);
    const missing = [...exp].filter((id) => !s.cats.has(id));
    const extra = [...s.cats].filter((id) => !exp.has(id));
    const catCoverage = missing.length === 0 ? "Complete" : missing.length <= 3 ? "Partial" : "Partial";
    const yearStatus =
      s.status === "partial-seed" ? "Partial (seed)" : s.nominees === 0 ? "Missing" : catCoverage;
    lines.push(
      `| ${y} | ${yearStatus} | categories:${s.cats.size}/${exp.size} winners:${s.winners} tmdb∅:${s.tmdbNull}/${s.nominees} poster:${s.hasPoster ? "y" : "n"} | missing:${missing.slice(0, 5).join(",") || "—"}${missing.length > 5 ? "…" : ""} |`,
    );
    if (extra.length)
      lines.push(`  _ids in file but not in checklist core:_ ${extra.slice(0, 10).join(", ")}${extra.length > 10 ? "…" : ""}`);
  }
  return lines;
}

const years = parseYearsArg();

console.log("# Awards data audit (vs checklist normalized IDs → Pitflix JSON ids)\n");
console.log("Source checklist: `awards_data_audit_checklist.docx` — category expectations + years 2018–2026.\n");
console.log("| Award | Scope |");
console.log("|-------|-------|");

for (const block of auditAward("academy-awards", years, OSCAR_EXPECT)) console.log(block);
for (const block of auditAward("primetime-emmys", years, EMMY_EXPECT)) console.log(block);
for (const block of auditAward("bafta", years, BAFTA_EXPECT)) console.log(block);

for (const block of auditAward("golden-globes", years, GLOBE_EXPECT)) console.log(block);

console.log(`
## ID mapping notes (checklist ≠ Pitflix slug)
Oscars: best-international-feature-film → best-international; shorts/documentary/animated similarly shortened.
Emmys: importer uses emmy-* prefixes for acting/directing/writing; series blocks outstanding-*.
BAFTA: checklist leading-actor → best-actor; film-not-in-the-english-language → best-film-not-english; make-up-and-hair → best-makeup-hair.
Globes: checklist best-director → best-director-film (separate from other awards).
`);

console.log(JSON.stringify({ checklistAliasKeys: Object.keys(CHECKLIST_TO_PITFLIX).length }, null, 0));
