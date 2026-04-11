Pitflix awards — bundle for external review (ChatGPT, Claude, etc.)
Generated: 2026-04-07T17:40:22.166Z

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
