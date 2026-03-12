import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentSite } from "@/hooks/use-current-site";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Auth guard that wraps protected routes.
 * - Not authenticated → redirect to /login
 * - Authenticated but no site access → redirect to /access-denied
 * - Authenticated + site loaded → render children
 */
export function AuthGuard() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { site, loading: siteLoading, error } = useCurrentSite();

  // Still loading auth state
  if (authLoading) {
    return <LoadingScreen />;
  }

  // Not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Still loading site data
  if (siteLoading) {
    return <LoadingScreen />;
  }

  // Authenticated but no site access
  if (error === "ACCESS_DENIED" || (!site && !siteLoading)) {
    return <Navigate to="/access-denied" replace />;
  }

  return <Outlet />;
}

function LoadingScreen() {
  return (
    <div className="flex h-screen">
      {/* Sidebar skeleton */}
      <div className="flex w-56 flex-col gap-4 border-r bg-sidebar p-4">
        <Skeleton className="h-8 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
      {/* Main content skeleton */}
      <div className="flex flex-1 flex-col">
        <div className="flex h-14 items-center border-b px-6">
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    </div>
  );
}
