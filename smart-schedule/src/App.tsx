import { BrowserRouter } from "react-router-dom";
import { QueryProvider } from "@/providers/query-provider";
import { AuthProvider } from "@/providers/auth-provider";
import { SiteProvider } from "@/providers/site-provider";
import { RealtimeProvider } from "@/providers/realtime-provider";
import { SpotlightProvider } from "@/contexts/spotlight-context";
import { AppRoutes } from "@/routes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function App() {
  return (
    <QueryProvider>
      <TooltipProvider>
        <AuthProvider>
          <SiteProvider>
            <RealtimeProvider>
              <SpotlightProvider>
                <BrowserRouter basename={import.meta.env.VITE_BASE_PATH || "/"}>
                  <AppRoutes />
                </BrowserRouter>
              </SpotlightProvider>
              <Toaster />
            </RealtimeProvider>
          </SiteProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryProvider>
  );
}
