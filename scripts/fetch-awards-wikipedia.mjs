/**
 * One-off / rare: builds Pitflix award edition JSON from English Wikipedia via the
 * MediaWiki Action API (`parse` → wikitext) with Special:Export fallback on rate limits.
 * Wikidata seeds: `scripts/fetch-awards-wikidata.mjs`. Runtime: Pitflix API resolves TMDB artwork
 * from nominee titles when a key is configured (secondary enrichment, not a full ceremony roster API).
 *
 * Covers Oscars, Primetime Emmys, BAFTA Film, and Golden Globes (expanded category maps below;
 * legacy ===Film=== / ===Television=== wikitables still only lift the main motion-picture / series blocks unless the page uses {{Award category}}).
 *
 * When the Action API rate-limits (HTTP 429), the script falls back to
 * Special:Export XML (same wikitext), following `#REDIRECT` to the canonical title.
 *
 * IMDb event pages are protected by AWS WAF; this script does NOT scrape IMDb.
 *
 * Usage (repo root):
 *   node scripts/fetch-awards-wikipedia.mjs --from=2018 --to=2024
 *   node scripts/fetch-awards-wikipedia.mjs --upgrade-seed --from=1929 --to=2026
 *   node scripts/fetch-awards-wikipedia.mjs --award=primetime-emmys --upgrade-seed --from=1970 --to=2025
 *   node scripts/fetch-awards-wikipedia.mjs --award=bafta --upgrade-seed --from=2000 --to=2025
 *   node scripts/fetch-awards-wikipedia.mjs --award=golden-globes --upgrade-seed --from=2024 --to=2026
 *   node scripts/fetch-awards-wikipedia.mjs --dry-run --from=2022 --to=2022
 *
 * `--award=` : `academy-awards` (default), `primetime-emmys`, `bafta`, or `golden-globes`
 *
 * Honors the same replace rules as fetch-awards-wikidata.mjs with --upgrade-seed / --force.
 * Does not overwrite hand-curated JSON (non-Wikidata, non–auto-Wikipedia dataSource).
 *
 * Data: Wikipedia (CC BY-SA). Verify against AMPAS / Television Academy. tmdbId is left null
 * unless you enrich separately (e.g. TMDB search).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const EDITIONS_ROOT = path.join(REPO_ROOT, "Pitflix.API", "Data", "Awards", "editions");
const MW_API = "https://en.wikipedia.org/w/api.php";
const UA = "PitflixAwardsWikiImport/1.0 (one-off local tool; no bulk scraping)";

/** Wikipedia |Best X| short name -> Pitflix category id (subset matching curated 2024 JSON). */
const WIKI_NAME_TO_ID = {
  "Best Picture": "best-picture",
  "Best Directing": "best-director",
  "Best Director": "best-director",
  "Best Actor in a Leading Role": "best-actor",
  "Best Actress in a Leading Role": "best-actress",
  "Best Actor in a Supporting Role": "best-supporting-actor",
  "Best Actress in a Supporting Role": "best-supporting-actress",
  "Best Writing (Original Screenplay)": "best-original-screenplay",
  "Best Original Screenplay": "best-original-screenplay",
  "Best Writing (Adapted Screenplay)": "best-adapted-screenplay",
  "Best Adapted Screenplay": "best-adapted-screenplay",
  "Best International Feature Film": "best-international",
  "Best Foreign Language Film": "best-international",
  "Best Animated Feature": "best-animated",
  "Best Animated Feature Film": "best-animated",
  "Best Documentary Feature": "best-documentary",
  "Best Documentary Feature Film": "best-documentary",
  "Best Cinematography": "best-cinematography",
  "Best Film Editing": "best-film-editing",
  "Best Production Design": "best-production-design",
  "Best Art Direction": "best-production-design",
  "Best Costume Design": "best-costume-design",
  "Best Makeup and Hairstyling": "best-makeup-hairstyling",
  "Best Makeup": "best-makeup-hairstyling",
  "Best Original Score": "best-original-score",
  "Best Original Song": "best-original-song",
  "Best Sound": "best-sound",
  "Best Sound Editing": "best-sound",
  "Best Sound Mixing": "best-sound",
  "Best Visual Effects": "best-visual-effects",
  "Best Casting": "best-casting",
  "Best Achievement in Casting": "best-casting",
  "Best Documentary Short Film": "best-documentary-short",
  "Best Live Action Short Film": "best-live-action-short",
  "Best Animated Short Film": "best-animated-short",
};

/** Display name after `[[Primetime Emmy Award for …|` in {{Award category}} → Pitflix category id. */
const EMMY_WIKI_SHORT_TO_ID = {
  "Outstanding Comedy Series": "outstanding-comedy-series",
  "Outstanding Series - Comedy": "outstanding-comedy-series",
  "Outstanding Series – Comedy": "outstanding-comedy-series",
  "Outstanding Limited or Anthology Series": "outstanding-limited-series",
  Limited: "outstanding-limited-series",
  "Limited Series": "outstanding-limited-series",
  "Outstanding Limited Series": "outstanding-limited-series",
  "Outstanding Miniseries": "outstanding-limited-series",
  "Outstanding Miniseries or Movie": "outstanding-limited-series",
  "Outstanding Drama/Comedy Special and Miniseries": "outstanding-limited-series",
  "Outstanding Drama Series": "outstanding-drama-series",
  "Outstanding Dramatic Series": "outstanding-drama-series",
  "Outstanding Series - Drama": "outstanding-drama-series",
  "Outstanding Series – Drama": "outstanding-drama-series",
  "Outstanding Lead Actor in a Drama Series": "emmy-lead-actor-drama",
  "Outstanding Lead Actor in a Comedy Series": "emmy-lead-actor-comedy",
  "Outstanding Lead Actress in a Drama Series": "emmy-lead-actress-drama",
  "Outstanding Lead Actress in a Comedy Series": "emmy-lead-actress-comedy",
  "Outstanding Supporting Actor in a Drama Series": "emmy-supporting-actor-drama",
  "Outstanding Supporting Actor in a Comedy Series": "emmy-supporting-actor-comedy",
  "Outstanding Supporting Actress in a Drama Series": "emmy-supporting-actress-drama",
  "Outstanding Supporting Actress in a Comedy Series": "emmy-supporting-actress-comedy",
  "Outstanding Directing for a Drama Series": "emmy-directing-drama",
  "Outstanding Directing for a Comedy Series": "emmy-directing-comedy",
  "Outstanding Directing for a Limited or Anthology Series or Movie": "emmy-directing-limited",
  "Outstanding Writing for a Drama Series": "emmy-writing-drama",
  "Outstanding Writing for a Comedy Series": "emmy-writing-comedy",
  "Outstanding Writing for a Limited or Anthology Series or Movie": "emmy-writing-limited",
};

