import { motion, type TargetAndTransition, type Transition } from "framer-motion";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Sidebar / top-dock nav icons that animate the part of the icon that means something — the
 * clapper arm snaps, the compass needle swings to north, chart bars grow, the film strip rolls —
 * instead of shaking or spinning the whole glyph. Shapes are lucide-react's own (v0.469, ISC), split
 * into their parts so each part can move on its own, drawn with the same stroke settings so they
 * look identical to the static icons at rest.
 *
 * One-shot animations restart on every hover (remounted via `run`) and always play to the end even
 * if the pointer leaves mid-way, so nothing snaps back. Only the film strip and the globe loop, and
 * only while hovered.
 */
export type NavIconId =
  | "home"
  | "film"
  | "tv"
  | "sparkles"
  | "play"
  | "globe"
  | "compass"
  | "ticket"
  | "signal"
  | "calendarClock"
  | "trophy"
  | "clapper"
  | "list"
  | "drive"
  | "chart"
  | "settings";

type IconProps = { run: number; hovered: boolean; uid: string };

/**
 * One-shot keyframes on hover; motionless (and no mount animation) before the first hover. Replays
 * because AnimatedNavIcon remounts the icon (key = run) on every hover start.
 */
function once(run: number, keyframes: TargetAndTransition, transition: Transition) {
  return run > 0 ? { animate: keyframes, transition } : { initial: false as const, animate: {} };
}

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const center = { originX: 0.5, originY: 0.5 };

function HomeIcon({ run }: IconProps) {
  return (
    <>
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      {/* The door swings open on its left hinge, then closes. */}
      <motion.path
        d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
        style={{ originX: 0, originY: 1 }}
        {...once(run, { scaleX: [1, 0.2, 0.2, 1] }, { duration: 0.75, times: [0, 0.35, 0.6, 1] })}
      />
    </>
  );
}

function FilmIcon({ hovered, uid }: IconProps) {
  const clip = `nav-film-${uid}`;
  // Side sprocket marks, spaced 4.5 apart (one extra above) so shifting by 4.5 loops seamlessly.
  const ticks = [-1.5, 3, 7.5, 12, 16.5, 21];
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
        </clipPath>
      </defs>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18" />
      <path d="M17 3v18" />
      <path d="M7 12h10" />
      <g clipPath={`url(#${clip})`}>
        <motion.g
          animate={hovered ? { y: [0, 4.5] } : { y: 0 }}
          transition={hovered ? { duration: 0.32, ease: "linear", repeat: Infinity } : { duration: 0.2 }}
        >
          {ticks.map((y) => (
            <path key={y} d={`M3 ${y}h4M17 ${y}h4`} />
          ))}
        </motion.g>
      </g>
    </>
  );
}

function TvIcon({ run }: IconProps) {
  return (
    <>
      <rect width="20" height="15" x="2" y="7" rx="2" ry="2" />
      {/* Antenna wobbles from its base. */}
      <motion.polyline
        points="17 2 12 7 7 2"
        style={{ originX: 0.5, originY: 1 }}
        {...once(run, { rotate: [0, -16, 12, -7, 3, 0] }, { duration: 0.65 })}
      />
      {/* A scan line sweeps down the screen. */}
      <motion.path
        d="M5 10.5h14"
        strokeWidth={1.5}
        style={{ opacity: 0 }}
        {...once(run, { y: [0, 8.5], opacity: [0, 0.9, 0] }, { duration: 0.6, ease: "easeInOut" })}
      />
    </>
  );
}

function SparklesIcon({ run }: IconProps) {
  return (
    <>
      <motion.path
        d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
        style={center}
        {...once(run, { scale: [1, 0.82, 1.14, 1], rotate: [0, 0, 12, 0] }, { duration: 0.6 })}
      />
      {/* The two small sparkles twinkle one after the other. */}
      <motion.path
        d="M20 3v4M22 5h-4"
        style={center}
        {...once(run, { scale: [1, 0, 1.5, 1], opacity: [1, 0, 1, 1] }, { duration: 0.45, delay: 0.1 })}
      />
      <motion.path
        d="M4 17v2M5 18H3"
        style={center}
        {...once(run, { scale: [1, 0, 1.6, 1], opacity: [1, 0, 1, 1] }, { duration: 0.45, delay: 0.3 })}
      />
    </>
  );
}

