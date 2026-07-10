import { invoke } from "@tauri-apps/api/core";
import { cn } from "../../utils/cn";
import { isNativeBackendEmbeddedLibmpv } from "../../utils/playerNativeBackend";
import { logPlayer2InvokeFailure } from "./playerDebug";
import type { Dispatch, SetStateAction } from "react";
import type { PlayerEmbeddedDevToolsProps } from "./playerViewProps";

type Props = PlayerEmbeddedDevToolsProps & {
  filePath: string;
  useLibMpv: boolean;
  embedReady: boolean;
  onFullscreenPointerActivity: () => void;
  setTransportError: Dispatch<SetStateAction<string | null>>;
};

/** Dev-only IPC diagnostics panel — proves commands reach the live mpv IPC session. */
export function PlayerEmbeddedDevTools({
  filePath,
  useLibMpv,
  embedReady,
  nativeState,
  embeddedSafeMode,
  setEmbeddedSafeMode,
  lastMpvCrashLog,
  setLastMpvCrashLog,
  effectiveStart,
  onFullscreenPointerActivity,
  setTransportError,
}: Props) {
  if (!(import.meta.env.DEV && embedReady && !useLibMpv)) return null;

  return (
    <details className="group relative">
      <summary
        className="flex h-8 cursor-pointer list-none items-center justify-center rounded-md bg-white/10 px-2 text-white marker:content-none hover:bg-white/20 [&::-webkit-details-marker]:hidden"
        title="IPC diagnostics (dev)"
        onClick={() => onFullscreenPointerActivity()}
      >
        <span className="text-[10px] font-semibold tracking-wide text-white/90">IPC</span>
      </summary>
      <div className="absolute bottom-full mb-2 left-1/2 z-[60] max-h-[70vh] min-w-[220px] -translate-x-1/2 overflow-y-auto rounded-lg border border-white/10 bg-black/95 p-2 shadow-xl backdrop-blur">
        <p className="mb-2 text-[10px] text-pitflix-muted">
          Diagnostics: prove commands reach the live mpv IPC session.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={isNativeBackendEmbeddedLibmpv(nativeState?.backend)}
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15",
              isNativeBackendEmbeddedLibmpv(nativeState?.backend) ? "bg-white/5 opacity-50" : "bg-white/10",
            )}
            onClick={() =>
              void invoke("player2_test_ipc_osd").catch((e) => {
                logPlayer2InvokeFailure("player2_test_ipc_osd", e);
                setTransportError(String(e));
              })
            }
          >
            Test IPC OSD
          </button>
          <button
            type="button"
            disabled={isNativeBackendEmbeddedLibmpv(nativeState?.backend)}
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15",
              isNativeBackendEmbeddedLibmpv(nativeState?.backend) ? "bg-white/5 opacity-50" : "bg-white/10",
            )}
            onClick={() =>
              void invoke("player2_test_toggle_pause").catch((e) => {
                logPlayer2InvokeFailure("player2_test_toggle_pause", e);
                setTransportError(String(e));
              })
            }
          >
            Test Toggle Pause
          </button>
          <button
            type="button"
            className="rounded-md bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
            onClick={() => {
              void invoke<{
                session_id: number;
                mpv_pid: number;
                exit_code?: number | null;
                last_action: string;
                time_pos: number;
                pipe: string;
                exe: string;
                args: string[];
                stderr_tail: string[];
                stdout_tail: string[];
                no_config: boolean;
                close_reason?: string | null;
              } | null>("player2_get_last_mpv_exit_report")
                .then((r) => {
                  if (!r) {
                    setLastMpvCrashLog("No mpv exit report captured yet.");
                    return;
                  }
                  const tail =
                    r.stderr_tail?.length
                      ? ["[mpv-stderr-tail]", ...r.stderr_tail].join("\n")
                      : r.stdout_tail?.length
                        ? ["[mpv-stdout-tail]", ...r.stdout_tail].join("\n")
                        : "(no stderr/stdout captured)";
                  setLastMpvCrashLog(
                    [
                      `[mpv-exit] session_id=${r.session_id} pid=${r.mpv_pid} exit_code=${r.exit_code ?? "?"} last_action=${r.last_action} time_pos=${r.time_pos.toFixed(2)}`,
                      `[mpv-launch] exe=${r.exe}`,
                      `args=${JSON.stringify(r.args)}`,
                      `pipe=${r.pipe} no_config=${String(r.no_config)} close_reason=${r.close_reason ?? "—"}`,
                      "",
                      tail,
                    ].join("\n"),
                  );
                })
                .catch((e) => {
                  logPlayer2InvokeFailure("player2_get_last_mpv_exit_report", e);
                  setTransportError(e instanceof Error ? e.message : String(e));
                });
            }}
          >
            Show last mpv stderr
          </button>
          <button
            type="button"
            disabled={isNativeBackendEmbeddedLibmpv(nativeState?.backend)}
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15",
              isNativeBackendEmbeddedLibmpv(nativeState?.backend) ? "bg-white/5 opacity-50" : "bg-white/10",
            )}
            onClick={() => {
              setLastMpvCrashLog(null);
              void invoke("player2_recover_no_config").catch((e) => {
                logPlayer2InvokeFailure("player2_recover_no_config", e);
                setTransportError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            Recover (no-config)
          </button>
          <button
            type="button"
            className="rounded-md bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
            onClick={() => {
              setLastMpvCrashLog(null);
              void invoke("player2_open_detached_no_wid", {
                payload: { path: filePath, start_seconds: effectiveStart ?? null },
              }).catch((e) => {
                logPlayer2InvokeFailure("player2_open_detached_no_wid", e);
                setTransportError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            Open detached (no-wid)
          </button>
          <button
            type="button"
            className="rounded-md bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
            onClick={() => {
              setLastMpvCrashLog(null);
              void invoke("player2_open_detached", {
                payload: { path: filePath, start_seconds: effectiveStart ?? null },
              }).catch((e) => {
                logPlayer2InvokeFailure("player2_open_detached", e);
                setTransportError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            Open detached (supported)
          </button>
          <button
            type="button"
            className="rounded-md bg-rose-500/15 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-500/20"
            onClick={() => {
              setLastMpvCrashLog(null);
              // Minimal embedded diagnostic: no auto-recovery, no window ops after launch.
              void invoke("player2_open_embedded_minimal_no_config", {
                payload: { path: filePath, start_seconds: effectiveStart ?? null },
              }).catch((e) => {
                logPlayer2InvokeFailure("player2_open_embedded_minimal_no_config", e);
                setTransportError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            Open embedded minimal (no-config)
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15",
              embeddedSafeMode ? "bg-amber-500/20" : "bg-white/10",
            )}
            onClick={() => {
              const next = !embeddedSafeMode;
              setEmbeddedSafeMode(next);
              void invoke("player2_set_embedded_safe_mode", { enabled: next }).catch((e) => {
                logPlayer2InvokeFailure("player2_set_embedded_safe_mode", e);
                setTransportError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            Embedded safe mode: {embeddedSafeMode ? "ON" : "OFF"}
          </button>
        </div>
        {lastMpvCrashLog ? (
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-pitflix-muted">Last mpv crash log</p>
              <button
                type="button"
                className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/90 hover:bg-white/10"
                onClick={() => void navigator.clipboard?.writeText(lastMpvCrashLog).catch(() => {})}
              >
                Copy
              </button>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-white/10 bg-black/70 p-2 text-[9px] text-white/80">
              {lastMpvCrashLog}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}