const EMMY_CATEGORY_TITLES = {
  "outstanding-drama-series": "Outstanding Drama Series",
  "outstanding-comedy-series": "Outstanding Comedy Series",
  "outstanding-limited-series": "Outstanding Limited or Anthology Series",
  "emmy-lead-actor-drama": "Outstanding Lead Actor in a Drama Series",
  "emmy-lead-actor-comedy": "Outstanding Lead Actor in a Comedy Series",
  "emmy-lead-actress-drama": "Outstanding Lead Actress in a Drama Series",
  "emmy-lead-actress-comedy": "Outstanding Lead Actress in a Comedy Series",
  "emmy-supporting-actor-drama": "Outstanding Supporting Actor in a Drama Series",
  "emmy-supporting-actor-comedy": "Outstanding Supporting Actor in a Comedy Series",
  "emmy-supporting-actress-drama": "Outstanding Supporting Actress in a Drama Series",
  "emmy-supporting-actress-comedy": "Outstanding Supporting Actress in a Comedy Series",
  "emmy-directing-drama": "Outstanding Directing for a Drama Series",
  "emmy-directing-comedy": "Outstanding Directing for a Comedy Series",
  "emmy-directing-limited": "Outstanding Directing for a Limited or Anthology Series or Movie",
  "emmy-writing-drama": "Outstanding Writing for a Drama Series",
  "emmy-writing-comedy": "Outstanding Writing for a Comedy Series",
  "emmy-writing-limited": "Outstanding Writing for a Limited or Anthology Series or Movie",
};

const EMMY_SERIES_CAT_IDS = new Set([
  "outstanding-drama-series",
  "outstanding-comedy-series",
  "outstanding-limited-series",
]);

/** `[[BAFTA Award for …|` display text → Pitflix id (main competitive categories for the app). */
const BAFTA_WIKI_SHORT_TO_ID = {
  "Best Film": "best-film",
  "Best Direction": "best-direction",
  "Best Director": "best-direction",
  "Best Actor in a Leading Role": "best-actor",
  "Best Actress in a Leading Role": "best-actress",
  "Best Actor in a Supporting Role": "best-supporting-actor",
  "Best Actress in a Supporting Role": "best-supporting-actress",
  "Best Film Not in the English Language": "best-film-not-english",
  "Best Foreign Language Film": "best-film-not-english",
  "Outstanding British Film": "outstanding-british-film",
  "Best Original Screenplay": "best-original-screenplay",
  "Best Adapted Screenplay": "best-adapted-screenplay",
  "Best Casting": "best-casting",
  "Best Editing": "best-editing",
  "Best Cinematography": "best-cinematography",
  "Best Costume Design": "best-costume-design",
  "Best Production Design": "best-production-design",
  "Best Make Up & Hair": "best-makeup-hair",
  "Best Makeup and Hair": "best-makeup-hair",
  "Best Original Score": "best-original-score",
  "Best Sound": "best-sound",
  "Best Special Visual Effects": "best-visual-effects",
  "Best Animated Film": "best-animated-film",
  "Best Documentary": "best-documentary",
  "Outstanding Debut by a British Writer, Director or Producer": "outstanding-debut-british",
};

const BAFTA_CATEGORY_TITLES = {
  "best-film": "Best Film",
  "outstanding-british-film": "Outstanding British Film",
  "best-direction": "Best Director",
  "best-actor": "Best Actor in a Leading Role",
  "best-actress": "Best Actress in a Leading Role",
  "best-supporting-actor": "Best Actor in a Supporting Role",
  "best-supporting-actress": "Best Actress in a Supporting Role",
  "best-film-not-english": "Best Film Not in the English Language",
  "best-original-screenplay": "Best Original Screenplay",
  "best-adapted-screenplay": "Best Adapted Screenplay",
  "best-casting": "Best Casting",
  "best-editing": "Best Editing",
  "best-cinematography": "Best Cinematography",
  "best-costume-design": "Best Costume Design",
  "best-production-design": "Best Production Design",
  "best-makeup-hair": "Best Make Up & Hair",
  "best-original-score": "Best Original Score",
  "best-sound": "Best Sound",
  "best-visual-effects": "Best Special Visual Effects",
  "best-animated-film": "Best Animated Film",
  "best-documentary": "Best Documentary",
  "outstanding-debut-british": "Outstanding Debut by a British Writer, Director or Producer",
};

const BAFTA_CATEGORY_ORDER = Object.keys(BAFTA_CATEGORY_TITLES);

const BAFTA_FILM_LIKE_IDS = new Set(["best-film", "best-film-not-english", "outstanding-british-film"]);

/** Normalize en/em dash to ASCII hyphen for Golden Globe Wikipedia labels. */
function normalizeGlobeWikiShort(s) {
  return s.trim().replace(/\u2013|\u2014/g, "-");
}

