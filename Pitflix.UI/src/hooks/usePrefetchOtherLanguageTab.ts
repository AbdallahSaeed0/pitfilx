import { useEffect } from "react";
import { useQueryClient, type QueryFunction } from "@tanstack/react-query";
import type { MediaCard } from "../types/media";
import { POSTER_WIDTHS, toPosterSrc } from "../utils/posterSrc";

type ListParams = {
  page: number;
  pageSize: number;
  lang: "en" | "ar";
  search?: string;
  genre?: string;
  sort: string;
  watch: string;
};

/**
 * Warms the other English/Arabic tab of a library list (Movies/Series) shortly after the current
 * one has loaded, so the first switch is instant.
 *
 * The list data itself is fast (single-digit ms); what made the first switch slow was the posters:
 * every card's `?w=` poster variant is resized on the API the first time it's asked for (~240 ms
 * each, measured) and the WebView only fetches a few at once. Preloading those same URLs here
 * means the resized files are cached and decoded before the tab is opened. Same query key as the
 * page's own hook (switching tabs resets to page 1 and keeps the other filters), so the switch
 * reads straight from this cache.
 */
export function usePrefetchOtherLanguageTab(
  queryKeyRoot: "movies" | "series",
  current: ListParams,
  ready: boolean,
  fetchList: (params: ListParams) => Promise<unknown>,
) {
  const qc = useQueryClient();
  const { pageSize, lang, search, genre, sort, watch } = current;

  useEffect(() => {
    if (!ready) return;
    const other: ListParams = {
      page: 1,
      pageSize,
      lang: lang === "en" ? "ar" : "en",
      search,
      genre,
      sort,
      watch,
    };
    const queryKey = [queryKeyRoot, other];
    // After the visible tab's own posters have had their turn on the connection pool.
    const timer = window.setTimeout(() => {
      void qc
        .prefetchQuery({
          queryKey,
          queryFn: (() => fetchList(other)) as QueryFunction,
          staleTime: 300_000,
        })
        .then(() => {
          const data = qc.getQueryData<{ items?: MediaCard[] }>(queryKey);
          for (const item of data?.items ?? []) {
            const path = item.selectedPosterPath || item.posterLocalPath || item.posterRemoteUrl;
            const url = toPosterSrc(path ?? undefined, POSTER_WIDTHS.card);
            if (!url) continue;
            const img = new Image();
            img.decoding = "async";
            img.src = url;
          }
        });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [qc, queryKeyRoot, ready, pageSize, lang, search, genre, sort, watch, fetchList]);
}
