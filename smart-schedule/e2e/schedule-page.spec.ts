import { test, expect } from "@playwright/test";
import { installSupabaseMocks } from "./helpers/mock-supabase";

test("schedule page loads", async ({ page }) => {
  await installSupabaseMocks(page);

  await page.goto("/schedule");
  await expect(page).toHaveURL(/\/schedule$/);
});

test("batch detail shows shortage table with rows", async ({ page }) => {
  await installSupabaseMocks(page);

  await page.goto("/schedule");
  await expect(page).toHaveURL(/\/schedule$/);

  // Click the batch SAP order link to open the detail sheet
  const batchLink = page.getByRole("button", { name: "10127843", exact: true });
  await batchLink.click();

  // Wait for Material Availability section header
  await expect(page.getByText("Material Availability")).toBeVisible({ timeout: 10000 });

  // Verify "Not Available" statuses are shown
  await expect(page.getByText("Raw Materials")).toBeVisible();
  await expect(page.getByText("Packaging")).toBeVisible();

  // Verify shortage header badge appears (e.g. "8 SHORTAGES")
  await expect(page.getByText(/SHORTAGES/)).toBeVisible({ timeout: 10000 });

  // Verify shortage table column headers
  await expect(page.getByRole("columnheader", { name: "Required" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "SOH" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Short" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "UOM" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "ETA" })).toBeVisible();

  // Verify specific shortage rows appear (RM materials)
  await expect(page.getByText("K1804")).toBeVisible();
  await expect(page.getByText("ARADUR 2965")).toBeVisible();
  await expect(page.getByText("K1082")).toBeVisible();
  await expect(page.getByText("K0057")).toBeVisible();

  // Verify PKG shortages appear
  await expect(page.getByText("C97684539-0.8L03")).toBeVisible();
});
