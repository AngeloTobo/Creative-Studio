import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "../../shared/contracts";
import { CreateResultRail } from "../../src/features/generation/CreateResultRail";

function artifact(kind: Artifact["kind"], createdAt: string, id: string = kind): Artifact {
  return {
    id: `result-${id}`,
    projectId: "project-create",
    jobId: `job-${kind}`,
    dnaArtifactId: "dna-create",
    kind,
    name: `Created ${kind}`,
    status: "ready",
    provider: "local-comfyui",
    prompt: `A finished ${kind} result`,
    preview: {
      kind: "remote-media",
      url: `/api/creative-studio/artifacts/result-${id}/media`,
      posterUrl: kind === "video" ? `/api/creative-studio/artifacts/result-${id}/thumbnail` : null,
      colors: ["#412082", "#d12678"],
    },
    lineage: { sourceArtifactIds: [], parentArtifactId: null },
    retention: { state: "retained", size: 2048 },
    settingsStamp: {
      schemaVersion: 1,
      source: "creative-dna",
      createdAt,
      reusedFromJobId: null,
      prompt: `A finished ${kind} result`,
      provider: "local-comfyui",
      modality: kind,
      workflow: null,
      parameters: {},
      models: [],
      inputAssetIds: [],
    },
    createdAt,
    updatedAt: createdAt,
  };
}

const video = artifact("video", "2026-08-30T17:03:00.000Z");
const image = artifact("image", "2026-08-30T17:02:00.000Z");
const music = artifact("music", "2026-08-30T17:01:00.000Z");
const artifacts = [video, image, music];
let root: Root | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("CreateResultRail", () => {
  it("mounts one selected video player while every rail item stays thumbnail-only", () => {
    const markup = renderToStaticMarkup(
      <CreateResultRail artifacts={artifacts} onSelect={() => undefined} onUseAsSource={() => undefined} onOpenArtifacts={() => undefined} />,
    );

    expect(markup.match(/<video/g)).toHaveLength(1);
    expect(markup).toContain("controls=\"\"");
    expect(markup).toContain("playsInline=\"\"");
    expect(markup).toContain("preload=\"metadata\"");
    expect(markup).toContain("poster=\"/api/creative-studio/artifacts/result-video/thumbnail\"");
    expect(markup.match(/data-result-card=/g)).toHaveLength(3);
    expect(markup).toContain("Use as source");
    expect(markup).toContain("aria-label=\"Download Created video\"");
  });

  it("loads a selected image eagerly and mounts no video or audio player", () => {
    const markup = renderToStaticMarkup(<CreateResultRail artifacts={artifacts} selectedArtifactId={image.id} />);

    expect(markup).toContain("loading=\"eager\"");
    expect(markup).toContain("src=\"/api/creative-studio/artifacts/result-image/media\"");
    expect(markup).not.toContain("<video");
    expect(markup).not.toContain("<audio");
  });

  it("defers selected audio loading and exposes an accessible player", () => {
    const markup = renderToStaticMarkup(<CreateResultRail artifacts={artifacts} selectedArtifactId={music.id} />);

    expect(markup.match(/<audio/g)).toHaveLength(1);
    expect(markup).toContain("preload=\"none\"");
    expect(markup).toContain("aria-label=\"Audio player for Created music\"");
    expect(markup).not.toContain("<video");
  });

  it("switches the single mounted preview, reuses the selected result, and follows a newly completed result", async () => {
    const onSelect = vi.fn();
    const onUseAsSource = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(<CreateResultRail artifacts={artifacts} onSelect={onSelect} onUseAsSource={onUseAsSource} />));
    expect(container.querySelectorAll("video")).toHaveLength(1);

    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Preview ${image.name}"]`)?.click());
    expect(onSelect).toHaveBeenCalledWith(image.id);
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(container.querySelector<HTMLImageElement>(".create-result-stage img")?.src).toContain("result-image/media");

    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Use as source"))?.click());
    expect(onUseAsSource).toHaveBeenCalledWith(image.id);

    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Preview ${video.name}"]`)?.click());
    const newest = artifact("image", "2026-08-30T17:04:00.000Z", "newest-image");
    await act(async () => root?.render(<CreateResultRail artifacts={[newest, ...artifacts]} onSelect={onSelect} onUseAsSource={onUseAsSource} />));
    expect(container.querySelector<HTMLImageElement>(".create-result-stage img")?.src).toContain("result-newest-image/media");
    expect(container.querySelectorAll("video")).toHaveLength(0);
  });
});
