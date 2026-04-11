/**
 * Fetches award nominees + winners from Wikidata (P1411 nominations, P166 wins)
 * for mapped categories and writes Pitflix edition JSON (multi-category, multi-nominee).
 *
 * Usage (from repo root):
 *   node scripts/fetch-awards-wikidata.mjs
 *   node scripts/fetch-awards-wikidata.mjs --force
 *   node scripts/fetch-awards-wikidata.mjs --from=1999 --to=2025
 *   node scripts/fetch-awards-wikidata.mjs --dry-run
 *   node scripts/fetch-awards-wikidata.mjs --upgrade-seed
 *   node scripts/fetch-awards-wikidata.mjs --award=primetime-emmys --upgrade-seed --from=1970 --to=2025
 *
 * --upgrade-seed  Overwrite auto-generated Wikidata JSON (dataSource wikidata-sparql or wikidata-sparql-seed, or
 *                 notes mention winner-only). Keeps hand-curated sources (e.g. dataSource "AMPAS / …"). --force replaces all.
 *
 * Optional: TMDB_API_KEY or PITFLIX_TMDB_API_KEY to resolve tmdbId when Wikidata has no P4947 on the work.
 *
 * Faster import (English Wikipedia): `node scripts/fetch-awards-wikipedia.mjs --upgrade-seed --from=Y1 --to=Y2`
 *   Other awards (English Wikipedia): `--award=primetime-emmys` | `bafta` | `golden-globes`
 * (IMDb is not used: their site blocks automated fetch with AWS WAF.)
 *
 * Coverage depends on Wikidata completeness (missing nominees are common). CC0 — verify with official sources.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const EDITIONS_ROOT = path.join(REPO_ROOT, "Pitflix.API", "Data", "Awards", "editions");

const WD_ENDPOINT = "https://query.wikidata.org/sparql";
const UA = "PitflixAwardsSeed/1.1 (https://github.com/pitflix; awards JSON seed)";

/** @typedef {{ id: string, name: string, wd: string, kind: "film"|"tv"|"person", mediaType: "movie"|"tv" }} CategoryDef */

/** @type {{ awardId: string, labelPrefix: string, categories: CategoryDef[] }[]} */
const PROGRAMS = [
  {
    awardId: "academy-awards",
    labelPrefix: "Academy Awards",
    categories: [
      { id: "best-picture", name: "Best Picture", wd: "Q102427", kind: "film", mediaType: "movie" },
      { id: "best-director", name: "Best Director", wd: "Q103360", kind: "person", mediaType: "movie" },
      { id: "best-actor", name: "Best Actor in a Leading Role", wd: "Q103916", kind: "person", mediaType: "movie" },
      { id: "best-actress", name: "Best Actress in a Leading Role", wd: "Q103618", kind: "person", mediaType: "movie" },
      { id: "best-supporting-actor", name: "Best Actor in a Supporting Role", wd: "Q106291", kind: "person", mediaType: "movie" },
      { id: "best-supporting-actress", name: "Best Actress in a Supporting Role", wd: "Q107276", kind: "person", mediaType: "movie" },
      { id: "best-original-screenplay", name: "Best Original Screenplay", wd: "Q41417", kind: "person", mediaType: "movie" },
      { id: "best-adapted-screenplay", name: "Best Adapted Screenplay", wd: "Q107258", kind: "person", mediaType: "movie" },
      { id: "best-international", name: "Best International Feature Film", wd: "Q105304", kind: "film", mediaType: "movie" },
      { id: "best-animated", name: "Best Animated Feature", wd: "Q106800", kind: "film", mediaType: "movie" },
      { id: "best-documentary", name: "Best Documentary Feature", wd: "Q111332", kind: "film", mediaType: "movie" },
    ],
  },
  {
    awardId: "bafta",
    labelPrefix: "BAFTA Film Awards",
    categories: [
      { id: "best-film", name: "Best Film", wd: "Q139184", kind: "film", mediaType: "movie" },
      { id: "best-direction", name: "Best Direction", wd: "Q787131", kind: "person", mediaType: "movie" },
      { id: "best-actor", name: "Best Actor in a Leading Role", wd: "Q400007", kind: "person", mediaType: "movie" },
      { id: "best-actress", name: "Best Actress in a Leading Role", wd: "Q687123", kind: "person", mediaType: "movie" },
      { id: "best-supporting-actor", name: "Best Actor in a Supporting Role", wd: "Q548389", kind: "person", mediaType: "movie" },
      { id: "best-film-not-english", name: "Best Film Not in the English Language", wd: "Q2925687", kind: "film", mediaType: "movie" },
    ],
  },
  {
    awardId: "golden-globes",
    labelPrefix: "Golden Globe Awards",
    categories: [
      { id: "best-picture-drama", name: "Best Motion Picture – Drama", wd: "Q1011509", kind: "film", mediaType: "movie" },
      { id: "best-picture-musical-comedy", name: "Best Motion Picture – Musical or Comedy", wd: "Q670282", kind: "film", mediaType: "movie" },
      { id: "best-tv-drama", name: "Best Television Series – Drama", wd: "Q1255198", kind: "tv", mediaType: "tv" },
      { id: "best-tv-musical-comedy", name: "Best Television Series – Musical or Comedy", wd: "Q596294", kind: "tv", mediaType: "tv" },
      { id: "best-limited-tv", name: "Best Limited Series or Motion Picture Made for Television", wd: "Q265435", kind: "tv", mediaType: "tv" },
    ],
  },
  {
    awardId: "primetime-emmys",
    labelPrefix: "Primetime Emmy Awards",
    categories: [
      { id: "outstanding-drama-series", name: "Outstanding Drama Series", wd: "Q989438", kind: "tv", mediaType: "tv" },
      { id: "outstanding-comedy-series", name: "Outstanding Comedy Series", wd: "Q2110156", kind: "tv", mediaType: "tv" },
      { id: "outstanding-limited-series", name: "Outstanding Limited or Anthology Series", wd: "Q20714679", kind: "tv", mediaType: "tv" },
    ],
  },
];

