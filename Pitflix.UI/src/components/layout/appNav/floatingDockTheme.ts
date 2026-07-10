/** Pitflix floating dock — active icon uses purple (per product; handoff Home orange replaced). */
export const FLOATING_DOCK_ACTIVE = {
  background: "linear-gradient(135deg, #7c3aed, #4c1d95)",
  boxShadow: "0 6px 28px rgba(124, 58, 237, 0.55)",
  borderColor: "transparent",
} as const;

export const FLOATING_DOCK_IDLE = {
  background: "rgba(255,255,255,0.07)",
  borderColor: "rgba(255,255,255,0.08)",
  boxShadow: "none",
} as const;

export const FLOATING_DOCK_BASE_SIZE = 44;
export const FLOATING_DOCK_BASE_ICON = 20;
/** Dock pill height — tall enough for 1.55× icons + tooltip row inside. */
export const FLOATING_DOCK_TRACK_HEIGHT = 112;
export const FLOATING_DOCK_SIGMA = 60;
export const FLOATING_DOCK_MAX_EXTRA = 0.55;
export const FLOATING_DOCK_SPRING_K = 300;
export const FLOATING_DOCK_SPRING_D = 22;
