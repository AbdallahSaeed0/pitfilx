import type { QueryClient } from "@tanstack/react-query";
import api from "./client";

export type PlayPayload = {
  filePath: string;
  startSeconds?: number;
  /** Shown in Continue Watching; defaults to file name if omitted. */
  title?: string;
  posterPath?: string | null;
  mediaType?: string;
  durationSeconds?: number;
};

function invalidateHistoryQueries(qc?: QueryClient) {
  if (!qc) return;
  void qc.invalidateQueries({ queryKey: ["home-history"] });
  void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
  void qc.invalidateQueries({ queryKey: ["history"] });
}

/** Starts external player and logs a history row for Continue Watching. */
export const playFile = async (body: PlayPayload, qc?: QueryClient) => {
  const r = await api.post("/play", body);
  const data = r.data as { success?: boolean; error?: string };
  if (data.success === true) {
    invalidateHistoryQueries(qc);
  } else if (data.error) {
    console.warn("Play / history:", data.error);
  }
  return r.data;
};
