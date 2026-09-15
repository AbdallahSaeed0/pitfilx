import { AnimatePresence, motion } from "framer-motion";
import { Dices, Film, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/** One entry in the reel — generic so this same modal drives both the My Videos folder picker
 * (a plain imageUrl works fine) and My Device's "random video from this folder" version (which
 * needs the async LazyFolderThumb pipeline instead, via renderThumb). */
export type DeviceRouletteItem = {
  id: string;
  label: string;
  imageUrl?: string | null;
  /** Takes priority over imageUrl when given — e.g. LazyFolderThumb for a video file. */
  renderThumb?: () => React.ReactNode;
};

export type DeviceRouletteModalProps = {
  open: boolean;
  /** The pool to draw from — same list the Roulette button next to it draws from. */
  items: DeviceRouletteItem[];
  /** "actress", "category", or "video" — just for the subtitle copy. */
  kindLabel: string;
  onClose: () => void;
  onLanded: (id: string) => void;
};

// Same slot-machine reel mechanic as the Home page's Roulette (features/home/RouletteModal.tsx) —
// same geometry constants, same "extend the strip N laps past the winner, slide, decelerate" trick,
// just square folder tiles instead of poster art and no source-picking step (the pool here is
// already exactly "whatever tab you're on", so there's nothing to choose).
const SLIDER_ITEM_SIZE = 132;
const SLIDER_GAP = 14;
const SLIDER_STEP = SLIDER_ITEM_SIZE + SLIDER_GAP;
const SLIDER_VIEWPORT_W = 700;
const SLIDER_CENTER_OFFSET = SLIDER_VIEWPORT_W / 2 - SLIDER_ITEM_SIZE / 2;
const SLIDE_DURATION_MS = 3800;

function sliderOffsetForIndex(index: number): number {
  return SLIDER_CENTER_OFFSET - index * SLIDER_STEP;
}

export function DeviceRouletteModal({ open, items, kindLabel, onClose, onLanded }: DeviceRouletteModalProps) {
  const [spinning, setSpinning] = useState(false);
  const [landedIndex, setLandedIndex] = useState<number | null>(null);
  const [sliderItems, setSliderItems] = useState<DeviceRouletteItem[]>([]);
  const [sliderOffset, setSliderOffset] = useState(0);
  const [sliderAnimate, setSliderAnimate] = useState(false);

  const timeoutRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const clearSpinTimer = () => {
    if (timeoutRef.current != null) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (rafRef.current != null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  };

  const runSpin = () => {
    if (items.length === 0) return;
    clearSpinTimer();
    setSpinning(true);
    setLandedIndex(null);

    const winnerIndex = Math.floor(Math.random() * items.length);

    if (items.length === 1) {
      setSliderItems(items);
      setSliderAnimate(false);
      setSliderOffset(sliderOffsetForIndex(0));
      setSpinning(false);
      setLandedIndex(0);
      return;
    }

    // Build a long strip that repeats the pool a few laps' worth, ending exactly on the winner, plus
    // a short trailing run so a few "next" tiles are still visible past the landing spot.
    const laps = items.length <= 6 ? 5 : items.length <= 20 ? 3 : items.length <= 60 ? 2 : 1;
    const targetIndex = laps * items.length + winnerIndex;
    const trailing = Math.min(items.length - 1, 6);
    const extendedLen = targetIndex + trailing + 1;
    const extended = Array.from({ length: extendedLen }, (_, i) => items[i % items.length]!);

    setSliderItems(extended);
    setSliderAnimate(false);
    setSliderOffset(sliderOffsetForIndex(0));

    // Two rAFs: the first commits the "snapped to start, no transition" frame, the second flips the
    // transition on and moves the target offset — guarantees the browser paints the reset before sliding.
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = window.requestAnimationFrame(() => {
        setSliderAnimate(true);
        setSliderOffset(sliderOffsetForIndex(targetIndex));
      });
    });

    timeoutRef.current = window.setTimeout(() => {
      setSpinning(false);
      setLandedIndex(winnerIndex);
    }, SLIDE_DURATION_MS + 80);
  };

  // Auto-starts the spin the moment the modal opens — there's no "choose sources" step to wait on
  // here (unlike Home's version), since the pool is already exactly "this tab's folders".
  useEffect(() => {
    if (open) runSpin();
    else clearSpinTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => clearSpinTimer(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !spinning) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, spinning]);

  const landed = useMemo(() => {
    if (spinning || landedIndex == null) return null;
    return items[landedIndex] ?? null;
  }, [spinning, landedIndex, items]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          style={{ position: "fixed", inset: 0, zIndex: 240, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(2px)", padding: 16 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={spinning ? undefined : onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            style={{ width: "100%", maxWidth: 780, display: "flex", flexDirection: "column", borderRadius: 16, background: "#1C1C1C", border: "1px solid rgba(124,58,237,0.25)", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "20px 28px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 700, color: "#e0e0f0", margin: 0 }}>
                  <Dices style={{ width: 22, height: 22, color: "#7c3aed" }} />
                  Roulette
                </h2>
                <p style={{ marginTop: 6, fontSize: 13, color: "rgba(180,180,220,0.5)" }}>
                  {spinning ? "Spinning…" : `Landed on a random ${kindLabel}.`}
                </p>
              </div>
              <button type="button" onClick={spinning ? undefined : onClose} disabled={spinning} style={{ background: "transparent", border: "none", color: "rgba(200,200,235,0.5)", cursor: spinning ? "default" : "pointer", opacity: spinning ? 0.4 : 1 }}>
                <X style={{ width: 17, height: 17 }} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 28px" }}>
              {landed ? (
                <div style={{ marginBottom: 20, width: "100%", display: "flex", alignItems: "center", gap: 14, borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(124,58,237,0.4)", background: "rgba(124,58,237,0.1)" }}>
                  <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 10, overflow: "hidden", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {landed.renderThumb ? landed.renderThumb() : landed.imageUrl ? (
                      <img src={landed.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
                    ) : (
                      <Film style={{ width: 24, height: 24, color: "rgba(180,180,220,0.25)" }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 16, fontWeight: 700, color: "#e0e0f0", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{landed.label}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { onLanded(landed.id); onClose(); }}
                    style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, color: "white", background: "#7c3aed", border: "none", cursor: "pointer" }}
                  >
                    <Play style={{ width: 14, height: 14 }} fill="currentColor" />
                    Open
                  </button>
                </div>
              ) : (
                <div style={{ marginBottom: 20, height: 76, width: "100%" }} />
              )}

              <div style={{ position: "relative", margin: "0 auto", overflow: "hidden", borderRadius: 12, background: "rgba(0,0,0,0.3)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)", width: SLIDER_VIEWPORT_W, height: SLIDER_ITEM_SIZE + 20 }}>
                {/* Center landing marker */}
                <div
                  style={{
                    pointerEvents: "none", position: "absolute", top: "50%", zIndex: 20, transform: "translateY(-50%)", borderRadius: 10,
                    left: SLIDER_CENTER_OFFSET - 3, width: SLIDER_ITEM_SIZE + 6, height: SLIDER_ITEM_SIZE + 6,
                    boxShadow: spinning ? "0 0 0 2px rgba(255,255,255,0.3)" : "0 0 0 2px #7c3aed, 0 0 24px rgba(124,58,237,0.55)",
                    transition: "box-shadow 0.2s",
                  }}
                />
                {/* Edge fades so the reel reads as continuous, not clipped */}
                <div style={{ pointerEvents: "none", position: "absolute", inset: "0 auto 0 0", zIndex: 10, width: 80, background: "linear-gradient(to right, #1C1C1C, transparent)" }} />
                <div style={{ pointerEvents: "none", position: "absolute", inset: "0 0 0 auto", zIndex: 10, width: 80, background: "linear-gradient(to left, #1C1C1C, transparent)" }} />

                <div
                  style={{
                    display: "flex", height: "100%", alignItems: "center", gap: SLIDER_GAP,
                    transform: `translateX(${sliderOffset}px)`,
                    transition: sliderAnimate ? `transform ${SLIDE_DURATION_MS}ms cubic-bezier(0.1,0.7,0.15,1)` : "none",
                  }}
                >
                  {sliderItems.map((item, i) => (
                    <div key={`${item.id}-${i}`} style={{ flexShrink: 0, overflow: "hidden", borderRadius: 8, background: "rgba(255,255,255,0.04)", width: SLIDER_ITEM_SIZE, height: SLIDER_ITEM_SIZE, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {item.renderThumb ? item.renderThumb() : item.imageUrl ? (
                        <img src={item.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
                      ) : (
                        <Film style={{ width: 22, height: 22, color: "rgba(180,180,220,0.25)" }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "16px 28px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <button
                type="button"
                disabled={spinning}
                onClick={runSpin}
                style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, color: "rgba(224,224,240,0.8)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", cursor: spinning ? "not-allowed" : "pointer", opacity: spinning ? 0.5 : 1 }}
              >
                <RotateCcw style={{ width: 14, height: 14 }} />
                Spin again
              </button>
              <button
                type="button"
                disabled={spinning}
                onClick={onClose}
                style={{ borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, color: "rgba(224,224,240,0.8)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", cursor: spinning ? "not-allowed" : "pointer", opacity: spinning ? 0.5 : 1 }}
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
