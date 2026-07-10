# Handoff: Pitflix Android

## Overview
Pitflix is a self-hosted personal media tracker — a companion to a desktop media center app. This handoff covers the full Android mobile UI across 8 screens (Phase 1–3): Login, Home, Stats, Profile, Title Detail (Series + Movie), Actor, Settings, and Search.

## About the Design Files
The files in this bundle are **high-fidelity design references built in HTML** — interactive prototypes showing the intended look, layout, and behavior. They are not production code to ship directly.

Your task is to **recreate these designs in your target codebase** (React Native, Jetpack Compose, Flutter, etc.) using its established patterns, navigation library, and component primitives. The HTML prototypes are the source of truth for visual design; the implementation technology is your call.

## Fidelity
**High-fidelity.** All colors, typography, spacing, border radii, and interactions are final and should be matched pixel-precisely. Every hex value in the Design Tokens section below is production-ready.

---

## Design Tokens

### Colors
| Token | Hex | Usage |
|---|---|---|
| `bg-base` | `#09080F` | App background |
| `bg-canvas` | `#07060E` | Canvas / outer |
| `bg-card` | `#110F22` | Cards, inputs, list rows |
| `bg-nav` | `#0C0B1A` | Bottom nav bar |
| `border` | `#1A172E` | Dividers, borders |
| `border-input` | `#2A2548` | Input field borders |
| `accent` | `#7C3AED` | Primary violet — CTAs, toggles ON, active progress |
| `accent-dim` | `#5B21B6` | Log FAB background |
| `text-primary` | `#FFFFFF` | Main text |
| `text-secondary` | `rgba(255,255,255,0.65)` | Secondary / body copy |
| `text-muted` | `#5E5A82` | Labels, meta, inactive |
| `text-inactive-nav` | `rgba(255,255,255,0.45)` | Inactive nav labels |
| `icon-inactive` | `#5E5A82` | Inactive nav icons |
| `tab-inactive-border` | `#231E3A` | Inactive tab underline |
| `success` | `#34D399` | Fully-watched checkmark |
| `destructive` | `#EF4444` | Log Out text |
| `star` | `#F59E0B` | Star rating filled |

### Typography
| Role | Font | Size | Weight | Notes |
|---|---|---|---|---|
| Display / heading | Bebas Neue | varies | 400 (display) | All-caps, letter-spacing 0.08–0.14em |
| Body | DM Sans | 13–15px | 300–600 | Clean sans for all UI text |
| Section label | DM Sans | 11px | 600 | Uppercase, tracking 0.1–0.12em, color `#5E5A82` |
| Poster title | DM Sans | 9–10px | 600 | White, over gradient overlay |
| Nav label | DM Sans | 9px | 400/600 active | Letter-spacing 0.04em |

### Spacing
- Screen horizontal padding: **20px**
- Card padding: **14–18px**
- Card border-radius: **12–14px**
- Poster border-radius: **8px**
- Avatar border-radius: **50%** (circle)
- Section gap (between rows): **22px**
- Poster gap in scroll row: **10px**

### Bottom Nav
- Height: **60px**
- Background: `#0C0B1A`
- Border-top: `1px solid #1A172E`
- 4 equal-flex tabs

---

## Navigation Structure

```
Bottom Nav (4 tabs)
├── Home        — Watch Next / Trending / Watch Later (Shows + Movies tabs)
├── Discover    — Search + TMDB browsing → Title Detail → Actor
├── Stats       — Shows / Movies tabs, metrics
└── Profile     — Quick stats, Watch Later preview → Settings (pushed screen)
```

Title Detail and Actor are pushed screens (no bottom nav re-selection).

---

## Screens

---

### 01 · Login

**Purpose:** Single-user auth gate. No registration flow.

**Layout:** Full-screen dark `#09080F`. Vertically centered column.

**Top (hero area, flex: 1, centered):**
- Logo icon: 80×80px rounded square (border-radius 20px), background `#5B21B6`
  - White "P" monogram SVG inside (see design file)
- PITFLIX wordmark: Bebas Neue, width ~196px, animated SVG (letters reveal upward on load, loop). Color `#7C3AED`. See animation section below.

**Bottom (form, padding 0 32px 52px):**
- Email label: DM Sans 11px/600, uppercase, tracking 0.1em, `#5E5A82`
- Email input: `#110F22` bg, 1.5px border `#2A2548`, border-radius 10px, padding 14px 16px, font 15px, color `#9D9AC0`
- Password label: same as email label
- Password input: same style, value shown as `••••••••`, color `#7B77A0`, letter-spacing 0.28em
- Gap between fields: 14px; gap before button: 28px
- **Log In button:** `#FFFFFF` bg, border-radius 12px, padding 16px, Bebas Neue 22px, letter-spacing 0.14em, color `#09080F`
- Forgot password: centered, DM Sans 13px, `rgba(255,255,255,0.45)`

