export function streamMovieEmbedUrl(imdbId: string) {
  return `https://streamimdb.ru/embed/movie/${encodeURIComponent(imdbId)}`;
}

export function streamTvEmbedUrl(imdbId: string, season: number, episode: number) {
  return `https://streamimdb.ru/embed/tv/${encodeURIComponent(imdbId)}/${season}/${episode}`;
}
