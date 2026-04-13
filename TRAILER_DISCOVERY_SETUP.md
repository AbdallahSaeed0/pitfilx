# Trailer Discovery System - Setup Guide

## What Changed

The "Latest Trailers" section now **prioritizes unreleased (upcoming) titles** instead of showing already-released popular movies/shows.

### Key Improvements

1. **Unreleased-First Logic**
   - Collects trailers for unreleased titles (future air/release dates) separately
   - Fills the grid with unreleased trailers first
   - Only backfills with released titles if there aren't enough unreleased ones

2. **Pagination & Performance**
   - Reduced API calls from 560 to 240 (faster, less overhead)
   - Smarter candidate pool scanning

3. **Multiple Discovery Sources**
   - **RSS feeds** (YouTube channel Atom feeds - no API key needed)
   - **Invidious search** (unofficial JSON API - no API key needed)
   - **YouTube Data API v3** (official search - requires API key)

4. **Wider Windows for Upcoming Titles**
   - Released titles: 35-day trailer publish window
   - Unreleased titles: 105-day trailer publish window (catches early teasers)

---

## Configuration (`appsettings.json`)

### Basic Setup (No API Keys Required)

```json
{
  "TrailerDiscovery": {
    "EnableYoutubeRss": true,
    "RssMaxEntriesPerChannel": 12,
    "MaxRssTitlesToResolve": 28,
    "YoutubeChannelIds": [
      "UC3PaKrV0Z1oxQq7yEJih5KA",
      "UCp0rADOT9K4HrjpV6Cfr6YQ",
      "UCKvn9VBLtVvDr4nWKU6cHZA"
    ],
    "EnableInvidiousSearch": true,
    "InvidiousBaseUrl": "https://invidious.projectsegfau.lt",
    "MaxInvidiousResultsPerQuery": 15,
    "EnableYoutubeSearch": false,
    "YoutubeDataApiKey": "",
    "MaxYoutubeSearchResultsPerQuery": 12,
    "YoutubeSearchQueries": []
  }
}
```

### Advanced Setup (With YouTube Data API Key)

If you want official YouTube search (like typing "trailers" in YouTube):

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project
3. Enable **YouTube Data API v3**
4. Create an API key
5. Update config:

```json
{
  "TrailerDiscovery": {
    "EnableYoutubeSearch": true,
    "YoutubeDataApiKey": "YOUR_API_KEY_HERE",
    "YoutubeSearchQueries": [
      "official movie trailer 2026",
      "new tv series trailer official",
      "upcoming movie trailer"
    ]
  }
}
```

**Note:** YouTube Data API has quota limits (100 units per search call). Free tier = 10,000 units/day.

---

## Invidious Instances

Invidious instances are public YouTube frontends with JSON APIs. If one goes down, swap to another:

### Working Instances (as of April 2026)
- `https://invidious.projectsegfau.lt`
- `https://inv.nadeko.net`
- `https://invidious.privacyredirect.com`
- `https://invidious.fdn.fr`

Check current status: https://api.invidious.io/

---

## How to Verify It's Working

### 1. Check the Diagnostic Endpoint

Call: `GET http://localhost:5001/api/home/trailers/rss-status`

Example response:
```json
{
  "ok": true,
  "enabled": true,
  "channelsConfigured": 3,
  "rawEntriesFetched": 36,
  "resolvedToTmdb": 24,
  "channelErrors": [],
  "buildError": null,
  "youtubeSearchRawEntries": 0,
  "youtubeSearchError": null,
  "invidiousRawEntries": 45,
  "invidiousError": null
}
```

**Good signs:**
- `rawEntriesFetched` > 0 (RSS is fetching videos)
- `resolvedToTmdb` > 0 (titles are matching TMDB catalog)
- `invidiousRawEntries` > 0 (if Invidious is enabled)
- `channelErrors` is empty or small

**Bad signs:**
- `rawEntriesFetched` = 0 → RSS feeds failed or channel IDs are wrong
- `resolvedToTmdb` = 0 → Titles aren't matching TMDB (rare)
- `invidiousError` not null → Invidious instance is down (swap URL)

### 2. Check API Logs

When you call `/api/home/trailers/latest`, look for log lines like:

```
info: Trailer Invidious search: 45 video(s) from 3 quer(ies) via https://invidious.projectsegfau.lt
info: Trailer external discovery: 81 raw (invidious 45, official search 0) → 52 TMDB title(s)
```

### 3. Check the UI

Open the app → **Latest Trailers** section should now show:
- More **unreleased** titles (future release dates)
- Fewer already-released popular movies
- Trailers sorted by publish date (newest first)

---

## Troubleshooting

### "Latest Trailers" still shows old released movies

**Cause:** The candidate pool might not have enough unreleased titles with trailers.

**Fix:**
1. Increase `MaxRssTitlesToResolve` to 40-50
2. Enable Invidious search
3. Check if TMDB has trailers for upcoming titles (some don't have YouTube trailers yet)

### RSS returns 0 entries

**Cause:** YouTube channel IDs are wrong or feeds are blocked.

**Fix:**
1. Verify channel IDs are correct (visit `https://www.youtube.com/channel/{ID}`)
2. Check firewall/proxy isn't blocking `youtube.com`
3. Try different channel IDs

### Invidious returns error

**Cause:** Instance is down or overloaded.

**Fix:**
1. Swap `InvidiousBaseUrl` to a different instance (see list above)
2. Check https://api.invidious.io/ for working instances
3. Set `EnableInvidiousSearch: false` to disable temporarily

### YouTube Data API quota exceeded

**Cause:** Too many search queries or high `MaxYoutubeSearchResultsPerQuery`.

**Fix:**
1. Reduce `YoutubeSearchQueries` to 2-3 queries
2. Lower `MaxYoutubeSearchResultsPerQuery` to 8-10
3. Use Invidious instead (no quota limits)

---

## File Structure

```
Pitflix.API/Services/Trailers/
├── InvidiousSearchTrailerDiscovery.cs    # Invidious JSON API search
├── YoutubeDataApiTrailerDiscovery.cs     # Official YouTube Data API v3 search
├── YoutubeRssTrailerDiscovery.cs         # YouTube channel RSS feeds
├── ScrapedTrailerPoolBuilder.cs          # Orchestrates all sources + TMDB resolve
├── ScrapedTrailerTmdbResolver.cs         # Matches raw titles to TMDB catalog
├── TrailerTitleNormalizer.cs             # Cleans noisy YouTube titles
└── TrailerDiscoveryContracts.cs          # Shared types + diagnostics

Pitflix.API/Services/
└── TrailersFeedHelpers.cs                # Main trailer collection logic (unreleased-first)
```

---

## Summary

- **Restart your API** to pick up the changes
- **Enable Invidious** for best results (no API key needed)
- **Check `/api/home/trailers/rss-status`** to verify it's working
- **Swap Invidious instances** if one goes down
- **Latest Trailers now shows unreleased titles first**

Enjoy your improved trailer discovery!