---

### 02 · Home

**Purpose:** Main content feed — in-progress shows, trending, watchlist.

**Top bar (padding 14px 20px 0):**
- Left: "PITFLIX" wordmark, Bebas Neue 26px, `#FFFFFF`, tracking 0.14em
- Right: search icon (stroke `#5E5A82`) + avatar circle (28px, `#2E2B46`)

**Shows / Movies tab bar (padding 10px 20px 0):**
- Flex row, each tab: flex 1, center-aligned text
- Active: DM Sans 14px/600, `#F0EDFF`, border-bottom `2px solid #FFFFFF`
- Inactive: DM Sans 14px/400, `#6B6890`, border-bottom `2px solid #231E3A`
- Padding-bottom on tab: 10px

**Shows tab sections (top-to-bottom):**
1. **Watch Next** — horizontal scroll row of poster cards with progress bar
2. **Trending** — horizontal scroll row of poster cards
3. **Watch Later** — horizontal scroll row of poster cards

**Movies tab sections:**
1. **Trending** (no Watch Next — movies have no "next episode")
2. **Watch Later**

**Section header row (padding 0 20px 10px):**
- Left: section title, DM Sans 14px/600, `#F0EDFF`
- Right: "See all", DM Sans 12px, `#FFFFFF`

**Poster card:**
- Width: 110px, height: 162px, border-radius 8px
- Background: dark gradient (placeholder; real implementation uses TMDB poster images)
- Gradient overlay at bottom: `linear-gradient(to top, rgba(9,8,15,0.95), transparent)`
- Title text: DM Sans 10px/600, `#EDE9FF`, bottom-left, padding 8px
- Episode sub (Watch Next only): DM Sans 9px, `rgba(255,255,255,0.7)`, below title

**Progress bar (Watch Next only):**
- 3px tall strip at very bottom of card
- Track: `#1E1A32`; fill: `#7C3AED`, width = % watched

**Bottom nav:** 4 tabs — Home (active), Discover, Stats, Profile.

---

### 03 · Stats

**Purpose:** Viewing time analytics.

**Top bar:** "Stats" title, Bebas Neue 22px, `#FFFFFF`.

**Shows / Movies tab bar:** same pattern as Home.

**Sections (vertical scroll):**

1. **Hero metric card** (`#110F22`, border-radius 14px, padding 22px 20px 18px):
   - Label: "Total Time Watched", section-label style
   - Value: "5 mo 21 d 15 hr", Bebas Neue 34px, `#FFFFFF`
   - Sub: "+38 hours in the last 7 days", DM Sans 12px/500, `#7C3AED`

2. **Bar chart card** (`#110F22`, border-radius 14px, padding 18px 16px 14px):
   - Label: "Episodes / Week"
   - 12 bars, last bar (current week) in `#7C3AED`, others in `#1E1A32`
   - Bars bottom-aligned, max height 60px, border-radius `3px 3px 0 0`
   - Week labels: DM Sans 8px, `#3D3A5C`

3. **Count cards row** (two equal tiles side by side, gap 10px):
   - Each: `#110F22`, border-radius 14px, padding 16px 14px
   - Label: section-label style
   - Value: Bebas Neue 30px, `#FFFFFF`
   - Left: "Episodes · 5,920"; Right: "Movies · 801"

4. **Biggest Marathons table** (`#110F22`, border-radius 14px):
   - 5 rows, each: rank (11px `#3D3A5C`), title (13px/500 `#FFFFFF`), ep count (`#7C3AED`), hours (`#5E5A82`)
   - Dividers: `1px solid #1A172E`

5. **Top Genres** (`#110F22`, border-radius 14px):
   - 5 genres, each: name (13px/500 `#FFFFFF`) + count (12px `#5E5A82`) + 3px progress bar (`#7C3AED`)

**Bottom nav:** Stats active.

---

### 04 · Profile

**Purpose:** User identity + quick stats + watchlist preview + settings entry point.

**Avatar row (padding 20px 20px 0):**
- Avatar circle: 64px, `#1A1630` bg, `2px solid #2A2548` border, initials "JD" Bebas Neue 26px `#7C3AED`
- Username: DM Sans 18px/600 `#FFFFFF`; email: 12px `#5E5A82`
- Edit button: `#1A1630` bg, `1px solid #2A2548` border, border-radius 8px, DM Sans 12px/500 `#FFFFFF`