/** After normalizeGlobeWikiShort — keys use ASCII `-`. Multiple Wikipedia display strings → same id. */
const GLOBE_WIKI_SHORT_TO_ID = {
  "Best Motion Picture - Drama": "best-picture-drama",
  "Best Motion Picture - Musical or Comedy": "best-picture-musical-comedy",
  "Best Motion Picture - Comedy or Musical": "best-picture-musical-comedy",
  "Best Television Series - Drama": "best-tv-drama",
  "Best Television Series - Musical or Comedy": "best-tv-musical-comedy",
  "Best Television Series - Comedy or Musical": "best-tv-musical-comedy",
  "Best Limited Series, Anthology Series, or Motion Picture Made for Television": "best-limited-tv",
  "Best Limited Series or Motion Picture Made for Television": "best-limited-tv",
  "Best Miniseries or Television Film": "best-limited-tv",
  "Best Miniseries - Series or Motion Picture Made for Television": "best-limited-tv",
  // Film — acting / director / craft (common {{Award category|…|}} pipe labels)
  "Best Actor in a Motion Picture - Drama": "best-actor-film-drama",
  "Best Performance by an Actor in a Motion Picture - Drama": "best-actor-film-drama",
  "Best Actor in a Motion Picture - Musical or Comedy": "best-actor-film-comedy",
  "Best Performance by an Actor in a Motion Picture - Musical or Comedy": "best-actor-film-comedy",
  "Best Actress in a Motion Picture - Drama": "best-actress-film-drama",
  "Best Performance by an Actress in a Motion Picture - Drama": "best-actress-film-drama",
  "Best Actress in a Motion Picture - Musical or Comedy": "best-actress-film-comedy",
  "Best Performance by an Actress in a Motion Picture - Musical or Comedy": "best-actress-film-comedy",
  "Best Supporting Actor - Motion Picture": "best-supporting-actor-film",
  "Best Performance by an Actor in a Supporting Role in any Motion Picture": "best-supporting-actor-film",
  "Best Supporting Actress - Motion Picture": "best-supporting-actress-film",
  "Best Performance by an Actress in a Supporting Role in any Motion Picture": "best-supporting-actress-film",
  "Best Director - Motion Picture": "best-director-film",
  "Best Director - Motion Picture Drama": "best-director-film",
  "Best Screenplay - Motion Picture": "best-screenplay-film",
  "Best Motion Picture Screenplay": "best-screenplay-film",
  "Best Original Score - Motion Picture": "best-original-score-film",
  "Best Original Song - Motion Picture": "best-original-song-film",
  "Best Motion Picture - Animated": "best-animated-film",
  "Best Animated Film": "best-animated-film",
  "Best Motion Picture - Non-English Language": "best-non-english-film",
  "Best Foreign Language Film": "best-non-english-film",
  "Best Non-English Language Film": "best-non-english-film",
  "Cinematic and Box Office Achievement": "best-cinematic-box-office",
  "Cinematic and Box Office Achievement in Motion Pictures": "best-cinematic-box-office",
  // TV — acting / supporting
  "Best Actor in a Television Series - Drama": "best-actor-tv-drama",
  "Best Performance by an Actor in a Television Series - Drama": "best-actor-tv-drama",
  "Best Actor in a Television Series - Musical or Comedy": "best-actor-tv-comedy",
  "Best Performance by an Actor in a Television Series - Musical or Comedy": "best-actor-tv-comedy",
  "Best Actor in a Television Series - Comedy or Musical": "best-actor-tv-comedy",
  "Best Performance by an Actor in a Television Series - Comedy or Musical": "best-actor-tv-comedy",
  "Best Actress in a Television Series - Drama": "best-actress-tv-drama",
  "Best Performance by an Actress in a Television Series - Drama": "best-actress-tv-drama",
  "Best Actress in a Television Series - Musical or Comedy": "best-actress-tv-comedy",
  "Best Performance by an Actress in a Television Series - Musical or Comedy": "best-actress-tv-comedy",
  "Best Actress in a Television Series - Comedy or Musical": "best-actress-tv-comedy",
  "Best Performance by an Actress in a Television Series - Comedy or Musical": "best-actress-tv-comedy",
  "Best Supporting Actor - Drama Series, Limited Series or Motion Picture Made for Television":
    "best-supporting-actor-tv",
  "Best Supporting Actor - Television": "best-supporting-actor-tv",
  "Best Performance by an Actor in a Supporting Role on Television": "best-supporting-actor-tv",
  "Best Supporting Actress - Drama Series, Limited Series or Motion Picture Made for Television":
    "best-supporting-actress-tv",
  "Best Supporting Actress - Television": "best-supporting-actress-tv",
  "Best Performance by an Actress in a Supporting Role on Television": "best-supporting-actress-tv",
};

const GLOBE_CATEGORY_TITLES = {
  "best-picture-drama": "Best Motion Picture – Drama",
  "best-picture-musical-comedy": "Best Motion Picture – Musical or Comedy",
  "best-actor-film-drama": "Best Actor in a Motion Picture – Drama",
  "best-actor-film-comedy": "Best Actor in a Motion Picture – Musical or Comedy",
  "best-actress-film-drama": "Best Actress in a Motion Picture – Drama",
  "best-actress-film-comedy": "Best Actress in a Motion Picture – Musical or Comedy",
  "best-supporting-actor-film": "Best Supporting Actor – Motion Picture",
  "best-supporting-actress-film": "Best Supporting Actress – Motion Picture",
  "best-director-film": "Best Director – Motion Picture",
  "best-screenplay-film": "Best Screenplay – Motion Picture",
  "best-original-score-film": "Best Original Score – Motion Picture",
  "best-original-song-film": "Best Original Song – Motion Picture",
  "best-animated-film": "Best Motion Picture – Animated",
  "best-non-english-film": "Best Motion Picture – Non-English Language",
  "best-cinematic-box-office": "Cinematic and Box Office Achievement",
  "best-tv-drama": "Best Television Series – Drama",
  "best-tv-musical-comedy": "Best Television Series – Musical or Comedy",
  "best-limited-tv": "Best Limited Series or Motion Picture Made for Television",
  "best-actor-tv-drama": "Best Actor in a Television Series – Drama",
  "best-actor-tv-comedy": "Best Actor in a Television Series – Musical or Comedy",
  "best-actress-tv-drama": "Best Actress in a Television Series – Drama",
  "best-actress-tv-comedy": "Best Actress in a Television Series – Musical or Comedy",
  "best-supporting-actor-tv": "Best Supporting Actor – Television",
  "best-supporting-actress-tv": "Best Supporting Actress – Television",
};

const GLOBE_CATEGORY_ORDER = Object.keys(GLOBE_CATEGORY_TITLES);

/** Nominee row is primarily a work title (one main wikilink). */
const GLOBE_SINGLE_LINK_IDS = new Set([
  "best-picture-drama",
  "best-picture-musical-comedy",
  "best-tv-drama",
  "best-tv-musical-comedy",
  "best-limited-tv",
  "best-non-english-film",
  "best-animated-film",
  "best-cinematic-box-office",
]);

function globeNomineeMediaType(catId) {
  if (
    catId === "best-tv-drama" ||
    catId === "best-tv-musical-comedy" ||
    catId === "best-limited-tv" ||
    catId.startsWith("best-actor-tv-") ||
    catId.startsWith("best-actress-tv-") ||
    catId === "best-supporting-actor-tv" ||
    catId === "best-supporting-actress-tv"
  )
    return "tv";
  return "movie";
}

function isGlobeDualCreditCategory(catId) {
  if (!catId || GLOBE_SINGLE_LINK_IDS.has(catId)) return false;
  return (
    catId.includes("-actor-") ||
    catId.includes("-actress-") ||
    catId.includes("supporting-") ||
    catId === "best-director-film" ||
    catId === "best-screenplay-film" ||
    catId === "best-original-score-film" ||
    catId === "best-original-song-film"
  );
}

