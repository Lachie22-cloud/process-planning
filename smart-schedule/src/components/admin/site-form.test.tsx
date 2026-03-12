import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test/query-client";
import { SiteForm } from "./site-form";

const { mockUseCurrentSite, mockUsePermissions, mockFrom } = vi.hoisted(() => ({
  mockUseCurrentSite: vi.fn(),
  mockUsePermissions: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/hooks/use-current-site", () => ({
  useCurrentSite: () => mockUseCurrentSite(),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => mockUsePermissions(),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: mockFrom,
  },
}));

describe("SiteForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseCurrentSite.mockReturnValue({
      site: {
        id: "site-1",
        name: "Rocklea",
        code: "ROCKLEA",
        timezone: "Australia/Brisbane",
        weekEndDay: 5,
        scheduleHorizon: 7,
        active: true,
      },
      user: {
        id: "user-1",
      },
    });
  });

  it("renders read-only message for non-super-admin users", async () => {
    mockUsePermissions.mockReturnValue({ isSuperAdmin: false });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SiteForm />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/Site settings are read-only in this view/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Settings" })).not.toBeInTheDocument();
  });

  it("saves site updates and emits admin action for super admins", async () => {
    mockUsePermissions.mockReturnValue({ isSuperAdmin: true });

    const sitesEq = vi.fn().mockResolvedValue({ error: null });
    const sitesUpdate = vi.fn(() => ({ eq: sitesEq }));
    const adminInsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "sites") return { update: sitesUpdate };
      if (table === "admin_actions") return { insert: adminInsert };
      return {};
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SiteForm />
      </QueryClientProvider>,
    );

    const siteNameInput = screen.getAllByRole("textbox")[0];
    if (!siteNameInput) throw new Error("Expected site name input");
    fireEvent.change(siteNameInput, {
      target: { value: "Rocklea Updated" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => {
      expect(sitesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Rocklea Updated" }),
      );
      expect(sitesEq).toHaveBeenCalledWith("id", "site-1");
      expect(adminInsert).toHaveBeenCalledTimes(1);
    });
  });
});
