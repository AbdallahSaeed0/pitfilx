# Handoff: Library Screen — Continue Watching + Up Next (4 Directions)

## Overview
This handoff covers redesign explorations for two sections on the **Library screen** of Pitflix (a streaming app):
1. **Continue Watching** — highlights the single show the user is actively mid-episode on
2. **Up Next** — a horizontal shelf of other shows the user has started but not finished

Four distinct design directions are provided. The product owner may ship one, combine elements from multiple, or build a toggle in settings to let users choose.

---

## About the Design Files
The files in this bundle are **HTML design prototypes** — high-fidelity references showing intended visual appearance and layout. They are NOT production-ready code. The task is to **recreate these designs inside the existing Pitflix codebase** using its established component patterns, state management, and styling system.

The design prototype used inline CSS for layout; in the real codebase use whatever styling solution (CSS modules, Tailwind, styled-components, etc.) is already in use.

---

## Fidelity
**High-fidelity.** Colors, typography, spacing, border radii, shadows, and component structure are all specified. Implement pixel-accurately using the codebase's existing design system where it covers the values; where it does not, use the exact values from this document.

---

## Design Tokens Used

### Colors
| Token | Hex | Usage |
|---|---|---|
| Brand purple | `#7c3aed` | Primary action, progress bars, active states |
| Brand purple glow | `rgba(124,58,237,0.45)` | Button box-shadows |
| Brand purple light | `#a855f7` | Gradient endpoint on progress bar (1d only) |
| Brand purple dim | `#a78bfa` | Episode label text on active card (1d) |
| Surface base | `#06060e` | Page/screen background |
| Surface card | `#0d0d1c` | Card/panel background |
| Show accent (Wales Forever) | `#c0392b` | Ambient glow, progress, active border |
| Show accent dark | `#7f1d1d` | Poster gradient stop |
| Text primary | `#ffffff` | Headings, titles |
| Text secondary | `rgba(255,255,255,0.38)` | Subtitle / metadata |
| Text tertiary | `rgba(255,255,255,0.22)` | Labels, helper text |
| Text muted | `rgba(255,255,255,0.2)` | Timestamps, counts |
| Divider | `rgba(255,255,255,0.05)` | Border between sections |
| Card border | `rgba(255,255,255,0.07)` | Card stroke |

> **Note on show accent color:** In production, the accent color should be extracted dynamically from the show's artwork (dominant color). The prototype hardcodes red (`#c0392b`) for Wales Forever. Each show in Up Next gets its own unique gradient derived from its poster color — see per-show values below.

### Per-show poster gradients (placeholder — replace with real artwork)
| Show | Gradient |
|---|---|
| Welcome to Wrexham | `#7f1d1d → #c0392b` |
| The Sopranos | `#1a2332 → #2c3e50` |
| Rick and Morty | `#004d40 → #00897b` |
| The Bear | `#3e2723 → #6d4c41` |
| Euphoria | `#311b92 → #7b1fa2` |

### Typography
Font: **DM Sans** (Google Fonts), weights 300/400/500/600/700/800, optical size 9–40

| Usage | Size | Weight | Letter-spacing | Other |
|---|---|---|---|---|
| Section label (caps) | 9.5px | 700 | 0.16em | uppercase |
| Show title (hero) | 32–44px | 800 | -0.03em | line-height 0.95–1.05 |
| Show title (card) | 19px | 700 | -0.02em | |
| Episode title (1d card) | 14px | 700 | — | line-height 1.2 |
| Show name (secondary in 1d) | 11px | 400 | — | color: rgba(255,255,255,0.4) |
| Metadata / subtitle | 12–12.5px | 400 | — | color: rgba(255,255,255,0.38) |
| Episode badge (S05E04) | 9–9.5px | 700 | 0.04em | |
| Button label | 12.5–13px | 600–700 | — | |
| Helper / timestamp | 11px | 400 | — | color: rgba(255,255,255,0.2–0.25) |
| "Browse series" link | 12.5px | 600 | — | color: #7c3aed |

### Spacing
- Section padding: 22–28px vertical, 26–32px horizontal
- Card gap (horizontal shelf): 10–12px
- Inner card gap (text stack): 9px
- Divider line: 1px solid rgba(255,255,255,0.05)

### Border radii
| Element | Radius |
|---|---|
| Outer card/panel | 14px |
| Inner content card | 10px |
| Thumbnail (landscape) | 7px |
| Thumbnail (poster) | 5–9px |
| Button (primary) | 8–9px |
| Button (secondary/ghost) | 6–8px |
| Play button (circle) | 50% |
| Episode badge | 3–4px |
| Progress bar | 2–3px |

### Shadows
| Element | Shadow |
|---|---|
| Primary play button | `0 4px 22px rgba(124,58,237,0.48)` |
| Primary CTA button | `0 4px 20px rgba(124,58,237,0.45)` |
| Small play button | `0 2px 12px rgba(124,58,237,0.4)` |
| Active poster card (1b) | `0 8px 28px rgba(192,57,43,0.3)` |

---

## Direction 1a — Compact Spotlight Card

