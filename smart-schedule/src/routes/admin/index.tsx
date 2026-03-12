import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Server, Settings, Building2, Key, BookOpen, Clock, Bot, Palette } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "@/hooks/use-permissions";

export function AdminIndexPage() {
  const navigate = useNavigate();
  const { hasPermission, isSuperAdmin } = usePermissions();

  const sections = [
    {
      title: "User Management",
      description: "Add, remove, and manage user access for this site",
      icon: Users,
      path: "/admin/users",
    },
    {
      title: "Resource Configuration",
      description: "Configure mixers, dispersers, and pot groups",
      icon: Server,
      path: "/admin/resources",
    },
    {
      title: "Site Settings",
      description: "Configure site preferences and tenant access control",
      icon: Settings,
      path: "/admin/site-settings",
    },
    {
      title: "Colour Groups",
      description: "Configure colour groups and mixing transition rules",
      icon: Palette,
      path: "/admin/colour-groups",
    },
    ...(hasPermission("admin.settings")
      ? [
          {
            title: "AI Settings",
            description: "Configure AI credentials and integration settings",
            icon: Key,
            path: "/admin/ai-settings",
          },
          {
            title: "AI Instructions",
            description: "Configure AI agent system prompt and behaviour",
            icon: Bot,
            path: "/admin/ai-instructions",
          },
          {
            title: "Knowledge Base",
            description: "Manage wiki articles for AI context",
            icon: BookOpen,
            path: "/admin/wiki",
          },
          {
            title: "AI Scheduled Tasks",
            description: "Configure automated AI analysis schedules",
            icon: Clock,
            path: "/admin/ai-scheduled-tasks",
          },
        ]
      : []),
    ...(isSuperAdmin
      ? [
          {
            title: "All Sites",
            description: "View and manage all sites across the organisation",
            icon: Building2,
            path: "/admin/sites",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Administration"
        description="Manage users, resources, and site configuration"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Card
            key={section.path}
            className="cursor-pointer transition-shadow hover:shadow-md"
            onClick={() => navigate(section.path)}
          >
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <section.icon className="h-8 w-8 text-primary" />
              <CardTitle className="text-base">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {section.description}
              </p>
              <Button variant="link" className="mt-2 h-auto p-0 text-sm">
                Manage →
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
