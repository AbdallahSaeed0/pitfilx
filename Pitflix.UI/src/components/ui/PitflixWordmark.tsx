import { useEffect, useRef } from "react";

/**
 * Animated "PITFLIX" wordmark — each letter is a <rect> clipped to that
 * letter's glyph shape, translated up from below into place. Faithful port
 * of the design export's clip-path + translateY reveal (same ids, timing,
 * and easing), just driven by React refs instead of getElementById.
 */
const LETTER_IDS = ["r-p", "r-i1", "r-t", "r-f", "r-l", "r-i2", "r-x"] as const;
const DUR_MS = 1800;
const STAGGER_MS = 550;
/** Pause after the last letter settles before the reveal resets and replays. */
const LOOP_PAUSE_MS = 1500;
const CYCLE_MS = (LETTER_IDS.length - 1) * STAGGER_MS + DUR_MS + LOOP_PAUSE_MS;

type Props = {
  className?: string;
  /** Replays the reveal whenever this value changes (e.g. when the logo re-enters view). */
  playKey?: string | number;
};

export function PitflixWordmark({ className, playKey }: Props) {
  const rectRefs = useRef<Record<string, SVGRectElement | null>>({});

  useEffect(() => {
    const rects = LETTER_IDS.map((id) => rectRefs.current[id]).filter(
      (el): el is SVGRectElement => el != null,
    );
    if (rects.length === 0) return;

    rects.forEach((r) => {
      r.style.transition = "none";
      r.style.transform = "translateY(70px)";
      r.style.transformBox = "fill-box";
      r.style.transformOrigin = "50% 0%";
    });

    let raf1 = 0;
    let raf2 = 0;
    let loopTimer = 0;
    let stopped = false;

    const reveal = () => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          rects.forEach((r, i) => {
            r.style.transition = `transform ${DUR_MS}ms ${i * STAGGER_MS}ms cubic-bezier(0.22,1,0.36,1)`;
            r.style.transform = "translateY(0px)";
          });
        });
      });
    };

    const reset = () => {
      rects.forEach((r) => {
        r.style.transition = "none";
        r.style.transform = "translateY(70px)";
      });
    };

    const loop = () => {
      if (stopped) return;
      reveal();
      loopTimer = window.setTimeout(() => {
        if (stopped) return;
        reset();
        loopTimer = window.setTimeout(loop, 20);
      }, CYCLE_MS);
    };

    const startTimer = window.setTimeout(() => {
      void document.fonts.ready.then(loop);
    }, 300);

    return () => {
      stopped = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(loopTimer);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [playKey]);

  return (
    <svg viewBox="0 0 231 110" className={className} role="img" aria-label="Pitflix">
      <defs>
        <clipPath id="pf-fill-bounds">
          <rect x="-10" y="26" width="2000" height="70" />
        </clipPath>
        <clipPath id="pf-cp-p">
          <path
            transform="translate(0,26) scale(0.7)"
            clipRule="evenodd"
            d="M 0,0 L 0,100 L 12,100 L 12,54 C 32,54 54,46 54,27 C 54,8 32,0 12,0 Z M 15,8 L 15,46 L 46,27 Z"
          />
        </clipPath>
        <clipPath id="pf-cp-i1">
          <text x="40" y="96" style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 100 }}>
            I
          </text>
        </clipPath>
        <clipPath id="pf-cp-t">
          <text x="59.206" y="96" style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 100 }}>
            T
          </text>
        </clipPath>
        <clipPath id="pf-cp-f">
          <text x="95.609" y="96" style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 100 }}>
            F
          </text>
        </clipPath>
        <clipPath id="pf-cp-l">
          <text x="130.022" y="96" style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 100 }}>
            L
          </text>
        </clipPath>
        <clipPath id="pf-cp-i2">
          <text x="164.425" y="96" style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 100 }}>
            I
          </text>
        </clipPath>
        <clipPath id="pf-cp-x">
          <text x="183.632" y="96" style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 100 }}>
            X
          </text>
        </clipPath>
      </defs>

      <g clipPath="url(#pf-fill-bounds)">
        <rect
          ref={(el) => { rectRefs.current["r-p"] = el; }}
          x="0" y="26" width="38" height="70" fill="#7c3aed" clipPath="url(#pf-cp-p)"
        />
        <rect
          ref={(el) => { rectRefs.current["r-i1"] = el; }}
          x="39" y="26" width="21.2" height="70" fill="#7c3aed" clipPath="url(#pf-cp-i1)"
        />
        <rect
          ref={(el) => { rectRefs.current["r-t"] = el; }}
          x="58.2" y="26" width="38.4" height="70" fill="#7c3aed" clipPath="url(#pf-cp-t)"
        />
        <rect
          ref={(el) => { rectRefs.current["r-f"] = el; }}
          x="94.6" y="26" width="36.4" height="70" fill="#7c3aed" clipPath="url(#pf-cp-f)"
        />
        <rect
          ref={(el) => { rectRefs.current["r-l"] = el; }}
          x="129" y="26" width="36.4" height="70" fill="#7c3aed" clipPath="url(#pf-cp-l)"
        />
        <rect
          ref={(el) => { rectRefs.current["r-i2"] = el; }}
          x="163.4" y="26" width="21.2" height="70" fill="#7c3aed" clipPath="url(#pf-cp-i2)"
        />
        <rect
          ref={(el) => { rectRefs.current["r-x"] = el; }}
          x="182.6" y="26" width="42.6" height="70" fill="#7c3aed" clipPath="url(#pf-cp-x)"
        />
      </g>
    </svg>
  );
}
