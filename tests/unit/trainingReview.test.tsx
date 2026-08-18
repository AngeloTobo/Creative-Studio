import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileCreativeDna, CREATIVE_DNA_DIMENSION_KEYS, type CreativeDnaTrainingJob, type CreativeDnaTrainingReview } from "../../shared/contracts";
import { TrainingReviewPanel } from "../../src/features/creative-dna/TrainingReviewPanel";

const createdAt = "2026-08-16T18:00:00.000Z";
const base = compileCreativeDna({
  name: "Quiet baseline",
  directive: "A quiet visual structure with restrained warmth.",
  targetModality: "image",
  dimensions: { energy: 42, contrast: 55, warmth: 38 },
}, {
  artifactId: "dna_base",
  projectId: "project_training_review",
  version: 1,
  rootArtifactId: "dna_base",
  parentArtifactId: null,
  createdAt,
});

const trained = {
  ...compileCreativeDna({
    name: "Measured light",
    directive: "Luminous measured structure with crisp contrast and warm detail.",
    targetModality: "image",
    dimensions: { energy: 58, contrast: 72, warmth: 46 },
  }, {
    artifactId: "dna_trained",
    projectId: "project_training_review",
    version: 2,
    rootArtifactId: "dna_base",
    parentArtifactId: "dna_base",
    createdAt,
  }),
  training: {
    jobId: "dnatraining_review",
    runnerId: "runner_review",
    assetIds: ["media_source"],
    trainingExampleIds: [],
    analysis: {
      schemaVersion: "creative-dna-training-analysis/1.1" as const,
      createdAt,
      summary: "Measured the consented source and extracted a reusable visual direction.",
      sources: [{
        sourceId: "media_source",
        mediaId: "media_source",
        sourceType: "upload" as const,
        kind: "image" as const,
        label: "Luminous study",
        detailedDescription: {
          schemaVersion: "creative-dna-media-description/1.0" as const,
          text: "A luminous glass form stands against a deep background, with controlled warm highlights, crisp edges, and spacious negative space.",
          provider: "local-comfyui" as const,
          workflowId: "gemma4-multimodal-description" as const,
          workflowVersion: 1 as const,
          model: "gemma4_e4b_it_fp8_scaled.safetensors" as const,
          prompt: "Describe this uploaded image as a detailed reusable generation prompt.",
          comfyPromptId: "test-description-prompt-001",
          settings: { maxLength: 2048, temperature: 0.7, seed: 0 },
        },
        observations: ["Warm highlights remain controlled against a deep background."],
        metrics: { width: 2048, dominantTone: "warm-neutral" },
        dimensions: { energy: 58, contrast: 72, warmth: 46 },
        confidence: 0.91,
      }],
      dimensions: Object.fromEntries(CREATIVE_DNA_DIMENSION_KEYS.map((key) => [key, {
        value: key === "contrast" ? 72 : trainedDimensionValue(key),
        confidence: key === "contrast" ? 0.94 : 0.87,
        sourceIds: ["media_source"],
      }])) as NonNullable<NonNullable<ReturnType<typeof compileCreativeDna>["training"]>["analysis"]>["dimensions"],
    },
  },
};

function trainedDimensionValue(key: (typeof CREATIVE_DNA_DIMENSION_KEYS)[number]) {
  return key === "energy" ? 58 : key === "warmth" ? 46 : base.shared[key];
}

const job: CreativeDnaTrainingJob = {
  id: "dnatraining_review",
  projectId: "project_training_review",
  baseDnaArtifactId: base.artifactId,
  resultDnaArtifactId: trained.artifactId,
  name: "Measured light",
  targetModality: "image",
  status: "completed",
  progress: 100,
  provider: "local-creative-dna-runner",
  assetIds: ["media_source"],
  trainingExampleIds: [],
  runnerId: "runner_review",
  error: null,
  createdAt,
  updatedAt: createdAt,
  startedAt: createdAt,
  completedAt: createdAt,
};

const review: CreativeDnaTrainingReview = {
  id: "dnareview_approved",
  projectId: job.projectId,
  trainingJobId: job.id,
  dnaArtifactId: trained.artifactId,
  decision: "approved",
  note: "The warmth and contrast remain faithful to the source evidence.",
  actor: "angelo",
  activeDnaArtifactId: trained.artifactId,
  createdAt,
};

describe("CreativeDNA training review", () => {
  it("renders baseline comparison, measured evidence, note controls, and durable decision history", () => {
    const markup = renderToStaticMarkup(<TrainingReviewPanel
      job={job}
      artifact={trained}
      baseArtifact={base}
      reviews={[review]}
      active
      busy={false}
      onClose={() => undefined}
      onDecision={async () => undefined}
    />);

    expect(markup).toContain("Compare before activation");
    expect(markup).toContain("Quiet baseline");
    expect(markup).toContain("Measured light");
    expect(markup).toContain("Dimension comparison");
    expect(markup).toContain("94%");
    expect(markup).toContain("Warm highlights remain controlled");
    expect(markup).toContain("Gemma media summaries");
    expect(markup).toContain("Short summary");
    expect(markup).toContain("Long summary");
    expect(markup).toContain("A luminous glass form stands against a deep background");
    expect(markup).toContain("gemma4_e4b_it_fp8_scaled.safetensors");
    expect(markup).toContain("dominantTone");
    expect(markup).toContain("Training review note (required)");
    expect(markup).toContain("Approve &amp; activate");
    expect(markup).toContain(review.note);
    expect(markup).toContain("Reviewed by Angelo");
    expect(markup).toContain("Active project DNA");
  });
});
