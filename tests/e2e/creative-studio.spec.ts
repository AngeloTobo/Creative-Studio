import { expect, test } from "@playwright/test";

test("CreativeDNA survives the full review loop", async ({ page }) => {
  await page.goto("/#/dna");
  await page.getByRole("textbox", { name: "Project name" }).fill("E2E Project");
  await page.getByRole("textbox", { name: "Project type" }).fill("Visual System");
  await page.getByRole("button", { name: "Create project" }).click();
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

test("project onboarding starts empty and preserves explicit lifecycle changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Project lifecycle needs one browser shape");
  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "Create your first project" })).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(0);

  await page.getByRole("textbox", { name: "Project name" }).fill("Launch System");
  await page.getByRole("textbox", { name: "Project type" }).fill("Campaign");
  await page.getByRole("button", { name: "Create project" }).click();
  const card = page.locator(".project-card", { hasText: "Launch System" });
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByRole("textbox", { name: "Project name" }).fill("Launch System Revised");
  await card.getByRole("combobox", { name: "Project status" }).selectOption("paused");
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByText("Launch System Revised")).toBeVisible();
  await expect(card.getByText("paused", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Archive" }).click();
  await card.getByRole("button", { name: "Confirm archive" }).click();
  await expect(card.getByText("archived", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your first project" })).toBeVisible();
});