const CATEGORY_TITLES = {
  "best-picture": "Best Picture",
  "best-director": "Best Director",
  "best-actor": "Best Actor in a Leading Role",
  "best-actress": "Best Actress in a Leading Role",
  "best-supporting-actor": "Best Actor in a Supporting Role",
  "best-supporting-actress": "Best Actress in a Supporting Role",
  "best-original-screenplay": "Best Original Screenplay",
  "best-adapted-screenplay": "Best Adapted Screenplay",
  "best-international": "Best International Feature Film",
  "best-animated": "Best Animated Feature",
  "best-documentary": "Best Documentary Feature",
  "best-cinematography": "Best Cinematography",
  "best-film-editing": "Best Film Editing",
  "best-production-design": "Best Production Design",
  "best-costume-design": "Best Costume Design",
  "best-makeup-hairstyling": "Best Makeup and Hairstyling",
  "best-original-score": "Best Original Score",
  "best-original-song": "Best Original Song",
  "best-sound": "Best Sound",
  "best-visual-effects": "Best Visual Effects",
  "best-casting": "Best Casting",
  "best-documentary-short": "Best Documentary Short Film",
  "best-live-action-short": "Best Live Action Short Film",
  "best-animated-short": "Best Animated Short Film",
};

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Ceremony calendar year (e.g. March 2022 => 2022) -> Wikipedia page title */
function oscarsPageTitle(ceremonyYear) {
  const n = ceremonyYear - 1928;
  if (n < 1) throw new Error(`Year ${ceremonyYear} before modern Oscars page layout`);
  return `${ordinal(n)} Academy Awards`;
}

/** Primetime Emmys: 1st ceremony = 1949 → year 1949 → "1st Primetime Emmy Awards" */
function primetimeEmmyPageTitle(ceremonyYear) {
  const n = ceremonyYear - 1948;
  if (n < 1) throw new Error(`Year ${ceremonyYear} before Primetime Emmy Wikipedia coverage`);
  return `${ordinal(n)} Primetime Emmy Awards`;
}

/** BAFTA Film: 2nd ceremony = 1949 calendar year → <year> − 1947. */
function baftaPageTitle(ceremonyYear) {
  const n = ceremonyYear - 1947;
  if (n < 2) throw new Error(`Year ${ceremonyYear} before BAFTA Film Wikipedia coverage`);
  return `${ordinal(n)} British Academy Film Awards`;
}

/** Golden Globes: 1st = 1944 → <year> − 1943 (MediaWiki follows redirects, e.g. → "81st Golden Globes"). */
function goldenGlobePageTitle(ceremonyYear) {
  const n = ceremonyYear - 1943;
  if (n < 1) throw new Error(`Year ${ceremonyYear} before Golden Globe Wikipedia coverage`);
  return `${ordinal(n)} Golden Globe Awards`;
}

