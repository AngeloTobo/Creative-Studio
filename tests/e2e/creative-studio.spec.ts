import { expect, test } from "@playwright/test";

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

  await page.getByRole("button", { name: /Animate/ }).click();
  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.getByRole("button", { name: "Video", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Retained source")).toHaveValue("media_home");
  await expect(page.getByLabel("Describe the video")).toHaveValue(/A luminous embryo-like form floats in a dark violet field/);
  await expect(page.getByLabel("Describe the video")).toHaveValue(/Use the provided image as the exact first frame/);
  await expect(page.getByRole("alert")).toContainText("development adapter cannot submit simulated video");

  await page.goto("/#/portal");
  await page.getByRole("button", { name: /Train DNA/ }).click();
  await expect(page.getByRole("heading", { name: "Train CreativeDNA" })).toBeVisible();
});

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
  const videoDuration = page.getByRole("group", { name: "Video duration" });
  await expect(videoDuration.getByRole("button", { name: "5s", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(videoDuration.getByRole("button", { name: "10s", exact: true })).toBeVisible();
  await expect(videoDuration.getByRole("button", { name: "15s", exact: true })).toBeVisible();
  await expect(videoDuration.getByRole("button", { name: "30s", exact: true })).toBeVisible();
  await expect(videoDuration.getByRole("button", { name: "1m", exact: true })).toBeVisible();
  await expect(page.getByLabel("Video length")).toContainText("Each of 2 versions");
  await expect(page.getByLabel("Video length")).toContainText("Aligned follows your direction; Discovery uses 70% random DNA.");
  const videoDirection = page.getByRole("textbox", { name: "Describe the video" });
  const exactVideoPrompt = page.locator(".workflow-run-parameters").getByRole("textbox", { name: "MiniMax H3 Image to Video: Prompt" });
  await expect(page.getByRole("spinbutton", { name: "Float (duration)" })).toHaveCount(0);
  await expect(videoDirection).toHaveValue("");
  await expect(exactVideoPrompt).toHaveValue("");
  await videoDirection.fill("The subject turns toward the sunrise while the camera slowly pulls back.");
  await expect(exactVideoPrompt).toHaveValue("The subject turns toward the sunrise while the camera slowly pulls back.");
  await videoDuration.getByRole("button", { name: "30s", exact: true }).click();
  await expect(page.getByRole("button", { name: /LTX 2.5 Image to Video/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /MiniMax Video H3/ })).toBeDisabled();
  await expect(page.getByLabel("Video length")).toContainText("30s is an LTX long render");
  await expect(page.locator(".workflow-run-parameters").getByRole("textbox", { name: "LTX Positive Prompt" })).toHaveValue("The subject turns toward the sunrise while the camera slowly pulls back.");
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

test("evolution results stay in one side-by-side study instead of repeating in artifact history", async ({ page }) => {
  const createdAt = "2026-08-23T21:00:00.000Z";
  await page.addInitScript(({ createdAt: time }) => {
    const project = { id: "project_evolution", activeDnaArtifactId: null, name: "Rebecca", type: "Character study", status: "active", description: "Rebecca has a precise biomechanical silhouette and luminous blue eyes.", note: "Keep the rooftop sequence nocturnal and intimate.", hue: "#d946ef", initials: "RE", createdAt: time, updatedAt: time };
    const roles = ["refine", "correct", "discovery"];
    const stamp = (role: string) => ({ schemaVersion: 1, source: "comfyui-workflow", createdAt: time, reusedFromJobId: null, prompt: `${role} rooftop direction`, provider: "local-comfyui", modality: "image", workflow: null, parameters: { prompt: `${role} rooftop direction` }, models: ["z_image_turbo_bf16.safetensors"], inputAssetIds: [], evolution: { schemaVersion: "creative-studio-evolution/1.0", studyId: "evolve_e2e-study-001", role, sourceId: "artifact_source", source: "artifact", sourceKind: "image", sourceName: "Rebecca rooftop", projectCanon: { identity: project.description, currentDirection: project.note }, personalTasteSignalIds: [], projectTasteSignalIds: [], createdAt: time } });
    const jobs = roles.map((role) => ({ id: `job_${role}`, projectId: project.id, dnaArtifactId: "dna_evolution", capability: "IMAGE_GENERATE", modality: "image", status: "completed", progress: 100, prompt: `${role} rooftop direction`, provider: "local-comfyui", upstreamId: `comfy_${role}`, artifactId: `artifact_${role}`, retryOfJobId: null, error: null, createdAt: time, updatedAt: time, startedAt: time, executionStage: "completed", stageUpdatedAt: time, completedAt: time, settingsStamp: stamp(role) }));
    const cancelledJob = { ...jobs[0], id: "job_cancelled", status: "cancelled", progress: 44, artifactId: null, upstreamId: null, executionStage: "cancelled", settingsStamp: stamp("correct") };
    const artifacts = roles.map((role, index) => ({ id: `artifact_${role}`, projectId: project.id, jobId: `job_${role}`, dnaArtifactId: "dna_evolution", kind: "image", name: `Rebecca · ${role}`, status: index === 0 ? "accepted" : "ready", provider: "local-comfyui", prompt: `${role} rooftop direction`, preview: { kind: "development-gradient", url: null, colors: ["#6d28d9", "#db2777"] }, lineage: { sourceArtifactIds: ["artifact_source"], parentArtifactId: "artifact_source" }, retention: { state: "development-only", size: null }, settingsStamp: stamp(role), createdAt: time, updatedAt: time }));
    localStorage.setItem("creative-studio:development-adapter:v3", JSON.stringify({ projects: [project], dnaArtifacts: [], jobs: [...jobs, cancelledJob], artifacts, mediaAssets: [], workflows: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], acceptances: [{ id: "accept_evolution", artifactId: "artifact_refine", decision: "accepted", note: "Keep the luminous eyes and controlled silhouette.", actor: "development-user", createdAt: time }], idempotencyKeys: {} }));
  }, { createdAt });

  await page.goto("/#/gallery");
  const study = page.locator(".evolution-study");
  await expect(page.getByRole("feed", { name: "Artifact history, newest first" })).toBeVisible();
  await expect(study).toHaveCount(1);
  await expect(study.locator(".evolution-branch")).toHaveCount(3);
  await expect(study).toContainText("Refine");
  await expect(study).toContainText("Correct");
  await expect(study).toContainText("Discovery");
  await expect(study).toContainText("3 media · 4 runs");
  const noMedia = study.locator(".evolution-no-media");
  await expect(noMedia).toContainText("1 run without media");
  await expect(noMedia.getByText("job_cancelled", { exact: false })).toBeHidden();
  await noMedia.getByText("1 run without media").click();
  await expect(noMedia.getByText("job_cancelled", { exact: false })).toBeVisible();
  await expect(page.locator(".artifact-grid > .artifact-card")).toHaveCount(0);
});

test("artifact history keeps active work compact and archived work available on demand", async ({ page }) => {
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
  await expect(page.getByText("1 archived", { exact: true })).toBeVisible();

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
  await expect(page.getByRole("feed", { name: "Archived artifact history, newest first" }).getByRole("heading", { name: "Archived frame" })).toBeVisible();
  await page.getByRole("button", { name: "Create new" }).click();
  await expect(page).toHaveURL(/#\/dna$/);
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
  await expect(page.getByRole("status")).toContainText("Creative Studio learned from that decision");
  await expect(page.getByRole("status")).toContainText("preserve · Keep the cyan reflections and spacious focal hierarchy");
  await expect(page.getByText(/1 project signals · 1 personal signals/)).toBeVisible();
  await expect(artifact.locator(".artifact-title").getByText("accepted", { exact: true })).toBeVisible();
  await artifact.getByText("Details & history").click();
  await expect(artifact.getByText("Keep the cyan reflections and spacious focal hierarchy.")).toBeVisible();
  await expect(artifact.getByText("Reviewed by Development user")).toBeVisible();
  await artifact.getByRole("button", { name: "Evolve this" }).click();
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
