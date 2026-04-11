import { useQuery } from "@tanstack/react-query";
import { getMovies, type MovieListParams } from "../api/movies";

export function useMovies(params: MovieListParams) {
  return useQuery({
    queryKey: ["movies", params],
    queryFn: () => getMovies(params),
  });
}
