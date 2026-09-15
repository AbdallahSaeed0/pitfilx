import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowRight, Check, FolderPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fileDisplayTitle, type DeviceFsEntry } from "./deviceUtils";

function NewFolderPrompt({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 210, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)" }} onClick={onCancel}>
      <div style={{ width: 320, background: "#1C1C1C", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", marginBottom: 12 }}>New folder</div>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
          placeholder="Name…"
          style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 12px", color: "#e0e0f0", fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 14 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onCancel} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(224,224,240,0.8)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button type="button" disabled={!name.trim()} onClick={submit} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#7c3aed,#5b21b6)", color: "white", fontSize: 12.5, fontWeight: 700, cursor: name.trim() ? "pointer" : "not-allowed", opacity: name.trim() ? 1 : 0.4 }}>
            Create &amp; file here
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Fast keyboard-driven manual sort: watch a beat, type a name, Enter files it and jumps to the
 * next one. For batches where no automatic matching technique found anything — a human still has
 * to identify each video, this just makes doing that as fast as possible (no drag-and-drop, no
 * per-video menu, no re-opening a picker each time).
 */
export function DeviceQuickSortModal({
  videos,
  subfolders,
  onMove,
  onCreateAndMove,
  onClose,
}: {
  videos: DeviceFsEntry[];
  subfolders: DeviceFsEntry[];
  onMove: (path: string, destinationDir: string) => Promise<void>;
  /** Returns the new folder's absolute path so it can be tracked locally right away — otherwise a
   * folder created mid-session wouldn't be searchable for the *next* videos until the whole tool
   * were reopened. */
  onCreateAndMove: (path: string, folderName: string) => Promise<string>;
  onClose: () => void;
}) {
  const [remaining, setRemaining] = useState(videos);
  const [doneCount, setDoneCount] = useState(0);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState(subfolders);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const totalCount = videos.length;

  const current = remaining[0] ?? null;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return folders.slice(0, 40);
    return folders.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 40);
  }, [search, folders]);

  const exactExists = matches.some((f) => f.name.toLowerCase() === search.trim().toLowerCase());
  const showCreateOption = search.trim().length > 0 && !exactExists;
  const options = showCreateOption ? [...matches, { create: true as const, name: search.trim() }] : matches;

  const activeOptionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveIndex(0);
  }, [search, current?.path]);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, options.length]);

  useEffect(() => {
    if (!showNewFolder) inputRef.current?.focus();
  }, [current?.path, showNewFolder]);

  const advance = () => {
    setRemaining((prev) => prev.slice(1));
    setDoneCount((n) => n + 1);
    setSearch("");
  };

  const createFolder = async (name: string) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const path = await onCreateAndMove(current.path, name);
      setFolders((prev) => [...prev, { name, path, is_directory: true }]);
      setShowNewFolder(false);
      advance();
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (opt: DeviceFsEntry | { create: true; name: string }) => {
    if (!current || busy) return;
    if ("create" in opt) {
      await createFolder(opt.name);
      return;
    }
    setBusy(true);
    try {
      await onMove(current.path, opt.path);
      advance();
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    if (!current) return;
    setRemaining((prev) => [...prev.slice(1), prev[0]]);
    setSearch("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) void confirm(opt);
    } else if (e.key === "Escape") {
      if (search) setSearch("");
      else onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
      skip();
    }
  };

  if (!current) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)" }}>
        <div style={{ width: 360, textAlign: "center", background: "#1C1C1C", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#e0e0f0", marginBottom: 8 }}>All done</div>
          <p style={{ fontSize: 12.5, color: "rgba(180,180,220,0.5)", marginBottom: 18 }}>Sorted {doneCount} video{doneCount === 1 ? "" : "s"}.</p>
          <button type="button" onClick={onClose} style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#7c3aed,#5b21b6)", color: "white", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)", padding: "20px" }}>
      <div style={{ position: "absolute", top: 48, left: 20, fontSize: 11.5, color: "rgba(200,200,235,0.5)", fontWeight: 600 }}>
        Quick sort — {doneCount + 1} of {totalCount}
      </div>
      <button
        type="button"
        onClick={() => setShowNewFolder(true)}
        title="New folder"
        style={{ position: "absolute", top: 46, right: 62, display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 8, background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.35)", color: "#c4b5fd", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
      >
        <FolderPlus style={{ width: 13, height: 13 }} /> New folder
      </button>
      <button type="button" onClick={onClose} title="Close" style={{ position: "absolute", top: 46, right: 20, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(200,200,235,0.6)", cursor: "pointer" }}>
        <X style={{ width: 15, height: 15 }} />
      </button>

      <div style={{ width: "min(1200px, 94vw, calc(72vh * 16 / 9))", aspectRatio: "16/9", background: "#000", borderRadius: 12, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", marginBottom: 16 }}>
        <video
          key={current.path}
          src={convertFileSrc(current.path)}
          autoPlay
          loop
          muted
          controls
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>

      <div style={{ width: "min(1200px, 94vw, calc(72vh * 16 / 9))", fontSize: 12.5, color: "rgba(200,200,235,0.6)", marginBottom: 14, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {fileDisplayTitle(current.name)}
      </div>

      <div style={{ width: "min(480px, 90vw)", position: "relative" }}>
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a name…"
          disabled={busy}
          style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px 14px", color: "#e0e0f0", fontSize: 14, fontFamily: "inherit", outline: "none" }}
        />

        {options.length > 0 ? (
          <div style={{ marginTop: 18, background: "#1C1C1C", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, maxHeight: "min(420px, 38vh)", overflowY: "auto", overflowX: "hidden", boxShadow: "0 12px 30px rgba(0,0,0,0.5)" }}>
            {options.map((opt, i) => {
              const isCreate = "create" in opt;
              const isActive = i === activeIndex;
              return (
                <div
                  key={isCreate ? `create-${opt.name}` : opt.path}
                  ref={isActive ? activeOptionRef : null}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => void confirm(opt)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", background: isActive ? "rgba(124,58,237,0.18)" : "transparent" }}
                >
                  {isCreate ? (
                    <FolderPlus style={{ width: 14, height: 14, color: "#c4b5fd", flexShrink: 0 }} />
                  ) : (
                    <Check style={{ width: 14, height: 14, color: isActive ? "#c4b5fd" : "rgba(200,200,235,0.3)", flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 13, color: isActive ? "#c4b5fd" : "rgba(224,224,240,0.85)", fontWeight: isActive ? 700 : 500 }}>
                    {isCreate ? `New folder: ${opt.name}` : opt.name}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={skip}
        title="Skip (Tab)"
        style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "rgba(200,200,235,0.4)", fontSize: 12, cursor: "pointer" }}
      >
        Skip for now <ArrowRight style={{ width: 12, height: 12 }} />
      </button>

      {showNewFolder ? (
        <NewFolderPrompt onCancel={() => setShowNewFolder(false)} onCreate={(name) => void createFolder(name)} />
      ) : null}
    </div>
  );
}
