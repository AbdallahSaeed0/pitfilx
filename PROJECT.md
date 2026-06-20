# Pitflix

A self-hosted media center desktop app for Windows. You point it at your local movie/TV folders and get a Netflix-style UI to browse, play, and track everything — backed by real metadata from TMDB, IMDb, and OMDB.

Built with a **Tauri + React** frontend and an **ASP.NET Core 8** backend, connected by a local REST API on `localhost:5280`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI shell | Tauri (Rust) + React 18 + TypeScript + Vite |
| Backend API | ASP.NET Core 8 (minimal API), .NET 8 |
| Database | SQLite via Entity Framework Core |
| Metadata | TMDB API, OMDB API, optional PHP IMDb scraper |
| Trailers | YouTube Data API, YouTube RSS, Invidious (privacy proxy) |
| Subtitles | OpenSubtitles API |

---

## Features

### Library Management
- Scans local folders recursively for movies and TV shows
- Auto-matches files to TMDB titles using fuzzy name parsing (handles `.` `_` `-` separators, year tokens, Arabic titles)
- Smart auto-match: batch resolves an entire unmatched queue automatically
- Manual TMDB re-match for misidentified titles
- Pinned folder scanning and auto-rescan on startup
- Excluded paths support
- Unmatched file queue with bulk-match and skip actions

### Metadata & Enrichment
- Full movie/series details: overview, genres, cast, crew, ratings, artwork
- Episode artwork synced per-season from TMDB (up to 60 images per page load)
- Cast backfill: profile photos and billing order fetched in background batches
- On-demand metadata refresh per title
- Crew cache stored locally to avoid repeated API calls
- Multi-source ratings: TMDB score, IMDb score (via OMDB or PHP scraper), per-episode IMDb ratings
- Background ratings refresh queue with hosted service

### Playback
- Cinematic player shell with custom timeline bar, skip controls, and keyboard shortcuts
- Resume playback (trusted resume policy)
- Episode navigation overlay with next-episode auto-advance
- Subtitle drawer (OpenSubtitles integration, local `.srt` support)
- Watch status tracking: watched / watching / unwatched per movie, show, and episode

### Home & Discovery
- Configurable home screen sections (Continue Watching, Coming Soon, Next Episodes, Latest Trailers, etc.)
- Hero card with backdrop, ratings, and quick-play
- Genre browse page
- "Similar titles" recommendations on detail pages (genre-based, local library)
- TMDB Discover feed: trending, popular, top-rated, upcoming (movies & TV)
- Recommendations page

### Trailers
- Automatic trailer ingestion from multiple sources:
  - TMDB native videos
  - Official YouTube channel RSS feeds
  - YouTube Data API search
  - Invidious (YouTube privacy proxy) search
- Trailer deduplication and priority ranking
- Curated priority provider (Official Trailer first)
- Background ingestion hosted service with configurable poll interval
- Trailer modal player in-app

### Awards
- Award hub with year navigation (Oscars, etc.)
- Per-edition hero, category tabs, nominee cards
- Winner recommendations: "you own this" badge on nominees in your library
- Awards cache preloaded at startup from local data files

### Online Streaming (Browse Mode)
- Browse TMDB titles without local files
- Streaming detail pages: trailer, cast, seasons, recommendations
- TV season/episode picker
- IMDb ID lookup for linking to external streaming sites

### User Lists
- Built-in lists: Watchlist, Favorites, etc.
- Custom user-created lists
- List detail page with grid view

### Stats & Settings
- Library stats page (counts, watch progress)
- Settings page: TMDB API key, library folders, excluded paths, OMDB key, OpenSubtitles credentials, trailer discovery toggles
- Setup wizard for first-run configuration
- GitHub update checker with in-app modal

### Localization
- Arabic title support throughout search, matching, and display
- Language-aware TMDB queries (`en-US` + `ar`)
