import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cancelSmartScan, getSmartScanStatus } from "../api/smartMatch";

export function SmartMatchProgressOverlay() {
  const qc = useQueryClient();
  const prevRunning = useRef(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["smartMatchProgress"],
    queryFn: getSmartScanStatus,
    refetchInterval: (q) => (q.state.data?.isRunning ? 500 : false),
  });

  const isRunning = data?.isRunning ?? false;

  useEffect(() => {
    if (prevRunning.current && !isRunning && data?.lastResult) {
      const r = data.lastResult;
      setToast(`Auto-matched ${r.autoMatched} files. ${r.stillUnmatched} still need review.`);
      void qc.invalidateQueries({ queryKey: ["unmatched"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-movies"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["series"] });
    }
    prevRunning.current = isRunning;
  }, [isRunning, data?.lastResult, qc]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const pct = data?.total ? Math.min(100, (100 * data.current) / data.total) : 0;

  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="pointer-events-none fixed bottom-5 left-1/2 z-[60] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-pitflix-primary/40 bg-pitflix-surface px-4 py-3 shadow-2xl shadow-black/60"
        >
          <p className="text-center text-sm text-white">{toast}</p>
        </motion.div>
      ) : null}
      {isRunning ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-5 right-5 z-[55] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-pitflix-primary/40 bg-pitflix-surface p-4 shadow-2xl shadow-black/60"
        >
          <button
            type="button"
            onClick={() => void cancelSmartScan().then(() => qc.invalidateQueries({ queryKey: ["smartMatchProgress"] }))}
            className="absolute right-3 top-3 text-lg leading-none text-pitflix-subtle hover:text-white"
            title="Cancel"
          >
            ✕
          </button>
          <div className="mb-2 flex items-center justify-between pr-8">
            <span className="text-sm font-semibold text-white">🤖 Smart Auto-Match…</span>
            <span className="text-xs text-pitflix-muted">{pct.toFixed(0)}%</span>
          </div>
          <div className="mb-2 h-1.5 w-full rounded-full bg-pitflix-card">
            <div
              className="h-1.5 rounded-full bg-pitflix-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="truncate text-xs text-pitflix-subtle" title={data?.currentLabel}>
            {data?.currentLabel}
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
