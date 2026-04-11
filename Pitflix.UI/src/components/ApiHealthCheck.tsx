import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { API_ORIGIN } from "../api/client";
import api from "../api/client";

async function checkApiHealth() {
  try {
    const response = await api.get("/settings", { timeout: 5000 });
    return { status: "ok", message: "API is reachable", data: response.data };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Network Error") || error.message.includes("ECONNREFUSED")) {
        return {
          status: "error",
          message: `Cannot connect to API at ${API_ORIGIN}. Make sure Pitflix.API is running.`,
        };
      }
      if (error.message.includes("timeout")) {
        return { status: "error", message: "API request timed out. The API may be overloaded or not responding." };
      }
      return { status: "error", message: `API error: ${error.message}` };
    }
    return { status: "error", message: "Unknown API error" };
  }
}

export function ApiHealthCheck() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["api-health"],
    queryFn: checkApiHealth,
    refetchInterval: 10000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-xs text-pitflix-muted">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Checking API connection...</span>
      </div>
    );
  }

  if (data?.status === "ok") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-300">
        <CheckCircle className="h-3 w-3" />
        <span>API connected ({API_ORIGIN})</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
        <div className="flex-1">
          <p className="text-xs font-medium text-red-300">{data?.message}</p>
          <p className="mt-1 text-[10px] text-red-400/80">
            Troubleshooting:
            <br />
            1. Check if Pitflix.API.exe is running
            <br />
            2. Check Windows Firewall settings
            <br />
            3. Verify API is listening on {API_ORIGIN}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 rounded bg-red-500/20 px-2 py-1 text-[10px] text-red-200 hover:bg-red-500/30"
          >
            Retry connection
          </button>
        </div>
      </div>
    </div>
  );
}
