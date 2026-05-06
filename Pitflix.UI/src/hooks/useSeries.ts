import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAllSeries, type SeriesListParams } from "../api/series";

export function useSeriesList(params: SeriesListParams) {
  return useQuery({
    queryKey: ["series", params],
    queryFn: () => getAllSeries(params),
    staleTime: 300_000,
    gcTime: 60 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
