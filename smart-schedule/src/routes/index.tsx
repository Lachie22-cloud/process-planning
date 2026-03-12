import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { AuthGuard } from "./auth-guard";

const LoginPage = lazy(() =>
  import("./login").then((m) => ({ default: m.LoginPage })),
);
const CallbackPage = lazy(() =>
  import("./callback").then((m) => ({ default: m.CallbackPage })),
);
const AccessDeniedPage = lazy(() =>
  import("./access-denied").then((m) => ({ default: m.AccessDeniedPage })),
);
const SchedulePage = lazy(() =>
  import("./schedule").then((m) => ({ default: m.SchedulePage })),
);
const ResourcesPage = lazy(() =>
  import("./resources").then((m) => ({ default: m.ResourcesPage })),
);
const StatisticsPage = lazy(() =>
  import("./statistics").then((m) => ({ default: m.StatisticsPage })),
);
const PlanningPage = lazy(() =>
  import("./planning").then((m) => ({ default: m.PlanningPage })),
);
const RulesPage = lazy(() =>
  import("./rules").then((m) => ({ default: m.RulesPage })),
);
const AlertsPage = lazy(() =>
  import("./alerts").then((m) => ({ default: m.AlertsPage })),
);
const ShopFloorPage = lazy(() =>
  import("./shop-floor").then((m) => ({ default: m.ShopFloorPage })),
);
const AdminIndexPage = lazy(() =>
  import("./admin/index").then((m) => ({ default: m.AdminIndexPage })),
);
const AdminUsersPage = lazy(() =>
  import("./admin/users").then((m) => ({ default: m.AdminUsersPage })),
);
const AdminResourcesPage = lazy(() =>
  import("./admin/resources").then((m) => ({ default: m.AdminResourcesPage })),
);
const AdminSiteSettingsPage = lazy(() =>
  import("./admin/site-settings").then((m) => ({
    default: m.AdminSiteSettingsPage,
  })),
);
const AdminSitesPage = lazy(() =>
  import("./admin/sites").then((m) => ({ default: m.AdminSitesPage })),
);
const AdminAiSettingsPage = lazy(() =>
  import("./admin/ai-settings").then((m) => ({
    default: m.AdminAiSettingsPage,
  })),
);
const AdminWikiPage = lazy(() =>
  import("./admin/wiki").then((m) => ({ default: m.AdminWikiPage })),
);
const AdminAiScheduledTasksPage = lazy(() =>
  import("./admin/ai-scheduled-tasks").then((m) => ({
    default: m.AdminAiScheduledTasksPage,
  })),
);
const AdminAiInstructionsPage = lazy(() =>
  import("./admin/ai-instructions").then((m) => ({
    default: m.AdminAiInstructionsPage,
  })),
);
const AdminColourGroupsPage = lazy(() =>
  import("./admin/colour-groups").then((m) => ({
    default: m.AdminColourGroupsPage,
  })),
);

function RouteFallback() {
  return (
    <div className="flex h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading page...
    </div>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/callback" element={<CallbackPage />} />
        <Route path="/access-denied" element={<AccessDeniedPage />} />

        {/* Protected routes — wrapped in auth guard + layout */}
        <Route element={<AuthGuard />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/schedule" replace />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/statistics" element={<StatisticsPage />} />
            <Route path="/planning" element={<PlanningPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/admin" element={<AdminIndexPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/resources" element={<AdminResourcesPage />} />
            <Route
              path="/admin/site-settings"
              element={<AdminSiteSettingsPage />}
            />
            <Route path="/admin/sites" element={<AdminSitesPage />} />
            <Route
              path="/admin/ai-settings"
              element={<AdminAiSettingsPage />}
            />
            <Route path="/admin/wiki" element={<AdminWikiPage />} />
            <Route
              path="/admin/ai-scheduled-tasks"
              element={<AdminAiScheduledTasksPage />}
            />
            <Route
              path="/admin/ai-instructions"
              element={<AdminAiInstructionsPage />}
            />
            <Route
              path="/admin/colour-groups"
              element={<AdminColourGroupsPage />}
            />
          </Route>

          {/* Shop floor has its own layout (no sidebar/header) */}
          <Route path="/shop-floor" element={<ShopFloorPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/schedule" replace />} />
      </Routes>
    </Suspense>
  );
}
