import { expect, test, type Page } from "@playwright/test";

async function openRetainedWork(page: Page) {
  await page.getByRole("button", { name: /^(Retained work|Change)$/ }).click();
}

async function openCreativeControls(page: Page) {
  const control = page.getByRole("button", { name: /creative controls/i });
  if (await control.getAttribute("aria-expanded") !== "true") await control.click();
}

async function openCreatePlan(page: Page) {
  const plan = page.locator("details.quick-create-plan");
  if (await plan.getAttribute("open") === null) await plan.locator(":scope > summary").click();
}

test("a Create draft survives navigation and resumes from Home", async ({ page }) => {
  const createdAt = "2026-08-27T05:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({
      projects: [{ id: "project_session", activeDnaArtifactId: null, name: "Resumable study", type: "Image", status: "active", description: "", note: "", hue: "#d946ef", initials: "RS", createdAt: time, updatedAt: time }],
      dnaArtifacts: [], jobs: [], artifacts: [], mediaAssets: [], workflows: [], acceptances: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], idempotencyKeys: {},
    }));
  }, { createdAt });

  await page.goto("/#/dna");
  const direction = page.getByRole("textbox", { name: "Describe the image" });
  await direction.fill("A suspended glass seed holding a tiny electric storm.");
  await expect(page.locator(".quick-autosave-state")).toHaveText("Saves as you type.");
  await page.waitForTimeout(750);

  await page.goto("/#/portal");
  const draft = page.locator(".home-draft-chip");
  await expect(draft).toContainText("A suspended glass seed holding a tiny electric storm.");
  await expect(draft).toContainText("explore draft");
  await draft.click();
  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.getByRole("textbox", { name: "Describe the image" })).toHaveValue("A suspended glass seed holding a tiny electric storm.");
  await expect(page.getByText(/Resumed your explore image draft/)).toBeVisible();
});

test("a restored draft requires an explicit replacement when its model disappeared", async ({ page }) => {
  const createdAt = "2026-08-27T05:10:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({
      projects: [{ id: "project_missing_model", activeDnaArtifactId: null, name: "Model recovery", type: "Image", status: "active", description: "", note: "", hue: "#d946ef", initials: "MR", createdAt: time, updatedAt: time }],
      workflows: [{
        id: "workflow_available", projectId: "project_missing_model", name: "Available image model", description: "", sourceFileName: "available.json", modality: "image", executionState: "ready", createdAt: time, updatedAt: time,
        currentRevision: { id: "workflowrev_available", workflowId: "workflow_available", version: 1, parentRevisionId: null, format: "comfyui-api", contentHash: "availablehash", nodeCount: 2, models: ["available.safetensors"], createdAt: time, parameters: [{ id: "2::text", label: "Prompt", kind: "text", value: "Available prompt", mediaKind: null, binding: { format: "comfyui-api", nodeId: "2", inputName: "text" } }] },
      }],
      dnaArtifacts: [], jobs: [], artifacts: [], mediaAssets: [], acceptances: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], idempotencyKeys: {},
    }));
    localStorage.setItem("creative-studio:create-sessions", JSON.stringify({
      schemaVersion: 2,
      sessions: [{ schemaVersion: 2, id: "session_missing_model", projectId: "project_missing_model", sourceAssetIds: [], retainedArtifactId: null, direction: "A mirrored seed opening under moonlight.", mediaKind: "image", workflowId: "workflow_removed", graphicalSettings: { workflowRevisionId: "workflowrev_removed" }, intentTier: "explore", updatedAt: time }],
    }));
  }, { createdAt });

  await page.goto("/#/dna");
  await expect(page.getByText(/model is no longer available/i)).toBeVisible();
  await expect(page.locator(".quick-compose-model > summary")).toContainText("No image model ready");
  await expect(page.locator(".quick-primary")).toHaveText(/Create/);
  await expect(page.locator(".quick-primary")).toBeDisabled();
  await openCreativeControls(page);
  await page.locator(".quick-compose-model > summary").click();
  await page.getByRole("button", { name: /Available image model/ }).click();
  await expect(page.locator(".quick-compose-model > summary")).toContainText("Available image model");
});

