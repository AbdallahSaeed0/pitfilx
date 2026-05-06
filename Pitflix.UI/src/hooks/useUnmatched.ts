import { useQuery } from "@tanstack/react-query";
import { getUnmatched } from "../api/unmatched";

export function useUnmatchedPage(params: {
  page: number;
  pageSize?: number;
  search?: string;
  type?: string;
  sortBy?: string;
  sortDir?: string;
}) {
  return useQuery({
    queryKey: ["unmatched", params],
    queryFn: () => getUnmatched(params),
  });
}
