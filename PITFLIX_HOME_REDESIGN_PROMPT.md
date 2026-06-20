# Pitflix Home Page Redesign Prompt - Watching Currently & Continue Watching Sections

## Project Context
**Tech Stack:** Tauri + React/TypeScript + Rust backend + local database  
**Approach:** Refactor and redesign the first two sections on the Home page for better UX and visual appeal.

---

## Current State Analysis

From the uploaded screenshot, the current design has:

### "Watching Currently" Section
- Small horizontal cards with poster thumbnails
- Show title, season/episode info (Last S01E65, Next S01E65)
- Episode count (4/15 eps, 5/7 eps)
- Progress bar under episode info
- Purple "Continue" button on each card
- "Browse series >" link on the right

### "Continue Watching" Modal/Overlay
- Large poster on the left
- "CONTINUE WATCHING" label
- Episode title (11:00 A.M.)
- Season/Episode (S1 E5)
- Large progress bar
- "Continue S1E5" button
- "Done..." button
- Right side shows queue of next items

### Problems to Solve
1. Visual clutter - too much text in small cards
2. Redundant information between cards and modal
3. Poor information hierarchy
4. Progress indicators too small
5. Unclear navigation flow
6. Wasted space in modal layout
7. "Done..." button purpose unclear
8. Multiple "Continue" buttons create confusion

---

## Redesign Requirements

### Design Option 1: Hero Banner + Compact Carousel (Recommended)

#### 1.1 Featured "Continue Watching" Hero Banner

**Layout:**
- Single large hero section at the top of Home page
- Full-width backdrop image with gradient overlay
- Content positioned on left side
- Optional small poster on right side
- Height: ~400-500px
- Replaces both current "Watching currently" and "Continue Watching" sections

**Content Structure:**
```
┌─────────────────────────────────────────────────────────┐
│  [Backdrop Image with Gradient Overlay]                │
│                                                          │
│  CONTINUE WATCHING                                       │
│  The Pitt                                     [Poster]  │
│  S01E05 • 11:00 A.M.                                    │
│  ████████░░░░░░░░ 4/15 episodes                        │
│                                                          │
│  ▶ Continue S01E05    ℹ Details    ✓                   │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Automatically shows the most recently watched show/movie
- Prominent "Continue" button with episode number
- Progress bar showing episode progress AND total series progress
- Quick action buttons: Continue, Details, Mark as Watched
- Smooth fade-in animation on page load

**Component Structure:**
```typescript
// src/components/home/ContinueWatchingHero.tsx

interface ContinueWatchingHeroProps {
  item: {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    backdropPath: string;
    posterPath: string;
    // For TV shows
    lastWatchedEpisode?: { season: number; episode: number; title: string };
    nextEpisode?: { season: number; episode: number; title: string };
    episodeProgress?: number; // 0-100
    seriesProgress?: { current: number; total: number }; // e.g., 4/15 episodes
    // For movies
    movieProgress?: number; // 0-100
    runtime?: number;
  };
  onContinue: () => void;
  onDetails: () => void;
  onMarkWatched: () => void;
}
```

**Visual Elements:**
- Backdrop: 100% width, gradient from left (dark) to right (semi-transparent)
- Continue label: Small, uppercase, purple/accent color
- Title: Large (40-48px), bold, white
- Episode info: Medium (16-18px), light gray, with separator dots
- Progress bar: 
  - Primary bar: current episode progress (purple)
  - Secondary indicator: series progress text (4/15 episodes)
  - Height: 6-8px, rounded corners
- Buttons:
  - Primary "Continue": Large, purple background, white text, play icon
  - Secondary "Details": Outlined, transparent background
  - Icon button "Mark Watched": Small, circular, checkmark icon

---

#### 1.2 "Up Next" Compact Carousel

Below the hero banner, show other in-progress items:

**Layout:**
- Horizontal scrollable carousel
- Smaller cards (portrait posters)
- Max 5-6 visible at once
- "See All" link on the right

**Card Design:**
```
┌──────────┐
│  [Poster]│
│          │
│  ██░░░░  │ (small progress bar)
│ Euphoria │
│ S3E4     │
└──────────┘
```

**Component Structure:**
```typescript
// src/components/home/UpNextCarousel.tsx

