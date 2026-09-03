// @vitest-environment node

import sharp from "sharp";
import { describe, expect, it } from "vitest";

// The Local Runner is intentionally plain ESM so Windows can launch it directly with Node.
// @ts-expect-error TypeScript does not emit declarations for the runtime-only runner module.
import { prepareComfyInputUpload, RUNNER_VERSION } from "../../runner/index.mjs";

describe("Local Runner Comfy image input normalization", () => {
  it("applies EXIF orientation and strips metadata before uploading an image", async () => {
    const orientedSource = await sharp({
      create: {
        width: 2,
        height: 3,
        channels: 3,
        background: { r: 240, g: 40, b: 90 },
      },
    })
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const sourceMetadata = await sharp(orientedSource).metadata();
    expect(sourceMetadata).toMatchObject({ format: "jpeg", width: 2, height: 3, orientation: 6 });

    const normalized = await prepareComfyInputUpload(
      { kind: "image", mimeType: "image/jpeg" },
      new Blob([orientedSource], { type: "image/jpeg" }),
      "Portrait with orientation.JPG",
    );
    const normalizedBytes = Buffer.from(await normalized.media.arrayBuffer());
    const normalizedMetadata = await sharp(normalizedBytes).metadata();

    expect(normalized.fileName).toBe("Portrait_with_orientation.png");
    expect(normalized.mimeType).toBe("image/png");
    expect(normalized.media.type).toBe("image/png");
    expect(normalizedMetadata).toMatchObject({ format: "png", width: 3, height: 2 });
    expect(normalizedMetadata.orientation).toBeUndefined();
    expect(normalizedMetadata.exif).toBeUndefined();
    expect(normalizedMetadata.icc).toBeUndefined();
    expect(normalizedMetadata.xmp).toBeUndefined();
  });

  it("leaves video and audio upload bodies and filenames unchanged", async () => {
    const video = new Blob([new Uint8Array([0, 1, 2, 3])], { type: "video/mp4" });
    const audio = new Blob([new Uint8Array([4, 5, 6, 7])], { type: "audio/mpeg" });

    await expect(prepareComfyInputUpload({ kind: "video", mimeType: "video/mp4" }, video, "clip.mp4"))
      .resolves.toEqual({ media: video, fileName: "clip.mp4", mimeType: "video/mp4" });
    await expect(prepareComfyInputUpload({ kind: "audio", mimeType: "audio/mpeg" }, audio, "song.mp3"))
      .resolves.toEqual({ media: audio, fileName: "song.mp3", mimeType: "audio/mpeg" });
  });

  it("reports the current cooperative runner source version", () => {
    expect(RUNNER_VERSION).toBe("1.23.0");
  });
});
