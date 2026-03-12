import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Bot,
  MessageSquarePlus,
  Send,
  Square,
  History,
  ChevronLeft,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentSite } from "@/hooks/use-current-site";
import {
  useAiChat,
  useAiChatMessages,
  useAiSessions,
} from "@/hooks/use-ai-chat";
import { ChatMessage, StreamingMessage } from "./chat-message";

interface ChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChatPanel({ open, onOpenChange }: ChatPanelProps) {
  const { hasPermission } = usePermissions();

  if (!hasPermission("planning.ai")) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-[520px] flex-col sm:max-w-[520px]">
          <SheetHeader>
            <SheetTitle>AI Chat</SheetTitle>
            <SheetDescription>AI-assisted scheduling tools</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div>
              <Bot className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-sm text-muted-foreground">
                You don't have permission to use AI tools.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Requires the <strong>planning.ai</strong> permission.
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[520px] flex-col p-0 sm:max-w-[520px]" aria-describedby={undefined}>
        <SheetHeader className="sr-only">
          <SheetTitle>Planning Assistant</SheetTitle>
        </SheetHeader>
        <ChatPanelContent />
      </SheetContent>
    </Sheet>
  );
}

function ChatPanelContent() {
  const { site } = useCurrentSite();
  const [view, setView] = useState<"chat" | "sessions">("chat");
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const siteName = site?.name ?? "Planning";
  const assistantName = `${siteName} Planning Assistant`;

  const {
    send,
    streaming,
    streamContent,
    activeSessionId,
    pendingMessage,
    toolStatus,
    cancelStream,
    switchSession,
    newSession,
    isSending,
  } = useAiChat();

  const { data: messages = [] } = useAiChatMessages(activeSessionId);
  const { data: sessions = [] } = useAiSessions();

  // Auto-scroll to bottom on new messages or stream updates
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamContent]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setInput("");
    send({ message: trimmed, sessionId: activeSessionId ?? undefined });
  }, [input, isSending, send, activeSessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (view === "sessions") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setView("chat")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="font-semibold">Chat History</h3>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-left"
              onClick={() => {
                newSession();
                setView("chat");
              }}
            >
              <MessageSquarePlus className="h-4 w-4" />
              New conversation
            </Button>
            <Separator className="my-2" />
            {sessions.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No previous conversations.
              </p>
            ) : (
              sessions.map((session) => (
                <Button
                  key={session.id}
                  variant={session.id === activeSessionId ? "secondary" : "ghost"}
                  className="w-full justify-start text-left"
                  onClick={() => {
                    switchSession(session.id);
                    setView("chat");
                  }}
                >
                  <span className="truncate">
                    {session.title ?? "Untitled conversation"}
                  </span>
                </Button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3 pr-12">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-5 w-5 shrink-0 text-primary" />
          <h3 className="truncate font-semibold text-sm">{assistantName}</h3>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setView("sessions")}
            title="Chat history"
          >
            <History className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={newSession}
            title="New conversation"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !streaming && !pendingMessage ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div>
              <Bot className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">
                Ask about schedules, resource utilisation, or batch planning.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {pendingMessage &&
              !messages.some(
                (m) => m.role === "user" && m.content === pendingMessage,
              ) && (
              <ChatMessage
                message={{
                  id: "pending",
                  sessionId: "",
                  role: "user",
                  content: pendingMessage,
                  createdAt: new Date().toISOString(),
                }}
              />
            )}
            {streaming && <StreamingMessage content={streamContent} toolStatus={toolStatus} />}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask the ${assistantName}...`}
            className="min-h-[60px] max-h-[120px] resize-none text-sm"
            disabled={isSending}
          />
          <div className="flex flex-col gap-1">
            {streaming ? (
              <Button
                variant="destructive"
                size="icon"
                className="h-8 w-8"
                onClick={cancelStream}
                title="Stop"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-8 w-8"
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                title="Send"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Floating trigger button to open the chat panel from anywhere */
export function ChatPanelTrigger() {
  const [open, setOpen] = useState(false);
  const { hasPermission } = usePermissions();

  if (!hasPermission("planning.ai")) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="icon"
        className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full shadow-lg"
        title="Open AI Chat"
      >
        <Bot className="h-5 w-5" />
      </Button>
      <ChatPanel open={open} onOpenChange={setOpen} />
    </>
  );
}
