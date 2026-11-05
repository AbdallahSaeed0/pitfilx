// Re-finds History / My Favorite files that were moved OUTSIDE the app (Explorer etc.), by file name,
// under the current mode's locations. Moves made inside My Device don't need this — they update the
// saved paths directly (remapDeviceSavedPaths).
import { invoke } from "@tauri-apps/api/core";
import { isPathInside, remapDeviceSavedPaths, type DevicePathMove } from "./deviceUtils";

type FoundFile = { file_name: string; path: string; size_bytes: number };

/** Paths already searched for this session and not found — don't re-walk every location each time
 *  History opens just because a file was genuinely deleted. */
const notFoundThisSession = new Set<string>();

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * Looks for each missing path's file name under `roots` (skipping anything inside `exclude`) and
 * relinks the ones with exactly one match. Returns how many were relinked.
 *
 * Only an unambiguous match is trusted: two files named "01.mp4" in different folders could be
 * different videos, and silently pointing History at the wrong one is worse than leaving it missing.
 */
export async function relinkMovedDeviceFiles(
  missingPaths: string[],
  roots: string[],
  exclude: string[],
): Promise<number> {
  const todo = missingPaths.filter((p) => !notFoundThisSession.has(p.toLowerCase()));
  if (todo.length === 0 || roots.length === 0) return 0;

  const fileNames = Array.from(new Set(todo.map(fileNameOf)));
  const hits = new Map<string, Set<string>>();
  // Roots nested inside another root would report the same file twice — the Set dedupes that.
  await Promise.all(
    roots.map(async (root) => {
      try {
        const rows = await invoke<FoundFile[]>("device_find_files", { root, fileNames });
        for (const row of rows) {
          if (exclude.some((ex) => isPathInside(row.path, ex))) continue;
          const key = row.file_name.toLowerCase();
          const set = hits.get(key) ?? new Set<string>();
          set.add(row.path);
          hits.set(key, set);
        }
      } catch {
        // unreadable location — its files just stay unmatched
      }
    }),
  );

  const moves: DevicePathMove[] = [];
  for (const path of todo) {
    const matches = hits.get(fileNameOf(path).toLowerCase());
    // Case-insensitive dedupe: Windows paths differing only in case are the same file.
    const unique = matches ? Array.from(new Map(Array.from(matches).map((m) => [m.toLowerCase(), m])).values()) : [];
    if (unique.length === 1) moves.push({ from: path, to: unique[0]! });
    else notFoundThisSession.add(path.toLowerCase());
  }
  remapDeviceSavedPaths(moves);
  return moves.length;
}
