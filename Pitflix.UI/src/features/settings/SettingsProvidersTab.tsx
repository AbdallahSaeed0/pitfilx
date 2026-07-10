import { Eye, EyeOff, HelpCircle, Key } from "lucide-react";
import {
  saveSettings,
  verifyMdblistKey,
  verifyOpenSubtitlesKey,
  verifySubDlKey,
  verifySubSourceKey,
  verifyTmdbKey,
  verifyTvdbKey,
} from "../../api/settings";
import type { SettingsPageModel } from "./useSettingsPageModel";

type Props = { model: SettingsPageModel };

export function SettingsProvidersTab({ model }: Props) {
  const {
    data,
    setApiKeyGuide,
    tmdbKeyInput,
    setTmdbKeyInput,
    showTmdbKey,
    setShowTmdbKey,
    tmdbVerifyBusy,
    setTmdbVerifyBusy,
    setApiKeyMsg,
    osKeyInput,
    setOsKeyInput,
    showOsKey,
    setShowOsKey,
    osVerifyBusy,
    setOsVerifyBusy,
    sdlKeyInput,
    setSdlKeyInput,
    showSdlKey,
    setShowSdlKey,
    sdlVerifyBusy,
    setSdlVerifyBusy,
    ssKeyInput,
    setSsKeyInput,
    showSsKey,
    setShowSsKey,
    ssVerifyBusy,
    setSsVerifyBusy,
    apiKeyBusy,
    setApiKeyBusy,
    apiKeyMsg,
    refetchSettings,
    addlSourcesOpen,
    setAddlSourcesOpen,
    mdblistKeyInput,
    setMdblistKeyInput,
    showMdblistKey,
    setShowMdblistKey,
    mdblistVerifyBusy,
    setMdblistVerifyBusy,
    setAddlSourcesMsg,
    tvdbKeyInput,
    setTvdbKeyInput,
    showTvdbKey,
    setShowTvdbKey,
    tvdbVerifyBusy,
    setTvdbVerifyBusy,
    addlSourcesMsg,
  } = model;

  return (
    <>
<section
            id="settings-providers"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <Key className="h-4 w-4 text-amber-400" strokeWidth={2} />
              API keys
            </h2>
            <p className="mb-4 text-[10px] text-pitflix-subtle">
              Stored in your Pitflix database for this Windows user — not in appsettings files.
            </p>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-pitflix-muted">TMDB API key</span>
                    <button
                      type="button"
                      aria-label="How to get a TMDB API key"
                      title="How to get this key"
                      className="text-pitflix-subtle transition-colors hover:text-pitflix-primary"
                      onClick={() => setApiKeyGuide("tmdb")}
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </span>
                  <span className="truncate text-[10px] text-pitflix-subtle" title={data?.tmdbApiKey ?? ""}>
                    {data?.tmdbApiKey ? `Saved: ${data.tmdbApiKey}` : "Not set"}
                  </span>
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type={showTmdbKey ? "text" : "password"}
                    value={tmdbKeyInput}
                    onChange={(e) => setTmdbKeyInput(e.target.value)}
                    placeholder="Enter new key to replace…"
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
                    aria-label={showTmdbKey ? "Hide key" : "Show key"}
                    onClick={() => setShowTmdbKey((v) => !v)}
                  >
                    {showTmdbKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={tmdbVerifyBusy}
                    className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
                    onClick={() => {
                      setApiKeyMsg(null);
                      const k = tmdbKeyInput.trim();
                      if (!k) {
                        setApiKeyMsg("Type a key above to verify.");
                        return;
                      }
                      setTmdbVerifyBusy(true);
                      void verifyTmdbKey(k)
                        .then((r) =>
                          setApiKeyMsg(r.valid ? "TMDB: key is valid." : `TMDB: ${r.error ?? "invalid"}`),
                        )
                        .catch(() => setApiKeyMsg("TMDB verify failed."))
                        .finally(() => setTmdbVerifyBusy(false));
                    }}
                  >
                    {tmdbVerifyBusy ? "Verifying…" : "Verify"}
                  </button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-pitflix-muted">OpenSubtitles API key</span>
                    <button
                      type="button"
                      aria-label="How to get an OpenSubtitles API key"
                      title="How to get this key"
                      className="text-pitflix-subtle transition-colors hover:text-pitflix-primary"
                      onClick={() => setApiKeyGuide("opensubtitles")}
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </span>
                  <span
                    className="truncate text-[10px] text-pitflix-subtle"
                    title={data?.openSubtitlesApiKey ?? ""}
                  >
                    {data?.openSubtitlesApiKey ? `Saved: ${data.openSubtitlesApiKey}` : "Not set"}
                  </span>
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type={showOsKey ? "text" : "password"}
                    value={osKeyInput}
                    onChange={(e) => setOsKeyInput(e.target.value)}
                    placeholder="Enter new key to replace…"
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
                    aria-label={showOsKey ? "Hide key" : "Show key"}
                    onClick={() => setShowOsKey((v) => !v)}
                  >
                    {showOsKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={osVerifyBusy}
                    className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
                    onClick={() => {
                      setApiKeyMsg(null);
                      const k = osKeyInput.trim();
                      if (!k) {
                        setApiKeyMsg("Type an OpenSubtitles key to verify.");
                        return;
                      }
                      setOsVerifyBusy(true);
                      void verifyOpenSubtitlesKey(k)
                        .then((r) =>
                          setApiKeyMsg(
                            r.valid ? "OpenSubtitles: key is valid." : `OpenSubtitles: ${r.error ?? "invalid"}`,
                          ),
                        )
                        .catch(() => setApiKeyMsg("OpenSubtitles verify failed."))
                        .finally(() => setOsVerifyBusy(false));
                    }}
                  >
                    {osVerifyBusy ? "Verifying…" : "Verify"}
                  </button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-pitflix-muted">SubDL API key</span>
                    <button
                      type="button"
                      aria-label="How to get a SubDL API key"
                      title="How to get this key"
                      className="text-pitflix-subtle transition-colors hover:text-pitflix-primary"
                      onClick={() => setApiKeyGuide("subdl")}
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </span>
                  <span
                    className="truncate text-[10px] text-pitflix-subtle"
                    title={data?.subDlApiKey ?? ""}
                  >
                    {data?.subDlApiKey ? `Saved: ${data.subDlApiKey}` : "Not set"}
                  </span>
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type={showSdlKey ? "text" : "password"}
                    value={sdlKeyInput}
                    onChange={(e) => setSdlKeyInput(e.target.value)}
                    placeholder="Enter SubDL API key…"
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
                    aria-label={showSdlKey ? "Hide key" : "Show key"}
                    onClick={() => setShowSdlKey((v) => !v)}
                  >
                    {showSdlKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={sdlVerifyBusy}
                    className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
                    onClick={() => {
                      setApiKeyMsg(null);
                      const k = sdlKeyInput.trim();
                      if (!k) {
                        setApiKeyMsg("Type a SubDL key to verify.");
                        return;
                      }
                      setSdlVerifyBusy(true);
                      void verifySubDlKey(k)
                        .then((r) =>
                          setApiKeyMsg(
                            r.valid ? "SubDL: key is valid." : `SubDL: ${r.error ?? "invalid"}`,
                          ),
                        )
                        .catch(() => setApiKeyMsg("SubDL verify failed."))
                        .finally(() => setSdlVerifyBusy(false));
                    }}
                  >
                    {sdlVerifyBusy ? "Verifying…" : "Verify"}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-pitflix-subtle">
                  Get a free key at subdl.com — enables SubDL subtitle search.
                </p>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-pitflix-muted">SubSource API key</span>
                    <button
                      type="button"
                      aria-label="How to get a SubSource API key"
                      title="How to get this key"
                      className="text-pitflix-subtle transition-colors hover:text-pitflix-primary"
                      onClick={() => setApiKeyGuide("subsource")}
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </span>
                  <span
                    className="truncate text-[10px] text-pitflix-subtle"
                    title={data?.subSourceApiKey ?? ""}
                  >
                    {data?.subSourceApiKey ? `Saved: ${data.subSourceApiKey}` : "Not set"}
                  </span>
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type={showSsKey ? "text" : "password"}
                    value={ssKeyInput}
                    onChange={(e) => setSsKeyInput(e.target.value)}
                    placeholder="Enter SubSource API key…"
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
                    aria-label={showSsKey ? "Hide key" : "Show key"}
                    onClick={() => setShowSsKey((v) => !v)}
                  >
                    {showSsKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={ssVerifyBusy}
                    className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
                    onClick={() => {
                      setApiKeyMsg(null);
                      const k = ssKeyInput.trim();
                      if (!k) {
                        setApiKeyMsg("Type a SubSource key to verify.");
                        return;
                      }
                      setSsVerifyBusy(true);
                      void verifySubSourceKey(k)
                        .then((r) =>
                          setApiKeyMsg(
                            r.valid ? "SubSource: key is valid." : `SubSource: ${r.error ?? "invalid"}`,
                          ),
                        )
                        .catch(() => setApiKeyMsg("SubSource verify failed."))
                        .finally(() => setSsVerifyBusy(false));
                    }}
                  >
                    {ssVerifyBusy ? "Verifying…" : "Verify"}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-pitflix-subtle">
                  Get a free key at subsource.net — enables SubSource subtitle search.
                </p>
              </div>

              <button
                type="button"
                disabled={apiKeyBusy}
                className="w-full rounded-xl bg-pitflix-primary py-2.5 text-xs font-semibold text-white shadow-sm shadow-pitflix-primary/25 transition-all hover:bg-pitflix-light hover:shadow-pitflix-primary/40 disabled:opacity-50"
                onClick={() => {
                  setApiKeyMsg(null);
                  if (!tmdbKeyInput.trim() && !osKeyInput.trim() && !sdlKeyInput.trim() && !ssKeyInput.trim()) {
                    setApiKeyMsg("Enter at least one key to save, or use Verify only.");
                    return;
                  }
                  setApiKeyBusy(true);
                  void saveSettings({
                    ...(tmdbKeyInput.trim() ? { tmdbApiKey: tmdbKeyInput.trim() } : {}),
                    ...(osKeyInput.trim() ? { openSubtitlesApiKey: osKeyInput.trim() } : {}),
                    ...(sdlKeyInput.trim() ? { subDlApiKey: sdlKeyInput.trim() } : {}),
                    ...(ssKeyInput.trim() ? { subSourceApiKey: ssKeyInput.trim() } : {}),
                  })
                    .then(() => {
                      setApiKeyMsg("Saved.");
                      setTmdbKeyInput("");
                      setOsKeyInput("");
                      setSdlKeyInput("");
                      setSsKeyInput("");
                      refetchSettings();
                    })
                    .catch(() => setApiKeyMsg("Save failed."))
                    .finally(() => setApiKeyBusy(false));
                }}
              >
                {apiKeyBusy ? "Saving…" : "Save keys"}
              </button>
              {apiKeyMsg ? <p className="text-[11px] text-pitflix-muted">{apiKeyMsg}</p> : null}
            </div>
          </section>

          {/* ── Additional Sources ────────────────────────────────── */}
          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 shadow-xl shadow-black/30 backdrop-blur-sm overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
              onClick={() => setAddlSourcesOpen((o) => !o)}
            >
              <span className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-white">
                <span className="text-pitflix-primary">⊕</span>
                Additional Sources
              </span>
              <span className="text-[11px] text-white/30">{addlSourcesOpen ? "▲ Collapse" : "▼ Expand"}</span>
            </button>
            {addlSourcesOpen && (
              <div className="border-t border-white/[0.06] px-6 pb-6 pt-4">
                <p className="mb-4 text-[11px] text-pitflix-subtle">
                  Optional enrichment sources. MDBList adds aggregated ratings (RT, Metacritic, Letterboxd). TVDB adds
                  artwork and character data.
                </p>
                <div className="space-y-5">
                  {/* MDBList */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-pitflix-muted">MDBList API key</span>
                        <button
                          type="button"
                          aria-label="How to get an MDBList API key"
                          title="How to get this key"
                          className="text-pitflix-subtle transition-colors hover:text-pitflix-primary"
                          onClick={() => setApiKeyGuide("mdblist")}
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </span>
                      <span className="truncate text-[10px] text-pitflix-subtle">
                        {(data as { mdblistApiKey?: string } | undefined)?.mdblistApiKey
                          ? `Saved: ${(data as { mdblistApiKey?: string }).mdblistApiKey}`
                          : "Not set"}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2">
                      <input
                        type={showMdblistKey ? "text" : "password"}
                        value={mdblistKeyInput}
                        onChange={(e) => setMdblistKeyInput(e.target.value)}
                        placeholder="Enter MDBList API key…"
                        autoComplete="off"
                        className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
                        aria-label={showMdblistKey ? "Hide key" : "Show key"}
                        onClick={() => setShowMdblistKey((v) => !v)}
                      >
                        {showMdblistKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={mdblistVerifyBusy}
                        className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
                        onClick={() => {
                          setAddlSourcesMsg(null);
                          const k = mdblistKeyInput.trim();
                          if (!k) { setAddlSourcesMsg("Type a key to save & test."); return; }
                          setMdblistVerifyBusy(true);
                          // Save first, then verify — so the key is always persisted before use
                          void saveSettings({ mdblistApiKey: k })
                            .then(() => refetchSettings())
                            .then(() => verifyMdblistKey(k))
                            .then((r) =>
                              setAddlSourcesMsg(
                                r.valid
                                  ? `Saved. MDBList connected — Shawshank IMDb: ${r.imdbScore ?? "n/a"}`
                                  : `Saved, but key test failed: ${r.error ?? "invalid"}`,
                              ),
                            )
                            .catch(() => setAddlSourcesMsg("Save or test failed."))
                            .finally(() => { setMdblistVerifyBusy(false); setMdblistKeyInput(""); });
                        }}
                      >
                        {mdblistVerifyBusy ? "Saving…" : "Save & Test"}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-pitflix-subtle">
                      Free at{" "}
                      <a href="https://mdblist.com" target="_blank" rel="noreferrer" className="text-pitflix-primary hover:underline">
                        mdblist.com
                      </a>{" "}
                      — 1 000 req/day on the free tier.
                    </p>
                  </div>

                  {/* TVDB */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-pitflix-muted">TVDB API key</span>
                        <button
                          type="button"
                          aria-label="How to get a TVDB API key"
                          title="How to get this key"
                          className="text-pitflix-subtle transition-colors hover:text-pitflix-primary"
                          onClick={() => setApiKeyGuide("tvdb")}
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </span>
                      <span className="truncate text-[10px] text-pitflix-subtle">
                        {(data as { tvdbApiKey?: string } | undefined)?.tvdbApiKey
                          ? `Saved: ${(data as { tvdbApiKey?: string }).tvdbApiKey}`
                          : "Not set"}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2">
                      <input
                        type={showTvdbKey ? "text" : "password"}
                        value={tvdbKeyInput}
                        onChange={(e) => setTvdbKeyInput(e.target.value)}
                        placeholder="Enter TVDB v4 API key…"
                        autoComplete="off"
                        className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
                        aria-label={showTvdbKey ? "Hide key" : "Show key"}
                        onClick={() => setShowTvdbKey((v) => !v)}
                      >
                        {showTvdbKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={tvdbVerifyBusy}
                        className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
                        onClick={() => {
                          setAddlSourcesMsg(null);
                          const k = tvdbKeyInput.trim();
                          if (!k) { setAddlSourcesMsg("Type a key to save & test."); return; }
                          setTvdbVerifyBusy(true);
                          void saveSettings({ tvdbApiKey: k })
                            .then(() => refetchSettings())
                            .then(() => verifyTvdbKey(k))
                            .then((r) =>
                              setAddlSourcesMsg(
                                r.valid ? "Saved. TVDB connected — token obtained." : `Saved, but key test failed: ${r.error ?? "invalid"}`,
                              ),
                            )
                            .catch(() => setAddlSourcesMsg("Save or test failed."))
                            .finally(() => { setTvdbVerifyBusy(false); setTvdbKeyInput(""); });
                        }}
                      >
                        {tvdbVerifyBusy ? "Saving…" : "Save & Test"}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-pitflix-subtle">
                      Free at{" "}
                      <a href="https://thetvdb.com/api-information" target="_blank" rel="noreferrer" className="text-pitflix-primary hover:underline">
                        thetvdb.com/api-information
                      </a>
                    </p>
                  </div>

                  {addlSourcesMsg ? <p className="text-[11px] text-pitflix-muted">{addlSourcesMsg}</p> : null}
                </div>
              </div>
            )}
          </section>

    </>
  );
}