function globeWikiShortToId(wikiShort) {
  const k = normalizeGlobeWikiShort(wikiShort);
  return GLOBE_WIKI_SHORT_TO_ID[k] ?? null;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const awardArg = a.find((x) => x.startsWith("--award="))?.slice(8)?.trim() || "academy-awards";
  const allowed = new Set(["academy-awards", "primetime-emmys", "bafta", "golden-globes"]);
  if (!allowed.has(awardArg)) {
    throw new Error(`--award must be one of ${[...allowed].join(", ")} (got ${awardArg})`);
  }
  return {
    award: awardArg,
    force: a.includes("--force"),
    upgradeSeed: a.includes("--upgrade-seed"),
    dryRun: a.includes("--dry-run"),
    from: Number(a.find((x) => x.startsWith("--from="))?.slice(7)) || null,
    to: Number(a.find((x) => x.startsWith("--to="))?.slice(5)) || null,
  };
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
 * Safe to replace with a new import for this award. Curated/manual `dataSource` values are skipped.
 * @param {string} outFile
 * @param {{ awardId: string, wikipediaDataSource: string }} opts
 */
function isReplaceableSeedEdition(outFile, { awardId, wikipediaDataSource }) {
  try {
    const raw = fs.readFileSync(outFile, "utf8");
    const j = JSON.parse(raw);
    if (String(j.awardId ?? "") !== awardId) return false;
    const ds = String(j.dataSource ?? "");
    if (ds === "wikidata-sparql-seed" || ds === "wikidata-sparql") return true;
    if (String(j.notes ?? "").includes("winner-only")) return true;
    if (ds === wikipediaDataSource) return true;
    return false;
  } catch {
    return false;
  }
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeXmlTextChunk(s) {
  let out = s;
  let prev;
  for (let guard = 0; guard < 10 && out !== prev; guard++) {
    prev = out;
    out = out
      .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d{1,7});/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return out;
}

/**
 * Wikitext via Special:Export (often available when action=parse returns 429).
 * Export does not follow redirects inside the XML; we chase `#REDIRECT [[…]]` once or twice.
 */
async function fetchWikitextSpecialExport(pageTitle, depth = 0) {
  if (depth > 8) throw new Error(`Special:Export redirect depth exceeded for ${pageTitle}`);
  const canonical = pageTitle.trim().replace(/ /g, "_");
  const u = new URL("https://en.wikipedia.org/w/index.php");
  u.searchParams.set("title", "Special:Export");
  u.searchParams.set("pages", canonical);
  u.searchParams.set("action", "submit");
  const res = await fetch(u.toString(), { headers: { "User-Agent": UA } });
  if (res.status === 429) throw new Error("Special:Export HTTP 429");
  if (!res.ok) throw new Error(`Special:Export HTTP ${res.status}`);
  const xml = await res.text();
  const m = xml.match(/<text[^>]*>([\s\S]*?)<\/text>/);
  if (!m) throw new Error("Special:Export: no wikitext in XML");
  let w = decodeXmlTextChunk(m[1]);
  const redir = w.match(/^#\s*REDIRECT\s*\[\[([^\]|#]+)/i);
  if (redir) {
    const target = redir[1].trim().replace(/_/g, " ");
    return fetchWikitextSpecialExport(target, depth + 1);
  }
  return w;
}

async function fetchWikitextParse(pageTitle) {
  const url = new URL(MW_API);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", pageTitle);
  url.searchParams.set("redirects", "1");
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString(), { headers: { "User-Agent": UA } });
  if (res.status === 429) throw new Error("MediaWiki HTTP 429");
  if (!res.ok) throw new Error(`MediaWiki HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.info || JSON.stringify(j.error));
  const w = j.parse?.wikitext?.["*"];
  if (!w) throw new Error(`No wikitext for ${pageTitle}`);
  return w;
}

async function fetchWikitext(pageTitle) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await fetchWikitextParse(pageTitle);
    } catch (e) {
      lastErr = e;
    }
    try {
      return await fetchWikitextSpecialExport(pageTitle);
    } catch (e2) {
      lastErr = e2;
    }
    const msg = String(lastErr?.message ?? "");
    const is429 = msg.includes("429") || /too many requests/i.test(msg);
    if (!is429) throw lastErr;
    await sleepMs(5000 * (attempt + 1));
  }
  throw lastErr ?? new Error(`fetchWikitext failed for ${pageTitle}`);
}

function wikiLinks(line) {
  const out = [];
  const re = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;
  let m;
  while ((m = re.exec(line))) {
    let target = m[1].trim();
    const disp = (m[2] ?? m[1]).trim();
    target = target.replace(/#.*$/, "");
    if (target.startsWith("Category:") || target.startsWith("File:")) continue;
    out.push({ target, disp });
  }
  return out;
}

function stripTrail(line) {
  return line
    .replace(/\{\{double dagger\}\}/gi, "")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/<ref[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/\s+as\s+[\s\S]*$/i, "")
    .trim();
}

/** End index after outer `}}` for template starting at `openIdx` (`{{`). */
function endOfBalancedTemplate(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length - 1; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      depth++;
      i++;
    } else if (s[i] === "}" && s[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}

function displayForLine(line, catId) {
  const clean = stripTrail(line);
  const links = wikiLinks(clean);
  if (!links.length) return null;

  const firstFilmLink = () => {
    const film = links.find((l) => !/^Academy Award/i.test(l.disp));
    return film?.disp ?? links[0].disp;
  };

  if (
    catId === "best-picture" ||
    EMMY_SERIES_CAT_IDS.has(catId) ||
    BAFTA_FILM_LIKE_IDS.has(catId) ||
    GLOBE_SINGLE_LINK_IDS.has(catId)
  ) {
    return firstFilmLink();
  }

  if (isGlobeDualCreditCategory(catId)) {
    if (links.length >= 2) return `${links[0].disp} — ${links[1].disp}`;
    return links[0].disp;
  }

  if (
    catId === "best-director" ||
    catId === "best-direction" ||
    catId === "best-actor" ||
    catId === "best-actress" ||
    catId === "best-supporting-actor" ||
    catId === "best-supporting-actress" ||
    catId === "best-original-screenplay" ||
    catId === "best-adapted-screenplay" ||
    catId === "best-cinematography" ||
    catId === "best-film-editing" ||
    catId === "best-production-design" ||
    catId === "best-costume-design" ||
    catId === "best-makeup-hairstyling" ||
    catId === "best-original-score" ||
    catId === "best-original-song" ||
    catId === "best-sound" ||
    catId === "best-visual-effects" ||
    catId === "best-casting"
  ) {
    if (links.length >= 2) return `${links[0].disp} — ${links[1].disp}`;
    return links[0].disp;
  }

  if (catId === "best-international" || catId === "best-animated" || catId === "best-documentary") {
    return links[0].disp;
  }

  return links[0].disp;
}

/**
 * Parse "Winners and nominees" chunk for {{Award category| blocks (Oscars list pages).
 */
function parseOscarCategories(wikitext) {
  const wn = wikitext.search(/==\s*Winners and nominees\s*==/i);
  const chunk = wn >= 0 ? wikitext.slice(wn) : wikitext;

  const categories = [];
  let pos = 0;
  while ((pos = chunk.indexOf("{{Award category|", pos)) !== -1) {
    const endHeader = endOfBalancedTemplate(chunk, pos);
    const header = chunk.slice(pos, endHeader);
    const m = header.match(/\[\[Academy Award for [^\]|]+\|([^\]]+)\]\]/);
    const wikiShort = m?.[1]?.trim();
    pos = endHeader;
    if (!wikiShort) continue;

    const catId = WIKI_NAME_TO_ID[wikiShort];
    if (!catId) continue;

    const next = chunk.indexOf("{{Award category|", pos);
    const body = chunk.slice(pos, next === -1 ? chunk.length : next);

    const nominees = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!/^\*+\s*/.test(line)) continue;
      const isNom = /^\*\*/.test(line);
      const isWin = !isNom && /''/.test(line);
      if (!isWin && !isNom) continue;

      const title = displayForLine(line, catId);
      if (!title || title.length < 2) continue;

      nominees.push({
        title,
        mediaType: "movie",
        tmdbId: null,
        winner: isWin,
      });
    }

    if (nominees.length) {
      categories.push({ id: catId, name: CATEGORY_TITLES[catId] ?? wikiShort, nominees });
    }
  }

  /** Merge duplicate category ids (if any) */
  const byId = new Map();
  for (const c of categories) {
    if (!byId.has(c.id)) byId.set(c.id, { ...c, nominees: [...c.nominees] });
    else {
      const p = byId.get(c.id);
      const seen = new Set(p.nominees.map((n) => `${n.title}\t${n.winner}`));
      for (const n of c.nominees) {
        const k = `${n.title}\t${n.winner}`;
        if (!seen.has(k)) {
          seen.add(k);
          p.nominees.push(n);
        }
      }
    }
  }

  return [...byId.values()].sort((a, b) => {
    const order = Object.keys(CATEGORY_TITLES);
    return order.indexOf(a.id) - order.indexOf(b.id);
  });
}

/**
 * Parse "Winners and nominees" for Primetime {{Award category|…|[[Primetime Emmy Award for …|short]]}} blocks.
 */
function parsePrimetimeEmmyCategories(wikitext) {
  const wn = wikitext.search(/==\s*Winners and nominees\s*==/i);
  const chunk = wn >= 0 ? wikitext.slice(wn) : wikitext;

  const categories = [];
  let pos = 0;
  while ((pos = chunk.indexOf("{{Award category|", pos)) !== -1) {
    const endHeader = endOfBalancedTemplate(chunk, pos);
    const header = chunk.slice(pos, endHeader);
    const m = header.match(/\[\[Primetime Emmy Award for [^\]|]+\|([^\]]+)\]\]/);
    const wikiShort = m?.[1]?.trim();
    pos = endHeader;
    if (!wikiShort) continue;

    const catId = EMMY_WIKI_SHORT_TO_ID[wikiShort];
    if (!catId) continue;

    const next = chunk.indexOf("{{Award category|", pos);
    const body = chunk.slice(pos, next === -1 ? chunk.length : next);

    const nominees = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!/^\*+\s*/.test(line)) continue;
      const isNom = /^\*\*/.test(line);
      const isWin = !isNom && /''/.test(line);
      if (!isWin && !isNom) continue;

      const title = displayForLine(line, catId);
      if (!title || title.length < 2) continue;

      nominees.push({
        title,
        mediaType: "tv",
        tmdbId: null,
        winner: isWin,
      });
    }

    if (nominees.length) {
      categories.push({ id: catId, name: EMMY_CATEGORY_TITLES[catId] ?? wikiShort, nominees });
    }
  }

  const emmyOrder = Object.keys(EMMY_CATEGORY_TITLES);
  const byId = new Map();
  for (const c of categories) {
    if (!byId.has(c.id)) byId.set(c.id, { ...c, nominees: [...c.nominees] });
    else {
      const p = byId.get(c.id);
      const seen = new Set(p.nominees.map((n) => `${n.title}\t${n.winner}`));
      for (const n of c.nominees) {
        const k = `${n.title}\t${n.winner}`;
        if (!seen.has(k)) {
          seen.add(k);
          p.nominees.push(n);
        }
      }
    }
  }

  return [...byId.values()].sort((a, b) => emmyOrder.indexOf(a.id) - emmyOrder.indexOf(b.id));
}

function mergeCategoryBlocks(categories, sortOrder) {
  const byId = new Map();
  for (const c of categories) {
    if (!byId.has(c.id)) byId.set(c.id, { ...c, nominees: [...c.nominees] });
    else {
      const p = byId.get(c.id);
      const seen = new Set(p.nominees.map((n) => `${n.title}\t${n.winner}`));
      for (const n of c.nominees) {
        const k = `${n.title}\t${n.winner}`;
        if (!seen.has(k)) {
          seen.add(k);
          p.nominees.push(n);
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => sortOrder.indexOf(a.id) - sortOrder.indexOf(b.id));
}

function baftaAwardLabelFromHeader(header) {
  const piped = header.match(/\[\[BAFTA Award for [^\]|]+\|([^\]]+)\]\]/);
  if (piped?.[1]) return piped[1].trim();
  const plainBritish = header.match(/\[\[(Outstanding British Film)\]\]/);
  if (plainBritish) return plainBritish[1];
  const plainNotEn = header.match(/\[\[(Best Film Not in the English Language)\]\]/);
  if (plainNotEn) return plainNotEn[1];
  return null;
}

function parseBaftaCategories(wikitext) {
  const wn = wikitext.search(/==\s*Winners and nominees\s*==/i);
  const chunk = wn >= 0 ? wikitext.slice(wn) : wikitext;
  const categories = [];
  let pos = 0;
  while ((pos = chunk.indexOf("{{Award category|", pos)) !== -1) {
    const endHeader = endOfBalancedTemplate(chunk, pos);
    const header = chunk.slice(pos, endHeader);
    const wikiShort = baftaAwardLabelFromHeader(header);
    pos = endHeader;
    if (!wikiShort) continue;
    const catId = BAFTA_WIKI_SHORT_TO_ID[wikiShort];
    if (!catId) continue;
    const next = chunk.indexOf("{{Award category|", pos);
    const body = chunk.slice(pos, next === -1 ? chunk.length : next);
    const nominees = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!/^\*+\s*/.test(line)) continue;
      const isNom = /^\*\*/.test(line);
      const isWin = !isNom && /''/.test(line);
      if (!isWin && !isNom) continue;
      const title = displayForLine(line, catId);
      if (!title || title.length < 2) continue;
      nominees.push({ title, mediaType: "movie", tmdbId: null, winner: isWin });
    }
    if (nominees.length) {
      categories.push({ id: catId, name: BAFTA_CATEGORY_TITLES[catId] ?? wikiShort, nominees });
    }
  }
  return mergeCategoryBlocks(categories, BAFTA_CATEGORY_ORDER);
}

function collectGlobeBulletNominees(body, catId, mediaType) {
  const nominees = [];
  if (!body) return nominees;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!/^\*+\s*/.test(line)) continue;
    const isNom = /^\*\*/.test(line);
    const isWin = !isNom && /''/.test(line);
    if (!isWin && !isNom) continue;
    const title = displayForLine(line, catId);
    if (!title || title.length < 2) continue;
    nominees.push({ title, mediaType, tmdbId: null, winner: isWin });
  }
  return nominees;
}

/** `===Film===` / `===Television===` body until the next same-level `===` heading. */
function extractGlobeH3Body(wikitext, sectionName) {
  const mark = `===${sectionName}===`;
  const i = wikitext.indexOf(mark);
  if (i < 0) return "";
  const tail = wikitext.slice(i + mark.length).replace(/^\s*\n/, "");
  const stopNeedles = [
    "===Television===",
    "===Film===",
    "===Series with",
    "===Films with",
    "===Table",
    "===Audience",
    "==Presenters==",
    "==Reception==",
  ];
  let cut = tail.length;
  for (const n of stopNeedles) {
    if (n === mark) continue;
    const j = tail.indexOf(n);
    if (j >= 0 && j < cut) cut = j;
  }
  return tail.slice(0, cut).trimEnd();
}

/**
 * First `|- ... | valign=... | ... | valign=... |` pair after `anchorNeedle` (e.g. "Best Motion Picture").
 * Handles `valign="top"` and `valign=top`.
 */
function extractFirstTwoValignCellsAfter(chunk, anchorNeedle) {
  const pos = chunk.indexOf(anchorNeedle);
  if (pos < 0) return null;
  const sub = chunk.slice(pos);
  const m1 = sub.match(
    /\|-\s*\r?\n\|\s*valign="top"\s*\|\s*\r?\n([\s\S]*?)\r?\n\|\s*valign="top"\s*\|\s*\r?\n([\s\S]*?)(?=\r?\n\|-)/,
  );
  if (m1) return { left: m1[1].trim(), right: m1[2].trim() };
  const m2 = sub.match(/\|-\s*\r?\n\|\s*valign=top\s*\|\s*\r?\n([\s\S]*?)\r?\n\|\s*valign=top\s*\|\s*\r?\n([\s\S]*?)(?=\r?\n\|-)/);
  return m2 ? { left: m2[1].trim(), right: m2[2].trim() } : null;
}

function extractGlobeLimitedSeriesBody(tvChunk) {
  const needles = [
    "Best Miniseries or Television Film",
    "Best Limited Series",
    "Best Television Film",
    "Best Miniseries",
  ];
  let idx = -1;
  for (const n of needles) {
    idx = tvChunk.indexOf(n);
    if (idx >= 0) break;
  }
  if (idx < 0) return null;
  const sub = tvChunk.slice(idx);
  const m =
    sub.match(/\|-\s*\r?\n\|\s*colspan=2[^\n]*\|\s*\r?\n([\s\S]*?)(?=\r?\n\|-\r?\n!\s*(?:colspan|\[\[))/i) ||
    sub.match(/\|-\s*\r?\n\|\s*colspan="2"[^\n]*\|\s*\r?\n([\s\S]*?)(?=\r?\n\|-\r?\n!\s*(?:colspan|\[\[))/i);
  return m ? m[1].trim() : null;
}

function tvSeriesAnchorForChunk(tvChunk) {
  if (tvChunk.includes("Best Television Series")) return "Best Television Series";
  if (tvChunk.includes("!colspan=2|Best Series") || tvChunk.includes("!colspan=2|Best Series\n"))
    return "Best Series";
  if (tvChunk.indexOf("Best Series") >= 0) return "Best Series";
  return "Best Television Series";
}

/**
 * Older ceremony pages use side-by-side wikitables (no {{Award category}}). Covers ~1970s–2020.
 */
function parseGoldenGlobeLegacyWikitables(wikitext) {
  const wn = wikitext.search(/==\s*Winners and nominees\s*==/i);
  const base = wn >= 0 ? wikitext.slice(wn) : wikitext;
  const filmChunk = extractGlobeH3Body(base, "Film");
  const tvChunk = extractGlobeH3Body(base, "Television");
  const categories = [];
  const filmPair =
    extractFirstTwoValignCellsAfter(filmChunk, "Best Motion Picture") ||
    extractFirstTwoValignCellsAfter(filmChunk, "Motion Picture");
  if (filmPair) {
    const d = collectGlobeBulletNominees(filmPair.left, "best-picture-drama", "movie");
    const c = collectGlobeBulletNominees(filmPair.right, "best-picture-musical-comedy", "movie");
    if (d.length) {
      categories.push({
        id: "best-picture-drama",
        name: GLOBE_CATEGORY_TITLES["best-picture-drama"],
        nominees: d,
      });
    }
    if (c.length) {
      categories.push({
        id: "best-picture-musical-comedy",
        name: GLOBE_CATEGORY_TITLES["best-picture-musical-comedy"],
        nominees: c,
      });
    }
  }
  const tvAnchor = tvSeriesAnchorForChunk(tvChunk);
  const tvPair =
    extractFirstTwoValignCellsAfter(tvChunk, tvAnchor) ||
    extractFirstTwoValignCellsAfter(tvChunk, "Best Television Series");
  if (tvPair) {
    const d = collectGlobeBulletNominees(tvPair.left, "best-tv-drama", "tv");
    const c = collectGlobeBulletNominees(tvPair.right, "best-tv-musical-comedy", "tv");
    if (d.length) {
      categories.push({ id: "best-tv-drama", name: GLOBE_CATEGORY_TITLES["best-tv-drama"], nominees: d });
    }
    if (c.length) {
      categories.push({
        id: "best-tv-musical-comedy",
        name: GLOBE_CATEGORY_TITLES["best-tv-musical-comedy"],
        nominees: c,
      });
    }
  }
  const limBody = extractGlobeLimitedSeriesBody(tvChunk);
  if (limBody) {
    const n = collectGlobeBulletNominees(limBody, "best-limited-tv", "tv");
    if (n.length) {
      categories.push({
        id: "best-limited-tv",
        name: GLOBE_CATEGORY_TITLES["best-limited-tv"],
        nominees: n,
      });
    }
  }
  return mergeCategoryBlocks(categories, GLOBE_CATEGORY_ORDER);
}

function scoreGlobeCategories(cats) {
  return cats.reduce((s, c) => s + c.nominees.length, 0);
}

function pickGoldenGlobeCategories(wikitext) {
  const modern = parseGoldenGlobeTemplateCategories(wikitext);
  const legacy = parseGoldenGlobeLegacyWikitables(wikitext);
  const sm = scoreGlobeCategories(modern);
  const sl = scoreGlobeCategories(legacy);
  const cm = modern.length;
  const cl = legacy.length;
  if (cm === 0 && cl === 0) return [];
  if (cm === 0) return legacy;
  if (cl === 0) return modern;
  if (sm > sl) return modern;
  if (sl > sm) return legacy;
  return cm >= cl ? modern : legacy;
}

function parseGoldenGlobeTemplateCategories(wikitext) {
  const wn = wikitext.search(/==\s*Winners and nominees\s*==/i);
  const chunk = wn >= 0 ? wikitext.slice(wn) : wikitext;
  const categories = [];
  let pos = 0;
  while ((pos = chunk.indexOf("{{Award category|", pos)) !== -1) {
    const endHeader = endOfBalancedTemplate(chunk, pos);
    const header = chunk.slice(pos, endHeader);
    const m = header.match(/\[\[Golden Globe Award for [^\]|]+\|([^\]]+)\]\]/);
    const wikiShort = m?.[1]?.trim();
    pos = endHeader;
    if (!wikiShort) continue;
    const catId = globeWikiShortToId(wikiShort);
    if (!catId) continue;
    const next = chunk.indexOf("{{Award category|", pos);
    const body = chunk.slice(pos, next === -1 ? chunk.length : next);
    const mediaType = globeNomineeMediaType(catId);
    const nominees = collectGlobeBulletNominees(body, catId, mediaType);
    if (nominees.length) {
      categories.push({ id: catId, name: GLOBE_CATEGORY_TITLES[catId] ?? wikiShort, nominees });
    }
  }
  return mergeCategoryBlocks(categories, GLOBE_CATEGORY_ORDER);
}

async function importAcademyAwards(args, start, end) {
  const outSub = "academy-awards";
  const wikiDs = "wikipedia-mediawiki-api";

  console.error(`Wikipedia → ${EDITIONS_ROOT}/${outSub}/{year}.json (Oscars)`);
  console.error(`Years ${start}–${end} (${end - start + 1} years)`);
  if (args.dryRun) console.error("DRY RUN");

  for (let y = start; y <= end; y++) {
    const outDir = path.join(EDITIONS_ROOT, outSub);
    const outFile = path.join(outDir, `${y}.json`);

    if (fs.existsSync(outFile) && !args.force) {
      if (!args.upgradeSeed || !isReplaceableSeedEdition(outFile, { awardId: "academy-awards", wikipediaDataSource: wikiDs })) {
        continue;
      }
    }

    let title;
    try {
      title = oscarsPageTitle(y);
    } catch {
      console.error(`  SKIP ${y}: ${oscarsPageTitle.name} out of range`);
      continue;
    }

    let wikitext;
    try {
      wikitext = await fetchWikitext(title);
    } catch (e) {
      console.error(`  ERROR ${y} (${title}): ${e.message}`);
      continue;
    }

    const categories = parseOscarCategories(wikitext);
    if (!categories.length) {
      console.error(`  SKIP ${y}: no parsed categories from ${title}`);
      continue;
    }

    const doc = {
      awardId: "academy-awards",
      year: y,
      label: `${title} (${y})`,
      categories,
      dataSource: wikiDs,
      notes:
        "Imported from English Wikipedia wikitext (Winners and nominees / {{Award category}}). CC BY-SA. Verify with AMPAS. tmdbId left null unless you enrich separately.",
    };

    const summary = categories.map((c) => `${c.id}:${c.nominees.length}`).join(", ");
    if (args.dryRun) {
      console.error(`  would write ${outSub}/${y}.json — ${summary}`);
      continue;
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + "\n", "utf8");
    console.error(`  wrote ${outSub}/${y}.json — ${summary}`);
  }
}

async function importPrimetimeEmmys(args, start, end) {
  const outSub = "primetime-emmys";
  const wikiDs = "wikipedia-mediawiki-api-primetime";

  console.error(`Wikipedia → ${EDITIONS_ROOT}/${outSub}/{year}.json (Primetime Emmys)`);
  console.error(`Years ${start}–${end} (${end - start + 1} years)`);
  if (args.dryRun) console.error("DRY RUN");

  for (let y = start; y <= end; y++) {
    const outDir = path.join(EDITIONS_ROOT, outSub);
    const outFile = path.join(outDir, `${y}.json`);

    if (fs.existsSync(outFile) && !args.force) {
      if (!args.upgradeSeed || !isReplaceableSeedEdition(outFile, { awardId: "primetime-emmys", wikipediaDataSource: wikiDs })) {
        continue;
      }
    }

    let title;
    try {
      title = primetimeEmmyPageTitle(y);
    } catch {
      console.error(`  SKIP ${y}: ${primetimeEmmyPageTitle.name} out of range`);
      continue;
    }

    let wikitext;
    try {
      wikitext = await fetchWikitext(title);
    } catch (e) {
      console.error(`  ERROR ${y} (${title}): ${e.message}`);
      continue;
    }

    const categories = parsePrimetimeEmmyCategories(wikitext);
    if (!categories.length) {
      console.error(`  SKIP ${y}: no parsed categories from ${title}`);
      continue;
    }

    const doc = {
      awardId: "primetime-emmys",
      year: y,
      label: `${title} (${y} ceremony)`,
      categories,
      dataSource: wikiDs,
      notes:
        "Imported from English Wikipedia wikitext (Winners and nominees / {{Award category}}). CC BY-SA. Verify with Television Academy. tmdbId left null unless you enrich separately.",
    };

    const summary = categories.map((c) => `${c.id}:${c.nominees.length}`).join(", ");
    if (args.dryRun) {
      console.error(`  would write ${outSub}/${y}.json — ${summary}`);
      continue;
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + "\n", "utf8");
    console.error(`  wrote ${outSub}/${y}.json — ${summary}`);
  }
}

async function importBafta(args, start, end) {
  const outSub = "bafta";
  const wikiDs = "wikipedia-mediawiki-api-bafta";

  console.error(`Wikipedia → ${EDITIONS_ROOT}/${outSub}/{year}.json (BAFTA Film)`);
  console.error(`Years ${start}–${end} (${end - start + 1} years)`);
  if (args.dryRun) console.error("DRY RUN");

  for (let y = start; y <= end; y++) {
    const outDir = path.join(EDITIONS_ROOT, outSub);
    const outFile = path.join(outDir, `${y}.json`);

    if (fs.existsSync(outFile) && !args.force) {
      if (!args.upgradeSeed || !isReplaceableSeedEdition(outFile, { awardId: "bafta", wikipediaDataSource: wikiDs })) {
        continue;
      }
    }

    let title;
    try {
      title = baftaPageTitle(y);
    } catch {
      console.error(`  SKIP ${y}: ${baftaPageTitle.name} out of range`);
      continue;
    }

    let wikitext;
    try {
      wikitext = await fetchWikitext(title);
    } catch (e) {
      console.error(`  ERROR ${y} (${title}): ${e.message}`);
      continue;
    }

    const categories = parseBaftaCategories(wikitext);
    if (!categories.length) {
      console.error(`  SKIP ${y}: no parsed categories from ${title}`);
      continue;
    }

    const doc = {
      awardId: "bafta",
      year: y,
      label: `${title} (${y})`,
      categories,
      dataSource: wikiDs,
      notes:
        "Imported from English Wikipedia wikitext (Winners and nominees / {{Award category}}). CC BY-SA. Verify with BAFTA. tmdbId left null unless you enrich separately.",
    };

    const summary = categories.map((c) => `${c.id}:${c.nominees.length}`).join(", ");
    if (args.dryRun) {
      console.error(`  would write ${outSub}/${y}.json — ${summary}`);
      continue;
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + "\n", "utf8");
    console.error(`  wrote ${outSub}/${y}.json — ${summary}`);
  }
}

async function importGoldenGlobes(args, start, end) {
  const outSub = "golden-globes";
  const wikiDs = "wikipedia-mediawiki-api-golden-globes";

  console.error(`Wikipedia → ${EDITIONS_ROOT}/${outSub}/{year}.json (Golden Globes)`);
  console.error(`Years ${start}–${end} (${end - start + 1} years)`);
  if (args.dryRun) console.error("DRY RUN");

  for (let y = start; y <= end; y++) {
    const outDir = path.join(EDITIONS_ROOT, outSub);
    const outFile = path.join(outDir, `${y}.json`);

    if (fs.existsSync(outFile) && !args.force) {
      if (!args.upgradeSeed || !isReplaceableSeedEdition(outFile, { awardId: "golden-globes", wikipediaDataSource: wikiDs })) {
        continue;
      }
    }

    let title;
    try {
      title = goldenGlobePageTitle(y);
    } catch {
      console.error(`  SKIP ${y}: ${goldenGlobePageTitle.name} out of range`);
      continue;
    }

    let wikitext;
    try {
      wikitext = await fetchWikitext(title);
    } catch (e) {
      console.error(`  ERROR ${y} (${title}): ${e.message}`);
      continue;
    }

    const categories = pickGoldenGlobeCategories(wikitext);
    if (!categories.length) {
      console.error(`  SKIP ${y}: no parsed categories from ${title} (old table layout or missing article)`);
      continue;
    }

    const doc = {
      awardId: "golden-globes",
      year: y,
      label: `${title} (${y})`,
      categories,
      dataSource: wikiDs,
      notes:
        "Imported from English Wikipedia (Winners and nominees: {{Award category}} maps film + TV craft/acting categories where templates match; legacy ===Film=== / ===Television=== tables still only extract the main picture/series blocks). CC BY-SA. Verify with Golden Globes / DCP. Wikidata script can seed gaps; TMDB enriches artwork in the API when configured. tmdbId left null in JSON unless enriched.",
    };

    const summary = categories.map((c) => `${c.id}:${c.nominees.length}`).join(", ");
    if (args.dryRun) {
      console.error(`  would write ${outSub}/${y}.json — ${summary}`);
      continue;
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + "\n", "utf8");
    console.error(`  wrote ${outSub}/${y}.json — ${summary}`);
  }
}

async function main() {
  const args = parseArgs();
  const { start, end } = yearRange(args);

  if (args.award === "primetime-emmys") await importPrimetimeEmmys(args, start, end);
  else if (args.award === "bafta") await importBafta(args, start, end);
  else if (args.award === "golden-globes") await importGoldenGlobes(args, start, end);
  else await importAcademyAwards(args, start, end);

  console.error("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