**Quick stats tiles (padding 16px 20px 0, gap 10px):**
- Two equal tiles, `#110F22`, border-radius 14px, padding 16px 14px
- Label: section-label style; value: Bebas Neue 22px `#FFFFFF`; CTA: DM Sans 10px `#7C3AED`
- Tiles: "TV Time · 5mo 21d" and "Episodes · 5,920"
- Tapping either navigates to Stats screen

**Watch Later preview:**
- Section header + horizontal scroll row, poster cards 90×132px

**Settings block (margin-top 24px, border-top `1px solid #1A172E`):**
- Section label: "Settings"
- Sync card (`#110F22`, border-radius 14px):
  - "Sync with Desktop" + toggle (ON: `#7C3AED` bg, thumb right; OFF: `#2A2548`)
  - Connected status: green dot `#34D399` + "Connected · pitflix-desktop"
  - "Last synced: 3 min ago"
- Logout: `#110F22`, border-radius 14px, centered, `#EF4444`

**Bottom nav:** Profile active.

---

### 05a · Title Detail — Series

**Purpose:** Track episode progress for a TV series.

**Hero backdrop (height 200px):**
- Dark gradient bg (placeholder for TMDB backdrop)
- Back chevron (top-left, 34px circle `rgba(0,0,0,0.4)`)
- More button (top-right, same style)
- Title: Bebas Neue 36px `#FFFFFF`, tracking 0.08em
- Meta line: DM Sans 12px `rgba(255,255,255,0.55)` + rating badge (`#7C3AED`, border-radius 4px, 11px/600)

**Tabs: Episodes | About** (same tab pattern)

**Episodes tab:**

*Continue Tracking card* (`#110F22`, border-radius 12px, padding 14px):
- 52×52 icon tile with play icon `#7C3AED`
- "Continue Tracking" label (section-label style)
- Episode name: DM Sans 14px/600 `#FFFFFF`
- Duration: 11px `rgba(255,255,255,0.45)`
- "Mark" button: `#7C3AED`, border-radius 8px

*Season rows* (`#110F22`, border-radius 12px):
- Season name: DM Sans 14px/600 `#FFFFFF`; episode count: 11px `rgba(255,255,255,0.4)`
- Complete season: green check circle (`#1A3A2A` bg, `1.5px solid #34D399`)
- In-progress season: violet partial-check circle (`1.5px solid #7C3AED`)
- Expandable to individual episodes:
  - Done ep: `#1A3A2A` bg dot, `#34D399` stroke check
  - Pending ep: transparent bg, `#3D3A5C` border (no check rendered)
  - Title: 12px/500 `#FFFFFF`; duration: 10px `rgba(255,255,255,0.35)`; ep number: 11px `rgba(255,255,255,0.25)`

**About tab:**
- Overview paragraph: DM Sans 13px/1.65 `rgba(255,255,255,0.7)`
- Cast: horizontal scroll, 70px-wide items — 52px circle avatar (dark gradient bg, initials Bebas Neue 14px) + name 9px below
- Genres: pill chips — `#1A172E` bg, border-radius 20px, padding 5px 12px, DM Sans 12px `rgba(255,255,255,0.65)`

**Bottom nav:** Discover active.

---

### 05b · Title Detail — Movie

**Purpose:** Log, rate, and manage a movie.

**Hero backdrop (height 220px):** Same pattern as series but taller; no tabs.

**Actions row** (`#110F22`, border-radius 12px, 3-column flex with `1px solid #1A172E` dividers):
- **Watched toggle:** ON = `#7C3AED` bg, thumb right; OFF = `#1E1A32`, thumb left (`#3D3A5C`)
- **Star rating:** 5 stars, filled = `#F59E0B`, empty = `#2A2548`, font-size 17px
- **Watch Later toggle:** same as Watched toggle

**Log This Watch button:** `#7C3AED` bg, border-radius 12px, Bebas Neue 20px, tracking 0.12em, `#FFFFFF`

**Below:** Overview, cast scroll, genres chips (same as series About tab)

**Bottom nav:** Discover active.

---

### 06 · Actor

**Purpose:** Browse an actor's filmography.

**Header (gradient bg `linear-gradient(180deg,#0e0c20,#09080F)`):**
- Back button (top-left)
- Centered column: 80px avatar circle (`#1A1630` bg, `2px solid #2A2548`, initials `#7C3AED` Bebas Neue 28px)
- Name: Bebas Neue 28px/tracking 0.1em `#FFFFFF`
- Birthdate/location: DM Sans 12px `rgba(255,255,255,0.4)`

**Body:**
- Bio paragraph: DM Sans 13px/1.65 `rgba(255,255,255,0.65)`
- "Filmography" section label
- 3-column grid of poster cards (aspect-ratio 2/3, border-radius 8px, gradient overlay + title)

**Bottom nav:** Discover active.