const WD_PREFIXES = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
`;

function parseArgs() {
  const a = process.argv.slice(2);
  const awardArg = a.find((x) => x.startsWith("--award="))?.slice(8)?.trim() || null;
  return {
    force: a.includes("--force"),
    upgradeSeed: a.includes("--upgrade-seed"),
    dryRun: a.includes("--dry-run"),
    from: Number(a.find((x) => x.startsWith("--from="))?.slice(7)) || null,
    to: Number(a.find((x) => x.startsWith("--to="))?.slice(5)) || null,
    /** When set, only this catalog award id (e.g. primetime-emmys). */
    award: awardArg,
  };
}

/** Safe to refresh with a new Wikidata pull; do not touch AMPAS/manual JSON. */
function isReplaceableAutoWikidataEdition(outFile) {
  try {
    const raw = fs.readFileSync(outFile, "utf8");
    const j = JSON.parse(raw);
    const ds = String(j.dataSource ?? "");
    if (ds === "wikidata-sparql-seed" || ds === "wikidata-sparql") return true;
    if (String(j.notes ?? "").includes("winner-only")) return true;
    return false;
  } catch {
    return false;
  }
}

function yearRange(args) {
  const end = args.to ?? new Date().getUTCFullYear();
  const start = args.from ?? end - 25;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new Error("Invalid --from / --to");
  }
  return { start, end };
}

/**
 * Film / TV as award subject: no P1686 on the statement (work is ?subject).
 * Split **winners** (P166) and **nominees** (P1411) into two queries — SPARQL UNION times out on WD for some categories.
 * @param {"winner"|"nominee"} role
 */
function buildWorkSubjectSparql(kind, category, yearStart, yearEnd, role) {
  const wd = `wd:${category.wd}`;
  const typeQ = kind === "tv" ? "wd:Q5398426" : "wd:Q11424";
  const isWinner = role === "winner";
  const prop = isWinner ? "P166" : "P1411";
  const wonBind = isWinner ? "true" : "false";
  return (
    WD_PREFIXES +
    `
