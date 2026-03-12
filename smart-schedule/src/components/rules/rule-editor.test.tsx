import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuleEditor } from "./rule-editor";
import type { ScheduleRule } from "@/types/rule";

const mutateAsyncMock = vi.fn();
const hasPermissionMock = vi.fn();

vi.mock("@/hooks/use-rules", () => ({
  useUpdateScheduleRule: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    hasPermission: hasPermissionMock,
  }),
}));

const rule: ScheduleRule = {
  id: "rule-1",
  siteId: "site-1",
  name: "Original Rule",
  description: "desc",
  ruleType: "schedule",
  conditions: { min: 1 },
  actions: { target: "mixer" },
  ruleVersion: 1,
  schemaId: "schema-1",
  enabled: true,
  createdBy: "admin@example.com",
  createdAt: "2026-01-01",
};

describe("RuleEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockReturnValue(true);
    mutateAsyncMock.mockResolvedValue({});
  });

  it("shows validation error for invalid JSON and does not submit", async () => {
    const onOpenChange = vi.fn();
    render(<RuleEditor rule={rule} open={true} onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText("Conditions (JSON)"), {
      target: { value: "{bad-json}" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));

    await waitFor(() => {
      expect(screen.getByText(/Must be a valid JSON object/i)).toBeInTheDocument();
    });
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("submits valid changes and closes on success", async () => {
    const onOpenChange = vi.fn();
    render(<RuleEditor rule={rule} open={true} onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText("Rule Name *"), {
      target: { value: " Updated Rule " },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "rule-1",
          name: "Updated Rule",
          ruleVersion: 1,
        }),
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
