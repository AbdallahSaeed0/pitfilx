import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { getSettings, saveSettings, type PitflixSettings } from "../../api/settings";
import { useActivePlayerStore } from "../../store/activePlayerStore";
import { cn } from "../../utils/cn";

/** Mirrors the Rust `HdrCapability` struct returned by the `check_hdr_capability` Tauri command. */
type HdrCapability = {
  webview2_sufficient: boolean;
  os_hdr_enabled: boolean;
  true_hdr_available: boolean;
};

type HdrMode = "auto" | "true_hdr" | "tonemap_sdr";

const HDR_MODE_OPTIONS: { value: HdrMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "true_hdr", label: "True HDR" },
  { value: "tonemap_sdr", label: "Tonemap to SDR" },
];

/**
 * Opt-in embedded-player playback quality toggles: True HDR passthrough and Dolby/DTS audio
 * passthrough. Both default off/auto and only affect the embedded (libmpv-in-window) player —
 * see `src-tauri/src/player/quality_enhancement.rs` for the Rust side.
 */
export function PlaybackQualitySettings() {
  const [hdrMode, setHdrModeState] = useState<HdrMode>("auto");
  const [audioPassthrough, setAudioPassthroughState] = useState(false);
  const [capability, setCapability] = useState<HdrCapability | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const isPlaybackActive = useActivePlayerStore((s) => s.launchState != null);

  useEffect(() => {
    let cancelled = false;
    void getSettings().then((s: PitflixSettings) => {
      if (cancelled) return;
      setHdrModeState(s.hdrMode ?? "auto");
      setAudioPassthroughState(s.audioPassthrough ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void invoke<HdrCapability>("check_hdr_capability")
      .then((cap) => {
        if (!cancelled) setCapability(cap);
      })
      .catch(() => {
        if (!cancelled) setCapability(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  function announceChange() {
    if (isPlaybackActive) setToast("Change will apply on next playback");
  }

  function persist(next: { hdrMode?: HdrMode; audioPassthrough?: boolean }) {
    setBusy(true);
    void saveSettings(next).finally(() => setBusy(false));
    announceChange();
  }

  const trueHdrDisabled = capability != null && !capability.true_hdr_available;
  const trueHdrDisabledReason = !capability
    ? undefined
    : !capability.webview2_sufficient
      ? "WebView2 version too old for True HDR."
      : !capability.os_hdr_enabled
        ? "Windows HDR is off — turn it on in Display settings to use True HDR."
        : undefined;

  return (
    <section className="mt-6 rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
      <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
        <Sparkles className="h-4 w-4 text-pitflix-primary" strokeWidth={2} />
        Playback Quality
      </h2>
      <p className="mt-1 text-[10px] text-pitflix-subtle">
        Opt-in quality features for the Pitflix Player (embedded). Off by default — safe to leave alone.
      </p>

      {/* HDR Mode row */}
      <div className="mt-5">
        <p className="text-xs font-semibold text-white">HDR Mode</p>
        <div className="mt-2 flex w-fit gap-1 rounded-xl border border-white/10 bg-pitflix-bg p-1">
          {HDR_MODE_OPTIONS.map((opt) => {
            const isTrueHdr = opt.value === "true_hdr";
            const disabled = isTrueHdr && trueHdrDisabled;
            const active = hdrMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled || busy}
                title={disabled ? trueHdrDisabledReason : isTrueHdr
                  ? "Requires Windows HDR enabled and a compatible display. If subtitles or controls disappear, switch to Tonemap."
                  : undefined}
                onClick={() => {
                  setHdrModeState(opt.value);
                  persist({ hdrMode: opt.value });
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-35",
                  active && !disabled
                    ? "bg-pitflix-primary text-white shadow-[0_0_14px_rgba(139,92,246,0.3)]"
                    : "text-pitflix-muted hover:text-white",
                )}
              >
                {isTrueHdr ? (
                  <AlertTriangle
                    className={cn("h-3 w-3", disabled ? "text-amber-400" : "text-amber-300/80")}
                  />
                ) : null}
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Audio Passthrough row */}
      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-white">Audio Passthrough</p>
          <button
            type="button"
            role="switch"
            aria-checked={audioPassthrough}
            disabled={busy}
            onClick={() => {
              const next = !audioPassthrough;
              setAudioPassthroughState(next);
              persist({ audioPassthrough: next });
            }}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
              audioPassthrough ? "bg-pitflix-primary" : "bg-white/10",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                audioPassthrough ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
        {audioPassthrough ? (
          <p className="mt-2 text-[10px] text-pitflix-subtle">
            Requires HDMI or optical connection to a Dolby Atmos / DTS-capable receiver or soundbar.
          </p>
        ) : null}
      </div>

      {toast ? (
        <p className="mt-4 w-fit rounded-lg border border-pitflix-primary/35 bg-pitflix-primary/15 px-3 py-1.5 text-[11px] font-medium text-white">
          {toast}
        </p>
      ) : null}
    </section>
  );
}
