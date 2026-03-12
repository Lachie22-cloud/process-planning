import { useState, useCallback } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { ChatPanelTrigger } from "@/components/ai/chat-panel";
import { useCurrentSite } from "@/hooks/use-current-site";
import { supabase } from "@/lib/supabase/client";

export function AppLayout() {
  const { user } = useCurrentSite();
  const [collapsed, setCollapsed] = useState(
    () => user?.preferences?.sidebarCollapsed ?? false,
  );

  const handleToggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      // Persist preference
      if (user?.id) {
        supabase
          .from("site_users")
          .update({
            preferences: { ...user.preferences, sidebarCollapsed: next },
          } as never)
          .eq("id", user.id)
          .then(() => {});
      }
      return next;
    });
  }, [user]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header sidebarCollapsed={collapsed} onToggleSidebar={handleToggle} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <ChatPanelTrigger />
    </div>
  );
}
