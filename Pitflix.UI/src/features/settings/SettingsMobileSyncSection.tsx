import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { useState } from "react";
import {
  getMobileSyncStatus,
  linkMobileAccount,
  pushMobileSync,
  unlinkMobileAccount,
} from "../../api/mobileSync";

/**
 * Links this desktop app to a specific mobile-app Supabase account (same
 * email/password used to sign into PitflixAndroid) so watch history/lists
 * push directly to Supabase every 5 minutes — the mobile app no longer needs
 * to reach this desktop over the local network to pick up the same data.
 */
export function SettingsMobileSyncSection() {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["mobile-sync-status"],
    queryFn: getMobileSyncStatus,
    refetchInterval: 30_000,
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["mobile-sync-status"] });

  const handleLink = async () => {
    if (!email.trim() || !password) {
      setMessage("Enter the mobile account's email and password.");
      setMessageIsError(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await linkMobileAccount(email.trim(), password);
      if (!result.success) {
        setMessage(result.error ?? "Couldn't link the account.");
        setMessageIsError(true);
      } else {
        setPassword("");
        setMessage(
          result.pushed
            ? `Linked as ${result.email} — first sync completed.`
            : `Linked as ${result.email}, but the first sync failed: ${result.pushError ?? "unknown error"}`,
        );
        setMessageIsError(!result.pushed);
        refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await unlinkMobileAccount();
      setMessage("Unlinked.");
      setMessageIsError(false);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await pushMobileSync();
      setMessage(result.success ? "Synced." : (result.error ?? "Sync failed."));
      setMessageIsError(!result.success);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="mobile-sync" className="rounded-xl border border-pitflix-card/50 bg-pitflix-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Smartphone className="h-4 w-4 text-pitflix-primary" strokeWidth={2} />
        Link Mobile Account
      </h2>
      <p className="mt-2 text-[10px] text-pitflix-subtle leading-relaxed">
        Sign in with the same email/password you use on the Pitflix mobile app. Once linked, this
        desktop pushes your watch history and lists straight to your mobile account every 5
        minutes — no need for the phone to be on the same network.
      </p>

      {status?.linked ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            <p className="text-xs font-medium text-emerald-300">Linked as {status.email}</p>
            <p className="mt-0.5 text-[10px] text-pitflix-subtle">
              Last synced:{" "}
              {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "never yet"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSyncNow()}
              className="rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-xs font-medium text-white hover:border-pitflix-primary/50 disabled:opacity-50"
            >
              Sync Now
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleUnlink()}
              className="rounded-lg border border-pitflix-card px-3 py-2 text-xs text-pitflix-muted hover:text-white disabled:opacity-50"
            >
              Unlink
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <input
            type="email"
            placeholder="Mobile account email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/50 focus:outline-none"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/50 focus:outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleLink()}
            className="rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-medium text-white hover:bg-pitflix-primary/90 disabled:opacity-50"
          >
            Link Account
          </button>
        </div>
      )}

      {message ? (
        <p className={`mt-3 text-xs ${messageIsError ? "text-red-400/90" : "text-emerald-400/90"}`}>
          {message}
        </p>
      ) : null}
    </section>
  );
}
