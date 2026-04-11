/**
 * Awards dataset QA: scan Pitflix.API/Data/Awards/editions, emit JSON + Markdown reports,
 * optionally apply structured `qa` metadata and safe string fixes.
 *
 * Usage (repo root):
 *   node scripts/audit-awards-data.mjs
 *   node scripts/audit-awards-data.mjs --apply-qa     Write qa block into each edition JSON (from scan)
 *   node scripts/audit-awards-data.mjs --fix-safe     Trim titles/names only (no semantic fixes)
 *   node scripts/audit-awards-data.mjs --out=custom   Override report directory name under Data/Awards/_qa
 *
 * Reports: Pitflix.API/Data/Awards/_qa/reports/awards-qa-report.{json,md}
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url"; 

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const EDITIONS = path.join(REPO, "Pitflix.API", "Data", "Awards", "editions");
const QA_ROOT = path.join(REPO, "Pitflix.API", "Data", "Awards", "_qa");

/** Inclusive ceremony-year ranges for “expected” coverage hints (historical gaps still normal). */
const COVERAGE_EXPECT = {
  "academy-awards": { start: 1929, end: 2026, officialHint: "https://www.oscars.org/" },
  "bafta": { start: 1949, end: 2026, officialHint: "https://www.bafta.org/" },
  "golden-globes": { start: 1944, end: 2026, officialHint: "https://www.goldenglobes.com/" },
  "primetime-emmys": { start: 1949, end: 2026, officialHint: "https://www.emmys.com/" },
};

/** Person-first or “Person — Work” expected. */
const PERSON_HEAVY_IDS = new Set([
  "best-actor",
  "best-actress",
  "best-supporting-actor",
  "best-supporting-actress",
  "best-director",
  "best-direction",
  "best-casting",
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
  "best-actor-film-drama",
  "best-actress-film-drama",
  "best-actor-film-comedy",
  "best-actress-film-comedy",
  "best-actor-tv-drama",
  "best-actress-tv-drama",
  "best-actor-tv-comedy",
  "best-actress-tv-comedy",
  "best-supporting-actor-film",
  "best-supporting-actress-film",
  "best-supporting-actor-tv",
  "best-supporting-actress-tv",
  "best-director-film",
  "best-screenplay-film",
]);

function parseArgs() {
  const a = process.argv.slice(2);
  return {
    applyQa: a.includes("--apply-qa"),
    fixSafe: a.includes("--fix-safe"),
    outSub: a.find((x) => x.startsWith("--out="))?.slice(6)?.trim() || "reports",
  };
}