test("Home turns an analyzed upload into a visual CreativeDNA launchpad and one-tap animation brief", async ({ page }) => {
  const createdAt = "2026-08-23T23:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    const dimensions = { energy: 76, tension: 64, contrast: 88, warmth: 32, spaciousness: 71, rhythmicity: 58, organicity: 42, polish: 81 };
    const analysis = {
      schemaVersion: "creative-dna-training-analysis/1.1", createdAt: time, summary: "Measured the retained source.",
      sources: [{
        sourceId: "media_home", mediaId: "media_home", sourceType: "upload", kind: "image", label: "Rebecca embryo", observations: [], metrics: {}, dimensions, confidence: .93,
        detailedDescription: { schemaVersion: "creative-dna-media-description/1.1", longSummary: "A long source-grounded description of Rebecca's embryo artwork.", shortSummary: "A luminous embryo-like form floats in a dark violet field, with branching vessels and a cool internal glow.", provider: "local-comfyui", workflowId: "gemma4-multimodal-description", workflowVersion: 1, model: "gemma4_e4b_it_fp8_scaled.safetensors", prompt: "Describe the image.", comfyPromptId: "prompt_home_dna", settings: {} },
      }],
      dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, { value, confidence: .93, sourceIds: ["media_home"] }])),
    };
    const dna = { schemaVersion: "creative-dna/1.0", artifactId: "dna_home", projectId: "project_home", version: 1, rootArtifactId: "dna_home", name: "Embryo light", createdAt: time, targetModality: "image", capability: "IMAGE_GENERATE", source: { kind: "owner_uploads", directive: "Luminous embryonic forms in deep violet space.", referenceLabel: null, referenceAssetIds: ["media_home"] }, shared: dimensions, native: {}, influence: { angeloCore: 75, currentProject: 15, reference: 50 }, evidence: [], rights: { policy: "original-input", referenceStoredAsProvenanceOnly: false, allowedDownstream: [], blockedDownstream: [] }, translations: [], generationPrompts: { image: "Luminous embryonic forms in deep violet space.", music: "Translate the luminous tension into sound." }, lineage: { rootArtifactId: "dna_home", parentArtifactId: null }, training: { jobId: "training_home", runnerId: "runner_home", assetIds: ["media_home"], trainingExampleIds: [], analysis } };
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({
      projects: [{ id: "project_home", activeDnaArtifactId: "dna_home", name: "Rebecca", type: "Visual study", status: "active", description: "", note: "", hue: "#d946ef", initials: "RE", createdAt: time, updatedAt: time }],
      dnaArtifacts: [dna],
      mediaAssets: [{ id: "media_home", projectId: "project_home", kind: "image", name: "Rebecca embryo", originalFileName: "rebecca-embryo.png", mimeType: "image/png", size: 68, source: "upload", status: "retained", contentUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", trainingEligible: true, provenance: { uploadedByOwner: true, uploadedAt: time, parentAssetIds: [] }, createdAt: time, updatedAt: time }],
      jobs: [], artifacts: [], workflows: [], acceptances: [], trainingExamples: [], trainingJobs: [], idempotencyKeys: {},
      trainingReviews: [{ id: "review_home", projectId: "project_home", trainingJobId: "training_home", dnaArtifactId: "dna_home", decision: "approved", note: "Approved.", actor: "development-user", activeDnaArtifactId: "dna_home", createdAt: time }],
    }));
  }, { createdAt });

  await page.goto("/#/portal");
  await expect(page.getByRole("region", { name: "CreativeDNA canvas" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Measured upload DNA: Energy 76, Tension 64, Contrast 88/ })).toBeVisible();
  await expect(page.getByText("93% confidence")).toBeVisible();
  await expect(page.getByText(/A luminous embryo-like form floats in a dark violet field/)).toBeVisible();
  await expect(page.locator(".orb-stage")).toHaveCount(0);

  await page.getByRole("button", { name: /^Animate 2 fast versions/ }).click();
  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.getByRole("button", { name: "Video", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".quick-compose-source > summary")).toContainText("Rebecca embryo");
  await openRetainedWork(page);
  await expect(page.getByRole("button", { name: "Use Rebecca embryo upload" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Describe the video")).not.toHaveValue(/A luminous embryo-like form floats in a dark violet field/);
  await expect(page.getByLabel("Describe the video")).not.toHaveValue(/Opening-frame evidence|Beat 1:/);
  await expect(page.getByLabel("Describe the video")).toHaveValue(/Use this image as the exact first frame/);
  await expect(page.getByLabel("Describe the video")).toHaveValue(/fine light pulse crosses the central form/);
  await openCreatePlan(page);
  const outputCount = page.getByRole("group", { name: "Number of video outputs" });
  await expect(outputCount.getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(outputCount.getByRole("button", { name: "2", exact: true })).toBeEnabled();
  await expect(outputCount.getByRole("button", { name: "1", exact: true })).toBeEnabled();
  await expect(outputCount.getByRole("button", { name: "4", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("development adapter cannot submit simulated video");
  await openCreativeControls(page);
  await page.locator(".quick-ai-prompt-assist > summary").click();
  await expect(page.getByRole("button", { name: "Local Gemma offline" })).toBeDisabled();
  await expect(page.getByText(/no proven quality lift yet/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "No dialogue", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/model-tuned ambience and sound design/)).toBeVisible();
  await page.getByRole("button", { name: "Exact script", exact: true }).click();
  const originalScript = "Look at the light.";
  const exactScriptInput = page.getByRole("textbox", { name: "Exact spoken words" });
  await exactScriptInput.fill(originalScript);
  await expect(page.getByText(/Sent verbatim once/)).toBeVisible();

  const helpButton = page.getByRole("button", { name: "Write full script" });
  await helpButton.click();
  const scriptBuilder = page.getByRole("dialog", { name: "Full Video Script" });
  await expect(scriptBuilder).toBeVisible();
  await expect(scriptBuilder).toContainText("5s full scene");
  await expect(scriptBuilder).toContainText("dialogue optional");
  await expect(scriptBuilder.getByRole("alert")).toContainText("Choose a video model first");
  await scriptBuilder.getByRole("textbox", { name: /What should happen/ })
    .fill("They are posing for a fashion shoot");
  await expect(scriptBuilder).toContainText("action, camera, atmosphere, ending, and sound");
  await expect(scriptBuilder.getByRole("button", { name: "Write full video script" })).toBeDisabled();
  await expect(scriptBuilder.getByRole("button", { name: "Polish current direction" })).toBeDisabled();
  const viewport = page.viewportSize();
  const scriptBuilderBounds = await scriptBuilder.boundingBox();
  expect(viewport).not.toBeNull();
  expect(scriptBuilderBounds).not.toBeNull();
  expect(scriptBuilderBounds!.x).toBeGreaterThanOrEqual(0);
  expect(scriptBuilderBounds!.y).toBeGreaterThanOrEqual(0);
  expect(scriptBuilderBounds!.x + scriptBuilderBounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(scriptBuilderBounds!.y + scriptBuilderBounds!.height).toBeLessThanOrEqual(viewport!.height);
  await page.keyboard.press("Escape");
  await expect(scriptBuilder).toBeHidden();
  await expect(helpButton).toBeFocused();
  await expect(exactScriptInput).toHaveValue(originalScript);

  await page.goto("/#/portal");
  await page.getByRole("button", { name: /Train DNA/ }).click();
  await expect(page.getByRole("heading", { name: "Train", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Analyze media/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Analyze media" })).toBeVisible();
});

test("creation keeps image speed safe and never reuses an imported video prompt", async ({ page }) => {
  test.slow();
  const createdAt = "2026-08-23T14:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({
      projects: [{ id: "project_fast", activeDnaArtifactId: null, name: "Fast Images", type: "Image", status: "active", description: "", note: "", hue: "#d946ef", initials: "FI", createdAt: time, updatedAt: time }],
      dnaArtifacts: [], jobs: [], artifacts: [], mediaAssets: Array.from({ length: 7 }, (_, index) => {
        const date = new Date(new Date(time).getTime() + index * 1_000).toISOString();
        const name = index === 6 ? "Newest retained source" : index === 0 ? "Oldest retained source" : `Retained source ${index + 1}`;
        return { id: `media_fast_${index}`, projectId: "project_fast", kind: "image", name, originalFileName: `source-${index}.png`, mimeType: "image/png", size: 68, source: "upload", status: "retained", contentUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", trainingEligible: true, provenance: { uploadedByOwner: true, uploadedAt: date, parentAssetIds: [] }, createdAt: date, updatedAt: date };
      }), acceptances: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], idempotencyKeys: {},
      workflows: [{
        id: "workflow_z_image", projectId: "project_fast", name: "Z-Image Turbo", description: "", sourceFileName: "z-image.json", modality: "image", executionState: "ready", createdAt: time, updatedAt: time,
        currentRevision: {
          id: "workflowrev_z_image", workflowId: "workflow_z_image", version: 1, parentRevisionId: null, format: "comfyui-api", contentHash: "abc123", nodeCount: 4, models: ["z_image_turbo_bf16.safetensors"], createdAt: time,
          parameters: [
            { id: "13::width", label: "Width", kind: "number", value: 1024, mediaKind: null, binding: { format: "comfyui-api", nodeId: "13", inputName: "width" } },
            { id: "13::height", label: "Height", kind: "number", value: 1024, mediaKind: null, binding: { format: "comfyui-api", nodeId: "13", inputName: "height" } },
            { id: "3::steps", label: "Steps", kind: "number", value: 8, mediaKind: null, binding: { format: "comfyui-api", nodeId: "3", inputName: "steps" } },
            { id: "3::seed", label: "Seed", kind: "number", value: 42, mediaKind: null, binding: { format: "comfyui-api", nodeId: "3", inputName: "seed" } },
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
            { id: "105:111::value", label: "Float (duration)", kind: "number", value: 10, mediaKind: null, binding: { format: "comfyui-api", nodeId: "105:111", inputName: "value" } },
          ],
        },
      }, {
        id: "workflow_ltx", projectId: "project_fast", name: "LTX 2.5 Image to Video", description: "", sourceFileName: "ltx-2.5-i2v.json", modality: "video", executionState: "ready", createdAt: time, updatedAt: time,
        currentRevision: {
          id: "workflowrev_ltx", workflowId: "workflow_ltx", version: 3, parentRevisionId: "workflowrev_ltx_2", format: "comfyui-api", contentHash: "ghi789", nodeCount: 3, models: ["ltx-2.5-22b.safetensors"], createdAt: time,
          parameters: [
            { id: "398:350::image", label: "Load Image", kind: "media", value: "source.png", mediaKind: "image", binding: { format: "comfyui-api", nodeId: "398:350", inputName: "image" } },
            { id: "398:376::prompt", label: "LTX Positive Prompt", kind: "text", value: "Imported LTX prompt", mediaKind: null, binding: { format: "comfyui-api", nodeId: "398:376", inputName: "prompt" } },
            { id: "398:362::value", label: "Duration", kind: "number", value: 5, mediaKind: null, binding: { format: "comfyui-api", nodeId: "398:362", inputName: "value" } },
            { id: "398:361::value", label: "Frame Rate", kind: "number", value: 24, mediaKind: null, binding: { format: "comfyui-api", nodeId: "398:361", inputName: "value" } },
          ],
        },
      }],
    }));
  }, { createdAt });
  await page.goto("/#/dna");
  await openRetainedWork(page);
  const sourceGallery = page.getByRole("region", { name: "Use retained work" });
  await expect(sourceGallery.getByRole("button", { name: "Use Newest retained source upload" })).toBeVisible();
  await expect(sourceGallery.getByRole("button", { name: "Use Oldest retained source upload" })).toHaveCount(0);
  await sourceGallery.getByRole("button", { name: "View all 7" }).click();
  await expect(sourceGallery.getByRole("button", { name: "Use Oldest retained source upload" })).toBeVisible();
  await sourceGallery.getByRole("button", { name: "Use Oldest retained source upload" }).click();
  await expect(page.getByRole("region", { name: "Source and creation type" })).toContainText("Oldest retained source");
  await openCreativeControls(page);
  await page.locator(".quick-speed-panel > summary").click();
  const speed = page.getByRole("group", { name: "Image speed" });
  await expect(speed.getByRole("button", { name: /^Fast/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("alert")).toContainText("cannot use Oldest retained source");
  await page.getByRole("button", { name: "Continue without source" }).click();
  await expect(page.locator(".quick-primary")).toHaveText(/Create/);
  await page.locator(".quick-render-panel > summary").click();
  const renderSetup = page.getByRole("region", { name: "Canvas and render settings" });
  const canvasShape = renderSetup.getByRole("group", { name: "Canvas shape", exact: true });
  const renderDetail = page.getByRole("group", { name: "Render detail" });
  await expect(renderSetup).toBeVisible();
  await expect(canvasShape.getByRole("button", { name: "9:16 Portrait" })).toBeVisible();
  await canvasShape.getByRole("button", { name: "9:16 Portrait" }).click();
  await expect(canvasShape.getByRole("button", { name: "9:16 Portrait" })).toHaveAttribute("aria-pressed", "true");
  await renderDetail.getByRole("button", { name: /Balanced/ }).click();
  await expect(renderDetail.getByRole("button", { name: /Balanced/ })).toHaveAttribute("aria-pressed", "true");
  await expect(speed.getByRole("button", { name: /Custom · can be slow/ })).toHaveAttribute("aria-pressed", "true");
  await renderSetup.getByText("Fine tune", { exact: true }).click();
  await expect(page.getByRole("group", { name: "Sampling steps" }).getByRole("button", { name: "8", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator(".quick-create-advanced > summary").click();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveCount(0);
  await expect(page.getByRole("spinbutton", { name: "Height" })).toHaveCount(0);
  await expect(page.getByRole("spinbutton", { name: "Steps" })).toHaveCount(0);
  await expect(page.getByRole("spinbutton", { name: "Seed" })).toHaveCount(0);
  await expect(page.locator(".quick-primary")).toHaveText(/Create/);
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await expect(page.getByRole("region", { name: "Creation goal" })).toContainText("Two fast retained directions");
  await openRetainedWork(page);
  await page.getByRole("button", { name: "Use Newest retained source upload" }).click();
  await page.locator(".quick-compose-model > summary").click();
  await openCreatePlan(page);
  const videoDuration = page.getByRole("group", { name: "Video duration" });
  await expect(videoDuration.getByRole("button", { name: "5s", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(videoDuration.getByRole("button", { name: "10s", exact: true })).toBeVisible();
  await expect(videoDuration.getByRole("button", { name: "15s", exact: true })).toBeVisible();
  await expect(videoDuration.getByRole("button", { name: "30s", exact: true })).toBeVisible();
  await expect(videoDuration.getByRole("button", { name: "1m", exact: true })).toBeVisible();
  await expect(page.getByLabel("Video length")).toContainText("Each of 2 outputs");
  await expect(page.getByLabel("Video length")).toContainText("Aligned follows your direction; Discovery uses 70% random DNA.");
  const videoDirection = page.getByRole("textbox", { name: "Describe the video" });
  await expect(page.getByRole("spinbutton", { name: "Float (duration)" })).toHaveCount(0);
  await expect(videoDirection).toHaveValue("");
  await expect(page.locator(".workflow-run-parameters").getByRole("textbox", { name: "MiniMax H3 Image to Video: Prompt" })).toHaveCount(0);
  await videoDirection.fill("The subject turns toward the sunrise while the camera slowly pulls back.");
  await expect(videoDirection).toHaveValue("The subject turns toward the sunrise while the camera slowly pulls back.");
  await videoDuration.getByRole("button", { name: "30s", exact: true }).click();
  await expect(page.getByRole("button", { name: /LTX 2.5 Image to Video/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /MiniMax Video H3/ })).toBeDisabled();
  await expect(page.getByLabel("Video length")).toContainText("30s is a longer local render");
  await videoDuration.getByRole("button", { name: "5s", exact: true }).click();
  await expect(page.getByRole("button", { name: /MiniMax Video H3/ })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(750);
  const automaticDraft = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("creative-studio:create-sessions") ?? "{}") as {
      sessions?: Array<{ workflowId?: string | null; graphicalSettings?: Record<string, unknown> }>;
    };
    return stored.sessions?.[0] ?? null;
  });
  expect(automaticDraft?.workflowId).toBeNull();
  expect(automaticDraft?.graphicalSettings).toMatchObject({
    workflowSelectionMode: "automatic",
    automaticWorkflowId: "workflow_minimax",
  });
  await page.reload();
  await openCreatePlan(page);
  await expect(page.locator(".quick-video-essentials > header")).toContainText("AUTO MODEL");
  await expect(page.locator(".quick-video-essentials > header")).toContainText("MiniMax Video H3");
  await openCreativeControls(page);
  await page.locator(".quick-compose-model > summary").click();
  await page.getByRole("button", { name: /LTX 2.5 Image to Video/ }).click();
  await videoDuration.getByRole("button", { name: "10s", exact: true }).click();
  await expect(page.getByRole("button", { name: /LTX 2.5 Image to Video/ })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(750);
  const explicitDraft = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("creative-studio:create-sessions") ?? "{}") as {
      sessions?: Array<{ workflowId?: string | null; graphicalSettings?: Record<string, unknown> }>;
    };
    return stored.sessions?.[0] ?? null;
  });
  expect(explicitDraft?.workflowId).toBe("workflow_ltx");
  expect(explicitDraft?.graphicalSettings).toMatchObject({ workflowSelectionMode: "explicit" });
  await page.reload();
  await openCreatePlan(page);
  await expect(page.locator(".quick-video-essentials > header")).toContainText("YOUR MODEL");
  await expect(page.locator(".quick-video-essentials > header")).toContainText("LTX 2.5 Image to Video");
  await openCreativeControls(page);
  await page.locator(".quick-render-panel > summary").click();
  await page.getByRole("region", { name: "Canvas and render settings" }).getByText("Fine tune", { exact: true }).click();
  await expect(page.getByRole("group", { name: "Frames per second" }).getByRole("button", { name: /24/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".workflow-run-parameters").getByRole("textbox", { name: "LTX Positive Prompt" })).toHaveCount(0);
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
  await openRetainedWork(page);
  await page.getByRole("button", { name: "Use Embryo artwork upload" }).click();
  await openCreativeControls(page);
  await page.locator(".quick-prompt-ideas > summary").click();
  await expect(page.getByRole("region", { name: "Recommended song prompts" })).toContainText("Uploaded art + CreativeDNA");
  await page.getByRole("button", { name: "Use Art + DNA song prompt" }).click();
  const direction = page.getByRole("textbox", { name: "Describe the song" });
  await expect(direction).toHaveValue(/A translucent embryo-like form floats in a violet chamber/);
  await expect(direction).toHaveValue(/123 BPM/);
  await expect(direction).toHaveValue(/wide depth, long decays, and deliberate negative space/);
  await openCreativeControls(page);
  await page.locator(".quick-song-lyrics > summary").click();
  await expect(page.getByRole("textbox", { name: "Song lyrics" })).toHaveValue("");
  await page.locator(".quick-create-advanced > summary").click();
  await expect(page.locator(".workflow-run-parameters").getByRole("textbox", { name: "MiniMax Music3 Text Encode: Lyrics" })).toHaveCount(0);
});

test("evolution results stay in one side-by-side study instead of repeating in artifact history", async ({ page }) => {
  const createdAt = "2026-08-23T21:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    const project = { id: "project_evolution", activeDnaArtifactId: null, name: "Rebecca", type: "Character study", status: "active", description: "Rebecca has a precise biomechanical silhouette and luminous blue eyes.", note: "Keep the rooftop sequence nocturnal and intimate.", hue: "#d946ef", initials: "RE", createdAt: time, updatedAt: time };
    const roles = ["refine", "correct", "discovery"];
    const stamp = (role: string) => ({ schemaVersion: 1, source: "comfyui-workflow", createdAt: time, reusedFromJobId: null, prompt: `${role} rooftop direction`, provider: "local-comfyui", modality: "image", workflow: null, parameters: { prompt: `${role} rooftop direction` }, models: ["z_image_turbo_bf16.safetensors"], inputAssetIds: [], evolution: { schemaVersion: "creative-studio-evolution/1.0", studyId: "evolve_e2e-study-001", role, sourceId: "artifact_source", source: "artifact", sourceKind: "image", sourceName: "Rebecca rooftop", projectCanon: { identity: project.description, currentDirection: project.note }, personalTasteSignalIds: [], projectTasteSignalIds: [], createdAt: time } });
    const jobs = roles.map((role) => ({ id: `job_${role}`, projectId: project.id, dnaArtifactId: "dna_evolution", capability: "IMAGE_GENERATE", modality: "image", status: "completed", progress: 100, prompt: `${role} rooftop direction`, provider: "local-comfyui", upstreamId: `comfy_${role}`, artifactId: `artifact_${role}`, retryOfJobId: null, error: null, createdAt: time, updatedAt: time, startedAt: time, executionStage: "completed", stageUpdatedAt: time, completedAt: time, settingsStamp: stamp(role) }));
    const cancelledJob = { ...jobs[0], id: "job_cancelled", status: "cancelled", progress: 44, artifactId: null, upstreamId: null, executionStage: "cancelled", settingsStamp: stamp("correct") };
    const artifacts = roles.map((role, index) => ({ id: `artifact_${role}`, projectId: project.id, jobId: `job_${role}`, dnaArtifactId: "dna_evolution", kind: "image", name: `Rebecca · ${role}`, status: index === 0 ? "accepted" : index === 1 ? "rejected" : "ready", provider: "local-comfyui", prompt: `${role} rooftop direction`, preview: { kind: "development-gradient", url: null, colors: ["#6d28d9", "#db2777"] }, lineage: { sourceArtifactIds: ["artifact_source"], parentArtifactId: "artifact_source" }, retention: { state: "development-only", size: null }, settingsStamp: stamp(role), createdAt: time, updatedAt: time }));
    const archivedJob = { ...jobs[2], id: "job_archived_discovery", artifactId: "artifact_archived_discovery" };
    const archivedArtifact = { ...artifacts[2], id: "artifact_archived_discovery", jobId: archivedJob.id, name: "Rebecca · archived discovery", status: "archived" };
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({ projects: [project], dnaArtifacts: [], jobs: [...jobs, archivedJob, cancelledJob], artifacts: [...artifacts, archivedArtifact], mediaAssets: [], workflows: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], acceptances: [{ id: "accept_evolution", artifactId: "artifact_refine", decision: "accepted", note: "Keep the luminous eyes and controlled silhouette.", actor: "development-user", createdAt: time }], idempotencyKeys: {} }));
  }, { createdAt });

  await page.goto("/#/gallery");
  const study = page.locator(".evolution-study");
  await expect(page.getByRole("feed", { name: "Artifact history, newest first" })).toBeVisible();
  await expect(study).toHaveCount(1);
  await expect(study.locator(".evolution-branch")).toHaveCount(3);
  await expect(study).toContainText("Direction board");
  await expect(study).toContainText("Refine");
  await expect(study).toContainText("Correct");
  await expect(study).toContainText("Discovery");
  await expect(study.locator(".evolution-branch-label > b")).toHaveText(["A", "B", "C"]);
  await expect(study).toContainText("3 results · 4 runs");
  await expect(study.getByRole("heading", { name: "Rebecca · archived discovery" })).toHaveCount(0);
  const noMedia = study.locator(".evolution-no-media");
  await expect(noMedia).toContainText("1 run without media");
  await expect(noMedia.getByText("job_cancelled", { exact: false })).toBeHidden();
  await noMedia.getByText("1 run without media").click();
  await expect(noMedia.getByText("job_cancelled", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "ready 1" }).click();
  await expect(study.locator(".evolution-branch")).toHaveCount(1);
  await expect(study.getByRole("heading", { name: "Rebecca · discovery" })).toBeVisible();
  await expect(study.getByRole("heading", { name: "Rebecca · correct" })).toHaveCount(0);
  await expect(study.locator(".evolution-no-media")).toHaveCount(0);
  const archive = page.locator(".archived-artifacts");
  await archive.getByText("Archived history").click();
  const archivedStudy = page.getByRole("feed", { name: "Archived artifact history, newest first" }).locator(".evolution-study");
  await expect(archivedStudy.locator(".evolution-branch")).toHaveCount(1);
  await expect(archivedStudy.getByRole("heading", { name: "Rebecca · archived discovery" })).toBeVisible();
  await expect(archivedStudy.getByRole("heading", { name: "Rebecca · refine" })).toHaveCount(0);
  await expect(page.locator(".artifact-grid > .artifact-card")).toHaveCount(0);
});

test("artifact history keeps active work compact and archived work available on demand", async ({ page }, testInfo) => {
  const createdAt = "2026-08-24T01:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    const project = { id: "project_artifacts", activeDnaArtifactId: null, name: "Artifact review", type: "Mixed media", status: "active", description: "", note: "", hue: "#d946ef", initials: "AR", createdAt: time, updatedAt: time };
    const stamp = (prompt: string) => ({ schemaVersion: 1, source: "development-adapter", createdAt: time, reusedFromJobId: null, prompt, provider: "development-adapter", modality: "image", workflow: null, parameters: { prompt }, models: [], inputAssetIds: [] });
    const artifact = (id: string, name: string, status: string, hour: number) => {
      const prompt = `${name} with a precise illuminated focal form, deep violet atmosphere, controlled negative space, fine tactile detail, and a deliberate edge that carries through the entire frame without explanatory text or title cards.`;
      const date = `2026-08-24T${String(hour).padStart(2, "0")}:00:00.000Z`;
      return { id, projectId: project.id, jobId: `job_${id}`, dnaArtifactId: "dna_artifacts", kind: "image", name, status, provider: "development-adapter", prompt, preview: { kind: "development-gradient", url: null, colors: ["#6d28d9", "#db2777"] }, lineage: { sourceArtifactIds: [], parentArtifactId: null }, retention: { state: "development-only", size: null }, settingsStamp: stamp(prompt), createdAt: date, updatedAt: date };
    };
    const artifacts = [artifact("artifact_ready", "Newest active frame", "ready", 3), artifact("artifact_accepted", "Accepted frame", "accepted", 2), artifact("artifact_archived", "Archived frame", "archived", 1)];
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({ projects: [project], dnaArtifacts: [], jobs: [], artifacts, mediaAssets: [], workflows: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], acceptances: [{ id: "accept_artifacts", artifactId: "artifact_accepted", decision: "accepted", note: "Keep the controlled violet depth.", actor: "development-user", createdAt: time }], idempotencyKeys: {} }));
  }, { createdAt });

  await page.goto("/#/gallery");
  const activeFeed = page.getByRole("feed", { name: "Artifact history, newest first" });
  await expect(activeFeed.locator(".artifact-card")).toHaveCount(2);
  await expect(activeFeed.getByRole("heading", { name: "Newest active frame" })).toBeVisible();
  await expect(activeFeed.getByRole("heading", { name: "Archived frame" })).toHaveCount(0);
  await expect(page.locator(".archived-artifacts > summary")).toContainText("Hidden · open to load");

  await page.getByRole("button", { name: "accepted 1" }).click();
  await expect(activeFeed.getByRole("heading", { name: "Accepted frame" })).toBeVisible();
  await expect(activeFeed.getByRole("heading", { name: "Newest active frame" })).toHaveCount(0);
  const acceptedCard = activeFeed.locator(".artifact-card");
  await expect(acceptedCard.getByText("Keep the controlled violet depth.")).toBeHidden();
  await acceptedCard.getByText("Details & history").click();
  await expect(acceptedCard.getByText("Keep the controlled violet depth.")).toBeVisible();

  const archive = page.locator(".archived-artifacts");
  await expect(archive).not.toHaveAttribute("open", "");
  await archive.getByText("Archived history").click();
  await expect(page.locator(".archived-artifacts > summary")).toContainText("1 hidden item");
  await expect(page.getByRole("feed", { name: "Archived artifact history, newest first" }).getByRole("heading", { name: "Archived frame" })).toBeVisible();
  await page.locator(testInfo.project.name === "mobile" ? ".mtabbar" : ".sidebar").getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/#\/dna$/);
});

test("video artifact gallery stays thumbnail-only until one video is opened", async ({ page }) => {
  const createdAt = "2026-08-24T04:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    const project = { id: "project_video_gallery", activeDnaArtifactId: null, name: "Video gallery", type: "Motion", status: "active", description: "", note: "", hue: "#d946ef", initials: "VG", createdAt: time, updatedAt: time };
    const dimensions = { energy: 70, tension: 58, contrast: 74, warmth: 32, spaciousness: 68, rhythmicity: 62, organicity: 44, polish: 78 };
    const poster = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const video = "data:video/mp4;base64,AAAA";
    const artifacts = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(new Date(time).getTime() + index * 1_000).toISOString();
      const prompt = `Motion study ${index + 1}`;
      return {
        id: `artifact_video_${index}`, projectId: project.id, jobId: `job_video_${index}`, dnaArtifactId: "dna_video_gallery", kind: "video", name: prompt, status: "ready", provider: "development-adapter", prompt,
        preview: { kind: "remote-media", url: video, posterUrl: poster, colors: ["#6d28d9", "#db2777"] }, lineage: { sourceArtifactIds: [], parentArtifactId: null }, retention: { state: index === 11 ? "retained" : "development-only", size: null },
        settingsStamp: {
          schemaVersion: 1, source: "development-adapter", createdAt: date, reusedFromJobId: null, prompt, provider: "development-adapter", modality: "video", workflow: null, parameters: { prompt }, models: [], inputAssetIds: [],
          ...(index === 11 ? {
            outputBatch: { schemaVersion: "creative-studio-output-batch/1.0", batchId: "output_batch_video_gallery", index: 4, count: 4 },
            videoVariant: { schemaVersion: "creative-studio-video-variant/1.1", pairId: "video_board_gallery", role: "awe", seed: 404, personalStyleWeight: 10, randomDnaWeight: 90, baseDimensions: dimensions, randomDimensions: dimensions, effectiveDimensions: dimensions },
            videoSpeech: { schemaVersion: "creative-studio-video-speech/1.0", mode: "exact-script", authoredText: "Look at the light.", spokenText: "Look at the light.", directive: "(S1) is the visible subject. At the intended beat, (S1) says exactly once without paraphrase: <d>[English] Look at the light.</d>. Do not add, repeat, or improvise any other words. No other dialogue or human vocalization." },
            promptEnhancement: {
              schemaVersion: "creative-studio-video-prompt-enhancement/1.0", requestId: "promptenh_gallery", generationWorkflowId: "workflow_h3", generationWorkflowRevisionId: "workflowrev_h3_job", enhancementWorkflowRevisionId: "workflowrev_h3_source",
              sourcePrompt: "The figure turns toward the city.", enhancedPrompt: "Enhanced Gemma timeline that is not the final downstream variant.", basePrompt: "Enhanced Gemma timeline that is not the final downstream variant.", appliedPrompt: "Exact applied motion prompt with the final Discovery camera turn.", editedAfterEnhancement: false,
              provider: "local-comfyui", workflowId: "gemma4-video-prompt-enhancer", workflowVersion: 1, model: "gemma4_e4b_it_fp8_scaled.safetensors", comfyPromptId: "comfy_gallery", sourceWordCount: 7, enhancedWordCount: 10, createdAt: date, promptProfileId: "minimax-h3-i2v-motion/1.0", targetModel: "MiniMax H3", outputFormat: "minimax-h3-timeline",
            },
          } : {}),
        }, createdAt: date, updatedAt: date,
      };
    });
    const newest = artifacts[11];
    const jobCreatedAt = new Date(Date.now() + 60_000).toISOString();
    const job = { id: newest.jobId, projectId: project.id, dnaArtifactId: newest.dnaArtifactId, capability: "VIDEO_GENERATE", modality: "video", status: "queued", progress: 0, prompt: newest.prompt, provider: newest.provider, upstreamId: null, artifactId: newest.id, retryOfJobId: null, error: null, createdAt: jobCreatedAt, updatedAt: jobCreatedAt, startedAt: null, executionStage: "queued", stageUpdatedAt: jobCreatedAt, completedAt: null, settingsStamp: newest.settingsStamp };
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({ projects: [project], dnaArtifacts: [], jobs: [job], artifacts, mediaAssets: [], workflows: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], acceptances: [], idempotencyKeys: {} }));
  }, { createdAt });

  await page.goto("/#/gallery");
  const feed = page.getByRole("feed", { name: "Artifact history, newest first" });
  await expect(feed.locator(".artifact-card")).toHaveCount(8);
  await expect(feed.locator("video")).toHaveCount(0);
  await expect(feed.locator("img[loading='lazy']")).toHaveCount(8);

  await feed.getByRole("button", { name: "Play Motion study 12" }).click();
  const player = page.getByRole("dialog", { name: "Motion study 12" });
  await expect(player.locator("video")).toHaveCount(1);
  await expect(page.locator("video")).toHaveCount(1);
  await player.getByRole("button", { name: "Close video player" }).click();
  await expect(page.locator("video")).toHaveCount(0);
  const newestVideoCard = page.locator("#artifact-card-artifact_video_11");
  await expect(newestVideoCard.locator(".video-context-chip.role")).toHaveText("Awe");
  await expect(newestVideoCard.locator(".video-context-chip.speech")).toHaveText("Exact script");
  await newestVideoCard.getByText("Details & history").click();
  await expect(newestVideoCard.getByText("Video prompt", { exact: false })).toBeVisible();
  await expect(newestVideoCard.getByText("Exact motion prompt sent to the video model")).toBeVisible();
  await expect(newestVideoCard.locator(".lineage-prompt pre")).toContainText("Exact applied motion prompt with the final Discovery camera turn.");
  await expect(newestVideoCard.locator(".lineage-prompt pre")).not.toContainText("Enhanced Gemma timeline that is not the final downstream variant.");
  await expect(newestVideoCard.getByText("Output 4 of 4", { exact: false })).toBeVisible();
  await expect(newestVideoCard.getByText("Direction Awe · 10% personal / 90% random DNA", { exact: false })).toBeVisible();
  await expect(newestVideoCard.getByText("Speech Exact script · “Look at the light.”", { exact: false })).toBeVisible();
  await expect(newestVideoCard.getByText("Song prompt", { exact: false })).toHaveCount(0);

  await page.goto("/#/queue");
  const queuedRun = page.locator("#cockpit-run-job_video_11");
  await expect(queuedRun).toBeVisible();
  await expect(queuedRun.locator(".video-context-chip.role")).toHaveText("Awe");
  await expect(queuedRun.locator(".video-context-chip.speech")).toHaveText("Exact script");
  await queuedRun.getByText("Details", { exact: true }).click();
  await expect(queuedRun.getByText("Awe · 10% personal / 90% random DNA", { exact: true })).toBeVisible();
  await expect(queuedRun.getByText("Exact script · “Look at the light.”", { exact: true })).toBeVisible();

  await page.goto("/#/gallery");
  await page.locator("#artifact-card-artifact_video_11").getByRole("button", { name: "Extend video" }).click();
  await openCreativeControls(page);
  await expect(page.locator(".quick-extension-panel > summary")).toBeVisible();
  await page.locator(".quick-extension-panel > summary").click();
  await expect(page.getByText("Final-frame continuation", { exact: true })).toBeVisible();
  const soundPolicy = page.getByLabel("Sound", { exact: true });
  await expect(soundPolicy).toHaveValue("new-sound");
  await expect(page.getByText("Keeps the original sound, then continues with newly generated audio.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Exact script", exact: true }).click();
  await page.getByLabel("Exact spoken words", { exact: true }).fill("Stay with me.");
  await soundPolicy.selectOption("keep-source");
  await expect(page.getByRole("button", { name: "No dialogue", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("No new dialogue. The original soundtrack stays unchanged.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Exact script", exact: true }).click();
  await expect(soundPolicy).toHaveValue("new-sound");
  await expect(page.getByLabel("Exact spoken words", { exact: true })).toHaveValue("Stay with me.");
  await soundPolicy.selectOption("keep-source");
  const resultPolicy = page.getByLabel("Result", { exact: true });
  await resultPolicy.selectOption("continuation");
  await expect(soundPolicy).toHaveValue("new-sound");
  await expect(page.getByText("Keeps the newly generated audio in the continuation clip.", { exact: true })).toBeVisible();
  await expect(soundPolicy.locator("option[value='keep-source']")).toHaveCount(0);
  await expect(page.locator(".quick-extension-panel > summary")).toContainText("New sound");
  await expect(page.locator(".quick-extension-panel > summary")).not.toContainText("Clean cut");
});

