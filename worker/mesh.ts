/** Check the GLB 2 header before retaining bytes, without buffering the full mesh. */
export async function validatedGlbStream(body: ReadableStream<Uint8Array>, declaredSize: number) {
  const reader = body.getReader();
  const buffered: Uint8Array[] = [];
  const header = new Uint8Array(12);
  let copied = 0;
  try {
    while (copied < header.length) {
      const part = await reader.read();
      if (part.done) throw new Error("invalid_mesh_output");
      buffered.push(part.value);
      const length = Math.min(part.value.length, header.length - copied);
      header.set(part.value.subarray(0, length), copied);
      copied += length;
    }
    const view = new DataView(header.buffer);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
      || view.getUint32(8, true) !== declaredSize || declaredSize < 20) throw new Error("invalid_mesh_output");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (buffered.length) { controller.enqueue(buffered.shift()!); return; }
      const part = await reader.read();
      if (part.done) controller.close();
      else controller.enqueue(part.value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}
