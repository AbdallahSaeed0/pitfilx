import api from "./client";

export type SkipSegment = {
  start: number;
  end: number;
  confidence: number | null;
  /** "chapter" | "anilist" | "fingerprint" | "heuristic" | override source */
  source: string | null;
};

export type EpisodeSkipResult = {
  intro: SkipSegment | null;
  outro: SkipSegment | null;
};

export async function getEpisodeSkip(episodeId: number): Promise<EpisodeSkipResult> {
  const { data } = await api.get<EpisodeSkipResult>(`/skip/episode/${episodeId}`);
  return data;
}
