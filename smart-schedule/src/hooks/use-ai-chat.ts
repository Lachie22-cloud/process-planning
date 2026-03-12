import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow } from "@/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ChatSession {
  id: string;
  siteId: string;
  userId: string;
  title: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getAiAgentUrl(): string {
  // Empty string is valid — means same origin (behind reverse proxy)
  return (import.meta.env.VITE_AI_AGENT_URL as string | undefined) ?? "";
}

async function getAccessToken(): Promise<string> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

function mapSession(
  row: Pick<
    DatabaseRow["ai_chat_sessions"],
    "id" | "site_id" | "user_id" | "title" | "status" | "created_at" | "updated_at"
  >,
): ChatSession {
  return {
    id: row.id,
    siteId: row.site_id,
    userId: row.user_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(
  row: Pick<
    DatabaseRow["ai_chat_messages"],
    "id" | "session_id" | "role" | "content" | "created_at"
  >,
): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/*  useAiSessions — list user's chat sessions                         */
/* ------------------------------------------------------------------ */

export function useAiSessions() {
  const { site } = useCurrentSite();

  return useQuery<ChatSession[]>({
    queryKey: ["ai_sessions", site?.id],
    queryFn: async () => {
      if (!site) return [];
      const token = await getAccessToken();
      const res = await fetch(
        `${getAiAgentUrl()}/ai/sessions?siteId=${encodeURIComponent(site.id)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const json = (await res.json()) as { sessions: DatabaseRow["ai_chat_sessions"][] };
      return json.sessions.map(mapSession);
    },
    enabled: !!site,
    staleTime: 10_000,
  });
}

/* ------------------------------------------------------------------ */
/*  useAiChatMessages — fetch messages for a session                   */
/* ------------------------------------------------------------------ */

export function useAiChatMessages(sessionId: string | null) {
  const { site } = useCurrentSite();

  return useQuery<ChatMessage[]>({
    queryKey: ["ai_chat_messages", sessionId],
    queryFn: async () => {
      if (!sessionId || !site) return [];
      const { data, error } = await supabase
        .from("ai_chat_messages")
        .select("id, session_id, role, content, created_at")
        .eq("session_id", sessionId)
        .eq("site_id", site.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []).map(
        (row) => mapMessage(row as Pick<DatabaseRow["ai_chat_messages"], "id" | "session_id" | "role" | "content" | "created_at">),
      );
    },
    enabled: !!sessionId && !!site,
    staleTime: 5_000,
  });
}

/* ------------------------------------------------------------------ */
/*  useAiChat — SSE streaming send + state                             */
/* ------------------------------------------------------------------ */

export function useAiChat() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async ({
      message,
      sessionId,
    }: {
      message: string;
      sessionId?: string;
    }) => {
      if (!site) throw new Error("No site selected");

      const token = await getAccessToken();
      const controller = new AbortController();
      abortRef.current = controller;

      setStreaming(true);
      setStreamContent("");
      setPendingMessage(message);
      setToolStatus(null);

      const res = await fetch(`${getAiAgentUrl()}/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          siteId: site.id,
          sessionId: sessionId ?? activeSessionId,
          message,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          (payload as { error?: string }).error ?? `Chat request failed (${res.status})`,
        );
      }

      // Parse SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let resolvedSessionId = sessionId ?? activeSessionId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6)) as SSEEvent["data"];

              if (parsed.sessionId && !resolvedSessionId) {
                resolvedSessionId = parsed.sessionId as string;
                setActiveSessionId(resolvedSessionId);
              }

              if (currentEvent === "error" && parsed.error) {
                throw new Error(parsed.error as string);
              }

              if (currentEvent === "status" && parsed.content) {
                setToolStatus(parsed.content as string);
                continue;
              }

              if (currentEvent === "message" && parsed.content) {
                setToolStatus(null);
                fullContent += parsed.content as string;
                setStreamContent(fullContent);
              }
            } catch (e) {
              if (e instanceof Error && currentEvent === "error") throw e;
              // skip malformed SSE data
            }
          }
        }
      }

      return { sessionId: resolvedSessionId, content: fullContent };
    },
    onSuccess: (result) => {
      setStreaming(false);
      setPendingMessage(null);
      setToolStatus(null);
      if (result?.sessionId) {
        setActiveSessionId(result.sessionId);
        queryClient.invalidateQueries({ queryKey: ["ai_sessions", site?.id] });
        queryClient.invalidateQueries({
          queryKey: ["ai_chat_messages", result.sessionId],
        });
      }
    },
    onError: (err) => {
      setStreaming(false);
      setStreamContent("");
      setPendingMessage(null);
      setToolStatus(null);
      if ((err as Error).name !== "AbortError") {
        toast.error(err instanceof Error ? err.message : "Chat error");
      }
    },
  });

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const switchSession = useCallback((sessionId: string | null) => {
    setActiveSessionId(sessionId);
    setStreamContent("");
  }, []);

  const newSession = useCallback(() => {
    setActiveSessionId(null);
    setStreamContent("");
  }, []);

  return {
    send: send.mutate,
    sendAsync: send.mutateAsync,
    isSending: send.isPending,
    streaming,
    streamContent,
    activeSessionId,
    pendingMessage,
    toolStatus,
    cancelStream,
    switchSession,
    newSession,
  };
}
