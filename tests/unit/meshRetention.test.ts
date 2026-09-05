// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validatedGlbStream } from "../../worker/mesh";

function bytes() {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 20, true);
  return bytes;
}

describe("mesh retention", () => {
  it("preserves exact bytes across split header chunks", async () => {
    const source = bytes();
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(source.subarray(0, 3));
      controller.enqueue(source.subarray(3, 8));
      controller.enqueue(source.subarray(8));
      controller.close();
    } });
    const result = await validatedGlbStream(body, 20);
    expect(new Uint8Array(await new Response(result).arrayBuffer())).toEqual(source);
  });
  it.each(["magic", "version", "size", "truncated"])("rejects invalid %s before storage", async (failure) => {
    const source = bytes();
    if (failure === "magic") source[0] = 0;
    if (failure === "version") source[4] = 1;
    const body = new Response(failure === "truncated" ? source.subarray(0, 8) : source).body!;
    await expect(validatedGlbStream(body, failure === "size" ? 40 : 20)).rejects.toThrow("invalid_mesh_output");
  });
});