interface UpNextItem {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string;
  progress: number;
  // For TV
  nextEpisode?: { season: number; episode: number };
  // For movies
  movieProgress?: number;
}

interface UpNextCarouselProps {
  items: UpNextItem[];
  onItemClick: (item: UpNextItem) => void;
}
```

**Features:**
- Hover effect: scale up slightly, show "Continue" overlay
- Progress bar at bottom of poster (2-3px height)
- Click to make it the featured hero item
- Episode badge (S3E4) overlaid on poster

---

### Design Option 2: Unified Compact Grid

Alternative simpler approach if hero banner feels too bold:

**Layout:**
- Keep horizontal scrollable approach
- Larger cards than current (medium size)
- Better spacing and typography
- Remove redundant modal

**Improved Card Design:**
```
┌────────────────────────────┐
│ [Backdrop Thumb] [Poster]  │
│                             │
│ The Pitt                    │
│ Next: S01E05 • 11:00 A.M.  │
│ ████████░░░░ 53%           │
│                             │
│ ▶ Continue      ⋮          │
└────────────────────────────┘
```

**Card Specs:**
- Width: 360-400px
- Height: 200-220px
- Backdrop thumbnail on left (16:9 ratio)
- Small poster overlaid on bottom-left of backdrop
- Title: Large, bold
- Episode info: One line, concise
- Progress bar: Prominent, with percentage
- Continue button: Full width or left-aligned
- Menu button (⋮): Quick actions (Details, Mark Watched, Remove)

---

## Implementation Tasks

### Phase 1: Create New Components

#### Task 1: ContinueWatchingHero Component
**File:** `src/components/home/ContinueWatchingHero.tsx`

Requirements:
- Fetch most recently watched item from watch_history
- Display backdrop with gradient overlay
- Show title, episode/movie info, progress
- Action buttons: Continue, Details, Mark as Watched
- Responsive layout (mobile: stack vertically, hide poster)
- Loading skeleton while fetching data
- Empty state if no items in progress

**Rust Backend:**
```rust
// src-tauri/src/services/watch_history.rs

pub async fn get_most_recent_in_progress() -> Result<Option<WatchHistoryItem>> {
    // Query watch_history for most recent item with progress < 100
    // Join with TMDB metadata if cached
    // Return full item details
}
```

**Tauri Command:**
```rust
#[tauri::command]
async fn get_continue_watching_hero() -> Result<Option<ContinueWatchingItem>, String>
```

---

#### Task 2: UpNextCarousel Component
**File:** `src/components/home/UpNextCarousel.tsx`

Requirements:
- Horizontal scrollable carousel
- Show 5-6 items at once
- Smooth scroll animations
- Hover effects on cards
- Click to promote item to hero position
- Progress bar overlay on posters
- Episode badge overlay

**Data Source:**
```rust
pub async fn get_in_progress_items(limit: usize, exclude_id: Option<i32>) -> Result<Vec<WatchHistoryItem>>
```

---

#### Task 3: Refactor Home Page
**File:** `src/pages/Home.tsx`

Changes:
1. Remove old "Watching currently" section
2. Remove "Continue Watching" modal
3. Add `<ContinueWatchingHero />` at top
4. Add `<UpNextCarousel />` below hero
5. Keep existing sections (recommendations, coming soon, etc.)

**Layout Order:**
```
Home Page
├── ContinueWatchingHero (if has in-progress items)
├── UpNextCarousel (if has multiple in-progress items)
├── ComingSoonSection
├── RecommendationsCarousel
├── PopularMoviesCarousel
└── ... (other existing sections)
```

---

### Phase 2: Styling & Animations

#### Task 4: Hero Banner Styles
**File:** `src/styles/ContinueWatchingHero.css`

Requirements:
- Backdrop image with `object-fit: cover`
- Gradient overlay: `linear-gradient(90deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 100%)`
- Content positioned with flexbox
- Responsive breakpoints:
  - Desktop (>1024px): Side-by-side layout
  - Tablet (768-1023px): Reduce padding, smaller text
  - Mobile (<768px): Stack vertically, full-width buttons
- Button hover states with smooth transitions
- Progress bar animation on mount

**Color Palette (Pitflix Dark Theme):**
- Primary Purple: `#a78bfa` (buttons, accents)
- Background: `#0f0f0f` or `#1a1a1a`
- Text Primary: `#ffffff`
- Text Secondary: `#d1d5db`
- Text Muted: `#6b7280`
- Progress Bar Background: `rgba(255, 255, 255, 0.2)`
- Progress Bar Fill: `#a78bfa` (purple gradient)

