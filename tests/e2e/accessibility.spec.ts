import { expect, test } from "@playwright/test";

test("desktop navigation and focus treatment work from the keyboard", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop sidebar focus order only");
  await page.goto("/#/portal");

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const dnaButton = page.locator(".sidebar").getByRole("button", { name: "Create", exact: true });
  await expect(dnaButton).toBeFocused();
  const focusStyle = await dnaButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).toBe("solid");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.locator(".topbar").getByRole("heading", { name: "Create", exact: true })).toBeVisible();
});

test("the consolidated shell exposes six primary destinations without repeated desktop chrome", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop shell coverage needs one browser shape");
  await page.goto("/#/portal");

  const navigation = page.locator(".sidebar .nav-item");
  await expect(navigation).toHaveCount(6);
  await expect(navigation).toHaveText(["Home", "Create", "Artifacts", "ProductionLIVE", "Projects", "System"]);
  await expect(page.locator(".rightpanel")).toHaveCount(0);
  await expect(page.locator(".player")).toHaveCount(0);

  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page).toHaveURL(/#\/system$/);
  await expect(page.getByRole("tab", { name: /Status/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Runners/ }).click();
  await expect(page.getByRole("heading", { name: "Creative Studio Local Runner" })).toBeVisible();
});

test("mobile primary pages render one route heading", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile heading coverage needs one browser shape");
  await page.goto("/#/cockpit");

  await expect(page.getByRole("heading", { name: "Production Dashboard", exact: true })).toHaveCount(1);
  await expect(page.locator(".mtabbar .mtab")).toHaveCount(6);
});

test("reduced-motion preference suppresses portal animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/portal");
  await page.getByRole("textbox", { name: "Project name" }).fill("Motion Test");
  await page.getByRole("textbox", { name: "Project type" }).fill("Interaction System");
  await page.getByRole("button", { name: "Create project" }).click();

  const animation = await page.locator(".orb-ring.a").evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(animation.name).toBe("none");
  expect(Number.parseFloat(animation.duration)).toBeLessThanOrEqual(0.001);
});