### Continue Watching
A contained horizontal card (does NOT fill full width edge-to-edge) inside a padded section.

**Structure:**
- Section label: "CONTINUE WATCHING" in brand purple caps, 9.5px/700, spacing 0.16em
- Card: `display:flex`, `align-items:stretch`, background `rgba(255,255,255,0.03)`, border `1px solid rgba(255,255,255,0.07)`, border-radius 10px
  - Left accent bar: 3px wide, gradient `#c0392b → #7f1d1d` vertical
  - Poster: 78×118px, show gradient, border-radius 0 (flush)
  - Info column: flex:1, padding 14px 20px
    - Show title: 19px/700
    - Metadata: "Season 5 · Episode 4 · 44 min left" — 12.5px, rgba(255,255,255,0.38)
    - Progress bar: height 3px, track rgba(255,255,255,0.08), fill #7c3aed, label "30% watched" 11px below
  - Action column: flex-shrink:0, padding 0 22px, flex row gap 10px
    - Play button: 50×50px circle, background #7c3aed, font-size 19px, box-shadow
    - Stacked ghost buttons: "Details" + "Dismiss", 5px 13px padding, border-radius 6px
  - Pagination dots (top-right absolute): active dot 16×3px #7c3aed, inactive dots 5×3px rgba(255,255,255,0.18)

### Up Next
Horizontal scroll of **16:9 landscape thumbnails**.

- Section header row: "Up Next" 15px/700 + subtitle + "Browse series →" link right-aligned
- Cards: 196×110px, border-radius 7px
  - Active card: 2px border `#7c3aed`, box-sizing border-box
  - Episode badge top-left: active=#7c3aed background, inactive=rgba(0,0,0,0.5)
  - Play icon bottom-right: 26×26px circle, rgba(0,0,0,0.55)
  - Progress bar: 3px, absolutely positioned at bottom
  - Below card: show name 12.5px/600, episode count 11px/rgba(255,255,255,0.3)

---

## Direction 1b — Ambient Color Immersion

### Continue Watching
Full-bleed hero panel, 220px tall. No poster image — the show's accent color fills the background as a radial gradient wash.

**Background layers (bottom to top):**
1. Base: `#0a0808`
2. Radial gradient: `radial-gradient(ellipse 80% 120% at 50% 140%, rgba(192,57,43,0.65), rgba(127,29,29,0.3) 45%, transparent 75%)`
3. Secondary radial: `radial-gradient(ellipse 40% 80% at 18% 100%, rgba(192,57,43,0.22), transparent 60%)`

**Content (absolute positioned):**
- Top bar: section label left + [pagination dots + × dismiss button] right
- Bottom area: flex row, space-between, align flex-end
  - Left: giant show title 44px/800, letter-spacing -0.035em, line-height 0.95, text-shadow `0 2px 32px rgba(0,0,0,0.6)`; metadata below
  - Right: action buttons row — "▶ Continue S5E4" (primary), "Details" (ghost), "✓" icon-only (ghost 40×40px)
- Bottom edge: 2px progress line, full width, track rgba(255,255,255,0.06), fill rgba(192,57,43,0.8) at 30%

### Up Next
Tall **poster-ratio cards** (138×196px) with title overlaid at the bottom.

- Border-radius 9px
- Active card: 2px border rgba(192,57,43,0.7), box-shadow `0 8px 28px rgba(192,57,43,0.3)`
- Gradient overlay: `linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 55%)`
- Episode badge: top-left, active uses show accent color, inactive uses rgba(0,0,0,0.5)
- Bottom overlay: show name 12px/700, progress bar 2px
- Ghost "add" card at end: 138×196px, dashed border rgba(255,255,255,0.08), "+" center

---

## Direction 1c — Watchlist Queue + List Shelf

### Continue Watching
Two-column panel, total height 188px.

**Left column (320px fixed):** Vertical list of in-progress shows (inbox/queue style)
- Active row: background rgba(124,58,237,0.1), left border 2px solid #7c3aed
- Inactive rows: transparent, left border 2px transparent
- Each row: flex, gap 12px, padding 10px 18px
  - Poster thumbnail: 46×64px, border-radius 5px
  - Info: show name 13px, episode 11px/rgba(255,255,255,0.35), progress bar 2px
  - Time remaining: 11px, active=rgba(124,58,237,0.7), inactive=rgba(255,255,255,0.22)

**Right column (flex:1):** Featured preview of the active show
- Background: dark gradient `#150808 → #220d0d → #1a0909` + radial accent glow
- Content: show name 22px/800, metadata 12px; action buttons (Continue + Details + ✓)

Divider between sections: 1px solid rgba(255,255,255,0.05) bottom border on the panel.

### Up Next
**Compact list rows** (no horizontal scroll). Each row is a flex container:
- Thumbnail: 48×68px poster, border-radius 5px
- Info: show name 13px, "S05E04 · 52 / 56 eps" 11px, progress bar 2px (max-width 240px)
- Time remaining: 11px right-aligned
- Play button: 34×34px circle, active=#7c3aed with shadow, inactive=rgba(255,255,255,0.07) ghost
- Row padding: 9px 10px, border-radius 8px
- Active row: background rgba(124,58,237,0.07)