test("Projects opens the exact pending trained-DNA review instead of the default Create panel", async ({ page }) => {
  const createdAt = "2026-08-23T22:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    const dimensions = { energy: 60, tension: 50, contrast: 70, warmth: 35, spaciousness: 75, rhythmicity: 55, organicity: 45, polish: 70 };
    const dna = (id: string, version: number, parent: string | null, training: unknown) => ({ schemaVersion: "creative-dna/1.0", artifactId: id, projectId: "project_review", version, rootArtifactId: "dna_base", name: version === 1 ? "Rebecca baseline" : "Rebecca trained", createdAt: time, targetModality: "image", capability: "IMAGE_GENERATE", source: { kind: "original", directive: version === 1 ? "Rebecca baseline direction." : "Rebecca trained direction.", referenceLabel: null, referenceAssetIds: [] }, shared: dimensions, native: {}, influence: { angeloCore: 75, currentProject: 15, reference: 50 }, evidence: [], rights: { policy: "original-input", referenceStoredAsProvenanceOnly: false, allowedDownstream: [], blockedDownstream: [] }, translations: [], generationPrompts: { image: "Rebecca direction.", music: "Rebecca translated into sound." }, lineage: { rootArtifactId: "dna_base", parentArtifactId: parent }, training });
    const analysis = { schemaVersion: "creative-dna-training-analysis/1.1", createdAt: time, summary: "Measured training result.", sources: [], dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, { value, confidence: .9, sourceIds: [] }])) };
    const trainingJob = { id: "training_pending_review", projectId: "project_review", baseDnaArtifactId: "dna_base", resultDnaArtifactId: "dna_trained", name: "Rebecca trained", targetModality: "image", status: "completed", progress: 100, provider: "local-creative-dna-runner", assetIds: ["media_review"], trainingExampleIds: [], runnerId: "runner_review", error: null, createdAt: time, updatedAt: time, startedAt: time, completedAt: time };
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({ projects: [{ id: "project_review", activeDnaArtifactId: "dna_base", name: "Rebecca", type: "Character study", status: "active", description: "Rebecca canon.", note: "Current rooftop direction.", hue: "#d946ef", initials: "RE", createdAt: time, updatedAt: time }], dnaArtifacts: [dna("dna_trained", 2, "dna_base", { jobId: trainingJob.id, runnerId: "runner_review", assetIds: ["media_review"], trainingExampleIds: [], analysis }), dna("dna_base", 1, null, null)], jobs: [], artifacts: [], mediaAssets: [], workflows: [], trainingExamples: [], trainingJobs: [trainingJob], trainingReviews: [], acceptances: [], idempotencyKeys: {} }));
  }, { createdAt });

  await page.goto("/#/projects");
  await page.getByRole("button", { name: "Review trained version" }).click();
  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.getByRole("heading", { name: "Compare before activation" })).toBeVisible();
  await expect(page.getByText("Rebecca trained direction.", { exact: true })).toBeVisible();
});

