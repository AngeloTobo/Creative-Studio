import { expect, test } from "@playwright/test";

test("image creation is fast by default and makes a slow custom run explicit", async ({ page }) => {
  const createdAt = "2026-08-23T14:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({
      projects: [{ id: "project_fast", activeDnaArtifactId: null, name: "Fast Images", type: "Image", status: "active", description: "", note: "", hue: "#d946ef", initials: "FI", createdAt: time, updatedAt: time }],
      dnaArtifacts: [], jobs: [], artifacts: [], mediaAssets: [], acceptances: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], idempotencyKeys: {},
      workflows: [{
        id: "workflow_z_image", projectId: "project_fast", name: "Z-Image Turbo", description: "", sourceFileName: "z-image.json", modality: "image", executionState: "ready", createdAt: time, updatedAt: time,
        currentRevision: {
          id: "workflowrev_z_image", workflowId: "workflow_z_image", version: 1, parentRevisionId: null, format: "comfyui-api", contentHash: "abc123", nodeCount: 4, models: ["z_image_turbo_bf16.safetensors"], createdAt: time,
          parameters: [
            { id: "13::width", label: "Width", kind: "number", value: 1024, mediaKind: null, binding: { format: "comfyui-api", nodeId: "13", inputName: "width" } },
            { id: "13::height", label: "Height", kind: "number", value: 1024, mediaKind: null, binding: { format: "comfyui-api", nodeId: "13", inputName: "height" } },
            { id: "3::steps", label: "Steps", kind: "number", value: 8, mediaKind: null, binding: { format: "comfyui-api", nodeId: "3", inputName: "steps" } },
            { id: "2::text", label: "Prompt", kind: "text", value: "A quiet portrait", mediaKind: null, binding: { format: "comfyui-api", nodeId: "2", inputName: "text" } },
          ],
        },
      }],
    }));
  }, { createdAt });
  await page.goto("/#/dna");
  const speed = page.getByRole("group", { name: "Image speed" });
  await expect(speed.getByRole("button", { name: /^Fast/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Save & generate image · fast/ })).toBeVisible();
  await page.locator(".quick-create-advanced > summary").click();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("512");
  await expect(page.getByRole("spinbutton", { name: "Height" })).toHaveValue("512");
  await speed.getByRole("button", { name: /Custom · can be slow/ }).click();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("1024");
  await expect(page.getByRole("button", { name: /Generate image · can be slow/ })).toBeVisible();
});

