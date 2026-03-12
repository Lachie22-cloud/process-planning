import { createContext, useContext, useEffect, useState, useRef } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuthContext } from "./auth-provider";
import { useSiteContext } from "./site-provider";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { logFrontendError } from "@/lib/error-logger";

interface RealtimeContextValue {
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
});

/** Tables we subscribe to for realtime changes */
const WATCHED_TABLES = [
  "batches",
  "audit_log",
  "bulk_alerts",
  "resource_blocks",
  "notifications",
  "resources",
] as const;

/** Map table names to the query key prefixes they should invalidate */
const TABLE_QUERY_KEYS: Record<string, string[]> = {
  batches: ["batches", "schedule"],
  audit_log: ["audit"],
  bulk_alerts: ["alerts"],
  resource_blocks: ["resource-blocks"],
  notifications: ["notifications"],
  resources: ["resources"],
};

function getReconnectDelayMs(attempt: number) {
  const base = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30000);
  const jitter = Math.floor(Math.random() * 300);
  return base + jitter;
}

const IS_MOCK = import.meta.env.VITE_E2E_MOCK_AUTH === "true";

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuthContext();
  const { currentSite } = useSiteContext();
  const siteId = currentSite?.id;
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    // Skip realtime connections in mock mode — no backend to connect to
    if (IS_MOCK) return;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function teardownChannel() {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    }

    if (!session || !siteId) {
      teardownChannel();
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      setConnected(false);
      return;
    }

    function scheduleReconnect() {
      clearReconnectTimer();
      reconnectAttemptRef.current += 1;
      const delay = getReconnectDelayMs(reconnectAttemptRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        connectChannel();
      }, delay);
    }

    function connectChannel() {
      teardownChannel();

      const channel = supabase
        .channel(`site:${siteId}`)
        .on("presence", { event: "sync" }, () => {
          setConnected(true);
        });

      // Subscribe to postgres changes for each watched table
      for (const table of WATCHED_TABLES) {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `site_id=eq.${siteId}`,
          },
          () => {
            // Invalidate related query caches
            const keys = TABLE_QUERY_KEYS[table] ?? [table];
            for (const key of keys) {
              queryClient.invalidateQueries({ queryKey: [key] });
            }
          },
        );
      }

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          reconnectAttemptRef.current = 0;
          clearReconnectTimer();
          setConnected(true);
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnected(false);
          logFrontendError(new Error(`Realtime status: ${status}`), {
            source: "realtime-provider",
            action: "subscription_status",
            siteId,
            attempt: reconnectAttemptRef.current + 1,
          }, "warning");
          scheduleReconnect();
        }
      });

      channelRef.current = channel;
    }

    connectChannel();

    return () => {
      teardownChannel();
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      setConnected(false);
    };
  }, [session, siteId, queryClient]);

  return (
    <RealtimeContext.Provider value={{ connected }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtimeContext() {
  return useContext(RealtimeContext);
}
