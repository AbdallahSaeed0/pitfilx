/** Extract YouTube watch id from watch / embed / short URLs for iframe `youtubeKey`. */
export function youtubeKeyFromWatchOrEmbedUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id || null;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const embed = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embed?.[1]) return embed[1];
    if (host.endsWith("youtube.com")) {
      const shorts = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shorts?.[1]) return shorts[1];
    }
  } catch {
    return null;
  }
  return null;
}
