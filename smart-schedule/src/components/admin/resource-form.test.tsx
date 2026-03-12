import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceForm } from "./resource-form";
import type { Resource } from "@/types/resource";

describe("ResourceForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows validator errors and blocks submit on invalid payload", async () => {
    const onSubmit = vi.fn();

    render(
      <ResourceForm
        open={true}
        onOpenChange={vi.fn()}
        resource={null}
        isPending={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Resource Code *"), {
      target: { value: "INVALID SPACE" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Resource" }));

    await waitFor(() => {
      expect(screen.getByText(/Only letters, numbers, hyphens, and underscores/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits edit form with resource id when valid", async () => {
    const onSubmit = vi.fn();
    const resource: Resource = {
      id: "resource-1",
      siteId: "site-1",
      resourceCode: "MIX-01",
      resourceType: "mixer",
      displayName: "Mixer",
      trunkLine: null,
      groupName: null,
      minCapacity: 100,
      maxCapacity: 200,
      maxBatchesPerDay: 2,
      chemicalBase: null,
      sortOrder: 0,
      active: true,
      config: {},
      createdAt: "2026-01-01",
    };

    render(
      <ResourceForm
        open={true}
        onOpenChange={vi.fn()}
        resource={resource}
        isPending={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Display Name"), {
      target: { value: "Mixer Updated" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "resource-1",
          displayName: "Mixer Updated",
          resourceCode: "MIX-01",
        }),
      );
    });
  });
});
