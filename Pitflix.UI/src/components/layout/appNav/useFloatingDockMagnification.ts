import { useEffect, useRef, type RefObject } from "react";
import {
  FLOATING_DOCK_BASE_ICON,
  FLOATING_DOCK_BASE_SIZE,
  FLOATING_DOCK_MAX_EXTRA,
  FLOATING_DOCK_SIGMA,
  FLOATING_DOCK_SPRING_D,
  FLOATING_DOCK_SPRING_K,
} from "./floatingDockTheme";

export type FloatingDockIconRefs = {
  wrapper: HTMLDivElement | null;
  bg: HTMLDivElement | null;
  icon: HTMLSpanElement | null;
};

type TooltipRefs = {
  root: HTMLDivElement | null;
  label: HTMLSpanElement | null;
};

export function useFloatingDockMagnification(
  trackRef: RefObject<HTMLElement | null>,
  iconRefs: RefObject<FloatingDockIconRefs[]>,
  labels: string[],
  tooltipRefs: RefObject<TooltipRefs>,
) {
  const mouseXRef = useRef<number | null>(null);
  const springsRef = useRef<{ pos: number; vel: number }[]>([]);
  const lastTRef = useRef<number | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const count = labels.length;
    springsRef.current = Array.from({ length: count }, (_, i) => springsRef.current[i] ?? { pos: 1, vel: 0 });

    const onMove = (e: MouseEvent) => {
      const r = track.getBoundingClientRect();
      mouseXRef.current = e.clientX - r.left;
    };
    const onLeave = () => {
      mouseXRef.current = null;
    };

    track.addEventListener("mousemove", onMove);
    track.addEventListener("mouseleave", onLeave);

    const tick = (time: number) => {
      const dt = Math.min((time - (lastTRef.current ?? time)) / 1000, 0.05);
      lastTRef.current = time;

      const icons = iconRefs.current;
      const dr = track.getBoundingClientRect();
      const centers = icons.map((refs) => {
        if (!refs?.wrapper) return 0;
        const r = refs.wrapper.getBoundingClientRect();
        return r.left - dr.left + r.width / 2;
      });

      let topIdx = -1;
      let topScale = 1.06;

      springsRef.current.forEach((sp, i) => {
        const mouseX = mouseXRef.current;
        const target =
          mouseX !== null
            ? 1.0 + FLOATING_DOCK_MAX_EXTRA * Math.exp(-((mouseX - centers[i]) ** 2) / (2 * FLOATING_DOCK_SIGMA ** 2))
            : 1.0;

        sp.vel += (FLOATING_DOCK_SPRING_K * (target - sp.pos) - FLOATING_DOCK_SPRING_D * sp.vel) * dt;
        sp.pos += sp.vel * dt;
        if (mouseX === null && Math.abs(sp.pos - 1) < 0.002 && Math.abs(sp.vel) < 0.003) {
          sp.pos = 1;
          sp.vel = 0;
        }

        const sz = Math.round(FLOATING_DOCK_BASE_SIZE * sp.pos);
        const svgSz = Math.round(FLOATING_DOCK_BASE_ICON * sp.pos);
        const refs = icons[i];
        if (refs?.bg) {
          refs.bg.style.width = `${sz}px`;
          refs.bg.style.height = `${sz}px`;
        }
        if (refs?.icon) {
          refs.icon.style.width = `${svgSz}px`;
          refs.icon.style.height = `${svgSz}px`;
        }

        if (sp.pos > topScale) {
          topScale = sp.pos;
          topIdx = i;
        }
      });

      const tip = tooltipRefs.current;
      if (tip?.root && tip?.label) {
        if (mouseXRef.current !== null && topIdx >= 0) {
          tip.root.style.opacity = "1";
          tip.root.style.left = `${centers[topIdx]}px`;
          tip.label.textContent = labels[topIdx] ?? "";
        } else {
          tip.root.style.opacity = "0";
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      track.removeEventListener("mousemove", onMove);
      track.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, [trackRef, iconRefs, labels, tooltipRefs]);
}