test("CreativeDNA survives the full review loop", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/dna");
  await page.getByRole("textbox", { name: "Project name" }).fill("E2E Project");
  await page.getByRole("textbox", { name: "Project type" }).fill("Visual System");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("group", { name: "What do you want to make?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Image", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Add workflow JSON", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /No image model is ready/ })).toBeVisible();
  await page.locator(".quick-create-advanced > summary").click();
  await page.getByRole("button", { name: "Build detailed CreativeDNA" }).click();

  await page.getByRole("textbox", { name: "Name", exact: true }).fill("E2E Luminous Study");
  await page.getByRole("textbox", { name: "What are you making?" }).fill(
    "A nocturnal glass form with electric magenta tension, cyan reflections, spacious composition, and a deliberately human edge.",
  );
  await page.locator(".dna-compose").getByRole("button", { name: "image", exact: true }).click();
  await page.getByRole("button", { name: "Build CreativeDNA" }).click();

  await expect(page.getByText("Saved · v1")).toBeVisible();
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText("Saved · v2")).toBeVisible();

  await page.getByRole("button", { name: "Back to Create" }).click();
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.getByRole("button", { name: "Open training" }).click();
  await expect(page.getByRole("heading", { name: "Train CreativeDNA" })).toBeVisible();
  await expect(page.getByText(/retains a long analysis and a short generation summary for every selected image, audio file, and video/)).toBeVisible();
  await page.getByRole("button", { name: "Back to Create" }).click();
  await expect(page.getByRole("region", { name: "Create with Creative Studio" })).toBeVisible();
  await page.getByRole("button", { name: "Create explicitly simulated development preview" }).click();
  await page.getByRole("button", { name: "View queue", exact: true }).click();
  await expect(page).toHaveURL(/#\/queue$/);
  await expect(page.locator(".queue-card").first()).toBeVisible({ timeout: 5_000 });

  await page.goto("/#/gallery");
  const artifact = page.locator("article", { has: page.getByRole("heading", { name: "E2E Luminous Study" }) });
  await expect(artifact).toBeVisible({ timeout: 10_000 });
  await artifact.getByRole("button", { name: "Accept" }).click();
  const review = page.getByRole("dialog", { name: "Accept E2E Luminous Study" });
  await expect(review).toBeVisible();
  await expect(review.getByRole("button", { name: "Accept artifact" })).toBeDisabled();
  await review.getByRole("textbox", { name: /Review note/ }).fill("Keep the cyan reflections and spacious focal hierarchy.");
  await review.getByRole("button", { name: "Accept artifact" }).click();
  await expect(artifact.locator(".artifact-title").getByText("accepted", { exact: true })).toBeVisible();
  await expect(artifact.getByText("Keep the cyan reflections and spacious focal hierarchy.")).toBeVisible();
  await expect(artifact.getByText("Reviewed by Development user")).toBeVisible();

  await page.reload();
  const persisted = page.locator("article", { has: page.getByRole("heading", { name: "E2E Luminous Study" }) });
  await expect(persisted.locator(".artifact-title").getByText("accepted", { exact: true })).toBeVisible();
  await expect(persisted.getByText("Keep the cyan reflections and spacious focal hierarchy.")).toBeVisible();

  await page.goto("/#/cockpit");
  await expect(page.getByRole("heading", { name: "Production cockpit", exact: true })).toBeVisible();
  await expect(page.getByText("All caught up.")).toBeVisible();
  await expect(page.getByText("Direct CreativeDNA generation")).toBeVisible();
  await expect(page.getByText("Verified storage")).toBeVisible();
});

test("cancelled generation explains the retained history and offers a durable retry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Queue control coverage needs one browser shape");
  await page.goto("/#/dna");
  await page.getByRole("textbox", { name: "Project name" }).fill("Retry E2E");
  await page.getByRole("textbox", { name: "Project type" }).fill("Image Study");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("textbox", { name: "Describe the image" }).fill("An original image with a clean silhouette and high contrast rim light.");
  await page.getByRole("button", { name: "Create explicitly simulated development preview" }).click();
  await page.getByRole("button", { name: "View queue", exact: true }).click();
  await page.getByRole("button", { name: "Cancel tracking" }).click();

  await expect(page.getByRole("region", { name: "Tracking cancelled" })).toContainText("cancelled_by_user");
  await expect(page.getByRole("region", { name: "Tracking cancelled" })).toContainText("remains in history");
  await page.getByRole("button", { name: "Retry as new job" }).click();
  await expect(page.getByText(/Retry of job_/)).toBeVisible();
  await expect(page.locator(".queue-card")).toHaveCount(2);
});

test("project onboarding starts empty and preserves explicit lifecycle changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Project lifecycle needs one browser shape");
  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "Create your first project" })).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(0);

  await page.getByRole("textbox", { name: "Project name" }).fill("Launch System");
  await page.getByRole("textbox", { name: "Project type" }).fill("Campaign");
  await page.getByRole("button", { name: "Create project" }).click();
  let card = page.locator(".project-card", { hasText: "Launch System" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Direction needed")).toBeVisible();
  await expect(card.getByRole("button", { name: "Create", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Artifacts", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Production", exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/#\/dna$/);
  await page.goto("/#/projects");
  card = page.locator(".project-card", { hasText: "Launch System" });

  await card.getByRole("button", { name: "Edit Launch System" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Launch System Revised");
  await page.getByRole("combobox", { name: "Project status" }).selectOption("paused");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByText("Launch System Revised")).toBeVisible();
  await expect(card.getByText("paused", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Archive Launch System Revised" }).click();
  await card.getByRole("button", { name: "Confirm archive Launch System Revised" }).click();
  const archived = page.locator(".project-archived-row", { hasText: "Launch System Revised" });
  await expect(archived).toBeVisible();
  await expect(archived).toContainText("archived");
  await expect(page.getByRole("heading", { name: "Create your first project" })).toBeVisible();
});

test("media workspace never substitutes fake uploads in development mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Media workspace coverage needs one browser shape");
  await page.goto("/#/media");
  await page.getByRole("textbox", { name: "Project name" }).fill("Media E2E");
  await page.getByRole("textbox", { name: "Project type" }).fill("Source Library");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.goto("/#/media");
  await expect(page.getByRole("heading", { name: "Bring real source material into the studio." })).toBeVisible();
  await expect(page.getByText("The browser development adapter never creates fake media.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload and retain" })).toBeDisabled();
  await expect(page.getByText("No media uploaded yet.")).toBeVisible();
});
