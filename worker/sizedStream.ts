/** R2 requires a known byte length even when the gateway forwards a chunked body. */
export async function putSizedStream(bucket: R2Bucket, key: string, body: ReadableStream,
  size: number, options: R2PutOptions) {
  const fixed = new FixedLengthStream(size);
  const abort = new AbortController();
  let received = 0;
  let finalChunk: Uint8Array | null = null;
  const counted = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > size) throw new Error("retention_size_mismatch");
      if (received === size) finalChunk = chunk;
      else controller.enqueue(chunk);
    },
    flush(controller) {
      if (received !== size) throw new Error("retention_size_mismatch");
      if (finalChunk) controller.enqueue(finalChunk);
    },
  }));
  // Observe pipe rejection immediately; a short/long source also rejects the R2 read.
  const piping = counted.pipeTo(fixed.writable, { signal: abort.signal }).then(() => null, (error: unknown) => error);
  try {
    const stored = await bucket.put(key, fixed.readable, options);
    // Conditional writes may return without consuming the stream.
    if (!stored) abort.abort();
    const pipeError = await piping;
    if (stored && pipeError) {
      await bucket.delete(key);
      throw pipeError;
    }
    return stored;
  } catch (error) {
    abort.abort();
    await piping;
    throw error;
  }
}
