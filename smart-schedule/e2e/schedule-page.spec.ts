import { test, expect } from "@playwright/test";
import { installSupabaseMocks } from "./helpers/mock-supabase";

test("schedule page loads", async ({ page }) => {
  await installSupabaseMocks(page);

  await page.goto("/schedule");
  await expect(page).toHaveURL(/\/schedule$/);
});
