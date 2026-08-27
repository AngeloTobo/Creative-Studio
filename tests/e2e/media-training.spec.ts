import { expect, test } from "@playwright/test";

test("media training sends audio to ACE-Step and visual media to CreativeDNA analysis", async ({ page }) => {
  const createdAt = "2026-08-26T12:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    const asset = (id: string, kind: "image" | "audio", name: string, mimeType: string, contentUrl: string) => ({
      id,
      projectId: "project_training_routes",
      kind,
      name,
      originalFileName: `${name.toLowerCase().replaceAll(" ", "-")}.${kind === "audio" ? "mp3" : "png"}`,
      mimeType,
      size: 1024,
      source: "upload",
      status: "retained",
      contentUrl,
      trainingEligible: true,
      provenance: { uploadedByOwner: true, uploadedAt: time, parentAssetIds: [] },
      createdAt: time,
      updatedAt: time,
    });
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({
      projects: [{ id: "project_training_routes", activeDnaArtifactId: null, name: "Training routes", type: "Creative project", status: "active", description: "", note: "", hue: "#d946ef", initials: "TR", createdAt: time, updatedAt: time }],
      dnaArtifacts: [],
      mediaAssets: [
        asset("media_still", "image", "Still source", "image/png", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
        asset("media_song", "audio", "Song source", "audio/mpeg", "data:audio/mpeg;base64,"),
      ],
      jobs: [], artifacts: [], workflows: [], acceptances: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], modelTrainingJobs: [], modelAdapters: [], idempotencyKeys: {},
    }));
  }, { createdAt });

  await page.goto("/#/media");
  const stillCard = page.locator(".media-card").filter({ hasText: "Still source" });
  await stillCard.locator("summary[aria-label='More actions for Still source']").click();
  await expect(stillCard.getByRole("menuitem", { name: "Analyze media" })).toBeVisible();
  await expect(stillCard.getByRole("menuitem", { name: "Train music LoRA" })).toHaveCount(0);
  await stillCard.getByRole("menuitem", { name: "Analyze media" }).click();
  await expect(page.getByRole("tab", { name: /Analyze media/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("1 selected / 2 eligible")).toBeVisible();

  await page.goto("/#/media");
  const songCard = page.locator(".media-card").filter({ hasText: "Song source" });
  await songCard.locator("summary[aria-label='More actions for Song source']").click();
  await songCard.getByRole("menuitem", { name: "Train music LoRA" }).click();
  await expect(page.getByRole("tab", { name: /Train music LoRA/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Train a music LoRA" })).toBeVisible();
  await expect(page.locator(".ace-audio-select").filter({ hasText: "Song source" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".ace-audio-grid audio")).toHaveAttribute("preload", "none");
});
