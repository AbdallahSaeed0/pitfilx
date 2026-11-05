import { formatVideoDuration, useVideoDuration } from "./deviceDurations";

/** Bottom-right "12:34" chip over a video thumbnail. Renders nothing until the duration is known —
 *  the caller is responsible for kicking off the probe via `requestVideoDurations`. The parent must
 *  be `position: relative`. */
export function DeviceDurationBadge({ path, small = false }: { path: string; small?: boolean }) {
  const secs = useVideoDuration(path);
  if (secs == null) return null;
  return (
    <span
      style={{
        position: "absolute",
        right: small ? 4 : 6,
        bottom: small ? 4 : 6,
        zIndex: 3,
        pointerEvents: "none",
        background: "rgba(0,0,0,0.78)",
        color: "#f0f0fa",
        fontSize: small ? 9 : 10,
        fontWeight: 700,
        letterSpacing: 0.2,
        fontVariantNumeric: "tabular-nums",
        padding: small ? "1px 4px" : "2px 6px",
        borderRadius: 4,
        lineHeight: 1.3,
      }}
    >
      {formatVideoDuration(secs)}
    </span>
  );
}
