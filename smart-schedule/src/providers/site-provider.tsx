import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import type { Site } from "@/types/site";
import type { User } from "@/types/user";
import { supabase } from "@/lib/supabase/client";
import { resolveAuthSubject, useAuthContext } from "./auth-provider";
import { mapSite, mapUser } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";

interface SiteContextValue {
  currentSite: Site | null;
  currentUser: User | null;
  sites: Site[];
  loading: boolean;
  error: string | null;
  switchSite: (siteId: string) => void;
}

const SiteContext = createContext<SiteContextValue>({
  currentSite: null,
  currentUser: null,
  sites: [],
  loading: true,
  error: null,
  switchSite: () => {},
});

const IS_E2E_MOCK_AUTH = import.meta.env.VITE_E2E_MOCK_AUTH === "true";

export function SiteProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuthContext();
  const authUserId = resolveAuthSubject(session);
  const authEmail = session?.user?.email ?? null;
  const [currentSite, setCurrentSite] = useState<Site | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (IS_E2E_MOCK_AUTH) {
      const mockSite: Site = {
        id: "00000000-0000-4000-8000-000000000010",
        name: "Rocklea",
        code: "ROCK",
        timezone: "Australia/Brisbane",
        weekEndDay: 5,
        scheduleHorizon: 6,
        config: {},
        active: true,
        createdAt: new Date().toISOString(),
      };
      const mockUser: User = {
        id: "00000000-0000-4000-8000-000000000001",
        siteId: mockSite.id,
        externalId: "00000000-0000-4000-8000-000000000999",
        email: "site-admin@example.com",
        displayName: "Smoke Admin",
        role: "site_admin",
        active: true,
        preferences: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setCurrentSite(mockSite);
      setCurrentUser(mockUser);
      setSites([mockSite]);
      setLoading(false);
      setError(null);
      return;
    }

    if (!authUserId) {
      setCurrentSite(null);
      setCurrentUser(null);
      setSites([]);
      // Only mark site loading as done once auth has finished loading.
      // While auth is still loading, we don't know if there's a user yet.
      if (!authLoading) {
        setLoading(false);
      }
      return;
    }

    loadUserSiteData(authUserId, authEmail);
  }, [authUserId, authEmail, authLoading]);

  async function loadUserSiteData(authUserId: string, email: string | null) {
    setLoading(true);
    setError(null);

    try {
      // First, try direct match by OIDC subject.
      const { data: directRows, error: userError } = await supabase
        .from("site_users")
        .select("*")
        .eq("external_id", authUserId)
        .eq("active", true);

      if (userError) throw userError;
      let userRows = directRows;

      // If no direct match, try pending invite rows by email and bind to OIDC subject.
      if ((!userRows || userRows.length === 0) && email) {
        const normalisedEmail = email.trim().toLowerCase();
        const { data: pendingRows, error: pendingError } = await supabase
          .from("site_users")
          .select("*")
          .eq("email", normalisedEmail)
          .like("external_id", "pending:%")
          .eq("active", true);

        if (pendingError) throw pendingError;

        if (pendingRows && pendingRows.length > 0) {
          const { data: bindResult, error: bindError } = await supabase.rpc("bind_pending_invite", {
            p_external_id: authUserId,
            p_email: normalisedEmail,
          });
          if (bindError) throw bindError;

          const bindSuccess = (bindResult as { success?: boolean } | null)?.success;
          if (bindSuccess === false) {
            throw new Error("Failed to bind pending invite");
          }

          const { error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) throw refreshError;

          // Re-fetch the current user's own row after token claims refresh.
          // Must filter by external_id to avoid returning other users visible via RLS.
          const relink = await supabase
            .from("site_users")
            .select("*")
            .eq("external_id", authUserId)
            .eq("active", true);
          if (relink.error) throw relink.error;
          userRows = relink.data;
        }
      }

      if (!userRows || userRows.length === 0) {
        setError("ACCESS_DENIED");
        setLoading(false);
        return;
      }

      const mappedUsers = (userRows as DatabaseRow["site_users"][]).map(mapUser);

      // Load all sites the user belongs to
      const siteIds = mappedUsers.map((u) => u.siteId);
      const { data: siteRows, error: siteError } = await supabase
        .from("sites")
        .select("*")
        .in("id", siteIds)
        .eq("active", true);

      if (siteError) throw siteError;

      const mappedSites = (siteRows as DatabaseRow["sites"][]).map(mapSite);
      setSites(mappedSites);

      // Super admins: also load all sites
      const isSuperAdmin = mappedUsers.some((u) => u.role === "super_admin");
      if (isSuperAdmin) {
        const { data: allSiteRows, error: allSiteError } = await supabase
          .from("sites")
          .select("*")
          .eq("active", true)
          .order("name");

        if (!allSiteError && allSiteRows) {
          setSites((allSiteRows as DatabaseRow["sites"][]).map(mapSite));
        }
      }

      // Default to first site
      const defaultSite = mappedSites[0];
      if (defaultSite) {
        setCurrentSite(defaultSite);
        const siteUser = mappedUsers.find((u) => u.siteId === defaultSite.id);
        setCurrentUser(siteUser ?? mappedUsers[0] ?? null);
      }
    } catch (err) {
      console.error("Failed to load site data:", err);
      setError("LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }

  const switchSite = useCallback(
    (siteId: string) => {
      const site = sites.find((s) => s.id === siteId);
      if (site) {
        setCurrentSite(site);
        // Re-resolve user for the new site context
        const sessionSubject = resolveAuthSubject(session);
        if (sessionSubject) {
          supabase
            .from("site_users")
            .select("*")
            .eq("external_id", sessionSubject)
            .eq("site_id", siteId)
            .eq("active", true)
            .single()
            .then(({ data }) => {
              if (data) setCurrentUser(mapUser(data as DatabaseRow["site_users"]));
            });
        }
      }
    },
    [session, sites],
  );

  return (
    <SiteContext.Provider
      value={{ currentSite, currentUser, sites, loading, error, switchSite }}
    >
      {children}
    </SiteContext.Provider>
  );
}

export function useSiteContext() {
  return useContext(SiteContext);
}
