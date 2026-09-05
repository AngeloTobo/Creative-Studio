import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { putSizedStream } from "../../worker/sizedStream";
import { validatedGlbStream } from "../../worker/mesh";

function chunked(bytes: Uint8Array) {
  return new ReadableStream({ start(controller) {
    controller.enqueue(bytes.subarray(0, 3));
    controller.enqueue(bytes.subarray(3));
    controller.close();
  } });
}

it("retains unknown-length gateway and validated mesh streams with exact bytes", async () => {
  const image = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  await putSizedStream(env.ARTIFACTS!, "sized-image", chunked(image), image.length, {});
  expect(new Uint8Array(await (await env.ARTIFACTS!.get("sized-image"))!.arrayBuffer())).toEqual(image);
  const glb = new Uint8Array(20);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 20, true);
  await putSizedStream(env.ARTIFACTS!, "sized-mesh", await validatedGlbStream(chunked(glb), 20), 20, {});
  expect(new Uint8Array(await (await env.ARTIFACTS!.get("sized-mesh"))!.arrayBuffer())).toEqual(glb);
});

it("rejects short and oversized bodies without retaining an object", async () => {
  for (const size of [3, 9]) {
    const key = `sized-invalid-${size}`;
    await expect(putSizedStream(env.ARTIFACTS!, key, chunked(new Uint8Array(8)), size, {})).rejects.toThrow();
    expect(await env.ARTIFACTS!.head(key)).toBeNull();
  }
});

it("finishes an idempotent conditional conflict without waiting for an unread pipe", async () => {
  await env.ARTIFACTS!.put("sized-existing", new Uint8Array([1]));
  expect(await putSizedStream(env.ARTIFACTS!, "sized-existing", chunked(new Uint8Array(8)), 8,
    { onlyIf: { etagDoesNotMatch: "*" } })).toBeNull();
});