function PlayIcon({ run }: IconProps) {
  return (
    <>
      {/* The ring draws itself from the top, then the triangle pops like pressing play. */}
      <motion.circle
        cx="12"
        cy="12"
        r="10"
        style={{ ...center, rotate: -90 }}
        {...once(run, { pathLength: [0, 1] }, { duration: 0.5, ease: "easeInOut" })}
      />
      <motion.polygon
        points="10 8 16 12 10 16 10 8"
        style={{ originX: 0.4, originY: 0.5 }}
        {...once(run, { scale: [1, 0.55, 1.25, 1] }, { duration: 0.5, delay: 0.15 })}
      />
    </>
  );
}

function GlobeIcon({ hovered }: IconProps) {
  const spin: Transition = hovered
    ? { duration: 0.55, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }
    : { duration: 0.3 };
  return (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      {/* Meridians narrow and widen in turn — the globe turning. */}
      <motion.path
        d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"
        style={center}
        animate={hovered ? { scaleX: [1, 0.12] } : { scaleX: 1 }}
        transition={spin}
      />
      <motion.path
        d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"
        style={{ ...center, scaleX: 0.12, opacity: 0 }}
        animate={hovered ? { scaleX: [0.12, 1], opacity: 0.6 } : { scaleX: 0.12, opacity: 0 }}
        transition={spin}
      />
    </>
  );
}

function CompassIcon({ run }: IconProps) {
  return (
    <>
      <circle cx="12" cy="12" r="10" />
      {/* The needle swings round and settles back on north with a little overshoot. */}
      <motion.path
        d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"
        style={center}
        {...once(
          run,
          { rotate: [0, -30, 330, 375, 355, 360] },
          { duration: 1, times: [0, 0.15, 0.55, 0.72, 0.87, 1], ease: "easeInOut" },
        )}
      />
    </>
  );
}

function TicketIcon({ run }: IconProps) {
  return (
    <motion.g style={center} {...once(run, { rotate: [0, -9, 5, 0] }, { duration: 0.55 })}>
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      {/* The perforation is punched hole by hole. */}
      {["M13 5v2", "M13 11v2", "M13 17v2"].map((d, i) => (
        <motion.path
          key={d}
          d={d}
          {...(run > 0
            ? { initial: { opacity: 0, scale: 0 }, animate: { opacity: 1, scale: 1 } }
            : { initial: false as const, animate: {} })}
          style={center}
          transition={{ duration: 0.15, delay: 0.12 + i * 0.1 }}
        />
      ))}
    </motion.g>
  );
}

function SignalIcon({ run }: IconProps) {
  // Bars rewritten to all start at the base (lucide's tallest one is drawn top-down), so they
  // light up growing upward, left to right — the signal coming in.
  const bars = ["M7 20v-4", "M12 20v-8", "M17 20V8", "M22 20V4"];
  return (
    <>
      <motion.path d="M2 20h.01" {...once(run, { opacity: [0.2, 1] }, { duration: 0.15 })} />
      {bars.map((d, i) => (
        <motion.path
          key={d}
          d={d}
          {...(run > 0
            ? { initial: { pathLength: 0, opacity: 0.3 }, animate: { pathLength: 1, opacity: 1 } }
            : { initial: false as const, animate: {} })}
          transition={{ duration: 0.18, delay: 0.08 + i * 0.1, ease: "easeOut" }}
        />
      ))}
    </>
  );
}

function CalendarClockIcon({ run }: IconProps) {
  return (
    <>
      <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
      <motion.path d="M16 2v4" {...once(run, { y: [0, -1.5, 0] }, { duration: 0.3 })} />
      <motion.path d="M8 2v4" {...once(run, { y: [0, -1.5, 0] }, { duration: 0.3, delay: 0.08 })} />
      <path d="M3 10h5" />
      <circle cx="16" cy="16" r="6" />
      {/* The clock hand sweeps a full turn around the dial's centre (16,16). */}
      <motion.path
        d="M17.5 17.5 16 16.3V14"
        style={{ originX: 0, originY: 0.571 }}
        {...once(run, { rotate: [0, 360] }, { duration: 0.8, ease: "easeInOut" })}
      />
    </>
  );
}

function TrophyIcon({ run, uid }: IconProps) {
  const clip = `nav-trophy-${uid}`;
  const cup = "M18 2H6v7a6 6 0 0 0 12 0V2Z";
  return (
    <motion.g {...once(run, { y: [0, -2, 0] }, { duration: 0.5, ease: "easeOut" })}>
      <defs>
        <clipPath id={clip}>
          <path d={cup} />
        </clipPath>
      </defs>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d={cup} />
      {/* A glint sweeps across the cup. */}
      <g clipPath={`url(#${clip})`}>
        <motion.path
          d="M8 0 4 16"
          strokeWidth={2.5}
          style={{ opacity: 0 }}
          {...once(run, { x: [0, 14], opacity: [0, 0.85, 0] }, { duration: 0.55, delay: 0.1, ease: "easeInOut" })}
        />
      </g>
    </motion.g>
  );
}