---

#### Task 5: Carousel Styles
**File:** `src/styles/UpNextCarousel.css`

Requirements:
- Horizontal scroll with hidden scrollbar (custom scrollbar on desktop)
- Card hover: `transform: scale(1.05)`, `box-shadow` increase
- Smooth scroll behavior
- Snap scroll points (optional)
- Progress bar: 3px height, absolute positioned at bottom
- Episode badge: positioned top-right, semi-transparent background

**Card Hover Effect:**
```css
.up-next-card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.up-next-card:hover {
  transform: scale(1.05) translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.up-next-card:hover .continue-overlay {
  opacity: 1;
}

.continue-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease;
}
```

---

### Phase 3: Logic & Interactions

#### Task 6: Continue Watching Logic

**User Flows:**

**Flow 1: Continue from Hero**
1. User clicks "Continue S01E05" on hero banner
2. App triggers existing playback function with:
   - `tmdbId`
   - `mediaType`
   - `seasonNumber` (if TV)
   - `episodeNumber` (if TV)
   - Resume from saved progress if <90%
3. On playback completion, update watch_history
4. Automatically advance to next episode for TV shows

**Flow 2: Switch Featured Item**
1. User clicks on item in "Up Next" carousel
2. Clicked item smoothly transitions to hero position
3. Previous hero item moves to carousel
4. Fade animation between items (0.3s duration)

**Flow 3: Mark as Watched**
1. User clicks checkmark icon on hero
2. Confirm modal: "Mark S01E05 as watched?"
3. On confirm:
   - Update watch_history progress to 100%
   - Auto-load next episode to hero position
   - Show brief success toast

**Flow 4: Remove from Continue Watching**
1. User clicks menu (⋮) on carousel card
2. Options: "Remove from Continue Watching", "Mark as Watched"
3. On remove:
   - Item fades out of carousel
   - Don't delete from watch_history (just filter out items with progress 0 or 100)

---

#### Task 7: Data Fetching & Caching

**Hook:** `src/hooks/useContinueWatching.ts`

```typescript
export function useContinueWatching() {
  const [heroItem, setHeroItem] = useState<ContinueWatchingItem | null>(null);
  const [upNextItems, setUpNextItems] = useState<UpNextItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadContinueWatching();
  }, []);

  const loadContinueWatching = async () => {
    setIsLoading(true);
    try {
      // Fetch hero item
      const hero = await invoke<ContinueWatchingItem | null>('get_continue_watching_hero');
      setHeroItem(hero);

      // Fetch up next items (exclude hero)
      if (hero) {
        const items = await invoke<UpNextItem[]>('get_in_progress_items', {
          limit: 10,
          excludeId: hero.tmdbId
        });
        setUpNextItems(items);
      }
    } catch (error) {
      console.error('Failed to load continue watching:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const promoteToHero = (item: UpNextItem) => {
    // Move clicked item to hero position
    if (heroItem) {
      setUpNextItems([...upNextItems.filter(i => i.tmdbId !== item.tmdbId), heroItem]);
    }
    setHeroItem(item as ContinueWatchingItem);
  };

  const removeItem = async (tmdbId: number) => {
    setUpNextItems(items => items.filter(i => i.tmdbId !== tmdbId));
    if (heroItem?.tmdbId === tmdbId) {
      // Promote first up-next item to hero
      if (upNextItems.length > 0) {
        setHeroItem(upNextItems[0] as ContinueWatchingItem);
        setUpNextItems(items => items.slice(1));
      } else {
        setHeroItem(null);
      }
    }
  };

  return {
    heroItem,
    upNextItems,
    isLoading,
    promoteToHero,
    removeItem,
    refresh: loadContinueWatching
  };
}
```