---

## Direction 1d — Split Wide + Episode-First Shelf

### Continue Watching
**60/40 horizontal split** panel.

**Left 60% (info + actions):**
- Section label top: "CONTINUE WATCHING"
- Show title: 32px/800, letter-spacing -0.03em
- Episode info: "Season 5, Episode 4 · 'The Beautiful Game' · 44 min left" 13px
- Progress: flex row with "30% watched" left + "52 / 56 episodes" right, then 4px tall progress bar, gradient fill `#7c3aed → #a855f7`
- Action row: "▶ Continue S5E4" primary + "Details" ghost + "✓" icon + "×" icon
- Button padding: 12px 24px (primary), 12px 18px (secondary), 12px 15px (icon), border-radius 9px

**Right 40% (mini-queue, "Also in progress"):**
- Header: "ALSO IN PROGRESS" 9px/700/uppercase, rgba(255,255,255,0.2)
- Mini rows: flex, gap 10px, padding 10px 18px, border-bottom 1px rgba(255,255,255,0.04)
  - Tiny poster: 32×46px, border-radius 4px
  - Info: show name 12px/600, "S4 E11 · 1h 2m left" 10.5px/rgba(255,255,255,0.3)
  - Play: 28×28px circle ghost button
- Footer: "+ 2 more in progress" ghost text button, centered

### Up Next
**Episode-first cards** — episode title is the primary label, show name is secondary. Cards use `flex:1` equal width (not fixed px).

Each card:
- Border-radius 10px, padding 14px
- Active card: background rgba(124,58,237,0.08), border 1px solid rgba(124,58,237,0.18)
- Inactive cards: background rgba(255,255,255,0.03), border 1px solid rgba(255,255,255,0.06)
- Inner layout: flex row, gap 10px
  - Poster: 40×56px, border-radius 5px
  - Text stack:
    1. Episode code "S05 · E04" — 10px/600/uppercase — active: #a78bfa, inactive: rgba(255,255,255,0.28)
    2. Episode title in quotes — 14px/700 — active: white, inactive: rgba(255,255,255,0.8)
    3. Show name — 11px — rgba(255,255,255,0.4)
    4. Progress bar — 2px
  - padding-right: 38px on text stack (to clear the abs-positioned play button)
- Play button: 30×30px circle, absolute top-right (12px, 12px), active=#7c3aed with shadow, inactive=ghost

---

## Interactions & Behavior

### Continue Watching — shared across all directions
- **Play button / "Continue" CTA:** resumes playback from the saved timestamp, navigates to the player screen
- **Details button:** navigates to the show's detail/info page
- **Dismiss / ✓ button:** removes the show from the Continue Watching row (with an undo toast)
- **× button:** same as dismiss
- **Pagination dots (1a):** clicking a dot cycles to the next in-progress show; the card animates to the new show
- **Queue row click (1c, 1d right panel):** clicking an inactive row makes it the active/featured show without navigating away; the right panel animates to reflect the new show's colors

### Up Next — shared
- **Card click:** navigates to the show's detail page
- **Play button on card:** resumes playback directly, same as the Continue CTA
- **Horizontal scroll:** rows are scrollable; show overflow: hidden on the container and handle pointer drag/touch swipe
- **"Browse series →" link:** navigates to the user's full watchlist/library

### Active/hover states (implement with your interaction system)
- Cards: on hover, slight brightness increase (filter: brightness(1.08)) or scale(1.02)
- Buttons: primary darkens 8%; ghost increases opacity of background to rgba(255,255,255,0.1)
- Play circle buttons: scale(1.08) on hover

---

## State Management

Each section needs:
```
continueWatchingShows: Show[]        // ordered, first = active/featured
upNextShows: Show[]                  // ordered by last-watched

interface Show {
  id: string
  title: string
  posterUrl: string
  accentColor: string               // extracted from poster
  currentSeason: number
  currentEpisode: number
  currentEpisodeTitle?: string      // used in 1d only
  progressPercent: number           // 0-100
  remainingMinutes: number
  totalEpisodes: number
  watchedEpisodes: number
}
```

For direction 1c: also track `activeQueueIndex: number` (which show is featured in the right panel).

Dismiss action: remove from `continueWatchingShows`, surface undo toast for ~5s.

---

## Assets
- Show poster/thumbnail images: pulled from existing media API — replace gradient placeholders with `<img>` tags using the show's artwork URL
- Accent/ambient color: derive dynamically from the poster image using a color-extraction library (e.g. `colorthief` or server-side dominant color endpoint)
- Play icon (▶): use existing icon system; the prototype uses the unicode character as a placeholder

---

## Files
| File | Description |
|---|---|
| `Library Sections Explorations.dc.html` | Interactive HTML prototype with all 4 directions; toggle buttons hide/show each one |

Open the HTML file in a browser to compare all four directions side by side. Use the toggle buttons at the top to show/hide individual directions.
