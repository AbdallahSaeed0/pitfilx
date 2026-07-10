import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Player2Event } from "../../features/player/playerTypes";
import { cn } from "../../utils/cn";

/**
 * Small status pill for the embedded player's audio-tracks panel — reads "PASSTHROUGH" once mpv's
 * log confirms `audio-spdif` engaged (see `quality_enhancement.rs` + `libmpv_session.rs`), "PCM"
 * otherwise. Purely additive/isolated: listens to the existing `player2-event` channel without
 * touching how any other event on it is handled.
 */
export function PassthroughStatusBadge() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<Player2Event>("player2-event", (event) => {
      const e = event.payload;
      if (e?.type === "AudioPassthroughStatus") setActive(Boolean(e.payload?.active));
    }).then((un) => {
      unlisten = un;
    });
    return () => unlisten?.();
  }, []);

  return (
    <span
      className={cn(
        "ml-auto inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
        active ? "text-[#A78BFA]" : "text-white/40",
      )}
      style={active ? { backgroundColor: "#A78BFA22" } : undefined}
      title={active ? "Dolby/DTS audio passthrough is active" : "Audio is being decoded to PCM"}
    >
      {active ? "Passthrough" : "PCM"}
    </span>
  );
}