test("Creative Worlds turns an owner upload into explicitly reviewed canon", async ({ page }) => {
  const createdAt = "2026-08-27T16:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({
      projects: [{ id: "project_world", activeDnaArtifactId: null, name: "Rebecca world", type: "Character world", status: "active", description: "", note: "", hue: "#d946ef", initials: "RW", createdAt: time, updatedAt: time }],
      mediaAssets: [{ id: "media_world", projectId: "project_world", kind: "image", name: "Rebecca embryo", originalFileName: "rebecca-embryo.png", mimeType: "image/png", size: 68, source: "upload", status: "retained", contentUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", trainingEligible: true, provenance: { uploadedByOwner: true, uploadedAt: time, parentAssetIds: [] }, createdAt: time, updatedAt: time }],
      dnaArtifacts: [], jobs: [], artifacts: [], workflows: [], acceptances: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], idempotencyKeys: {},
    }));
  }, { createdAt });

  await page.goto("/#/studio");
  await page.getByRole("button", { name: "New world", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Create a world" });
  await dialog.getByLabel("World name").fill("Rebecca continuum");
  await dialog.getByLabel("Premise").fill("A living archive where Rebecca's body and luminous internal structures remain continuous.");
  await dialog.getByRole("button", { name: "Create world" }).click();
  await expect(page.getByText("Rebecca continuum", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /Add the first character/ }).click();
  dialog = page.getByRole("dialog", { name: "Add a world element" });
  await dialog.getByLabel("Name").fill("Rebecca");
  await dialog.getByLabel("Identity summary").fill("A non-binary intergalactic observer adapting human anatomy through deliberate body modification.");
  await dialog.getByRole("textbox", { name: "Identity detail", exact: true }).fill("Keep Rebecca's luminous embryonic core and calm, observant presence.");
  await dialog.getByRole("button", { name: "Add character" }).click();
  await expect(page.getByText("Rebecca", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /Add reference/ }).first().click();
  dialog = page.getByRole("dialog", { name: "Add canon candidate" });
  await dialog.getByRole("tab", { name: /Accepted work/ }).click();
  await expect(dialog.getByText(/0 eligible loaded .* 0 accepted total/)).toBeVisible();
  await expect(dialog.getByText("All accepted work checked", { exact: true })).toBeVisible();
  await dialog.getByRole("tab", { name: /Uploads/ }).click();
  await dialog.getByRole("option", { name: /Rebecca embryo/ }).click();
  await dialog.getByRole("textbox", { name: "Identity detail", exact: true }).fill("Preserve the violet glow, branching vessels, and suspended embryonic silhouette.");
  await dialog.getByRole("button", { name: "Add candidate" }).click();
  await expect(page.getByText("candidate", { exact: true })).toBeVisible();
  await expect(page.getByText(/0 canon/).first()).toBeVisible();

  await page.getByRole("button", { name: "Promote", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Promote candidate" });
  await dialog.getByLabel(/Promotion note/).fill("This image establishes Rebecca's primary internal-light anatomy.");
  await dialog.getByRole("checkbox", { name: /Make these facets canon/ }).check();
  await dialog.getByRole("button", { name: "Promote to canon" }).click();
  await expect(page.getByText("canonical", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 canon/).first()).toBeVisible();
});

test("CreativeDNA survives the full review loop", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/dna");
  await page.getByRole("textbox", { name: "Project name" }).fill("E2E Project");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("group", { name: "What do you want to make?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Image", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Add workflow JSON", { exact: true })).toHaveCount(0);
  await expect(page.locator(".quick-compose-model > summary")).toContainText("No image model ready");
  await openCreativeControls(page);
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
  await page.getByRole("button", { name: /Analyze media/ }).click();
  await expect(page.getByRole("heading", { name: "Analyze media" })).toBeVisible();
  await expect(page.getByRole("list", { name: "CreativeDNA analysis progress" })).toBeVisible();
  await expect(page.getByText(/Gemma describes each file, measures its signals, and creates a reviewable DNA version/)).toHaveCount(1);
  await page.getByRole("button", { name: "Back to Create" }).click();
  await expect(page.getByRole("region", { name: "Create with Creative Studio" })).toBeVisible();
  await page.getByRole("button", { name: "Create explicitly simulated development preview" }).click();
  await page.getByRole("button", { name: "View queue", exact: true }).click();
  await expect(page).toHaveURL(/#\/queue$/);
  await expect(page.getByRole("region", { name: "Work", exact: true })).toBeVisible();
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
  await expect(page.getByRole("status")).toContainText("Creative Studio learned from that decision");
  await expect(page.getByRole("status")).toContainText("preserve · Keep the cyan reflections and spacious focal hierarchy");
  await expect(page.getByText(/1 project signals · 1 personal signals/)).toBeVisible();
  await expect(artifact.locator(".artifact-title").getByText("accepted", { exact: true })).toBeVisible();
  await artifact.getByText("Details & history").click();
  await expect(artifact.getByText("Keep the cyan reflections and spacious focal hierarchy.")).toBeVisible();
  await expect(artifact.getByText("Reviewed by Development user")).toBeVisible();
  await artifact.locator(".artifact-compact-actions details > summary").click();
  await artifact.getByRole("button", { name: "Evolve this" }).click();
  await openCreativeControls(page);
  await page.locator(".quick-evolution-brief > summary").click();
  const evolution = page.getByRole("region", { name: "Evolution study" });
  await expect(evolution).toContainText("Refine");
  await expect(evolution).toContainText("Correct");
  await expect(evolution).toContainText("Discovery");
  await expect(evolution).toContainText("1 project signals");
  await page.goto("/#/gallery");

  await page.reload();
  const persisted = page.locator("article", { has: page.getByRole("heading", { name: "E2E Luminous Study" }) });
  await expect(persisted.locator(".artifact-title").getByText("accepted", { exact: true })).toBeVisible();
  await persisted.getByText("Details & history").click();
  await expect(persisted.getByText("Keep the cyan reflections and spacious focal hierarchy.")).toBeVisible();

  await page.goto("/#/work");
  await expect(page.getByRole("region", { name: "Work", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Results/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Luminous Study" })).toBeVisible();
});

test("cancelled generation explains the retained history and offers a durable retry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Queue control coverage needs one browser shape");
  await page.goto("/#/dna");
  await page.getByRole("textbox", { name: "Project name" }).fill("Retry E2E");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("textbox", { name: "Describe the image" }).fill("An original image with a clean silhouette and high contrast rim light.");
  await page.getByRole("button", { name: "Create explicitly simulated development preview" }).click();
  await page.getByRole("button", { name: "View queue", exact: true }).click();
  const firstRun = page.locator(".cockpit-run").first();
  await firstRun.getByText("Details", { exact: true }).click();
  await firstRun.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: /Needs action/ })).toHaveAttribute("aria-pressed", "true");
  const recovery = page.getByRole("region", { name: "Work needing action" });
  await expect(recovery).toContainText("cancelled", { ignoreCase: true });
  await recovery.getByRole("button", { name: /Retry/ }).click();
  await expect(page.getByRole("button", { name: /Running/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Results/ }).click();
  await page.locator(".work-history > summary").click();
  await expect(page.locator(".work-history .cockpit-run")).toHaveCount(2);
  await expect(page.locator(".work-history")).toContainText("cancelled", { ignoreCase: true });
});

test("project onboarding starts empty and preserves explicit lifecycle changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Project lifecycle needs one browser shape");
  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "Name your first project" })).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(0);

  await page.getByRole("textbox", { name: "Project name" }).fill("Launch System");
  await page.getByRole("button", { name: "Create project" }).click();
  let card = page.locator(".project-card", { hasText: "Launch System" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Direction needed")).toBeVisible();
  await expect(card.getByRole("button", { name: /Build CreativeDNA/ })).toBeVisible();
  await expect(card.locator(".project-compact-counts b")).toHaveCount(4);
  await expect(card.locator(".project-compact-counts")).toHaveAttribute("aria-label", "0 DNA versions, 0 sources, 0 jobs, 0 results");

  await card.getByRole("button", { name: /Build CreativeDNA/ }).click();
  await expect(page).toHaveURL(/#\/dna$/);
  await page.goto("/#/projects");
  card = page.locator(".project-card", { hasText: "Launch System" });

  await card.locator(".project-menu > summary").click();
  await card.getByRole("button", { name: "Edit details" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Launch System Revised");
  await page.getByRole("combobox", { name: "Project status" }).selectOption("paused");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByText("Launch System Revised")).toBeVisible();
  await expect(card.getByText("paused", { exact: true })).toBeVisible();

  await card.locator(".project-menu > summary").click();
  await card.getByRole("button", { name: "Archive" }).click();
  await card.getByRole("button", { name: "Confirm archive" }).click();
  const archived = page.locator(".project-archived-row", { hasText: "Launch System Revised" });
  await expect(archived).toBeHidden();
  await page.locator(".archived-projects > summary").click();
  await expect(archived).toBeVisible();
  await expect(archived).toContainText("archived");
  await expect(page.getByRole("heading", { name: "Name your first project" })).toBeVisible();
});

test("media workspace never substitutes fake uploads in development mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Media workspace coverage needs one browser shape");
  await page.goto("/#/media");
  await page.getByRole("textbox", { name: "Project name" }).fill("Media E2E");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.goto("/#/media");
  await expect(page.getByRole("heading", { name: "Add a source" })).toBeVisible();
  await expect(page.getByText("The browser development adapter never creates fake media.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload and retain" })).toBeDisabled();
  await expect(page.getByText("No media uploaded yet.")).toBeVisible();
});
