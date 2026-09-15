import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { startScan } from "../../api/scan";
import { loadSaved, saveSaved } from "../device/deviceUtils";

type FolderActionPayload = {
  action: "scan-folder" | "add-device-folder";
  path: string;
};

/**
 * Handles Explorer's folder right-click actions ("Scan this folder to Pitflix" / "Add this folder
 * to My Device"), registered by the NSIS installer under HKCU\...\Directory\shell — see
 * installer-hooks.nsh and extract_folder_action_from_args in src-tauri/src/lib.rs.
 * Same cold-start-vs-already-running split as OpenFileListenerHost: a fresh process pulls its
 * pending action once via `take_pending_folder_action`; an already-running instance gets it
 * pushed via the `folder-action` event from the single-instance relaunch handler.
 */
export function FolderActionListenerHost() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    const runAction = ({ action, path }: FolderActionPayload) => {
      const trimmed = path.trim();
      if (!trimmed || cancelled) return;
      if (action === "scan-folder") {
        void startScan({ folders: [trimmed] }).catch(() => {});
        return;
      }
      // add-device-folder
      const saved = loadSaved();
      if (!saved.includes(trimmed)) {
        saveSaved([...saved, trimmed]);
      }
      navigate(`/my-device?path=${encodeURIComponent(trimmed)}`);
    };

    void invoke<FolderActionPayload | null>("take_pending_folder_action")
      .then((payload) => {
        if (payload) runAction(payload);
      })
      .catch(() => {});

    let unlisten: UnlistenFn | undefined;
    void listen<FolderActionPayload>("folder-action", (event) => runAction(event.payload))
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      void unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
