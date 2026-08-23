import { expect, test } from "@playwright/test";

test("creation keeps image speed safe and never reuses an imported video prompt", async ({ page }) => {
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
      }, {
        id: "workflow_minimax", projectId: "project_fast", name: "MiniMax Video H3", description: "", sourceFileName: "minimax-h3.json", modality: "video", executionState: "ready", createdAt: time, updatedAt: time,
        currentRevision: {
          id: "workflowrev_minimax", workflowId: "workflow_minimax", version: 4, parentRevisionId: "workflowrev_minimax_3", format: "comfyui-api", contentHash: "def456", nodeCount: 3, models: ["minimax_h3.safetensors"], createdAt: time,
          parameters: [
            { id: "114::image", label: "Load Image", kind: "media", value: "source.png", mediaKind: "image", binding: { format: "comfyui-api", nodeId: "114", inputName: "image" } },
            { id: "105:104::prompt", label: "MiniMax H3 Image to Video: Prompt", kind: "text", value: "Imported cybernetic prompt that must not be reused", mediaKind: null, binding: { format: "comfyui-api", nodeId: "105:104", inputName: "prompt" } },
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
  await expect(page.getByRole("button", { name: /generate image · can be slow/i })).toBeVisible();
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await expect(page.getByLabel("Two video versions per request")).toContainText("Aligned: your exact direction · Discovery: 70% random DNA");
  const videoDirection = page.getByRole("textbox", { name: "Describe the video" });
  const exactVideoPrompt = page.locator(".workflow-run-parameters").getByRole("textbox", { name: "MiniMax H3 Image to Video: Prompt" });
  await expect(videoDirection).toHaveValue("");
  await expect(exactVideoPrompt).toHaveValue("");
  await videoDirection.fill("The subject turns toward the sunrise while the camera slowly pulls back.");
  await expect(exactVideoPrompt).toHaveValue("The subject turns toward the sunrise while the camera slowly pulls back.");
});

test("song creation recommends MiniMax Music captions from analyzed art and DNA without imported lyrics", async ({ page }) => {
  const createdAt = "2026-08-23T20:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    const dimensions = { energy: 72, tension: 68, contrast: 81, warmth: 35, spaciousness: 76, rhythmicity: 63, organicity: 42, polish: 57 };
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({
      projects: [{ id: "project_song", activeDnaArtifactId: "dna_song", name: "Song Study", type: "Music", status: "active", description: "", note: "", hue: "#d946ef", initials: "SS", createdAt: time, updatedAt: time }],
      dnaArtifacts: [{
        schemaVersion: "creative-dna/1.0", artifactId: "dna_song", projectId: "project_song", version: 1, rootArtifactId: "dna_song", name: "Embryo Atmosphere", createdAt: time,
        targetModality: "image", capability: "IMAGE_GENERATE", source: { kind: "owner_uploads", directive: "Patient tension, electric violet color, open space, and a deliberately human edge.", referenceLabel: null, referenceAssetIds: ["media_embryo"] },
        shared: dimensions, native: {}, influence: { angeloCore: 75, currentProject: 15, reference: 50 }, evidence: [],
        rights: { policy: "original-input", referenceStoredAsProvenanceOnly: false, allowedDownstream: ["owner-upload lineage"], blockedDownstream: [] },
        translations: [], lineage: { rootArtifactId: "dna_song", parentArtifactId: null },
        generationPrompts: { image: "Patient tension, electric violet color, open space, and a deliberately human edge.", music: "Patient tension translated into sound." },
        training: { jobId: "training_song", runnerId: "runner_song", assetIds: ["media_embryo"], trainingExampleIds: [], analysis: {
          schemaVersion: "creative-dna-training-analysis/1.1", createdAt: time, summary: "One analyzed artwork.",
          sources: [{ sourceId: "media_embryo", mediaId: "media_embryo", sourceType: "upload", kind: "image", label: "Embryo artwork", observations: [], metrics: {}, dimensions, confidence: .9,
            detailedDescription: { schemaVersion: "creative-dna-media-description/1.1", longSummary: "A detailed analysis of the source artwork.", shortSummary: "A translucent embryo-like form floats in a violet chamber, crossed by fine branching vessels and lit from within against a deep black field.", provider: "local-comfyui", workflowId: "gemma4-multimodal-description", workflowVersion: 1, model: "gemma4_e4b_it_fp8_scaled.safetensors", prompt: "Describe the image.", comfyPromptId: "prompt_song_art", settings: {} } }],
          dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, { value, confidence: .9, sourceIds: ["media_embryo"] }])),
        } },
      }],
      mediaAssets: [{ id: "media_embryo", projectId: "project_song", kind: "image", name: "Embryo artwork", originalFileName: "embryo.png", mimeType: "image/png", size: 4, source: "upload", status: "retained", contentUrl: "data:image/png;base64,iVBORw0KGgo=", trainingEligible: true, provenance: { uploadedByOwner: true, uploadedAt: time, parentAssetIds: [] }, createdAt: time, updatedAt: time }],
      workflows: [{
        id: "workflow_music3", projectId: "project_song", name: "MiniMax Music 3", description: "", sourceFileName: "minimax-music3-api.json", modality: "music", executionState: "ready", createdAt: time, updatedAt: time,
        currentRevision: { id: "workflowrev_music3", workflowId: "workflow_music3", version: 1, parentRevisionId: null, format: "comfyui-api", contentHash: "music3hash", nodeCount: 3, models: ["minimax_music3_dit_fp16.safetensors"], createdAt: time,
          parameters: [
            { id: "37:13::caption", label: "MiniMax Music3 Text Encode: Caption", kind: "text", value: "Imported demo caption", mediaKind: null, binding: { format: "comfyui-api", nodeId: "37:13", inputName: "caption" } },
            { id: "37:13::lyrics", label: "MiniMax Music3 Text Encode: Lyrics", kind: "text", value: "Imported demo lyrics that must not be reused", mediaKind: null, binding: { format: "comfyui-api", nodeId: "37:13", inputName: "lyrics" } },
            { id: "37:38::seed", label: "Seed: Seed", kind: "number", value: 222, mediaKind: null, binding: { format: "comfyui-api", nodeId: "37:38", inputName: "seed" } },
          ] },
      }],
      jobs: [], artifacts: [], acceptances: [], trainingExamples: [], trainingJobs: [],
      trainingReviews: [{ id: "review_song", projectId: "project_song", trainingJobId: "training_song", dnaArtifactId: "dna_song", decision: "approved", note: "Approved source analysis.", actor: "development-user", activeDnaArtifactId: "dna_song", createdAt: time }],
      idempotencyKeys: {},
    }));
  }, { createdAt });

  await page.goto("/#/dna");
  await page.getByRole("button", { name: "Song", exact: true }).click();
  await page.getByLabel("Artwork inspiration").selectOption("media_embryo");
  await expect(page.getByRole("region", { name: "Recommended song prompts" })).toContainText("Uploaded art + CreativeDNA");
  await page.getByRole("button", { name: "Use Art + DNA song prompt" }).click();
  const direction = page.getByRole("textbox", { name: "Describe the song" });
  await expect(direction).toHaveValue(/A translucent embryo-like form floats in a violet chamber/);
  await expect(direction).toHaveValue(/123 BPM/);
  await expect(direction).toHaveValue(/wide depth, long decays, and deliberate negative space/);
  await page.locator(".quick-song-lyrics > summary").click();
  await expect(page.getByRole("textbox", { name: "Song lyrics" })).toHaveValue("");
  await page.locator(".quick-create-advanced > summary").click();
  await expect(page.locator(".workflow-run-parameters").getByRole("textbox", { name: "MiniMax Music3 Text Encode: Lyrics" })).toHaveValue("");
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
  await expect(page.getByRole("heading", { name: "Production Dashboard", exact: true })).toBeVisible();
  await expect(page.locator(".cockpit-run").first()).toBeVisible({ timeout: 5_000 });

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
  await expect(page.getByRole("heading", { name: "Production Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("All caught up.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByText("Retained", { exact: true }).first()).toBeVisible();
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
  const firstRun = page.locator(".cockpit-run").first();
  await firstRun.getByText("Details", { exact: true }).click();
  await firstRun.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(firstRun.getByText("cancelled", { exact: true })).toBeVisible();
  await firstRun.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".cockpit-run")).toHaveCount(2);
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
