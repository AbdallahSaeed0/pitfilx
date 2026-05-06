import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getMovies, type MovieListParams } from "../api/movies";

export function useMovies(params: MovieListParams) {
  return useQuery({
    queryKey: ["movies", params],
    queryFn: () => getMovies(params),
    staleTime: 300_000,
    gcTime: 60 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
