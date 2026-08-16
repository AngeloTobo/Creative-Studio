import { expect, test } from "@playwright/test";

test("desktop navigation and focus treatment work from the keyboard", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop sidebar focus order only");
  await page.goto("/#/portal");

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const dnaButton = page.getByRole("button", { name: /CreativeDNA/ }).first();
  await expect(dnaButton).toBeFocused();
  const focusStyle = await dnaButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).toBe("solid");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.getByRole("heading", { name: "CreativeDNA", exact: true }).first()).toBeVisible();
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
