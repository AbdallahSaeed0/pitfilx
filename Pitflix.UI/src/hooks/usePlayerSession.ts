import { useEffect, useRef, useState } from "react";
import { PLAYER_WS_URL, type PlayerSession } from "../api/player";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

export function usePlayerSession(): {
  session: PlayerSession | null;
  isConnected: boolean;
} {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;

      const ws = new WebSocket(PLAYER_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) {
          ws.close();
          return;
        }
        retryCountRef.current = 0;
        setIsConnected(true);
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        try {
          const data = JSON.parse(e.data) as
            | { isStopped: true }
            | PlayerSession;
          if ("isStopped" in data && data.isStopped) {
            setSession(null);
          } else {
            setSession(data as PlayerSession);
          }
        } catch {
          // malformed message — ignore
        }
      };

      ws.onclose = (e: CloseEvent) => {
        setIsConnected(false);
        if (unmountedRef.current) return;

        if (e.wasClean && e.code === 1000) {
          // Server closed cleanly because the session ended.
          // Reconnect so we can pick up the next session when it starts.
          retryTimerRef.current = setTimeout(connect, RETRY_DELAY_MS);
          return;
        }

        // Unexpected close (server not running, network error, etc.).
        // Retry up to MAX_RETRIES times, then stop.
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current += 1;
          retryTimerRef.current = setTimeout(connect, RETRY_DELAY_MS);
        }
      };

      ws.onerror = () => {
        // onerror always fires before onclose; reconnect logic lives there.
        setIsConnected(false);
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null; // prevent the reconnect branch on intentional teardown
        ws.close();
      }
    };
  }, []);

  return { session, isConnected };
}