function readJsonFile(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function listEditionFiles() {
  const out = [];
  if (!fs.existsSync(EDITIONS)) return out;
  for (const awardId of fs.readdirSync(EDITIONS, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const id = awardId.name;
    const dir = path.join(EDITIONS, id);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const y = parseInt(path.basename(f, ".json"), 10);
      if (!Number.isFinite(y)) continue;
      out.push({ awardId: id, year: y, path: path.join(dir, f) });
    }
  }
  return out.sort((a, b) => a.awardId.localeCompare(b.awardId) || a.year - b.year);
}

function analyzeEdition(awardId, year, doc, relPath) {
  const issues = [];
  const ds = String(doc.dataSource ?? "");
  const notes = String(doc.notes ?? "");
  const cats = doc.categories ?? [];
  const catIds = cats.map((c) => c.id);

  const idCounts = {};
  for (const c of cats) {
    const id = c.id ?? "";
    if (!id) continue;
    idCounts[id] = (idCounts[id] ?? 0) + 1;
  }
  for (const [id, n] of Object.entries(idCounts)) {
    if (n > 1) {
      issues.push({
        code: "duplicate_category_id",
        severity: "error",
        detail: `Duplicate category id "${id}" appears ${n} times`,
      });
    }
  }

  const nomTotal = cats.reduce((s, c) => s + (c.nominees?.length ?? 0), 0);
  const winnerTotal = cats.reduce(
    (s, c) => s + (c.nominees?.filter((n) => n.winner).length ?? 0),
    0,
  );

  if (cats.length === 0) {
    issues.push({ code: "no_categories", severity: "error", detail: "Edition has no categories" });
  }

  if (cats.length === 1) {
    issues.push({
      code: "single_category_edition",
      severity: "warn",
      detail: "Only one category (often seed or incomplete)",
    });
  }

  const seedByText =
    /\bwinner-only\b/i.test(notes) ||
    /\bAuto-generated winner-only\b/i.test(notes) ||
    /wikidata-sparql-seed/i.test(ds) ||
    (cats.length === 1 && nomTotal <= 2 && winnerTotal >= 1);

  if (seedByText) {
    issues.push({ code: "likely_seed_edition", severity: "warn", detail: "Winner-only / Wikidata seed indicators" });
  }

  for (const cat of cats) {
    const nom = cat.nominees ?? [];
    const wid = cat.id ?? "";
    const wname = cat.name ?? "";

    if (nom.length === 0) {
      issues.push({
        code: "category_empty_nominees",
        severity: "warn",
        categoryId: wid,
        detail: `"${wname}" has no nominees`,
      });
    }

    if (nom.length === 1) {
      issues.push({
        code: "category_single_nominee",
        severity: "info",
        categoryId: wid,
        detail: `"${wname}" has only one nominee`,
      });
    }

    const winCount = nom.filter((n) => n.winner).length;
    if (nom.length > 0 && winCount === 0) {
      issues.push({
        code: "category_no_winner",
        severity: "error",
        categoryId: wid,
        detail: `"${wname}" has zero winners`,
      });
    }
    if (winCount > 1) {
      issues.push({
        code: "category_multiple_winners",
        severity: "warn",
        categoryId: wid,
        detail: `"${wname}" has ${winCount} winners (verify tie vs data bug)`,
      });
    }

    const seen = new Set();
    for (const n of nom) {
      const key = `${String(n.title ?? "").trim().toLowerCase()}\t${!!n.winner}`;
      if (seen.has(key)) {
        issues.push({
          code: "duplicate_nominee_row",
          severity: "warn",
          categoryId: wid,
          detail: `Duplicate nominee "${n.title}"`,
        });
      }
      seen.add(key);
    }

    if (PERSON_HEAVY_IDS.has(wid)) {
      for (const n of nom) {
        const t = String(n.title ?? "").trim();
        if (t && !t.includes("—") && !t.includes(" – ") && /^[A-Z][a-z]{2,15}$/.test(t)) {
          issues.push({
            code: "suspicious_single_token_in_person_category",
            severity: "info",
            categoryId: wid,
            detail: `Single short token "${t}" (may omit credited work)`,
          });
        }
      }
    }
  }

  let tmdbNull = 0;
  let tmdbSet = 0;
  for (const cat of cats) {
    for (const n of cat.nominees ?? []) {
      if (n.tmdbId != null && n.tmdbId > 0) tmdbSet++;
      else tmdbNull++;
    }
  }

  const qaWarnings = issues.filter((i) => i.severity !== "info").map((i) => `${i.code}:${i.categoryId || ""}:${i.detail}`);

  const qa = {
    version: 1,
    lastAuditAt: new Date().toISOString(),
    isSeedEdition: seedByText || (cats.length === 1 && nomTotal <= 2),
    needsNomineeBackfill:
      seedByText ||
      cats.length <= 2 ||
      issues.some((i) => i.code === "category_single_nominee" || i.code === "category_empty_nominees"),
    needsTmdbEnrichment: tmdbNull > 0,
    warnings: qaWarnings,
    stats: {
      categoryCount: cats.length,
      nomineeCount: nomTotal,
      winnerCount: winnerTotal,
      tmdbNull,
      tmdbSet,
    },
  };

  return { relPath: relPath.replace(/\\/g, "/"), awardId, year, issues, qa, dataSource: ds, notes };
}

function missingYearsMap(filesByAward) {
  const gaps = {};
  for (const [awardId, cfg] of Object.entries(COVERAGE_EXPECT)) {
    const have = new Set((filesByAward[awardId] ?? []).map((f) => f.year));
    const missing = [];
    for (let y = cfg.start; y <= cfg.end; y++) {
      if (!have.has(y)) missing.push(y);
    }
    gaps[awardId] = { expectedRange: `${cfg.start}–${cfg.end}`, missingYears: missing, officialHint: cfg.officialHint };
  }
  return gaps;
}

function trimEditionStrings(doc) {
  let changed = false;
  if (doc.label != null && doc.label !== String(doc.label).trim()) {
    doc.label = String(doc.label).trim();
    changed = true;
  }
  for (const c of doc.categories ?? []) {
    if (c.name != null && c.name !== String(c.name).trim()) {
      c.name = String(c.name).trim();
      changed = true;
    }
    for (const n of c.nominees ?? []) {
      if (n.title != null && n.title !== String(n.title).trim()) {
        n.title = String(n.title).trim();
        changed = true;
      }
    }
  }
  return changed;
}

function main() {
  const { applyQa, fixSafe, outSub } = parseArgs();
  const reportDir = path.join(QA_ROOT, outSub);
  fs.mkdirSync(reportDir, { recursive: true });

  const allFiles = listEditionFiles();
  const filesByAward = {};
  for (const f of allFiles) {
    if (!filesByAward[f.awardId]) filesByAward[f.awardId] = [];
    filesByAward[f.awardId].push(f);
  }

  const editions = [];
  const flatIssues = [];
  let totalTmdbNull = 0;
  let totalTmdbSet = 0;
  let totalNoms = 0;

  for (const f of allFiles) {
    const rel = path.relative(path.join(REPO, "Pitflix.API"), f.path);
    let doc;
    try {
      doc = readJsonFile(f.path);
    } catch (e) {
      editions.push({
        awardId: f.awardId,
        year: f.year,
        relPath: rel,
        parseError: String(e.message),
      });
      flatIssues.push({ severity: "error", path: rel, code: "json_parse_error", detail: String(e.message) });
      continue;
    }

    if (fixSafe) {
      if (trimEditionStrings(doc)) {
        writeJson(f.path, doc);
        flatIssues.push({ severity: "info", path: rel, code: "fix_safe_trim", detail: "Trimmed whitespace on strings" });
      }
    }

    const row = analyzeEdition(f.awardId, f.year, doc, rel);
    editions.push(row);
    for (const issue of row.issues) {
      flatIssues.push({
        severity: issue.severity,
        path: rel,
        awardId: f.awardId,
        year: f.year,
        code: issue.code,
        categoryId: issue.categoryId,
        detail: issue.detail,
      });
    }
    totalTmdbNull += row.qa.stats.tmdbNull;
    totalTmdbSet += row.qa.stats.tmdbSet;
    totalNoms += row.qa.stats.nomineeCount;

    if (applyQa) {
      doc.qa = row.qa;
      writeJson(f.path, doc);
    }
  }

  const gaps = missingYearsMap(filesByAward);
  const byAward = {};
  for (const id of Object.keys(COVERAGE_EXPECT)) {
    const rows = editions.filter((e) => e.awardId === id && !e.parseError);
    byAward[id] = {
      files: rows.length,
      tmdbNull: rows.reduce((s, e) => s + (e.qa?.stats?.tmdbNull ?? 0), 0),
      tmdbSet: rows.reduce((s, e) => s + (e.qa?.stats?.tmdbSet ?? 0), 0),
      issuesByCode: {},
    };
    for (const e of rows) {
      for (const i of e.issues ?? []) {
        byAward[id].issuesByCode[i.code] = (byAward[id].issuesByCode[i.code] ?? 0) + 1;
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    editionsRoot: path.relative(REPO, EDITIONS).replace(/\\/g, "/"),
    summary: {
      editionFiles: allFiles.length,
      totalNomineeRows: totalNoms,
      tmdbNull: totalTmdbNull,
      tmdbSet: totalTmdbSet,
      issueCounts: flatIssues.reduce((acc, i) => {
        acc[i.code] = (acc[i.code] ?? 0) + 1;
        return acc;
      }, {}),
    },
    coverageGaps: gaps,
    byAward,
    editions: editions.map((e) => ({
      awardId: e.awardId,
      year: e.year,
      path: e.relPath,
      issueCount: e.issues?.length ?? 0,
      codes: [...new Set((e.issues ?? []).map((i) => i.code))],
      parseError: e.parseError,
    })),
    issues: flatIssues,
  };

  const jsonPath = path.join(reportDir, "awards-qa-report.json");
  writeJson(jsonPath, report);

  const md = generateMarkdown(report);
  const mdPath = path.join(reportDir, "awards-qa-report.md");
  fs.writeFileSync(mdPath, md, "utf8");

  console.error(`Reports written:\n  ${jsonPath}\n  ${mdPath}`);

  const mirrorDir = path.join(REPO, "output", "awards-qa");
  try {
    fs.mkdirSync(mirrorDir, { recursive: true });
    fs.copyFileSync(jsonPath, path.join(mirrorDir, "awards-qa-report.json"));
    fs.copyFileSync(mdPath, path.join(mirrorDir, "awards-qa-report.md"));
    console.error(`Mirrored to ${mirrorDir}`);
  } catch (e) {
    console.error(`Mirror to output/awards-qa skipped: ${e.message}`);
  }

  if (applyQa) console.error("Applied `qa` object to each edition JSON (--apply-qa).");
  if (fixSafe) console.error("Applied --fix-safe (trim) where needed.");
}

function generateMarkdown(report) {
  const lines = [];
  lines.push(`# Awards QA report`);
  lines.push(``);
  lines.push(`Generated: **${report.generatedAt}**`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Edition JSON files | ${report.summary.editionFiles} |`);
  lines.push(`| Nominee rows | ${report.summary.totalNomineeRows} |`);
  lines.push(`| tmdbId null | ${report.summary.tmdbNull} |`);
  lines.push(`| tmdbId set | ${report.summary.tmdbSet} |`);
  lines.push(``);
  lines.push(`### Issue code counts`);
  lines.push(`| Code | Count |`);
  lines.push(`|------|-------|`);
  for (const [k, v] of Object.entries(report.summary.issueCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push(``);
  lines.push(`## Coverage gaps (expected ranges vs files present)`);
  for (const [id, g] of Object.entries(report.coverageGaps)) {
    lines.push(`### ${id}`);
    lines.push(`- Expected: **${g.expectedRange}** (guidance only — historical gaps are normal).`);
    lines.push(`- Missing **${g.missingYears.length}** ceremony years in folder: first gaps e.g. ${g.missingYears.slice(0, 12).join(", ")}${g.missingYears.length > 12 ? "…" : ""}`);
    lines.push(`- Official: ${g.officialHint}`);
    lines.push(``);
  }
  lines.push(`## By award (aggregates)`);
  for (const [id, b] of Object.entries(report.byAward)) {
    lines.push(`### ${id}`);
    lines.push(`- Files: ${b.files}; tmdb null/set: ${b.tmdbNull} / ${b.tmdbSet}`);
    lines.push(`- Top issue codes: ${Object.entries(b.issuesByCode).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}(${n})`).join(", ") || "—"}`);
    lines.push(``);
  }
  lines.push(`## Editions with errors or many warnings`);
  const heavy = report.editions
    .filter((e) => e.issueCount > 3 || (e.codes ?? []).includes("category_no_winner") || (e.codes ?? []).includes("duplicate_category_id"))
    .slice(0, 60);
  for (const e of heavy) {
    lines.push(`- **${e.awardId} ${e.year}** (${e.issueCount} issues): ${e.codes?.join(", ")} — \`${e.path}\``);
  }
  lines.push(``);
  lines.push(`Full machine list: **awards-qa-report.json** \`issues\` array.`);
  return lines.join("\n");
}

main();
