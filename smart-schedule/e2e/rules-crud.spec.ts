import { test, expect } from "@playwright/test";
import { installSupabaseMocks } from "./helpers/mock-supabase";

test("rule CRUD happy path", async ({ page }) => {
  await installSupabaseMocks(page);

  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Rules Engine" })).toBeVisible();

  await page.getByRole("tab", { name: /Substitutions/i }).click();
  await page.getByRole("button", { name: "Add Substitution Rule" }).click();

  await page.getByLabel("Source Resource").click();
  await page.getByRole("option", { name: "Mixer 1" }).click();
  await page.getByLabel("Target Resource").click();
  await page.getByRole("option", { name: "Mixer 2" }).click();
  await page.getByLabel("Max Volume (L)").fill("2000");
  await page.getByLabel("Colour Groups").fill("smoke-colour");

  await page.getByRole("button", { name: "Create Rule" }).click();
  await expect(page.getByText("Substitution Rules (1)")).toBeVisible();

  await page.getByRole("button", { name: "Edit substitution rule" }).first().click();
  await page.getByLabel("Max Volume (L)").fill("2500");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText('"maxVolume":2500')).toBeVisible();

  await page.getByRole("button", { name: "Edit substitution rule" }).first().click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No substitution rules configured")).toBeVisible();
});
