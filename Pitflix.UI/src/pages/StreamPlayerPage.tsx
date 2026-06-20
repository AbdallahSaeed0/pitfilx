import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { getLibraryWatchTarget } from "../api/library";
import { setEpisodeWatchStatus } from "../api/episodes";
import { setMovieWatchStatus } from "../api/watch";
import { markWatchedEntry } from "../api/history";
import { useAppPrefsStore } from "../store/appPrefsStore";

export type StreamLibraryWatchMeta = {
  tmdbId: number;
  mediaType: "Movie" | "Series";
  season?: number;
  episode?: number;
};

export type StreamPlayerReturnToDetails = {
  tmdbId: number;
  mediaType: "Movie" | "Series";
  title?: string;
  posterUrl?: string | null;
  year?: string | null;
  imdbId?: string | null;
};

export type StreamPlayerLocationState = {
  streamUrl: string;
  title?: string;
  libraryWatchMeta?: StreamLibraryWatchMeta;
  /** Poster URL — stored for unified watch tracking when item is not in library */
  posterUrl?: string | null;
  /** IMDb ID — passed through for unified watch tracking */
  imdbId?: string | null;
  /** When set, Back navigates directly to stream-details instead of history -1 */
  returnToDetails?: StreamPlayerReturnToDetails;
};

function isAllowedStreamEmbedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname === "streamimdb.ru" && u.pathname.startsWith("/embed/")) return true;
    if (u.hostname === "www.youtube.com" && u.pathname.startsWith("/embed/")) return true;
    if (u.hostname === "corsflix.net") return true;
    return false;
  } catch {
    return false;
  }
}

async function openExternal(url: string) {
  try {
    if (isTauri()) await openUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function StreamPlayerPage() {
  const offlineMode = useAppPrefsStore((s) => s.offlineMode);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const state = location.state as StreamPlayerLocationState | null;
  const streamUrl      = state?.streamUrl ?? "";
  const title          = state?.title?.trim() || "Online stream";
  const libraryMeta    = state?.libraryWatchMeta;
  const posterUrl      = state?.posterUrl ?? null;
  const imdbId         = state?.imdbId ?? null;
  const returnToDetails = state?.returnToDetails ?? null;

  const [embedFailed, setEmbedFailed] = useState(false);
  const autoOpenedRef = useRef(false);
  const [markBusy, setMarkBusy] = useState(false);
  const [markFeedback, setMarkFeedback] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEmbedFailed(false);
    autoOpenedRef.current = false;
    setMarkFeedback(null);
  }, [streamUrl]);

  useEffect(() => {
    if (!embedFailed || autoOpenedRef.current || !streamUrl) return;
    autoOpenedRef.current = true;
    void openExternal(streamUrl);
  }, [embedFailed, streamUrl]);

  // Track native fullscreen state
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerRef.current) {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // Fallback: use Tauri native window fullscreen
      if (isTauri()) {
        try {
          const win = getCurrentWindow();
          const current = await win.isFullscreen();
          await win.setFullscreen(!current);
          setIsFullscreen(!current);
        } catch {
          // ignore
        }
      }
    }
  }, []);

  const onMarkLibraryWatched = useCallback(async () => {
    if (!libraryMeta || markBusy) return;
    setMarkBusy(true);
    setMarkFeedback(null);
    let markedInLibrary = false;
    try {
      const target = await getLibraryWatchTarget({
        tmdbId: libraryMeta.tmdbId,
        mediaType: libraryMeta.mediaType,
        season: libraryMeta.season,
        episode: libraryMeta.episode,
      });
      if (target.matched) {
        if (libraryMeta.mediaType === "Movie" && target.movieId != null) {
          await setMovieWatchStatus(target.movieId, "Completed");
          markedInLibrary = true;
        } else if (libraryMeta.mediaType === "Series" && target.episodeId != null) {
          await setEpisodeWatchStatus(target.episodeId, "Completed");
          markedInLibrary = true;
        }
      }
    } catch {
      /* library update failed — still record in unified history below */
    }

    // Always record in unified watch history so stats count this watch
    // even when the title is not (or no longer) in the library.
    try {
      await markWatchedEntry({
        tmdbId: libraryMeta.tmdbId,
        imdbId,
        mediaType: libraryMeta.mediaType,
        title,
        posterUrl,
        source: "streaming",
        seasonNumber: libraryMeta.season ?? null,
        episodeNumber: libraryMeta.episode ?? null,
      });
    } catch {
      /* non-fatal */
    }

    void qc.invalidateQueries({ queryKey: ["watch-stats"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
    if (markedInLibrary) {
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["series"] });
    }
    setMarkFeedback(markedInLibrary ? "Marked watched — stats updated." : "Watch recorded in stats.");
    setMarkBusy(false);
  }, [libraryMeta, markBusy, qc, title, posterUrl, imdbId]);

  if (offlineMode) {
    return <Navigate to="/" replace />;
  }

  if (!streamUrl || !isAllowedStreamEmbedUrl(streamUrl)) {
    return <Navigate to="/online-stream" replace />;
  }

  return (
    <div ref={containerRef} className="flex h-screen min-h-0 flex-col bg-black">
      {/* Header — hidden in native fullscreen */}
      {!isFullscreen && (
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-pitflix-surface px-3 py-2">
          <button
            type="button"
            onClick={() => {
              if (returnToDetails) {
                navigate("/stream-details", { state: returnToDetails, replace: true });
              } else {
                navigate(-1);
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-white hover:bg-white/10"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{title}</div>
          {(libraryMeta != null) && (
            <button
              type="button"
              disabled={markBusy}
              onClick={() => void onMarkLibraryWatched()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:border-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {markBusy ? "Saving…" : "Mark watched"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            title="Toggle fullscreen"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-pitflix-card px-3 py-1.5 text-xs font-semibold text-white hover:border-pitflix-primary/50"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Fullscreen
          </button>
          <button
            type="button"
            onClick={() => void openExternal(streamUrl)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-pitflix-card px-3 py-1.5 text-xs font-semibold text-white hover:border-pitflix-primary/50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in browser
          </button>
          {markFeedback ? (
            <p className="w-full basis-full text-xs text-pitflix-subtle">{markFeedback}</p>
          ) : null}
        </header>
      )}

      {/* Exit fullscreen overlay button (shown only during fullscreen) */}
      {isFullscreen && (
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className="absolute right-4 top-4 z-50 inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-semibold text-white opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
          title="Exit fullscreen"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          Exit fullscreen
        </button>
      )}

      <div className="relative min-h-0 flex-1">
        {!embedFailed ? (
          <iframe
            title={title}
            src={streamUrl}
            className="h-full w-full border-0"
            width="100%"
            height="100%"
            allowFullScreen
            allow="fullscreen *; autoplay; encrypted-media; picture-in-picture"
            onError={() => setEmbedFailed(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-pitflix-bg px-6 text-center">
            <p className="text-sm font-semibold text-white">This embed cannot play in-app</p>
            <p className="max-w-md text-xs text-pitflix-subtle">
              The stream opened in your default browser. If it did not, use the button below.
            </p>
            <button
              type="button"
              onClick={() => void openExternal(streamUrl)}
              className="inline-flex items-center gap-2 rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-semibold text-white hover:bg-pitflix-light"
            >
              <ExternalLink className="h-4 w-4" />
              Open in browser
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