function ClapperIcon({ run }: IconProps) {
  return (
    <>
      {/* The clapper arm opens on its hinge and snaps shut. */}
      <motion.g
        style={{ originX: 0, originY: 1 }}
        {...once(
          run,
          { rotate: [0, -24, -24, 0, -5, 0] },
          { duration: 0.6, times: [0, 0.3, 0.45, 0.6, 0.78, 1], ease: "easeInOut" },
        )}
      >
        <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
        <path d="m6.2 5.3 3.1 3.9" />
        <path d="m12.4 3.4 3.1 4" />
      </motion.g>
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </>
  );
}

function ListIcon({ run }: IconProps) {
  // Lines rewritten left-to-right so they write themselves in reading order.
  const lines = ["M3 6h13", "M3 12h9", "M3 18h9"];
  return (
    <>
      {lines.map((d, i) => (
        <motion.path
          key={d}
          d={d}
          {...(run > 0
            ? { initial: { pathLength: 0 }, animate: { pathLength: 1 } }
            : { initial: false as const, animate: {} })}
          transition={{ duration: 0.2, delay: i * 0.09, ease: "easeOut" }}
        />
      ))}
      <motion.path d="m16 12 5 3-5 3v-6Z" {...once(run, { x: [0, 2, 0] }, { duration: 0.35, delay: 0.3 })} />
    </>
  );
}

function DriveIcon({ run }: IconProps) {
  return (
    <>
      <line x1="22" x2="2" y1="12" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      {/* Activity lights flicker like disk access. */}
      <motion.line
        x1="6" x2="6.01" y1="16" y2="16"
        {...once(run, { opacity: [1, 0.1, 1, 0.1, 1, 0.1, 1] }, { duration: 0.7 })}
      />
      <motion.line
        x1="10" x2="10.01" y1="16" y2="16"
        {...once(run, { opacity: [1, 1, 0.1, 1, 0.1, 1, 1] }, { duration: 0.7 })}
      />
    </>
  );
}

function ChartIcon({ run }: IconProps) {
  return (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      {/* Bars grow up from the axis one after another. */}
      {["M8 17v-3", "M13 17V5", "M18 17V9"].map((d, i) => (
        <motion.path
          key={d}
          d={d}
          {...(run > 0
            ? { initial: { pathLength: 0 }, animate: { pathLength: 1 } }
            : { initial: false as const, animate: {} })}
          transition={{ duration: 0.28, delay: i * 0.1, ease: "easeOut" }}
        />
      ))}
    </>
  );
}

function SettingsIcon({ run }: IconProps) {
  return (
    <>
      {/* The gear turns a third of a turn (its teeth repeat, so it ends where it looks like it
          started) while the hub stays still. */}
      <motion.path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        style={center}
        {...once(run, { rotate: [0, 120] }, { duration: 0.7, ease: [0.34, 1.4, 0.64, 1] })}
      />
      <circle cx="12" cy="12" r="3" />
    </>
  );
}

const ICONS: Record<NavIconId, (p: IconProps) => ReactNode> = {
  home: HomeIcon,
  film: FilmIcon,
  tv: TvIcon,
  sparkles: SparklesIcon,
  play: PlayIcon,
  globe: GlobeIcon,
  compass: CompassIcon,
  ticket: TicketIcon,
  signal: SignalIcon,
  calendarClock: CalendarClockIcon,
  trophy: TrophyIcon,
  clapper: ClapperIcon,
  list: ListIcon,
  drive: DriveIcon,
  chart: ChartIcon,
  settings: SettingsIcon,
};

export function AnimatedNavIcon({
  id,
  hovered,
  className,
}: {
  id: NavIconId;
  hovered: boolean;
  className?: string;
}) {
  // Bumped on each hover start; one-shot parts are keyed by it so every hover replays them.
  const [run, setRun] = useState(0);
  const wasHovered = useRef(false);
  useEffect(() => {
    if (hovered && !wasHovered.current) setRun((r) => r + 1);
    wasHovered.current = hovered;
  }, [hovered]);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const Icon = ICONS[id] as (p: IconProps & { key?: number }) => ReactNode;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      // Moving parts (antenna, clapper arm, glint) may briefly leave the 24x24 box.
      style={{ overflow: "visible" }}
      aria-hidden
      {...strokeProps}
    >
      <Icon key={run} run={run} hovered={hovered} uid={uid} />
    </svg>
  );
}
