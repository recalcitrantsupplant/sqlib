/**
 * Parse an SSE body as it arrives.
 *
 * `EventSource` cannot POST, and the prompt does not belong in a query string,
 * so the stream is read off `fetch` by hand. Frames are separated by a blank
 * line and can be split across chunk boundaries, which is the entire reason
 * this holds a buffer rather than parsing each chunk on its own.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (dataLine) {
          try {
            yield JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
          } catch {
            // A frame we cannot parse is not worth taking the stream down for.
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
