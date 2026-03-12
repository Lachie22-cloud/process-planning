import { test, expect } from "@playwright/test";
import { installSupabaseMocks } from "./helpers/mock-supabase";

test("admin resource CRUD happy path", async ({ page }) => {
  await installSupabaseMocks(page);

  await page.goto("/admin/resources");
  await expect(page.getByRole("heading", { name: "Resource Configuration" })).toBeVisible();

  await page.getByRole("button", { name: "Add Resource" }).click();

  await page.getByLabel("Resource Code *").fill("E2E-RSRC-01");
  await page.getByLabel("Display Name").fill("E2E Smoke Resource");
  await page.getByLabel("Trunk Line").fill("TL-9");
  await page.getByLabel("Group").fill("Smoke");
  await page.getByLabel("Min Capacity (L)").fill("100");
  await page.getByLabel("Max Capacity (L)").fill("2000");
  await page.getByLabel("Max Batches/Day").fill("5");

  await page.getByRole("button", { name: "Create Resource" }).click();
  await expect(page.getByText("E2E-RSRC-01")).toBeVisible();

  await page.getByRole("button", { name: "Edit resource E2E-RSRC-01" }).click();
  await page.getByLabel("Display Name").fill("E2E Smoke Resource Updated");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("E2E Smoke Resource Updated")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Deactivate resource E2E-RSRC-01" }).click();
  await expect(page.getByText("Inactive")).toBeVisible();
});