SELECT ?year ?won ?subject ?subjectLabel ?tmdb ?imdb WHERE {
  ?st ps:${prop} ${wd} .
  ?subject p:${prop} ?st .
  BIND(${wonBind} AS ?won)
  ?st pq:P585 ?when .
  BIND(YEAR(?when) AS ?year)
  FILTER(?year >= ${yearStart} && ?year <= ${yearEnd})
  FILTER NOT EXISTS { ?st pq:P1686 [] . }
  ?subject wdt:P31/wdt:P279* ${typeQ} .
  OPTIONAL { ?subject wdt:P4947 ?tmdb . }
  OPTIONAL { ?subject wdt:P345 ?imdb . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,de,fr,es,it,ja,mul,ru,pt". }
}
`.trim()
  );
}

/** Human recipients; TMDB target is usually the nominated work (P1686) when present. */
function buildPersonSubjectSparql(category, yearStart, yearEnd, role) {
  const wd = `wd:${category.wd}`;
  const isWinner = role === "winner";
  const prop = isWinner ? "P166" : "P1411";
  const wonBind = isWinner ? "true" : "false";
  return (
    WD_PREFIXES +
    `
SELECT ?year ?won ?subject ?film ?subjectLabel ?filmLabel ?tmdb ?imdb WHERE {
  ?st ps:${prop} ${wd} .
  ?subject p:${prop} ?st .
  BIND(${wonBind} AS ?won)
  ?st pq:P585 ?when .
  BIND(YEAR(?when) AS ?year)
  FILTER(?year >= ${yearStart} && ?year <= ${yearEnd})
  ?subject wdt:P31 wd:Q5 .
  OPTIONAL { ?st pq:P1686 ?film . }
  OPTIONAL { ?film wdt:P4947 ?tmdb . }
  OPTIONAL { ?film wdt:P345 ?imdb . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,de,fr,es,it,ja,mul,ru,pt". }
}
`.trim()
  );
}

async function wikidataQuery(sparql) {
  const url = new URL(WD_ENDPOINT);
  url.searchParams.set("query", sparql);
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Wikidata HTTP ${res.status}: ${t.slice(0, 500)}`);
  }
  return res.json();
}

async function wikidataQueryWithRetry(sparql, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await wikidataQuery(sparql);
    } catch (e) {
      last = e;
      const msg = String(e?.message ?? e);
      const retryable = /HTTP (429|502|503|504)/.test(msg);
      if (!retryable) throw e;
      if (i < attempts - 1) await sleep(4000 * (i + 1));
    }
  }
  throw last;
}

function bindingStr(b, key) {
  return b[key]?.value ?? "";
}

