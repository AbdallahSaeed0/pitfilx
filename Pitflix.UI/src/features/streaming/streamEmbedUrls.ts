export function streamMovieEmbedUrl(imdbId: string) {
  return `https://streamimdb.ru/embed/movie/${encodeURIComponent(imdbId)}`;
}

export function streamTvEmbedUrl(imdbId: string, season: number, episode: number) {
  return `https://streamimdb.ru/embed/tv/${encodeURIComponent(imdbId)}/${season}/${episode}`;
}

export function corsFlixTvUrl(tmdbId: number, season: number, episode: number) {
  return `https://corsflix.net/tv-shows/${encodeURIComponent(String(tmdbId))}?season=${encodeURIComponent(
    String(season),
  )}&episode=${encodeURIComponent(String(episode))}`;
}

export function corsFlixMovieUrl(tmdbId: number) {
  return `https://corsflix.net/movies/${encodeURIComponent(String(tmdbId))}`;
}
