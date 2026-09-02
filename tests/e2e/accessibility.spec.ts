import { expect, test } from "@playwright/test";

test("desktop navigation and focus treatment work from the keyboard", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop sidebar focus order only");
  await page.goto("/#/portal");

  const dnaButton = page.locator(".sidebar").getByRole("button", { name: "Create", exact: true });
  for (let index = 0; index < 8 && !(await dnaButton.evaluate((element) => element === document.activeElement)); index += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(dnaButton).toBeFocused();
  const focusStyle = await dnaButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).toBe("solid");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.getByRole("heading", { name: "Name your first project" })).toBeVisible();
});

test("the consolidated shell exposes four primary destinations without repeated desktop chrome", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop shell coverage needs one browser shape");
  await page.goto("/#/portal");

  const navigation = page.locator(".sidebar .nav-item");
  await expect(navigation).toHaveCount(4);
  await expect(navigation).toHaveText(["Create", "Ideas", "Work", "Studio"]);
  await expect(page.locator(".rightpanel")).toHaveCount(0);
  await expect(page.locator(".player")).toHaveCount(0);

  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(page).toHaveURL(/#\/studio$/);
  await page.getByRole("tab", { name: /System/ }).click();
  await expect(page.getByRole("tab", { name: /Status/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Runners/ }).click();
  await expect(page.getByRole("heading", { name: "Paired machines" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pair this workstation" })).toBeVisible();
});

test("mobile primary pages render one route heading and four tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile heading coverage needs one browser shape");
  await page.goto("/#/work");

  await expect(page.getByRole("heading", { name: "Work", exact: true })).toHaveCount(1);
  await expect(page.locator(".mtabbar .mtab")).toHaveCount(4);
});

test("reduced-motion preference suppresses Ideas disclosure motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/portal");
  await page.getByRole("textbox", { name: "Project name" }).fill("Motion Test");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: "Find the next direction", level: 1 })).toHaveCount(1);

  const context = page.locator("details.ideas-context");
  const motion = await context.locator(":scope > summary > svg").last().evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationName: style.animationName, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  });
  expect(motion.animationName).toBe("none");
  expect(Number.parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.001);
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.001);
  await context.locator(":scope > summary").click();
  await expect(context).toHaveAttribute("open", "");
});
