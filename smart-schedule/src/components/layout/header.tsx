import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentSite } from "@/hooks/use-current-site";
import { usePermissions } from "@/hooks/use-permissions";
import { useRealtimeContext } from "@/providers/realtime-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAvatar } from "@/hooks/use-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Wifi, WifiOff, LogOut, PanelLeft } from "lucide-react";
import { SiteSwitcher } from "./site-switcher";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationPanel } from "@/components/notifications/notification-panel";

interface HeaderProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function Header({ sidebarCollapsed, onToggleSidebar }: HeaderProps = {}) {
  const { signOut } = useAuth();
  const { user, site } = useCurrentSite();
  const { isSuperAdmin } = usePermissions();
  const { connected } = useRealtimeContext();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const avatarUrl = useAvatar();

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() ?? "?";

  const roleBadgeLabel =
    user?.role === "super_admin"
      ? "Super Admin"
      : user?.role === "site_admin"
        ? "Site Admin"
        : "Member";

  return (
    <TooltipProvider>
      <header className="flex h-14 items-center justify-between border-b bg-background px-4">
        {/* Left: sidebar toggle + site context */}
        <div className="flex items-center gap-3">
          {sidebarCollapsed && onToggleSidebar && (
            <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="h-8 w-8">
              <PanelLeft className="h-4 w-4" />
              <span className="sr-only">Open sidebar</span>
            </Button>
          )}
          {isSuperAdmin && <SiteSwitcher />}
          {!isSuperAdmin && site && (
            <span className="text-sm font-medium text-muted-foreground">
              {site.name}
            </span>
          )}
        </div>

        {/* Right: status, notifications, user */}
        <div className="flex items-center gap-2">
          {/* Connection status */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <div className="flex items-center">
                {connected ? (
                  <Wifi className="h-4 w-4 text-emerald-500" />
                ) : (
                  <WifiOff className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {connected ? "Real-time connected" : "Real-time disconnected"}
            </TooltipContent>
          </Tooltip>

          {/* Notifications */}
          <NotificationBell onClick={() => setNotificationsOpen(true)} />
          <NotificationPanel
            open={notificationsOpen}
            onOpenChange={setNotificationsOpen}
          />

          {/* Role badge */}
          <Badge variant="secondary" className="hidden text-xs sm:inline-flex">
            {roleBadgeLabel}
          </Badge>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="Open user menu"
              >
                <Avatar className="h-8 w-8">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile photo" />}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {user?.displayName ?? "User"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {user?.email}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </TooltipProvider>
  );
}
