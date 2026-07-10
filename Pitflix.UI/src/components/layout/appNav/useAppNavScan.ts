import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useState } from "react";
import { startScan } from "../../../api/scan";
import { useScanProgressQuery } from "../../../hooks/useScanProgress";

export function useAppNavScan() {
  const qc = useQueryClient();
  const { data: scanProgress } = useScanProgressQuery();
  const scanRunning = scanProgress?.isRunning ?? false;
  const [scanError, setScanError] = useState<string | null>(null);

  const runScan = () => {
    setScanError(null);
    void startScan({ folders: [] })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["scanProgress"] });
      })
      .catch((err) => {
        console.error("Scan failed:", err);
        const msg = (() => {
          if (axios.isAxiosError(err)) {
            const raw = err.response?.data;
            const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
            const message = data?.message;
            if (typeof message === "string" && message.trim()) return message;
            const code = data?.error;
            if (code === "NO_LIBRARY_FOLDERS") return "No library folders are configured. Open Settings first.";
          }
          return err instanceof Error && err.message.toLowerCase().includes("network")
            ? "API unreachable"
            : "Scan could not start";
        })();
        setScanError(msg);
        setTimeout(() => setScanError(null), 3000);
      });
  };

  return { scanRunning, scanError, runScan };
}