function bindingNum(b, key) {
  const v = b[key]?.value;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bindingBool(b, key) {
  const v = b[key]?.value;
  return v === "true" || v === "1";
}

function parseWorkRows(data, cat) {
  const rows = [];
  for (const b of data.results?.bindings ?? []) {
    const year = bindingNum(b, "year");
    if (!Number.isFinite(year)) continue;
    rows.push({
      year,
      categoryId: cat.id,
      categoryName: cat.name,
      mediaType: cat.mediaType,
      kind: cat.kind,
      subject: bindingStr(b, "subject"),
      film: "",
      subjectLabel: bindingStr(b, "subjectLabel"),
      filmLabel: "",
      tmdb: bindingNum(b, "tmdb"),
      imdb: bindingStr(b, "imdb") || null,
      won: bindingBool(b, "won"),
    });
  }
  return rows;
}

function parsePersonRows(data, cat) {
  const rows = [];
  for (const b of data.results?.bindings ?? []) {
    const year = bindingNum(b, "year");
    if (!Number.isFinite(year)) continue;
    rows.push({
      year,
      categoryId: cat.id,
      categoryName: cat.name,
      mediaType: cat.mediaType,
      kind: cat.kind,
      subject: bindingStr(b, "subject"),
      film: bindingStr(b, "film"),
      subjectLabel: bindingStr(b, "subjectLabel"),
      filmLabel: bindingStr(b, "filmLabel"),
      tmdb: bindingNum(b, "tmdb"),
      imdb: bindingStr(b, "imdb") || null,
      won: bindingBool(b, "won"),
    });
  }
  return rows;
}

function nomineeTitle(row) {
  const s = (row.subjectLabel ?? "").trim();
  const f = (row.filmLabel ?? "").trim();
  if (row.kind === "person") {
    if (s && f) return `${s} — ${f}`;
    if (f) return f;
    if (s) return s;
    return "Unknown title";
  }
  return s || f || "Unknown title";
}

function nomineeKey(row) {
  return `${row.subject}\t${row.film || ""}`;
}

function uriToQ(uri) {
  const m = String(uri).match(/entity\/(Q\d+)/);
  return m ? m[1] : null;
}

/** @param {Map<string, string | null>} cache */
async function wikidataBatchLabels(qids, cache) {
  const todo = [...new Set(qids)].filter((q) => q && !cache.has(q));
  for (let i = 0; i < todo.length; i += 45) {
    const chunk = todo.slice(i, i + 45);
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", chunk.join("|"));
    url.searchParams.set("props", "labels");
    url.searchParams.set("languages", "en|de|fr|es|it|ja|mul|ru|pt");
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString(), { headers: { "User-Agent": UA } });
    if (!res.ok) {
      for (const id of chunk) cache.set(id, null);
      await sleep(80);
      continue;
    }
    const j = await res.json();
    const entities = j.entities ?? {};
    const order = ["en", "de", "fr", "es", "it", "ja", "mul", "ru", "pt"];
    for (const id of chunk) {
      const labels = entities[id]?.labels ?? {};
      let found = null;
      for (const code of order) {
        const v = labels[code]?.value?.trim?.();
        if (v) {
          found = v;
          break;
        }
      }
      cache.set(id, found);
    }
    await sleep(80);
  }
}

/**
 * Fill missing subject/film labels via wbgetentities, then TMDB titles for work IDs.
 * @param {Map<string, string | null>} wdLabelCache
 */
async function hydrateMergedRows(merged, wdLabelCache, tmdbKey) {
  const qids = [];
  for (const r of merged) {
    if (!r.subjectLabel?.trim()) {
      const q = uriToQ(r.subject);
      if (q) qids.push(q);
    }
    if (r.kind === "person" && r.film && !r.filmLabel?.trim()) {
      const q = uriToQ(r.film);
      if (q) qids.push(q);
    }
  }
  await wikidataBatchLabels(qids, wdLabelCache);

  for (const r of merged) {
    if (!r.subjectLabel?.trim()) {
      const q = uriToQ(r.subject);
      const lb = q ? wdLabelCache.get(q) : null;
      if (lb) r.subjectLabel = lb;
    }
    if (r.kind === "person" && r.film && !r.filmLabel?.trim()) {
      const q = uriToQ(r.film);
      const lb = q ? wdLabelCache.get(q) : null;
      if (lb) r.filmLabel = lb;
    }
  }

  if (!tmdbKey) return;

  for (const r of merged) {
    const mt = r.mediaType ?? "movie";
    if (!r.tmdb || r.tmdb <= 0) continue;
    const needWorkTitle = r.kind !== "person" && !r.subjectLabel?.trim();
    const needFilmTitle = r.kind === "person" && !r.filmLabel?.trim();
    if (!needWorkTitle && !needFilmTitle) continue;
    const t = await tmdbDisplayTitle(tmdbKey, r.tmdb, mt);
    await sleep(60);
    if (!t) continue;
    if (needWorkTitle) r.subjectLabel = t;
    if (needFilmTitle) r.filmLabel = t;
  }
}

/** Merge rows: same nominee keeps won=true if any row won */
function mergeNomineeRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = nomineeKey(r);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...r });
      continue;
    }
    const won = prev.won || r.won;
    let tmdb = prev.tmdb ?? r.tmdb;
    if (!tmdb && r.tmdb) tmdb = r.tmdb;
    let imdb = prev.imdb || r.imdb;
    if (!imdb && r.imdb) imdb = r.imdb;
    let subjectLabel = prev.subjectLabel || r.subjectLabel;
    let filmLabel = prev.filmLabel || r.filmLabel;
    map.set(k, { ...prev, won, tmdb, imdb, subjectLabel, filmLabel });
  }
  return [...map.values()];
}

