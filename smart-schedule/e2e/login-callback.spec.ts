import { test, expect } from "@playwright/test";
import { installSupabaseMocks } from "./helpers/mock-supabase";

test("login callback redirects to schedule", async ({ page }) => {
  await installSupabaseMocks(page);

  await page.goto("/callback");
  await expect(page).toHaveURL(/\/schedule$/);
});
