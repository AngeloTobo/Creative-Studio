import { expect, test } from "@playwright/test";

test("CreativeDNA survives the full review loop", async ({ page }) => {
  await page.goto("/#/dna");
  await page.getByRole("button", { name: "New DNA" }).click();

  await page.getByRole("textbox", { name: "Name" }).fill("E2E Luminous Study");
  await page.getByRole("textbox", { name: "What are you making?" }).fill(
    "A nocturnal glass form with electric magenta tension, cyan reflections, spacious composition, and a deliberately human edge.",
  );
  await page.getByRole("button", { name: "image", exact: true }).click();
  await page.getByRole("button", { name: "Build CreativeDNA" }).click();

  await expect(page.getByText("Saved · v1")).toBeVisible();
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText("Saved · v2")).toBeVisible();

  await page.getByRole("button", { name: "Make image" }).click();
  await expect(page).toHaveURL(/#\/queue$/);
  await expect(page.getByText("running").first()).toBeVisible({ timeout: 5_000 });

  await page.goto("/#/gallery");
  const artifact = page.locator("article", { has: page.getByRole("heading", { name: "E2E Luminous Study" }) });
  await expect(artifact).toBeVisible({ timeout: 10_000 });
  await artifact.getByRole("button", { name: "Accept" }).click();
  await expect(artifact.getByText("accepted", { exact: true })).toBeVisible();

  await page.reload();
  const persisted = page.locator("article", { has: page.getByRole("heading", { name: "E2E Luminous Study" }) });
  await expect(persisted.getByText("accepted", { exact: true })).toBeVisible();
});
