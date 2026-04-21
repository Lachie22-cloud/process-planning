import { NavLink } from "react-router-dom";
import { cn } from "@/lib/ui/cn";
import { useCurrentSite } from "@/hooks/use-current-site";
import { usePermissions } from "@/hooks/use-permissions";
import {
  CalendarDays,
  LayoutGrid,
  BarChart3,
  Upload,
  Settings2,
  Bell,
  Monitor,
  Shield,
  Building2,
  PanelLeftClose,
} from "lucide-react";
import duluxLogo from "@/assets/dulux-logo.png";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  permission?: string;
  /** Show for any admin (site_admin or super_admin) regardless of permission */
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/schedule", icon: CalendarDays, label: "Schedule" },
  { to: "/resources", icon: LayoutGrid, label: "Resources" },
  { to: "/statistics", icon: BarChart3, label: "Statistics" },
  { to: "/planning", icon: Upload, label: "Planning", permission: "planning.tab" },
  { to: "/rules", icon: Settings2, label: "Rules", permission: "rules.read" },
  { to: "/alerts", icon: Bell, label: "Alerts", permission: "alerts.read" },
  { to: "/shop-floor", icon: Monitor, label: "Shop Floor" },
];

const ADMIN_ITEMS: NavItem[] = [
  { to: "/admin", icon: Shield, label: "Admin", permission: "admin.users" },
  { to: "/admin/sites", icon: Building2, label: "Sites", adminOnly: true },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { site } = useCurrentSite();
  const { hasPermission, isAdmin } = usePermissions();

  const renderNavItem = (item: NavItem) => {
    if (item.adminOnly && !isAdmin) {
      return null;
    }
    if (item.permission && !hasPermission(item.permission as Parameters<typeof hasPermission>[0])) {
      return null;
    }

    const Icon = item.icon;

    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70",
          )
        }
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 overflow-hidden",
        collapsed ? "w-0 border-r-0" : "w-56",
      )}
    >
      {/* Logo / site name */}
      <div className="flex h-14 items-center gap-2 border-b px-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center">
          <img src={duluxLogo} alt="Dulux" className="h-7 w-7 object-contain" />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <span className="truncate text-sm font-semibold">
            {site?.name ?? "Smart Schedule"}
          </span>
          {site?.code && (
            <span className="truncate text-xs text-sidebar-foreground/50">
              {site.code}
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {NAV_ITEMS.map(renderNavItem)}

        <Separator className="my-2" />

        {ADMIN_ITEMS.map(renderNavItem)}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={onToggle}
        >
          <PanelLeftClose className="mr-2 h-4 w-4" />
          <span className="text-xs">Collapse</span>
        </Button>
      </div>
    </aside>
  );
}
