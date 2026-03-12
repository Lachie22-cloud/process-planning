import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  useCreateSubstitutionRule,
  useUpdateScheduleRule,
} from "./use-rules";
import { QueryClientTestProvider, createTestQueryClient } from "@/test/query-client";

const { mockFrom, mockUseCurrentSite } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockUseCurrentSite: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: mockFrom,
  },
}));

vi.mock("@/hooks/use-current-site", () => ({
  useCurrentSite: () => mockUseCurrentSite(),
}));

describe("use-rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks schedule rule updates for non-admin roles", async () => {
    mockUseCurrentSite.mockReturnValue({
      site: { id: "site-1" },
      user: { role: "member", email: "member@example.com" },
    });

    const client = createTestQueryClient();
    const { result } = renderHook(() => useUpdateScheduleRule(), {
      wrapper: ({ children }) =>
        React.createElement(QueryClientTestProvider, { client }, children),
    });

    await expect(
      result.current.mutateAsync({
        id: "rule-1",
        name: "Rule",
        description: null,
        ruleType: "schedule",
        conditionsText: "{}",
        actionsText: "{}",
        enabled: true,
        ruleVersion: 1,
      }),
    ).rejects.toThrow("Only site admins can manage rules");
  });

  it("validates schedule rule JSON before update", async () => {
    mockUseCurrentSite.mockReturnValue({
      site: { id: "site-1" },
      user: { role: "site_admin", email: "admin@example.com" },
    });

    const client = createTestQueryClient();
    const { result } = renderHook(() => useUpdateScheduleRule(), {
      wrapper: ({ children }) =>
        React.createElement(QueryClientTestProvider, { client }, children),
    });

    await expect(
      result.current.mutateAsync({
        id: "rule-1",
        name: "Rule",
        description: null,
        ruleType: "schedule",
        conditionsText: "{bad-json}",
        actionsText: "{}",
        enabled: true,
        ruleVersion: 1,
      }),
    ).rejects.toThrow("Validation failed");
  });

  it("creates substitution rule and writes audit event", async () => {
    mockUseCurrentSite.mockReturnValue({
      site: { id: "site-1" },
      user: { role: "site_admin", email: "admin@example.com" },
    });

    const resourcesIn = vi.fn().mockResolvedValue({
      data: [{ id: "11111111-1111-1111-1111-111111111111" }],
      error: null,
    });
    const resourcesEq = vi.fn(() => ({ in: resourcesIn }));
    const resourcesSelect = vi.fn(() => ({ eq: resourcesEq }));

    const insertSingle = vi.fn().mockResolvedValue({
      data: {
        id: "sub-rule-1",
        site_id: "site-1",
        source_resource_id: "11111111-1111-1111-1111-111111111111",
        target_resource_id: null,
        conditions: null,
        enabled: true,
        created_by: "admin@example.com",
        created_at: "2026-01-01",
      },
      error: null,
    });
    const subSelect = vi.fn(() => ({ single: insertSingle }));
    const subInsert = vi.fn(() => ({ select: subSelect }));

    const auditInsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "resources") {
        return { select: resourcesSelect };
      }
      if (table === "substitution_rules") {
        return { insert: subInsert };
      }
      if (table === "audit_log") {
        return { insert: auditInsert };
      }
      return {};
    });

    const client = createTestQueryClient();
    const { result } = renderHook(() => useCreateSubstitutionRule(), {
      wrapper: ({ children }) =>
        React.createElement(QueryClientTestProvider, { client }, children),
    });

    await act(async () => {
      await result.current.mutateAsync({
        sourceResourceId: "11111111-1111-1111-1111-111111111111",
        targetResourceId: null,
        conditions: null,
        enabled: true,
      });
    });

    await waitFor(() => {
      expect(auditInsert).toHaveBeenCalledTimes(1);
    });

    expect(subInsert).toHaveBeenCalledTimes(1);
  });
});
