import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteProvider, useSiteContext } from "./site-provider";

const { mockUseAuthContext, mockResolveAuthSubject, mockFrom, mockRpc, mockRefreshSession } = vi.hoisted(() => ({
  mockUseAuthContext: vi.fn(),
  mockResolveAuthSubject: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockRefreshSession: vi.fn(),
}));

vi.mock("./auth-provider", () => ({
  useAuthContext: () => mockUseAuthContext(),
  resolveAuthSubject: (...args: unknown[]) => mockResolveAuthSubject(...args),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      refreshSession: mockRefreshSession,
    },
  },
}));

function Consumer() {
  const ctx = useSiteContext();
  return (
    <div>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="error">{ctx.error ?? "none"}</span>
      <span data-testid="site">{ctx.currentSite?.id ?? "none"}</span>
      <span data-testid="user">{ctx.currentUser?.id ?? "none"}</span>
      <span data-testid="sites-count">{String(ctx.sites.length)}</span>
      <button onClick={() => ctx.switchSite("site-2")}>Switch</button>
    </div>
  );
}

const baseSiteUser = {
  id: "user-row-1",
  site_id: "site-1",
  external_id: "auth-sub-1",
  email: "user@example.com",
  display_name: "User",
  role: "site_admin",
  active: true,
  preferences: {},
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const baseSite = {
  id: "site-1",
  name: "Site 1",
  code: "SITE1",
  timezone: "Australia/Brisbane",
  week_end_day: 5,
  schedule_horizon: 7,
  config: {},
  active: true,
  created_at: "2026-01-01",
};

describe("SiteProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });
    mockRefreshSession.mockResolvedValue({ data: { session: null, user: null }, error: null });
  });

  it("resets context when no auth subject is available", async () => {
    mockUseAuthContext.mockReturnValue({ session: null });
    mockResolveAuthSubject.mockReturnValue(null);

    render(
      <SiteProvider>
        <Consumer />
      </SiteProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });

    expect(screen.getByTestId("site")).toHaveTextContent("none");
    expect(screen.getByTestId("sites-count")).toHaveTextContent("0");
  });

  it("links pending invite rows by email and loads site data", async () => {
    mockUseAuthContext.mockReturnValue({
      session: { user: { email: "USER@example.com" } },
    });
    mockResolveAuthSubject.mockReturnValue("auth-sub-1");

    const directEqActive = vi.fn().mockResolvedValue({ data: [], error: null });
    const directEqExternal = vi.fn(() => ({ eq: directEqActive }));

    const pendingEqActive = vi.fn().mockResolvedValue({
      data: [{ ...baseSiteUser, id: "pending-id", external_id: "pending:user@example.com" }],
      error: null,
    });
    const pendingLike = vi.fn(() => ({ eq: pendingEqActive }));
    const pendingEqEmail = vi.fn(() => ({ like: pendingLike }));

    // After bind + refreshSession the code does: .from("site_users").select("*").eq("active", true)
    // Only one .eq() call — resolves directly.
    const relinkEqActive = vi.fn().mockResolvedValue({ data: [baseSiteUser], error: null });

    const sitesEqActive = vi.fn().mockResolvedValue({ data: [baseSite], error: null });
    const sitesIn = vi.fn(() => ({ eq: sitesEqActive }));

    let siteUsersSelectCalls = 0;
    const siteUsersSelect = vi.fn(() => {
      siteUsersSelectCalls += 1;
      if (siteUsersSelectCalls === 1) return { eq: directEqExternal };
      if (siteUsersSelectCalls === 2) return { eq: pendingEqEmail };
      if (siteUsersSelectCalls === 3) return { eq: relinkEqActive };
      return { eq: vi.fn() };
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "site_users") {
        return {
          select: siteUsersSelect,
        };
      }
      if (table === "sites") {
        return {
          select: () => ({ in: sitesIn }),
        };
      }
      return {};
    });

    render(
      <SiteProvider>
        <Consumer />
      </SiteProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });

    expect(mockRpc).toHaveBeenCalledWith("bind_pending_invite", {
      p_external_id: "auth-sub-1",
      p_email: "user@example.com",
    });
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("site")).toHaveTextContent("site-1");
    expect(screen.getByTestId("user")).toHaveTextContent("user-row-1");
    expect(screen.getByTestId("sites-count")).toHaveTextContent("1");
  });

  it("switches sites and refreshes current user for target site", async () => {
    mockUseAuthContext.mockReturnValue({ session: { user: { email: "user@example.com" } } });
    mockResolveAuthSubject.mockReturnValue("auth-sub-1");

    const siteUserSite1 = baseSiteUser;
    const siteUserSite2 = { ...baseSiteUser, id: "user-row-2", site_id: "site-2" };
    const site1 = baseSite;
    const site2 = { ...baseSite, id: "site-2", name: "Site 2", code: "SITE2" };

    const initialSiteUsersEqActive = vi.fn().mockResolvedValue({ data: [siteUserSite1, siteUserSite2], error: null });
    const initialSiteUsersEqExternal = vi.fn(() => ({ eq: initialSiteUsersEqActive }));
    const siteUsersSingle = vi.fn().mockResolvedValue({ data: siteUserSite2, error: null });
    const switchEqActive = vi.fn(() => ({ single: siteUsersSingle }));
    const switchEqSite = vi.fn(() => ({ eq: switchEqActive }));
    const switchEqExternal = vi.fn(() => ({ eq: switchEqSite }));

    const sitesEqActive = vi.fn().mockResolvedValue({ data: [site1, site2], error: null });
    const sitesIn = vi.fn(() => ({ eq: sitesEqActive }));

    const siteUsersSelect = vi
      .fn()
      .mockImplementationOnce(() => ({ eq: initialSiteUsersEqExternal }))
      .mockImplementationOnce(() => ({ eq: switchEqExternal }));

    mockFrom.mockImplementation((table: string) => {
      if (table === "site_users") {
        return { select: siteUsersSelect };
      }
      if (table === "sites") {
        return { select: () => ({ in: sitesIn }) };
      }
      return {};
    });

    render(
      <SiteProvider>
        <Consumer />
      </SiteProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("site")).toHaveTextContent("site-1");
    });

    fireEvent.click(screen.getByText("Switch"));

    await waitFor(() => {
      expect(screen.getByTestId("site")).toHaveTextContent("site-2");
      expect(screen.getByTestId("user")).toHaveTextContent("user-row-2");
    });
  });
});