---

### Phase 4: Empty States & Error Handling

#### Task 8: Empty States

**No Continue Watching Items:**
```typescript
// src/components/home/ContinueWatchingEmpty.tsx

export function ContinueWatchingEmpty() {
  return (
    <div className="continue-watching-empty">
      <div className="empty-icon">📺</div>
      <h3>Nothing to continue watching</h3>
      <p>Start watching a movie or series to see it here</p>
      <button onClick={() => navigate('/browse')}>
        Browse Library
      </button>
    </div>
  );
}
```

**Styling:**
- Center-aligned
- Subtle background
- Friendly icon (large emoji or SVG)
- Clear call-to-action button

---

#### Task 9: Loading States

**Hero Skeleton:**
```typescript
// src/components/home/ContinueWatchingHeroSkeleton.tsx

export function ContinueWatchingHeroSkeleton() {
  return (
    <div className="watching-hero skeleton">
      <div className="skeleton-backdrop" />
      <div className="skeleton-content">
        <div className="skeleton-label" />
        <div className="skeleton-title" />
        <div className="skeleton-episode" />
        <div className="skeleton-progress" />
        <div className="skeleton-buttons">
          <div className="skeleton-button-primary" />
          <div className="skeleton-button-secondary" />
        </div>
      </div>
    </div>
  );
}
```

**Carousel Skeleton:**
- 5-6 placeholder cards
- Pulsing animation
- Correct aspect ratios

---

### Phase 5: Responsive Design

#### Task 10: Mobile Optimization

**Breakpoints:**
```css
/* Desktop: >1024px */
.watching-hero {
  height: 500px;
  padding: 48px;
}

.hero-content {
  flex-direction: row;
}

.show-title {
  font-size: 48px;
}

/* Tablet: 768px - 1023px */
@media (max-width: 1023px) {
  .watching-hero {
    height: 400px;
    padding: 32px;
  }

  .show-title {
    font-size: 36px;
  }

  .poster-small {
    display: none; /* Hide poster on tablet */
  }
}

/* Mobile: <768px */
@media (max-width: 767px) {
  .watching-hero {
    height: auto;
    min-height: 300px;
    padding: 24px;
  }

  .hero-content {
    flex-direction: column;
    align-items: flex-start;
  }

  .show-title {
    font-size: 28px;
  }

  .hero-actions {
    flex-direction: column;
    width: 100%;
  }

  .btn-primary,
  .btn-secondary {
    width: 100%;
    justify-content: center;
  }

  /* Carousel: single column scroll */
  .up-next-carousel {
    gap: 12px;
  }

  .up-next-card {
    min-width: 140px;
  }
}
```

---

## Accessibility Requirements

1. **Keyboard Navigation:**
   - Hero buttons: tabbable, Enter to activate
   - Carousel: Arrow keys to scroll, Enter to select
   - Focus indicators: visible outline

