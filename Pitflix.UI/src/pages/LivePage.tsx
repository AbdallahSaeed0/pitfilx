import { useState, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { usePlayback } from "../hooks/usePlayback";
import { useAppPrefsStore } from "../store/appPrefsStore";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  Antenna,
  ChevronRight,
  CirclePlay,
  FileUp,
  Globe,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Signal,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import {
  createProvider,
  deleteProvider,
  getChannels,
  getGroups,
  getProviders,
  importM3uContent,
  refreshProvider,
  testXtreamConnection,
  updateProvider,
  type CreateProviderPayload,
  type IptvChannel,
  type IptvProvider,
  type IptvProviderType,
} from "../api/iptv";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";

// ── Provider form ─────────────────────────────────────────────────────────────

type ProviderFormState = {
  displayName: string;
  type: IptvProviderType;
  m3uSource: "url" | "file";
  m3uUrl: string;
  m3uFileName: string;
  m3uFileContent: string | null;
  serverUrl: string;
  username: string;
  password: string;
  epgUrl: string;
};

const DEFAULT_FORM: ProviderFormState = {
  displayName: "",
  type: "XtreamCodes",
  m3uSource: "url",
  m3uUrl: "",
  m3uFileName: "",
  m3uFileContent: null,
  serverUrl: "",
  username: "",
  password: "",
  epgUrl: "",
};

function providerToForm(p: IptvProvider): ProviderFormState {
  return {
    displayName: p.displayName,
    type: p.type,
    m3uSource: "url",
    m3uUrl: p.m3uUrl ?? "",
    m3uFileName: "",
    m3uFileContent: null,
    serverUrl: p.serverUrl ?? "",
    username: p.username ?? "",
    password: "",
    epgUrl: p.epgUrl ?? "",
  };
}

type ProviderTypeOption = {
  id: IptvProviderType;
  label: string;
  description: string;
  icon: React.ReactNode;
};

const PROVIDER_TYPES: ProviderTypeOption[] = [
  {
    id: "M3uUrl",
    label: "M3U playlist",
    description: "Direct .m3u or get.php URL with credentials baked in.",
    icon: <Tv className="h-5 w-5" />,
  },
  {
    id: "XtreamCodes",
    label: "Xtream codes",
    description: "Server URL plus username and password.",
    icon: <Signal className="h-5 w-5" />,
  },
  {
    id: "EpgOnly",
    label: "EPG / XMLTV only",
    description: "Standalone guide source to attach to existing playlists.",
    icon: <Globe className="h-5 w-5" />,
  },
];

// ── Add / Edit Provider Dialog ─────────────────────────────────────────────────

function ProviderDialog({
  editProvider,
  onClose,
  onSaved,
}: {
  editProvider?: IptvProvider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editProvider;
  const [form, setForm] = useState<ProviderFormState>(
    isEdit ? providerToForm(editProvider!) : DEFAULT_FORM,
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<ProviderFormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTestResult(null);
    setError(null);
  };

  const handleTest = async () => {
    if (!form.serverUrl || !form.username) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testXtreamConnection(form.serverUrl, form.username, form.password);
      setTestResult(r.success ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  const handlePickFile = async () => {
    if (isTauri()) {
      try {
        const filePath = await open({
          multiple: false,
          title: "Select M3U playlist file",
          filters: [{ name: "M3U Playlist", extensions: ["m3u", "m3u8", "txt"] }],
        });
        if (typeof filePath === "string") {
          const content = await readTextFile(filePath);
          const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
          set({ m3uFileContent: content, m3uFileName: fileName });
        }
      } catch {
        setError("Could not read the file.");
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    set({ m3uFileContent: content, m3uFileName: file.name });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = async () => {
    setError(null);
    const payload: CreateProviderPayload = {
      displayName: form.displayName.trim() || labelForType(form.type),
      type: form.type,
      m3uUrl:
        form.type === "M3uUrl" && form.m3uSource === "url"
          ? form.m3uUrl.trim() || undefined
          : undefined,
      serverUrl: form.type === "XtreamCodes" ? form.serverUrl.trim() || undefined : undefined,
      username: form.type === "XtreamCodes" ? form.username.trim() || undefined : undefined,
      password: form.type === "XtreamCodes" ? form.password.trim() || undefined : undefined,
      epgUrl: form.epgUrl.trim() || undefined,
    };
    setSaving(true);
    try {
      if (isEdit) {
        await updateProvider(editProvider!.id, payload);
        if (form.type === "M3uUrl" && form.m3uSource === "file" && form.m3uFileContent) {
          await importM3uContent(editProvider!.id, form.m3uFileContent);
        }
      } else {
        const { id } = await createProvider(payload);
        if (form.type === "M3uUrl" && form.m3uSource === "file" && form.m3uFileContent) {
          await importM3uContent(id, form.m3uFileContent);
        }
      }
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save provider.");
    } finally {
      setSaving(false);
    }
  };

  function labelForType(t: IptvProviderType) {
    return PROVIDER_TYPES.find((x) => x.id === t)?.label ?? "Provider";
  }

  const canSave =
    form.type === "M3uUrl"
      ? form.m3uSource === "url"
        ? !!form.m3uUrl.trim()
        : !!form.m3uFileContent
      : form.type === "XtreamCodes"
        ? !!form.serverUrl.trim() && !!form.username.trim()
        : true;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900/98 to-pitflix-bg p-6 shadow-2xl shadow-black/80 ring-1 ring-white/5">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              {isEdit ? "Edit provider" : "Connect your provider."}
            </h2>
            <p className="mt-1 text-sm text-pitflix-muted">
              {isEdit
                ? "Update provider details."
                : "Pick how you authenticate. Everything is stored locally."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-pitflix-muted hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Provider type picker */}
        <div className="mb-6 space-y-2">
          {PROVIDER_TYPES.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => set({ type: opt.id })}
              className={cn(
                "flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-all",
                form.type === opt.id
                  ? "border-pitflix-primary bg-pitflix-primary/10 shadow-[0_0_14px_rgba(139,92,246,0.25)]"
                  : "border-white/10 bg-black/20 hover:border-white/20",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
                  form.type === opt.id
                    ? "border-pitflix-primary/60 bg-pitflix-primary/20 text-violet-300"
                    : "border-white/10 bg-white/5 text-pitflix-muted",
                )}
              >
                {opt.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className={cn("font-semibold", form.type === opt.id ? "text-white" : "text-pitflix-muted")}>
                  {opt.label}
                </p>
                <p className="text-xs text-pitflix-subtle mt-0.5">{opt.description}</p>
              </div>
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                  form.type === opt.id ? "border-pitflix-primary bg-pitflix-primary" : "border-white/20",
                )}
              >
                {form.type === opt.id && <span className="block h-2 w-2 rounded-full bg-white" />}
              </span>
            </button>
          ))}
        </div>

        {/* Display name */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
            Display name <span className="normal-case font-normal text-pitflix-subtle">Optional</span>
          </label>
          <input
            value={form.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
            placeholder={labelForType(form.type)}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25"
          />
        </div>

        {/* M3U — source toggle + fields */}
        {form.type === "M3uUrl" && (
          <div className="mb-4">
            {/* URL / File toggle */}
            <div className="mb-3 flex rounded-xl border border-white/10 bg-black/30 p-1">
              <button
                type="button"
                onClick={() => set({ m3uSource: "url" })}
                className={cn(
                  "flex-1 rounded-lg py-2 text-sm font-medium transition-all",
                  form.m3uSource === "url"
                    ? "bg-pitflix-primary text-white shadow"
                    : "text-pitflix-muted hover:text-white",
                )}
              >
                URL
              </button>
              <button
                type="button"
                onClick={() => set({ m3uSource: "file" })}
                className={cn(
                  "flex-1 rounded-lg py-2 text-sm font-medium transition-all",
                  form.m3uSource === "file"
                    ? "bg-pitflix-primary text-white shadow"
                    : "text-pitflix-muted hover:text-white",
                )}
              >
                Import file
              </button>
            </div>

            {form.m3uSource === "url" ? (
              <>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  M3U URL
                </label>
                <input
                  value={form.m3uUrl}
                  onChange={(e) => set({ m3uUrl: e.target.value })}
                  placeholder="https://example-iptv.com:8080/get.php?username=...&password=..."
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25"
                />
              </>
            ) : (
              <>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  .m3u / .m3u8 file
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".m3u,.m3u8,.txt"
                  className="hidden"
                  onChange={(e) => void handleFileInput(e)}
                />
                <button
                  type="button"
                  onClick={() => void handlePickFile()}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all",
                    form.m3uFileContent
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                      : "border-dashed border-white/20 bg-black/20 text-pitflix-muted hover:border-pitflix-primary/50 hover:text-white",
                  )}
                >
                  <FileUp className="h-4 w-4 shrink-0" />
                  {form.m3uFileContent ? (
                    <span className="truncate font-medium">{form.m3uFileName}</span>
                  ) : (
                    <span>Click to browse for a .m3u file…</span>
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {/* Xtream Codes fields */}
        {form.type === "XtreamCodes" && (
          <>
            <div className="mb-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
                Server URL
              </label>
              <input
                value={form.serverUrl}
                onChange={(e) => set({ serverUrl: e.target.value })}
                placeholder="https://example-iptv.com:8080"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25"
              />
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Username
                </label>
                <input
                  value={form.username}
                  onChange={(e) => set({ username: e.target.value })}
                  placeholder="user12345"
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Password
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => set({ password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25"
                />
              </div>
            </div>
            {/* Test connection */}
            <div className="mb-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={testing || !form.serverUrl || !form.username}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3.5 py-2 text-sm text-pitflix-muted hover:text-white disabled:opacity-40 transition-colors"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Test connection
              </button>
              {testResult === "ok" && (
                <span className="text-sm font-medium text-emerald-400">Connected successfully</span>
              )}
              {testResult === "fail" && (
                <span className="text-sm font-medium text-red-400">Connection failed</span>
              )}
            </div>
          </>
        )}

        {/* EPG URL (shared) */}
        {form.type !== "EpgOnly" ? null : (
          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
              EPG / XMLTV URL
            </label>
            <input
              value={form.epgUrl}
              onChange={(e) => set({ epgUrl: e.target.value })}
              placeholder="https://epg.example.com/guide.xml"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25"
            />
          </div>
        )}

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {/* Footer buttons */}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-pitflix-muted hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !canSave}
            className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-pitflix-light disabled:opacity-40 transition-colors"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Channel card ──────────────────────────────────────────────────────────────

function ChannelRow({
  channel,
  onPlay,
}: {
  channel: IptvChannel;
  onPlay: (ch: IptvChannel) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPlay(channel)}
      onKeyDown={(e) => e.key === "Enter" && onPlay(channel)}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-all hover:border-pitflix-primary/30 hover:bg-white/5"
    >
      {/* Logo */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
        {channel.logoUrl && !imgFailed ? (
          <img
            src={channel.logoUrl}
            alt=""
            className="h-full w-full object-contain"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <Antenna className="h-5 w-5 text-pitflix-subtle" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{channel.name}</p>
        {channel.group && (
          <p className="truncate text-xs text-pitflix-muted">{channel.group}</p>
        )}
      </div>

      <CirclePlay className="h-5 w-5 shrink-0 text-pitflix-subtle opacity-0 transition-all group-hover:opacity-100 group-hover:text-pitflix-primary" />
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onRefresh,
  refreshing,
}: {
  provider: IptvProvider;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const typeLabel = PROVIDER_TYPES.find((t) => t.id === provider.type)?.label ?? provider.type;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "group relative cursor-pointer rounded-xl border px-4 py-4 transition-all",
        selected
          ? "border-pitflix-primary bg-pitflix-primary/10 shadow-[0_0_18px_rgba(139,92,246,0.2)]"
          : "border-white/10 bg-pitflix-card hover:border-pitflix-primary/40",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
            selected
              ? "border-pitflix-primary/60 bg-pitflix-primary/20 text-violet-300"
              : "border-white/10 bg-white/5 text-pitflix-muted",
          )}
        >
          <Signal className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{provider.displayName}</p>
          <p className="mt-0.5 text-xs text-pitflix-muted">{typeLabel}</p>
          <p className="mt-1 text-xs text-pitflix-subtle">
            {provider.channelCount > 0
              ? `${provider.channelCount.toLocaleString()} channels`
              : "No channels yet"}
            {provider.lastRefreshedAt && (
              <> · refreshed {new Date(provider.lastRefreshedAt).toLocaleDateString()}</>
            )}
          </p>
        </div>
        {selected && <ChevronRight className="h-4 w-4 shrink-0 text-pitflix-primary mt-0.5" />}
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2 opacity-0 transition-all group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          disabled={refreshing}
          title="Refresh channels"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-pitflix-muted hover:text-white transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-pitflix-muted hover:text-white transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-pitflix-muted hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function LivePage() {
  const liveTvEnabled = useAppPrefsStore((s) => s.liveTvEnabled);
  const qc = useQueryClient();
  const { play } = usePlayback();
  const [showDialog, setShowDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<IptvProvider | undefined>();
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [importingM3u, setImportingM3u] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: providers = [], isLoading: loadingProviders } = useQuery({
    queryKey: ["iptv-providers"],
    queryFn: getProviders,
  });

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) ?? null;

  const { data: groups = [] } = useQuery({
    queryKey: ["iptv-groups", selectedProviderId],
    queryFn: () => getGroups(selectedProviderId!),
    enabled: selectedProviderId != null && (selectedProvider?.channelCount ?? 0) > 0,
  });

  const { data: channels = [], isLoading: loadingChannels } = useQuery({
    queryKey: ["iptv-channels", selectedProviderId, activeGroup, search],
    queryFn: () =>
      getChannels(selectedProviderId!, {
        group: activeGroup ?? undefined,
        search: search.trim() || undefined,
      }),
    enabled: selectedProviderId != null && (selectedProvider?.channelCount ?? 0) > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteProvider(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["iptv-providers"] });
      if (selectedProviderId !== null) setSelectedProviderId(null);
    },
  });

  const handleRefresh = async (id: number) => {
    setRefreshingId(id);
    try {
      await refreshProvider(id);
      void qc.invalidateQueries({ queryKey: ["iptv-providers"] });
      void qc.invalidateQueries({ queryKey: ["iptv-channels", id] });
      void qc.invalidateQueries({ queryKey: ["iptv-groups", id] });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDialogSaved = () => {
    setShowDialog(false);
    setEditingProvider(undefined);
    void qc.invalidateQueries({ queryKey: ["iptv-providers"] });
  };

  // M3U file import via Tauri file dialog or <input type="file">
  const handleImportM3u = async () => {
    if (selectedProviderId == null) return;
    setImportingM3u(true);
    try {
      if (isTauri()) {
        const filePath = await open({
          multiple: false,
          title: "Select M3U playlist file",
          filters: [{ name: "M3U Playlist", extensions: ["m3u", "m3u8", "txt"] }],
        });
        if (typeof filePath === "string") {
          const content = await readTextFile(filePath);
          await importM3uContent(selectedProviderId, content);
          void qc.invalidateQueries({ queryKey: ["iptv-providers"] });
          void qc.invalidateQueries({ queryKey: ["iptv-channels", selectedProviderId] });
          void qc.invalidateQueries({ queryKey: ["iptv-groups", selectedProviderId] });
        }
      } else {
        fileInputRef.current?.click();
      }
    } finally {
      setImportingM3u(false);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || selectedProviderId == null) return;
    setImportingM3u(true);
    try {
      const content = await file.text();
      await importM3uContent(selectedProviderId, content);
      void qc.invalidateQueries({ queryKey: ["iptv-providers"] });
      void qc.invalidateQueries({ queryKey: ["iptv-channels", selectedProviderId] });
      void qc.invalidateQueries({ queryKey: ["iptv-groups", selectedProviderId] });
    } finally {
      setImportingM3u(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePlay = (ch: IptvChannel) => {
    void play(
      ch.streamUrl,
      ch.name,
      ch.logoUrl ?? null,
      "LiveTV",
      0,
      {
        suppressContinueWatching: true,
        liveChannels: channels.map((c) => ({
          name: c.name,
          streamUrl: c.streamUrl,
          logoUrl: c.logoUrl ?? null,
        })),
      },
    );
  };

  const handleSelectProvider = (id: number) => {
    setSelectedProviderId(id === selectedProviderId ? null : id);
    setActiveGroup(null);
    setSearch("");
  };

  if (!liveTvEnabled) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Live TV</h1>
          <p className="mt-1 text-sm text-pitflix-muted">
            {providers.length > 0
              ? `${providers.length} provider${providers.length !== 1 ? "s" : ""} · ${providers.reduce((s, p) => s + p.channelCount, 0).toLocaleString()} channels`
              : "Add an IPTV provider to get started."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingProvider(undefined);
            setShowDialog(true);
          }}
          className="flex items-center gap-2 rounded-xl bg-pitflix-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-pitflix-light"
        >
          <Plus className="h-4 w-4" />
          Add Provider
        </button>
      </div>

      {/* Body */}
      {loadingProviders ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : providers.length === 0 ? (
        <EmptyState onAdd={() => setShowDialog(true)} />
      ) : (
        <div className="flex min-h-0 flex-1 gap-5">
          {/* Provider list */}
          <div className="w-72 shrink-0 space-y-2 overflow-y-auto pr-1">
            {providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                selected={selectedProviderId === p.id}
                onSelect={() => handleSelectProvider(p.id)}
                onEdit={() => {
                  setEditingProvider(p);
                  setShowDialog(true);
                }}
                onDelete={() => {
                  if (window.confirm(`Delete "${p.displayName}"?`)) {
                    deleteMutation.mutate(p.id);
                  }
                }}
                onRefresh={() => void handleRefresh(p.id)}
                refreshing={refreshingId === p.id}
              />
            ))}
          </div>

          {/* Channel browser */}
          {selectedProvider == null ? (
            <div className="flex flex-1 items-center justify-center text-pitflix-muted">
              <p className="text-sm">Select a provider to browse channels.</p>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {/* Channel browser toolbar */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-48">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-subtle" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search channels..."
                    className="w-full rounded-xl border border-white/10 bg-black/40 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25"
                  />
                </div>
                {selectedProvider.type === "M3uUrl" && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".m3u,.m3u8,.txt"
                      className="hidden"
                      onChange={(e) => void handleFileInput(e)}
                    />
                    <button
                      type="button"
                      onClick={() => void handleImportM3u()}
                      disabled={importingM3u}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3.5 py-2.5 text-sm text-pitflix-muted hover:text-white disabled:opacity-40 transition-colors"
                    >
                      {importingM3u ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileUp className="h-4 w-4" />
                      )}
                      Import file
                    </button>
                  </>
                )}
                {selectedProvider.channelCount === 0 && selectedProvider.type !== "EpgOnly" && (
                  <button
                    type="button"
                    onClick={() => void handleRefresh(selectedProvider.id)}
                    disabled={refreshingId === selectedProvider.id}
                    className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-3.5 py-2.5 text-sm font-medium text-white hover:bg-pitflix-light disabled:opacity-40 transition-colors"
                  >
                    {refreshingId === selectedProvider.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Fetch channels
                  </button>
                )}
              </div>

              {/* Groups */}
              {groups.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveGroup(null)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      activeGroup == null
                        ? "border-pitflix-primary bg-pitflix-primary/20 text-violet-300"
                        : "border-white/10 text-pitflix-muted hover:text-white",
                    )}
                  >
                    All
                  </button>
                  {groups.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setActiveGroup(g === activeGroup ? null : g)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        activeGroup === g
                          ? "border-pitflix-primary bg-pitflix-primary/20 text-violet-300"
                          : "border-white/10 text-pitflix-muted hover:text-white",
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              )}

              {/* Channel list */}
              {selectedProvider.channelCount === 0 && selectedProvider.type !== "EpgOnly" ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <Signal className="h-10 w-10 text-pitflix-subtle" />
                  <p className="text-sm font-medium text-pitflix-muted">No channels loaded yet</p>
                  <p className="text-xs text-pitflix-subtle max-w-xs">
                    {selectedProvider.type === "M3uUrl"
                      ? "Import a .m3u file or fetch channels from the M3U URL."
                      : "Click \u201cFetch channels\u201d to load from the server."}
                  </p>
                </div>
              ) : loadingChannels ? (
                <div className="flex flex-1 items-center justify-center">
                  <Spinner />
                </div>
              ) : channels.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-sm text-pitflix-muted">
                  No channels match your search.
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/5 bg-black/20 p-2">
                  {channels.map((ch) => (
                    <ChannelRow key={ch.id} channel={ch} onPlay={handlePlay} />
                  ))}
                  {channels.length >= 500 && (
                    <p className="p-3 text-center text-xs text-pitflix-subtle">
                      Showing first 500 results — refine your search to see more.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hidden file input (browser fallback) */}
      {selectedProvider == null && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".m3u,.m3u8,.txt"
          className="hidden"
          onChange={(e) => void handleFileInput(e)}
        />
      )}

      {/* Dialogs */}
      {showDialog && (
        <ProviderDialog
          editProvider={editingProvider}
          onClose={() => {
            setShowDialog(false);
            setEditingProvider(undefined);
          }}
          onSaved={handleDialogSaved}
        />
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        <Antenna className="h-10 w-10 text-pitflix-muted" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white">No providers yet</h2>
        <p className="mt-1.5 max-w-sm text-sm text-pitflix-muted">
          Connect an IPTV provider using Xtream codes, an M3U playlist URL, or import a local .m3u
          file to start watching live channels.
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-2 rounded-xl bg-pitflix-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-pitflix-light"
      >
        <Plus className="h-4 w-4" />
        Add your first provider
      </button>
    </div>
  );
}
