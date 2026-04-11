# Awards QA report

Generated: **2026-04-07T17:54:39.625Z**

## Summary
| Metric | Value |
|--------|-------|
| Edition JSON files | 275 |
| Nominee rows | 10795 |
| tmdbId null | 10589 |
| tmdbId set | 206 |

### Issue code counts
| Code | Count |
|------|-------|
| category_multiple_winners | 74 |
| single_category_edition | 24 |
| category_single_nominee | 23 |
| likely_seed_edition | 15 |
| suspicious_single_token_in_person_category | 8 |

## Coverage gaps (expected ranges vs files present)
### academy-awards
- Expected: **1929–2026** (guidance only — historical gaps are normal).
- Missing **0** ceremony years in folder: first gaps e.g. 
- Official: https://www.oscars.org/

### bafta
- Expected: **1949–2026** (guidance only — historical gaps are normal).
- Missing **12** ceremony years in folder: first gaps e.g. 1950, 1951, 1952, 1953, 1957, 1959, 1960, 1961, 1963, 1964, 1967, 1968
- Official: https://www.bafta.org/

### golden-globes
- Expected: **1944–2026** (guidance only — historical gaps are normal).
- Missing **28** ceremony years in folder: first gaps e.g. 1944, 1945, 1946, 1947, 1948, 1949, 1950, 1951, 1952, 1953, 1955, 1957…
- Official: https://www.goldenglobes.com/

### primetime-emmys
- Expected: **1949–2026** (guidance only — historical gaps are normal).
- Missing **22** ceremony years in folder: first gaps e.g. 1949, 1950, 1951, 1952, 1953, 1954, 1955, 1956, 1957, 1958, 1959, 1960…
- Official: https://www.emmys.com/

## By award (aggregates)
### academy-awards
- Files: 98; tmdb null/set: 3749 / 130
- Top issue codes: category_multiple_winners(36), single_category_edition(7), category_single_nominee(5), suspicious_single_token_in_person_category(2)

### bafta
- Files: 66; tmdb null/set: 3385 / 21
- Top issue codes: category_multiple_winners(34), single_category_edition(8), category_single_nominee(7), likely_seed_edition(6), suspicious_single_token_in_person_category(6)

### golden-globes
- Files: 55; tmdb null/set: 824 / 34
- Top issue codes: category_single_nominee(11), single_category_edition(9), likely_seed_edition(9), category_multiple_winners(4)

### primetime-emmys
- Files: 56; tmdb null/set: 2631 / 21
- Top issue codes: —

## Editions with errors or many warnings
- **bafta 1969** (6 issues): category_multiple_winners — `Data/Awards/editions/bafta/1969.json`
- **bafta 1970** (6 issues): category_multiple_winners — `Data/Awards/editions/bafta/1970.json`
- **bafta 1971** (6 issues): category_multiple_winners — `Data/Awards/editions/bafta/1971.json`
- **bafta 1972** (6 issues): category_multiple_winners — `Data/Awards/editions/bafta/1972.json`

Full machine list: **awards-qa-report.json** `issues` array.