2. **Screen Readers:**
   - Hero section: `aria-label="Continue watching {title}"`
   - Progress bar: `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
   - Buttons: descriptive `aria-label`

3. **Reduced Motion:**
   ```css
   @media (prefers-reduced-motion: reduce) {
     .watching-hero,
     .up-next-card {
       transition: none;
     }
   }
   ```

---

## Testing Checklist

### Visual Tests
- [ ] Hero banner displays correctly with backdrop
- [ ] Gradient overlay is smooth and readable
- [ ] Progress bar animates on load
- [ ] Buttons have correct hover/active states
- [ ] Carousel scrolls smoothly
- [ ] Cards scale properly on hover
- [ ] Mobile layout stacks correctly
- [ ] Loading skeletons match final layout
- [ ] Empty state is friendly and clear

### Functional Tests
- [ ] Continue button starts playback
- [ ] Details button navigates to detail page
- [ ] Mark as watched updates database
- [ ] Clicking carousel item promotes to hero
- [ ] Remove item removes from carousel
- [ ] Auto-advance to next episode works
- [ ] Resume from saved progress works
- [ ] Data refreshes after playback completion

### Edge Cases
- [ ] Only 1 item in progress (no carousel)
- [ ] 0 items in progress (empty state)
- [ ] Very long titles (truncate with ellipsis)
- [ ] Missing backdrop image (fallback to solid color)
- [ ] Missing poster image (placeholder icon)
- [ ] Network error (retry button)
- [ ] Progress 100% items filtered out

---

## Performance Considerations

1. **Image Optimization:**
   - Use TMDB w780 for backdrops (not original)
   - Use w342 for posters in carousel
   - Lazy load carousel images
   - Preload hero backdrop

2. **Animation Performance:**
   - Use `transform` and `opacity` for animations (GPU-accelerated)
   - Avoid animating `width`, `height`, `margin`
   - Use `will-change` sparingly

3. **Data Fetching:**
   - Cache continue watching data for 30 seconds
   - Debounce refresh calls
   - Batch TMDB API requests

---

## Migration Plan

### Step 1: Feature Flag (Optional)
Add config to toggle between old and new design:
```typescript
// src/config/features.ts
export const FEATURES = {
  NEW_CONTINUE_WATCHING: true // Set to false to use old design
};
```

### Step 2: Gradual Rollout
1. Build new components alongside old ones
2. Test new design internally
3. A/B test with subset of users (if analytics available)
4. Full rollout after validation
5. Remove old components

### Step 3: Cleanup
- Delete old "Watching currently" component files
- Delete old "Continue Watching" modal files
- Remove unused CSS
- Update related documentation

---

## Future Enhancements (Post-Launch)

1. **Auto-play Next Episode:**
   - 10-second countdown after episode ends
   - "Still watching?" prompt every 3 episodes

2. **Multi-Profile Support:**
   - Separate continue watching per profile
   - Profile switcher in hero section

3. **Smart Shuffle:**
   - "Surprise Me" button that picks random in-progress item
   - Weighted by how recently watched

4. **Binge Mode:**
   - Toggle to auto-play next episode without countdown
   - "Binge Session" stats (hours watched in one sitting)

5. **Custom Order:**
   - Drag-and-drop to reorder "Up Next" carousel
   - Pin favorite shows to stay in carousel

---

## Code Quality Standards

- Use TypeScript strict mode
- Add JSDoc comments for complex functions
- Extract magic numbers to named constants
- Keep components under 200 lines (split if larger)
- Write unit tests for hooks and utilities
- Use semantic HTML (`<section>`, `<article>`, `<nav>`)
- Follow existing naming conventions
- Add error boundaries for component failures

---

## Design Assets Needed

If working with designer:
1. Backdrop gradient overlay (exact hex/rgba values)
2. Button styles (hover, active, disabled states)
3. Progress bar colors and gradients
4. Icon set (play, info, check, menu)
5. Loading skeleton shimmer animation
6. Empty state illustration/icon
7. Mobile layout mockups
8. Spacing/padding specifications

---

## Notes & Additional Resources

- Keep existing playback functionality intact
- Reuse current TMDB API integration
- Maintain watch_history tracking from Phase 1 of main prompt
- Test with real data from user libraries
- Monitor performance metrics after launch
- Collect user feedback for future iterations
