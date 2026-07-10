import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Compass, X } from "lucide-react";
import { cancelBrowseDownload, getBrowseDownloadStatus, postBrowseDownload } from "../../api/webBrowse";
import { cn } from "../../utils/cn";
import { BrowseDownloadToast, type BrowseToastState } from "./BrowseDownloadToast";

type DownloadRequestEvent = {
  url: string;
  type: "image" | "video" | "hls";
  pageUrl: string;
};

const DOWNLOAD_POLL_MS = 800;

const RESIZE_DEBOUNCE_MS = 96;

export function BrowsePage() {
  const [addressInput, setAddressInput] = useState("");
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<BrowseToastState | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const isOpenRef = useRef(false);
  const resizeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const currentBounds = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width <= 1 || height <= 1) return null;
    return { x: Math.round(rect.left), y: Math.round(rect.top), width, height };
  }, []);

  const openOrNavigate = useCallback(
    async (rawUrl: string) => {
      const bounds = currentBounds();
      if (!bounds) return;
      let target = rawUrl.trim();
      if (!target) return;
      if (!/^https?:\/\//i.test(target)) {
        target = `https://${target}`;
      }

      setError(null);
      try {
        if (isOpenRef.current) {
          await invoke("browse_navigate", { url: target });
        } else {
          await invoke("browse_open", { url: target, ...bounds });
          setIsOpen(true);
        }
        setCurrentUrl(target);
      } catch (e) {
        setError(typeof e === "string" ? e : "Failed to open that page.");
      }
    },
    [currentBounds],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void openOrNavigate(addressInput);
    },
    [addressInput, openOrNavigate],
  );

  const handleClose = useCallback(() => {
    if (isOpenRef.current) {
      void invoke("browse_close").catch(() => {});
    }
    setIsOpen(false);
    setCurrentUrl(null);
    setAddressInput("");
    setError(null);
  }, []);

  // Keep the native child webview aligned with the container div.
  useEffect(() => {
    if (!isTauri()) return;
    const el = containerRef.current;
    if (!el) return;

    const scheduleResize = () => {
      if (!isOpenRef.current) return;
      if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        const bounds = currentBounds();
        if (bounds) void invoke("browse_resize", bounds).catch(() => {});
      }, RESIZE_DEBOUNCE_MS);
    };

    const ro = new ResizeObserver(scheduleResize);
    ro.observe(el);
    window.addEventListener("resize", scheduleResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", scheduleResize);
      if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current);
    };
  }, [currentBounds]);

  // Rust -> JS: a download button was clicked inside the embedded page.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    let pollTimer: number | null = null;

    // Every download (image, direct video, or HLS remux) runs as a background
    // job on the backend and the initial POST returns immediately — poll for
    // progress/completion instead of blocking.
    const pollJob = (jobId: string, label: string) => {
      void getBrowseDownloadStatus(jobId)
        .then((status) => {
          if (cancelled) return;
          if (status.status === "running") {
            setToast({ kind: "pending", message: label, jobId, progressPercent: status.progressPercent });
            pollTimer = window.setTimeout(() => pollJob(jobId, label), DOWNLOAD_POLL_MS);
            return;
          }
          if (status.status === "cancelled") {
            setToast({ kind: "error", message: "Download cancelled" });
            return;
          }
          setToast(
            status.status === "succeeded"
              ? { kind: "success", message: `Saved ${status.savedPath ?? "file"}` }
              : { kind: "error", message: status.error ?? "Download failed" },
          );
        })
        .catch(() => {
          if (!cancelled) setToast({ kind: "error", message: "Download failed" });
        });
    };

    void listen<DownloadRequestEvent>("browse-download-request", (ev) => {
      const { url, type, pageUrl } = ev.payload;
      const label = type === "image" ? "Downloading image…" : "Downloading video…";
      void postBrowseDownload({ url, type, pageUrl })
        .then((res) => {
          if (cancelled) return;
          if (res.pending && res.jobId) {
            pollJob(res.jobId, label);
            return;
          }
          setToast(
            res.success
              ? { kind: "success", message: `Saved ${res.savedPath ?? "file"}` }
              : { kind: "error", message: "Download failed" },
          );
        })
        .catch(() => {
          if (!cancelled) setToast({ kind: "error", message: "Download failed" });
        });
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      void unlisten?.();
    };
  }, []);

  const handleCancelDownload = useCallback((jobId: string) => {
    void cancelBrowseDownload(jobId).catch(() => {});
  }, []);

  // Close the native webview when navigating away from this page entirely.
  useEffect(() => {
    return () => {
      if (isOpenRef.current) {
        void invoke("browse_close").catch(() => {});
      }
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2">
          <Compass className="h-4 w-4 shrink-0 text-pitflix-muted" />
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="Paste a link to browse…"
            className="w-full bg-transparent text-sm text-white placeholder:text-pitflix-subtle focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-pitflix-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:brightness-110"
        >
          Go
          <ArrowRight className="h-4 w-4" />
        </button>
        {isOpen ? (
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close browse tab"
            className="flex shrink-0 items-center justify-center rounded-lg border border-pitflix-card p-2 text-pitflix-muted transition-colors hover:bg-pitflix-card hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </form>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      {/* Rendered here (above the container), never below it — see the
          component doc comment for why it can't float over the webview. */}
      <BrowseDownloadToast state={toast} onDismiss={() => setToast(null)} onCancel={handleCancelDownload} />

      <div
        ref={containerRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-lg border border-pitflix-card bg-pitflix-bg",
        )}
      >
        {!isTauri() ? (
          <div className="flex h-full items-center justify-center text-sm text-pitflix-subtle">
            Browse is only available in the Pitflix desktop app.
          </div>
        ) : !currentUrl ? (
          <div className="flex h-full items-center justify-center text-sm text-pitflix-subtle">
            Paste a link above to start browsing.
          </div>
        ) : null}
      </div>
    </div>
  );
}
