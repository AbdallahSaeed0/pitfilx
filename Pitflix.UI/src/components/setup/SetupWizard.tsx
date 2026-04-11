import { isTauri } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ChevronRight, Film, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { startScan } from "../../api/scan";
import {
  completeSetup,
  getSettings,
  nativePickFolder,
  pathExistsOnServer,
  type PitflixSettings,
  type WizardDraft,
  saveWizardProgress,
  verifyOpenSubtitlesKey,
  verifyTmdbKey,
} from "../../api/settings";
import { Spinner } from "../ui/Spinner";

const BANNER_KEY = "pitflix_banner_add_folders";

const emptyDraft = (): WizardDraft => ({
  tmdbKey: "",
  tmdbVerified: false,
  tmdbSkipped: false,
  osKey: "",
  osSkipped: false,
  folders: [],
  foldersSkipped: false,
});

function mergeDraft(patch: Partial<WizardDraft> | null | undefined): WizardDraft {
  return { ...emptyDraft(), ...(patch ?? {}) };
}

async function openDocs(url: string) {
  try {
    if (isTauri()) await openUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function StepDots({ step }: { step: number }) {
  const labels = ["Welcome", "TMDB", "Subtitles", "Media"];
  return (
    <div className="mb-6 flex justify-center gap-3">
      {labels.map((_, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <div
            key={n}
            className="flex flex-col items-center gap-1"
            title={labels[i]}
          >
            <div
              className={
                done
                  ? "flex h-3 w-3 items-center justify-center rounded-full bg-violet-500 text-white"
                  : active
                    ? "h-3 w-3 rounded-full bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.35)]"
                    : "h-3 w-3 rounded-full bg-zinc-600"
              }
            >
              {done ? <Check className="h-2 w-2" strokeWidth={3} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SetupWizard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<WizardDraft>(emptyDraft);
  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<"wizard" | "scan">("wizard");

  const [tmdbVerifyBusy, setTmdbVerifyBusy] = useState(false);
  const [tmdbVerifyMsg, setTmdbVerifyMsg] = useState<"ok" | "bad" | null>(null);
  const [tmdbError, setTmdbError] = useState<string | null>(null);

  const [osVerifyBusy, setOsVerifyBusy] = useState(false);
  const [osVerifyMsg, setOsVerifyMsg] = useState<"ok" | "bad" | null>(null);
  const [osError, setOsError] = useState<string | null>(null);

  const [folderManual, setFolderManual] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderWarn, setFolderWarn] = useState<string | null>(null);
  const [finishBusy, setFinishBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    const st = (data as PitflixSettings).setupWizardStep;
    if (typeof st === "number" && st >= 1 && st <= 4) setStep(st);
    setDraft(mergeDraft((data as PitflixSettings).setupWizardState));
    setHydrated(true);
  }, [data, hydrated]);

  const persist = useCallback(async (s: number, d: WizardDraft) => {
    try {
      await saveWizardProgress(s, d);
    } catch (e) {
      console.error("wizard save", e);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const t = window.setTimeout(() => void persist(step, draft), 450);
    return () => window.clearTimeout(t);
  }, [step, draft, hydrated, persist]);

  const goStep = (n: number) => {
    setStep(Math.min(4, Math.max(1, n)));
    void persist(n, draft);
  };

  const verifyTmdb = async () => {
    const k = draft.tmdbKey.trim();
    if (!k) {
      setTmdbVerifyMsg("bad");
      setTmdbError("Enter a key first.");
      return;
    }
    setTmdbVerifyBusy(true);
    setTmdbVerifyMsg(null);
    setTmdbError(null);
    try {
      const r = await verifyTmdbKey(k);
      if (r.valid) {
        setTmdbVerifyMsg("ok");
        setDraft((d) => ({ ...d, tmdbVerified: true, tmdbSkipped: false }));
      } else {
        setTmdbVerifyMsg("bad");
        setTmdbError(r.error ?? "Invalid key");
      }
    } catch (e) {
      setTmdbVerifyMsg("bad");
      setTmdbError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setTmdbVerifyBusy(false);
    }
  };

  const verifyOs = async () => {
    const k = draft.osKey.trim();
    if (!k) {
      setOsVerifyMsg("bad");
      setOsError("Enter a key or use Skip.");
      return;
    }
    setOsVerifyBusy(true);
    setOsVerifyMsg(null);
    setOsError(null);
    try {
      const r = await verifyOpenSubtitlesKey(k);
      if (r.valid) {
        setOsVerifyMsg("ok");
        setDraft((d) => ({ ...d, osSkipped: false }));
      } else {
        setOsVerifyMsg("bad");
        setOsError(r.error ?? "Invalid key");
      }
    } catch (e) {
      setOsVerifyMsg("bad");
      setOsError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setOsVerifyBusy(false);
    }
  };

  const browseFolder = async () => {
    setFolderWarn(null);
    setFolderBusy(true);
    try {
      let selected: string | null = null;
      if (isTauri()) {
        const r = await open({ directory: true, multiple: false, title: "Media folder" });
        if (typeof r === "string") selected = r;
      } else {
        const d = await nativePickFolder();
        if (d.error) {
          setFolderWarn(d.error);
          return;
        }
        selected = d.path ?? null;
      }
      if (!selected) return;
      setDraft((d) => ({
        ...d,
        folders: d.folders.includes(selected!) ? d.folders : [...d.folders, selected!],
        foldersSkipped: false,
      }));
    } finally {
      setFolderBusy(false);
    }
  };

  const addManualFolder = async () => {
    const p = folderManual.trim();
    if (!p) return;
    setFolderWarn(null);
    try {
      const { exists } = await pathExistsOnServer(p);
      if (!exists) setFolderWarn("That folder was not found on disk.");
      setDraft((d) => ({
        ...d,
        folders: d.folders.includes(p) ? d.folders : [...d.folders, p],
        foldersSkipped: false,
      }));
      setFolderManual("");
    } catch {
      setFolderWarn("Could not verify path.");
    }
  };

  const removeFolder = (path: string) => {
    setDraft((d) => ({ ...d, folders: d.folders.filter((x) => x !== path) }));
  };

  const runFinish = async (runScan: boolean) => {
    setFinishBusy(true);
    setScanBusy(runScan);
    setFolderWarn(null);
    try {
      await completeSetup({
        tmdbApiKey: draft.tmdbSkipped ? null : draft.tmdbKey.trim() || null,
        tmdbSkipped: draft.tmdbSkipped,
        openSubtitlesApiKey: draft.osSkipped ? null : draft.osKey.trim() || null,
        openSubtitlesSkipped: draft.osSkipped,
        libraryPaths: draft.foldersSkipped ? [] : [...draft.folders],
        foldersSkipped: draft.foldersSkipped,
      });

      const noFolders = draft.foldersSkipped || draft.folders.length === 0;
      if (noFolders) sessionStorage.setItem(BANNER_KEY, "1");

      if (runScan) {
        try {
          await startScan({ folders: [] });
          void qc.invalidateQueries({ queryKey: ["scanProgress"] });
        } catch (scanError) {
          console.error("Scan start failed:", scanError);
          setFolderWarn(
            (() => {
              if (axios.isAxiosError(scanError)) {
                const raw = scanError.response?.data;
                const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
                const message = data?.message;
                if (typeof message === "string" && message.trim()) return message;
                const code = data?.error;
                if (code === "NO_LIBRARY_FOLDERS")
                  return "No library folders are configured yet. Add at least one folder, then scan.";
              }
              return scanError instanceof Error && scanError.message.toLowerCase().includes("network")
                ? "Cannot reach Pitflix API. Make sure the API is running on port 5001."
                : `Scan failed to start: ${scanError instanceof Error ? scanError.message : "Unknown error"}`;
            })()
          );
          throw scanError;
        }
      }
    } catch (error) {
      console.error("Setup completion failed:", error);
      setFolderWarn(
        error instanceof Error
          ? error.message
          : "Setup failed. Check if Pitflix API is running."
      );
    } finally {
      setFinishBusy(false);
      setScanBusy(false);
      void qc.invalidateQueries({ queryKey: ["settings"] });
    }
  };

  const onFinishClick = () => {
    const canFinish = draft.folders.length > 0 || draft.foldersSkipped;
    if (!canFinish) return;
    const hasFolders = draft.folders.length > 0 && !draft.foldersSkipped;
    if (hasFolders) setPhase("scan");
    else void runFinish(false);
  };

  if (isLoading && !data)
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Spinner />
      </div>
    );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm">
      <div
        className="w-full max-w-[520px] rounded-2xl border border-white/10 bg-zinc-900/95 p-8 shadow-2xl ring-1 ring-white/5"
        style={{ width: "100%", maxWidth: 520 }}
      >
        {phase === "scan" ? (
          <div className="text-center">
            <h2 className="text-lg font-semibold text-white">Scan library now?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Pitflix can scan your folders for movies and series. You can also run a scan later from
              Settings.
            </p>
            {folderWarn ? (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-left">
                <p className="text-xs text-red-300">{folderWarn}</p>
              </div>
            ) : null}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                disabled={finishBusy || scanBusy}
                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                onClick={() => void runFinish(true)}
              >
                {scanBusy ? "Starting…" : "Yes, scan now"}
              </button>
              <button
                type="button"
                disabled={finishBusy || scanBusy}
                className="rounded-xl border border-zinc-600 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                onClick={() => void runFinish(false)}
              >
                Later
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-1 text-center text-[11px] font-medium uppercase tracking-widest text-violet-300/90">
              Step {step} of 4
            </p>
            <StepDots step={step} />

            {step === 1 ? (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-600/20">
                  <Film className="h-9 w-9 text-violet-300" />
                </div>
                <h1 className="text-2xl font-bold text-white">Welcome to Pitflix</h1>
                <p className="mt-2 text-sm text-zinc-400">Your personal media library</p>
                <button
                  type="button"
                  className="mt-8 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-500"
                  onClick={() => goStep(2)}
                >
                  Get started
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            {step === 2 ? (
              <div>
                <h2 className="text-xl font-semibold text-white">Connect to TMDB</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  TMDB gives you posters, cast info, ratings and more. It&apos;s free.
                </p>
                <details className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-violet-400 hover:text-violet-300">
                    📖 How to get your TMDB API key (click to expand)
                  </summary>
                  <div className="mt-3 space-y-2 text-xs text-zinc-400">
                    <p className="font-semibold text-zinc-300">Step-by-step instructions:</p>
                    <ol className="ml-4 list-decimal space-y-1.5">
                      <li>
                        Go to{" "}
                        <button
                          type="button"
                          className="text-violet-400 underline hover:text-violet-300"
                          onClick={() => void openDocs("https://www.themoviedb.org/signup")}
                        >
                          themoviedb.org
                        </button>{" "}
                        and create a free account
                      </li>
                      <li>After signing in, go to your account settings</li>
                      <li>Click on "API" in the left sidebar</li>
                      <li>Click "Create" or "Request an API Key"</li>
                      <li>
                        Choose <strong>"Developer"</strong> (not Commercial)
                      </li>
                      <li>Accept the terms and conditions</li>
                      <li>
                        Fill in the form:
                        <ul className="ml-4 mt-1 list-disc space-y-0.5 text-zinc-500">
                          <li>Application Name: <code className="rounded bg-zinc-800 px-1">Pitflix</code></li>
                          <li>Application URL: <code className="rounded bg-zinc-800 px-1">http://localhost</code></li>
                          <li>Application Summary: <code className="rounded bg-zinc-800 px-1">Personal media library</code></li>
                        </ul>
                      </li>
                      <li>Submit the form</li>
                      <li>
                        Copy the <strong>"API Key (v3 auth)"</strong> and paste it below
                      </li>
                    </ol>
                  </div>
                </details>
                <input
                  type="password"
                  autoComplete="off"
                  value={draft.tmdbKey}
                  onChange={(e) => {
                    setTmdbVerifyMsg(null);
                    setTmdbError(null);
                    setDraft((d) => ({
                      ...d,
                      tmdbKey: e.target.value,
                      tmdbVerified: false,
                    }));
                  }}
                  placeholder="TMDB API key"
                  className="mt-4 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={tmdbVerifyBusy}
                    className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
                    onClick={() => void verifyTmdb()}
                  >
                    {tmdbVerifyBusy ? "Checking…" : "Verify key"}
                  </button>
                  {tmdbVerifyMsg === "ok" ? (
                    <span className="text-sm text-emerald-400">✓ Key is valid</span>
                  ) : null}
                  {tmdbVerifyMsg === "bad" && tmdbError ? (
                    <span className="text-sm text-red-400">✗ {tmdbError}</span>
                  ) : null}
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    className="text-sm text-zinc-400 hover:text-white"
                    onClick={() => goStep(1)}
                  >
                    ← Back
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      onClick={() => {
                        setDraft((d) => ({
                          ...d,
                          tmdbSkipped: true,
                          tmdbVerified: false,
                          tmdbKey: "",
                        }));
                        setTmdbVerifyMsg(null);
                        goStep(3);
                      }}
                    >
                      Skip for now
                    </button>
                    <button
                      type="button"
                      disabled={!(draft.tmdbVerified || draft.tmdbSkipped)}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => {
                        if (!draft.tmdbVerified && !draft.tmdbSkipped) return;
                        goStep(3);
                      }}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div>
                <h2 className="text-xl font-semibold text-white">Subtitle search (optional)</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Search and download subtitles in Arabic and English. Free.
                </p>
                <details className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-violet-400 hover:text-violet-300">
                    📖 How to get your OpenSubtitles API key (click to expand)
                  </summary>
                  <div className="mt-3 space-y-2 text-xs text-zinc-400">
                    <p className="font-semibold text-zinc-300">Step-by-step instructions:</p>
                    <ol className="ml-4 list-decimal space-y-1.5">
                      <li>
                        Go to{" "}
                        <button
                          type="button"
                          className="text-violet-400 underline hover:text-violet-300"
                          onClick={() => void openDocs("https://www.opensubtitles.com/en/users/sign_up")}
                        >
                          opensubtitles.com
                        </button>{" "}
                        and create a free account
                      </li>
                      <li>After signing in, go to your profile page</li>
                      <li>Click on "Consumers" in the menu</li>
                      <li>Click "Create new consumer"</li>
                      <li>
                        Fill in the form:
                        <ul className="ml-4 mt-1 list-disc space-y-0.5 text-zinc-500">
                          <li>Name: <code className="rounded bg-zinc-800 px-1">Pitflix</code></li>
                          <li>Description: <code className="rounded bg-zinc-800 px-1">Personal media library</code></li>
                        </ul>
                      </li>
                      <li>Submit the form</li>
                      <li>
                        Copy the <strong>"API Key"</strong> and paste it below
                      </li>
                    </ol>
                    <p className="mt-2 text-zinc-500">
                      Note: Free accounts have daily download limits. This is usually sufficient for personal use.
                    </p>
                  </div>
                </details>
                <input
                  type="password"
                  autoComplete="off"
                  value={draft.osKey}
                  onChange={(e) => {
                    setOsVerifyMsg(null);
                    setOsError(null);
                    setDraft((d) => ({ ...d, osKey: e.target.value, osSkipped: false }));
                  }}
                  placeholder="OpenSubtitles API key"
                  className="mt-4 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={osVerifyBusy}
                    className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
                    onClick={() => void verifyOs()}
                  >
                    {osVerifyBusy ? "Checking…" : "Verify key"}
                  </button>
                  {osVerifyMsg === "ok" ? (
                    <span className="text-sm text-emerald-400">✓ Key is valid</span>
                  ) : null}
                  {osVerifyMsg === "bad" && osError ? (
                    <span className="text-sm text-red-400">✗ {osError}</span>
                  ) : null}
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    className="text-sm text-zinc-400 hover:text-white"
                    onClick={() => goStep(2)}
                  >
                    ← Back
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      onClick={() => {
                        setDraft((d) => ({ ...d, osSkipped: true, osKey: "" }));
                        goStep(4);
                      }}
                    >
                      Skip for now
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
                      onClick={() => goStep(4)}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div>
                <h2 className="text-xl font-semibold text-white">Where is your media?</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  Add folders containing your movies and series.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={folderBusy}
                    onClick={() => void browseFolder()}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Browse for folder
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={folderManual}
                    onChange={(e) => setFolderManual(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void addManualFolder()}
                    placeholder="Or type a full path…"
                    className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void addManualFolder()}
                    className="rounded-xl border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                  >
                    Add
                  </button>
                </div>
                {folderWarn ? <p className="mt-2 text-xs text-amber-400/90">{folderWarn}</p> : null}
                <ul className="mt-4 max-h-36 space-y-2 overflow-y-auto">
                  {draft.folders.map((p) => (
                    <li
                      key={p}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-200"
                    >
                      <span className="truncate" title={p}>
                        {p}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-zinc-500 hover:text-red-400"
                        onClick={() => removeFolder(p)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    className="text-sm text-zinc-400 hover:text-white"
                    onClick={() => goStep(3)}
                  >
                    ← Back
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      onClick={() => {
                        setFolderWarn(null);
                        setDraft((d) => ({ ...d, foldersSkipped: true, folders: [] }));
                      }}
                    >
                      Skip — add later in Settings
                    </button>
                    <button
                      type="button"
                      disabled={finishBusy || !(draft.folders.length > 0 || draft.foldersSkipped)}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => void onFinishClick()}
                    >
                      Finish setup
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
