import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cancelScan, getScanProgress } from "../../api/scan";
import { useScanStore } from "../../store/scanStore";

export function ScanProgressOverlay() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["scanProgress"],
    queryFn: getScanProgress,
    refetchInterval: (query) => (query.state.data?.isRunning ? 400 : false),
  });

  const [cancelMessage, setCancelMessage] = useState<{ matched: number } | null>(null);
  const [completeToast, setCompleteToast] = useState<string | null>(null);

  const isRunning = data?.isRunning ?? false;
  const pct = typeof data?.percent === "number" ? data.percent : 0;
  const lastComplete = useScanStore((s) => s.lastComplete);
  const setLastComplete = useScanStore((s) => s.setLastComplete);

  useEffect(() => {
    if (!cancelMessage) return;
    const t = setTimeout(() => setCancelMessage(null), 4000);
    return () => clearTimeout(t);
  }, [cancelMessage]);

  useEffect(() => {
    if (!lastComplete) return;
    const { matched, unmatched, skipped, empty, message } = lastComplete;
    if (message) {
      setCompleteToast(message);
    } else if (empty) {
      setCompleteToast("No video files found in the selected folders.");
    } else if (matched === 0 && unmatched === 0) {
      setCompleteToast(skipped > 0 ? "Scan complete — no new files found." : "Scan complete.");
    } else {
      setCompleteToast(`Scan complete — ${matched} matched, ${unmatched} unmatched.`);
    }
    setLastComplete(null);
  }, [lastComplete, setLastComplete]);

  useEffect(() => {
    if (!completeToast) return;
    const t = setTimeout(() => setCompleteToast(null), 4500);
    return () => clearTimeout(t);
  }, [completeToast]);

  const handleCancel = async () => {
    const matched = data?.matched ?? 0;
    await cancelScan();
    for (let i = 0; i < 40; i++) {
      const row = await qc.fetchQuery({ queryKey: ["scanProgress"], queryFn: getScanProgress });
      if (!row?.isRunning) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    setCancelMessage({ matched });
  };

  return (
    <AnimatePresence>
      {completeToast && !isRunning ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed bottom-5 right-5 z-50 w-80 rounded-xl border border-pitflix-primary/40 bg-pitflix-surface p-4 shadow-2xl shadow-black/60"
        >
          <p className="text-sm text-pitflix-muted">{completeToast}</p>
        </motion.div>
      ) : null}
      {cancelMessage && !isRunning ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed bottom-5 right-5 z-50 w-80 rounded-xl border border-pitflix-primary/40 bg-pitflix-surface p-4 shadow-2xl shadow-black/60"
        >
          <p className="text-sm text-pitflix-muted">
            Scan cancelled — {cancelMessage.matched} matched before stop
          </p>
        </motion.div>
      ) : null}
      {isRunning ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-5 right-5 z-50 w-80 rounded-xl border border-pitflix-primary/40 bg-pitflix-surface p-4 shadow-2xl shadow-black/60"
        >
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="absolute right-3 top-3 text-lg leading-none text-pitflix-subtle transition-colors hover:text-white"
            title="Cancel scan"
          >
            ✕
          </button>
          <div className="mb-2 flex items-center justify-between pr-8">
            <span className="text-sm font-semibold text-white">Scanning library…</span>
            <span className="text-xs text-pitflix-muted">{pct.toFixed(0)}%</span>
          </div>
          <div className="mb-2 h-1.5 w-full rounded-full bg-pitflix-card">
            <div
              className="h-1.5 rounded-full bg-pitflix-primary transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <p className="mb-2 truncate text-xs text-pitflix-subtle" title={data?.currentFile}>
            {data?.currentFile}
          </p>
          <div className="flex gap-4 text-xs">
            <span className="text-green-400">✓ {data?.matched ?? 0} matched</span>
            <span className="text-pitflix-muted">⚠ {data?.unmatched ?? 0} unmatched</span>
            {(data?.skipped ?? 0) > 0 ? (
              <span className="text-pitflix-subtle">↷ {data?.skipped ?? 0} skipped</span>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
