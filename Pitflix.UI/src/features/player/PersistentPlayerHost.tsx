import { lazy, Suspense, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Spinner } from "../../components/ui/Spinner";
import { isMiniRestoreState, useMiniPlayerStore } from "../../store/miniPlayerStore";
import type { PlaybackLaunchState } from "../../types/playback";

const PlayerPage = lazy(() => import("../../pages/PlayerPage").then((m) => ({ default: m.PlayerPage })));

/**
 * Renders the player for /player AND keeps the same instance mounted while it's shrunk into the
 * in-app mini player on other routes. It lives outside <Routes> (the /player route itself renders
 * nothing) because a route element would be unmounted — killing the mpv session — on navigation.
 */
export function PersistentPlayerHost() {
  const location = useLocation();
  const mini = useMiniPlayerStore((s) => s.mini);
  const storedState = useMiniPlayerStore((s) => s.launchState);

  const onPlayer = location.pathname === "/player";
  const routeState = onPlayer ? (location.state as PlaybackLaunchState | undefined) : undefined;
  const isRestore = isMiniRestoreState(routeState);
  // Expanding keeps the stored object (same identity, so the player's [state] effects don't re-run
  // and reopen the file). Any real /player navigation uses its own route state, exactly as before.
  const state = onPlayer && !isRestore ? routeState : storedState ?? undefined;
  const showMini = mini && !onPlayer;

  // Starting something new while the mini player is up replaces that session: remount so the old
  // one is torn down by the normal unmount path instead of being fed a foreign launch state.
  const instanceKeyRef = useRef(0);
  const lastRouteKeyRef = useRef<string | null>(null);
  const wasMiniRef = useRef(false);
  if (onPlayer && !isRestore && location.key !== lastRouteKeyRef.current) {
    lastRouteKeyRef.current = location.key;
    if (wasMiniRef.current) instanceKeyRef.current += 1;
  }
  wasMiniRef.current = showMini;

  useEffect(() => {
    if (!onPlayer || isRestore) return;
    const store = useMiniPlayerStore.getState();
    if (store.mini) store.expand();
    if (routeState && store.launchState !== routeState) store.setLaunchState(routeState);
  }, [onPlayer, isRestore, routeState]);

  if (!onPlayer && !(showMini && state)) return null;

  return (
    <Suspense
      fallback={
        onPlayer ? (
          <div className="fixed inset-0 flex items-center justify-center bg-pitflix-bg">
            <Spinner />
          </div>
        ) : null
      }
    >
      {/* Full player: a fixed layer over the page kept alive underneath (see AppRoutes). Mini: a
          plain wrapper (the mini box positions itself). Same element either way, so switching
          never remounts the player. */}
      <div className={showMini ? undefined : "fixed inset-0"}>
        <PlayerPage key={instanceKeyRef.current} launchState={state} mini={showMini} />
      </div>
    </Suspense>
  );
}