---

### 07 · Settings

**Purpose:** App configuration (reached by pushing from Profile).

**Top bar:** Back chevron (34px circle `#110F22`) + "Settings" Bebas Neue 22px

**Sections (vertical scroll, padding 20px):**

*Connection* (`#110F22`, border-radius 14px):
- Sync toggle row
- Connected status (green dot)
- Last synced
- "Sync Now" tappable row, `#7C3AED`

*Account* (`#110F22`, border-radius 14px):
- Email (read-only)
- Change Password

*App* (`#110F22`, border-radius 14px):
- Version (read-only)
- Clear Cache (chevron right)

*Log Out* (`#110F22`, border-radius 14px, centered, `#EF4444`)

**Bottom nav:** Profile active (Settings is a pushed screen, not a tab).

---

### 08 · Search

**Purpose:** TMDB-backed search, reached from Discover tab.

**Search bar (`#110F22`, border `1.5px solid #2A2548`, border-radius 12px, height 46px):**
- Search icon + text input + clear ✕

**Filter chips (horizontal row, gap 8px):**
- Active chip: `#7C3AED` bg, DM Sans 12px/600 `#FFFFFF`
- Inactive chip: `#1A172E` bg, DM Sans 12px `rgba(255,255,255,0.45)`
- Chips: All | Movies | Shows

**Results count:** DM Sans 12px `rgba(255,255,255,0.3)`

**Results grid:** 3-column, gap 10px, poster cards (aspect-ratio 2/3), title + year below gradient overlay. Tapping opens Title Detail.

**Bottom nav:** Discover active.

---

## Interactions & Behavior

### Wordmark Animation (Login)
- On mount (after `document.fonts.ready`): each letter rect `translateY(70px)` → `translateY(0)`
- Stagger: 550ms per letter, duration 1800ms, easing `cubic-bezier(0.22,1,0.36,1)`
- Pause 1500ms, then loop
- Uses SVG clip-path per letter; rects slide up through the clip region

### Tabs (Home, Stats, Title Detail)
- Instant switch, no animation
- Active: border-bottom `2px solid #FFFFFF`, DM Sans/600, `#F0EDFF`
- Inactive: border-bottom `2px solid #231E3A`, DM Sans/400, `#6B6890`

### Sync Toggle (Profile, Settings)
- Tap: background transitions `#7C3AED` ↔ `#2A2548` (200ms)
- Thumb slides left ↔ right (200ms)

### Progress Bars (Watch Next posters)
- Static on render; value comes from backend tracking data

### Season rows (Title Detail — Series)
- Tapping a season row expands/collapses episode list
- Fully-watched seasons show collapsed by default with green checkmark
- In-progress season shown expanded by default

### Log This Watch (Movie Detail)
- Opens a log entry sheet (bottom sheet or modal); not yet designed in this phase

---

## State Management

| State | Type | Notes |
|---|---|---|
| `activeMainTab` | `'shows' \| 'movies'` | Home screen tab |
| `statsTab` | `'shows' \| 'movies'` | Stats screen tab |
| `detailTab` | `'episodes' \| 'about'` | Title Detail tab |
| `syncOn` | `boolean` | Sync with Desktop toggle |
| `expandedSeason` | `number \| null` | Which season is expanded in Title Detail |
| Auth token | `string` | Stored in secure storage |

---

## Assets

- **Bebas Neue** — Google Fonts (`https://fonts.google.com/specimen/Bebas+Neue`)
- **DM Sans** — Google Fonts (`https://fonts.google.com/specimen/DM+Sans`)
- **Poster images** — TMDB API (`https://www.themoviedb.org/documentation/api`), `w342` size
- **Backdrop images** — TMDB API, `w780` size
- **Actor photos** — TMDB API, `w185` profile size
- **Icons** — Custom SVG paths (see design file); style is minimal, 1.8px stroke, rounded caps

---

## Files in This Bundle

| File | Description |
|---|---|
| `Pitflix Android.dc.html` | Full 8-screen interactive HTML prototype (open in browser) |
| `android-frame.jsx` | Android device bezel component used by the prototype |
| `README.md` | This document |

---

## Implementation Notes

1. **No real images in prototype** — poster/backdrop cards use CSS gradients as placeholders. Swap with TMDB image URLs in production.
2. **Single user** — no social features, no followers, no public profiles.
3. **Offline-first sync** — the desktop app is the source of truth; the mobile app syncs bidirectionally.
4. **TMDB integration** — Discover/Search screens hit TMDB; watch history and episode tracking are stored locally/on the self-hosted server.
5. **Bottom nav is always 4 tabs** — Title Detail, Actor, and Settings are pushed screens on top of the tab stack, not separate tab destinations.
