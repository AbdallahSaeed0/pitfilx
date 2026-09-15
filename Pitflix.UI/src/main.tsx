import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { restoreQueryCache, startQueryCachePersistence } from "./api/queryCachePersistence";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,   // 5 min — avoids re-fetch on every navigation
      gcTime: 15 * 60_000,     // 15 min — keep unused data in memory
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Seed from the previous session before the first render so pages paint with real data instead of
// skeletons, then keep the snapshot current. Without this every launch is a fully cold cache.
restoreQueryCache(queryClient);
startQueryCachePersistence(queryClient);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  </React.StrictMode>,
);

// Hand off from the static splash in index.html (which covered the transparent window while the
// bundle loaded) to React's own UI. rAF fires after the first commit has painted, so there's no
// flash of an empty window between the two — but rAF is paused while the window is hidden or
// minimised (same trap PageTransition documents), and a splash that never clears would sit on
// top of the whole app. The timeout is the backstop; both calls are idempotent.
const dismissBootSplash = () => document.getElementById("boot-splash")?.remove();
requestAnimationFrame(dismissBootSplash);
setTimeout(dismissBootSplash, 1500);