function sortNominees(list) {
  return list.sort((a, b) => {
    if (a.winner !== b.winner) return a.winner ? -1 : 1;
    return a.title.localeCompare(b.title, "en");
  });
}

async function tmdbFindId(apiKey, imdbId, mediaType) {
  if (!apiKey || !imdbId || !imdbId.startsWith("tt")) return null;
  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  if (mediaType === "tv") {
    const r = j.tv_results?.[0];
    return r?.id ?? null;
  }
  const r = j.movie_results?.[0];
  return r?.id ?? null;
}

async function tmdbDisplayTitle(apiKey, tmdbId, mediaType) {
  if (!apiKey || !tmdbId) return null;
  const kind = mediaType === "tv" ? "tv" : "movie";
  const url = `https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const t = j.title ?? j.name;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

function needsTitleBackfill(n) {
  const t = (n.title ?? "").trim();
  if (!t) return true;
  if (t === "Unknown" || t === "Unknown title") return true;
  if (t.startsWith("Unknown —") || t.startsWith("Unknown title —")) return true;
  return false;
}

async function backfillTitlesFromTmdb(nominees, mediaType, tmdbKey) {
  if (!tmdbKey) return;
  for (const n of nominees) {
    if (!n.tmdbId || !needsTitleBackfill(n)) continue;
    const title = await tmdbDisplayTitle(tmdbKey, n.tmdbId, mediaType);
    await sleep(80);
    if (title) n.title = title;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchProgramRows(program, yearStart, yearEnd) {
  const filmCats = program.categories.filter((c) => c.kind === "film");
  const tvCats = program.categories.filter((c) => c.kind === "tv");
  const personCats = program.categories.filter((c) => c.kind === "person");

  const allRows = [];

  async function runQuery(label, fn) {
    try {
      const data = await fn();
      return data;
    } catch (e) {
      console.error(`  WARN ${program.awardId} ${label}: ${e.message}`);
      return null;
    }
  }

  for (const c of filmCats) {
    for (const role of /** @type {const} */ (["winner", "nominee"])) {
      const q = buildWorkSubjectSparql("film", c, yearStart, yearEnd, role);
      const data = await runQuery(`${c.id} film-${role}`, () => wikidataQueryWithRetry(q));
      if (data) allRows.push(...parseWorkRows(data, c));
      await sleep(1500);
    }
  }

  for (const c of tvCats) {
    for (const role of /** @type {const} */ (["winner", "nominee"])) {
      const q = buildWorkSubjectSparql("tv", c, yearStart, yearEnd, role);
      const data = await runQuery(`${c.id} tv-${role}`, () => wikidataQueryWithRetry(q));
      if (data) allRows.push(...parseWorkRows(data, c));
      await sleep(1500);
    }
  }

  for (const c of personCats) {
    for (const role of /** @type {const} */ (["winner", "nominee"])) {
      const q = buildPersonSubjectSparql(c, yearStart, yearEnd, role);
      const data = await runQuery(`${c.id} person-${role}`, () => wikidataQueryWithRetry(q));
      if (data) allRows.push(...parsePersonRows(data, c));
      await sleep(1500);
    }
  }

  return allRows;
}

function groupByYearAndCategory(rows) {
  /** @type {Map<number, Map<string, typeof rows>} */
  const byYear = new Map();
  for (const r of rows) {
    if (!byYear.has(r.year)) byYear.set(r.year, new Map());
    const byCat = byYear.get(r.year);
    if (!byCat.has(r.categoryId)) byCat.set(r.categoryId, []);
    byCat.get(r.categoryId).push(r);
  }
  return byYear;
}

async function buildEditionDoc(program, year, byYear, tmdbKey, wdLabelCache) {
  const byCat = byYear.get(year);
  const categories = [];
  if (!byCat) {
    return {
      awardId: program.awardId,
      year,
      label: `${program.labelPrefix} (${year})`,
      categories: [],
      dataSource: "wikidata-sparql",
      notes:
        "No mapped categories returned data for this year from Wikidata (P1411/P166 + P585). CC0 — verify with official sources.",
    };
  }

  for (const def of program.categories) {
    const raw = byCat.get(def.id);
    if (!raw?.length) continue;

    const merged = mergeNomineeRows(raw);
    await hydrateMergedRows(merged, wdLabelCache, tmdbKey);
    const nominees = sortNominees(
      merged.map((r) => ({
        title: nomineeTitle(r),
        mediaType: def.mediaType,
        tmdbId: r.tmdb && r.tmdb > 0 ? r.tmdb : null,
        winner: r.won,
        _imdb: r.tmdb && r.tmdb > 0 ? null : r.imdb,
      })),
    );

    categories.push({
      id: def.id,
      name: def.name,
      nominees,
    });
  }

  return {
    awardId: program.awardId,
    year,
    label: `${program.labelPrefix} (${year})`,
    categories,
    dataSource: "wikidata-sparql",
    notes:
      "Auto-generated from Wikidata (nominations P1411, wins P166, year pq:P585). Coverage varies by category/year; acting/screenplay rows need P1686 (for work) for TMDB. CC0 — verify with official sources.",
  };
}

async function enrichTmdb(nominees, mediaType, tmdbKey, imdbCache) {
  if (!tmdbKey) return;
  for (const n of nominees) {
    if (n.tmdbId || !n._imdb) continue;
    const imdb = n._imdb;
    if (imdbCache.has(imdb)) {
      const id = imdbCache.get(imdb);
      if (id) n.tmdbId = id;
      continue;
    }
    const id = await tmdbFindId(tmdbKey, imdb, mediaType);
    imdbCache.set(imdb, id ?? null);
    if (id) n.tmdbId = id;
    await sleep(100);
  }
}

async function main() {
  const args = parseArgs();
  const { start, end } = yearRange(args);
  const tmdbKey = process.env.TMDB_API_KEY || process.env.PITFLIX_TMDB_API_KEY || "";

  const programs = args.award
    ? PROGRAMS.filter((p) => p.awardId === args.award)
    : PROGRAMS;
  if (args.award && programs.length === 0) {
    console.error(`Unknown --award=${args.award}. Known: ${PROGRAMS.map((p) => p.awardId).join(", ")}`);
    process.exit(1);
  }

  console.error(`Years ${start}–${end} (${end - start + 1} years), editions → ${EDITIONS_ROOT}`);
  if (args.award) console.error(`Only award: ${args.award}`);
  if (args.dryRun) console.error("DRY RUN — no files written");

  const imdbCache = new Map();
  const wdLabelCache = new Map();

  for (const program of programs) {
    console.error(`Query Wikidata: ${program.awardId} (${program.categories.length} categories) …`);
    const rows = await fetchProgramRows(program, start, end);

    const byYear = groupByYearAndCategory(rows);

    for (let y = start; y <= end; y++) {
      const outDir = path.join(EDITIONS_ROOT, program.awardId);
      const outFile = path.join(outDir, `${y}.json`);
      if (fs.existsSync(outFile) && !args.force) {
        if (!args.upgradeSeed || !isReplaceableAutoWikidataEdition(outFile)) {
          continue;
        }
      }

      const doc = await buildEditionDoc(program, y, byYear, tmdbKey, wdLabelCache);
      if (!doc.categories.length) {
        console.error(`  SKIP ${program.awardId} ${y}: no Wikidata rows`);
        continue;
      }

      for (const cat of doc.categories) {
        if (tmdbKey) {
          const def = program.categories.find((c) => c.id === cat.id);
          const mediaType = def?.mediaType ?? "movie";
          await enrichTmdb(cat.nominees, mediaType, tmdbKey, imdbCache);
          await backfillTitlesFromTmdb(cat.nominees, mediaType, tmdbKey);
        }
        for (const n of cat.nominees) delete n._imdb;
      }

      const summary = doc.categories.map((c) => `${c.id}:${c.nominees.length}`).join(", ");
      if (args.dryRun) {
        console.error(`  would write ${path.relative(REPO_ROOT, outFile)} — ${summary}`);
        continue;
      }

      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + "\n", "utf8");
      console.error(`  wrote ${path.relative(REPO_ROOT, outFile)} — ${summary}`);
    }
  }

  console.error("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
