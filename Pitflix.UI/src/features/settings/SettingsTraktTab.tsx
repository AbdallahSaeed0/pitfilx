import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard } from "lucide-react";
import { disconnectTrakt, getTraktAuthUrl, getTraktStatus, patchTraktSettings } from "../../api/trakt";
import { formatScanOrApiError } from "./settingsTypes";

const REDIRECT_URI = "http://localhost:5280/api/trakt/callback";

export function SettingsTraktTab() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [clientIdInput, setClientIdInput] = useState("");
  const [clientSecretInput, setClientSecretInput] = useState("");

  const { data, refetch } = useQuery({
    queryKey: ["trakt-status"],
    queryFn: getTraktStatus,
    refetchInterval: connecting ? 2000 : false,
  });

  useEffect(() => {
    if (connecting && data?.connected) {
      setConnecting(false);
      setMessage("Connected to Trakt.");
    }
  }, [connecting, data?.connected]);

  const handleSaveAppCredentials = () => {
    const clientId = clientIdInput.trim();
    const clientSecret = clientSecretInput.trim();
    if (!clientId || !clientSecret) {
      setMessage("Enter both the Client ID and Client Secret.");
      return;
    }
    setBusy(true);
    setMessage(null);
    void patchTraktSettings({ clientId, clientSecret })
      .then(() => {
        setClientIdInput("");
        setClientSecretInput("");
        setMessage("Trakt app saved.");
        return qc.invalidateQueries({ queryKey: ["trakt-status"] });
      })
      .catch((err) => setMessage(formatScanOrApiError(err)))
      .finally(() => setBusy(false));
  };

  const handleConnect = () => {
    if (!isTauri()) {
      setMessage("Connecting to Trakt requires the Pitflix desktop app.");
      return;
    }
    setMessage(null);
    setBusy(true);
    void getTraktAuthUrl()
      .then((r) => {
        if (!r.url) {
          setMessage(r.error ?? "Trakt is not configured on this install.");
          return;
        }
        return openUrl(r.url).then(() => setConnecting(true));
      })
      .catch(() => setMessage("Could not start the Trakt connection."))
      .finally(() => setBusy(false));
  };

  const handleDisconnect = () => {
    setBusy(true);
    setMessage(null);
    void disconnectTrakt()
      .then(() => {
        setMessage("Disconnected from Trakt.");
        return refetch();
      })
      .catch((err) => setMessage(formatScanOrApiError(err)))
      .finally(() => setBusy(false));
  };

  const handleToggleAutoSync = (enabled: boolean) => {
    setBusy(true);
    setMessage(null);
    void patchTraktSettings({ autoSyncEnabled: enabled })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["trakt-status"] });
        if (enabled) setMessage("Auto-sync enabled — importing your Trakt watch history and playback progress now.");
      })
      .catch((err) => setMessage(formatScanOrApiError(err)))
      .finally(() => setBusy(false));
  };

  const connected = data?.connected ?? false;
  const appConfigured = data?.appConfigured ?? false;

  return (
    <section
      id="settings-trakt"
      className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
    >
      <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
        <Clapperboard className="h-4 w-4 text-red-400" strokeWidth={2} />
        Trakt
      </h2>

      {!appConfigured ? (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-pitflix-subtle">
            First-time setup: create a free Trakt API app, then paste its Client ID and Secret below. This
            only needs to be done once per Pitflix install — anyone using this app (e.g. a friend on the same
            PC) can then connect their own Trakt account without redoing this step.
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-[11px] text-pitflix-subtle">
            <li>
              Go to{" "}
              <a
                href="https://trakt.tv/oauth/applications/new"
                target="_blank"
                rel="noreferrer"
                className="text-pitflix-primary hover:underline"
              >
                trakt.tv/oauth/applications/new
              </a>{" "}
              and sign in.
            </li>
            <li>
              Name it anything (e.g. “Pitflix”) and set Redirect URI to exactly:{" "}
              <code className="rounded bg-pitflix-bg px-1 py-0.5 text-pitflix-primary">{REDIRECT_URI}</code>
            </li>
            <li>Save it, then copy the Client ID and Client Secret shown on the app's page.</li>
          </ol>
          <input
            value={clientIdInput}
            onChange={(e) => setClientIdInput(e.target.value)}
            placeholder="Client ID"
            autoComplete="off"
            className="w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
          />
          <input
            value={clientSecretInput}
            onChange={(e) => setClientSecretInput(e.target.value)}
            placeholder="Client Secret"
            type="password"
            autoComplete="off"
            className="w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
          />
          <button
            type="button"
            disabled={busy}
            onClick={handleSaveAppCredentials}
            className="w-full rounded-xl bg-pitflix-primary py-2.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save Trakt app"}
          </button>
        </div>
      ) : (
        <>
          {data?.expired ? (
            <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              Trakt connection expired, please reconnect.
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-pitflix-muted">
                {connected ? "Connected" : "Not connected"}
              </p>
              <p className="truncate text-sm text-white">
                {connected
                  ? data?.username
                    ? `@${data.username}`
                    : "Trakt account linked"
                  : "Sync watch activity with Trakt.tv"}
              </p>
            </div>
            {connected ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleDisconnect}
                className="shrink-0 rounded-xl border border-white/[0.08] bg-pitflix-bg px-3.5 py-2 text-xs font-semibold text-white transition-all hover:border-red-500/50 disabled:opacity-50"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || connecting}
                onClick={handleConnect}
                className="shrink-0 rounded-xl bg-pitflix-primary px-3.5 py-2 text-xs font-semibold text-white transition-all disabled:opacity-50"
              >
                {connecting ? "Waiting for browser…" : "Connect Trakt"}
              </button>
            )}
          </div>

          {connected ? (
            <label className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
              <span className="text-[11px] font-medium text-pitflix-muted">
                Automatically sync watch activity and playback progress with Trakt
              </span>
              <input
                type="checkbox"
                checked={data?.autoSyncEnabled ?? false}
                disabled={busy}
                onChange={(e) => handleToggleAutoSync(e.target.checked)}
                className="h-4 w-4 accent-pitflix-primary"
              />
            </label>
          ) : null}
        </>
      )}

      {message ? <p className="mt-3 text-[11px] text-pitflix-subtle">{message}</p> : null}
    </section>
  );
}
