import { useQuery } from "@tanstack/react-query";
import { getAllSeries, type SeriesListParams } from "../api/series";

export function useSeriesList(params: SeriesListParams) {
  return useQuery({
    queryKey: ["series", params],
    queryFn: () => getAllSeries(params),
  });
}
