import { describe, it, expect } from 'vitest';
import { parseSseStream } from '@/lib/sse';

/**
 * The stream parser, which exists because `EventSource` cannot POST and the
 * prompt does not belong in a query string.
 *
 * The case worth testing is the one that breaks in production and never in
 * development: a frame split across chunk boundaries. A parser that handles
 * each chunk on its own looks fine against a fast local server and drops
 * tokens against a real one.
 */

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events: Record<string, unknown>[] = [];
  for await (const event of parseSseStream(stream)) events.push(event);
  return events;
}

describe('parseSseStream', () => {
  it('reads whole frames', async () => {
    const events = await collect(
      streamOf([
        'event: token\ndata: {"type":"token","text":"Hi"}\n\n',
        'event: done\ndata: {"type":"done","reason":"complete"}\n\n',
      ])
    );

    expect(events).toEqual([
      { type: 'token', text: 'Hi' },
      { type: 'done', reason: 'complete' },
    ]);
  });

  it('reassembles a frame split across chunks', async () => {
    const events = await collect(
      streamOf(['event: token\ndata: {"type":"to', 'ken","text":"split"}', '\n\n'])
    );
    expect(events).toEqual([{ type: 'token', text: 'split' }]);
  });

  it('reads several frames arriving in one chunk', async () => {
    const events = await collect(
      streamOf(['data: {"type":"token","text":"a"}\n\ndata: {"type":"token","text":"b"}\n\n'])
    );
    expect(events).toHaveLength(2);
  });

  it('skips a frame it cannot parse rather than ending the stream', async () => {
    const events = await collect(
      streamOf(['data: {oops\n\n', 'data: {"type":"token","text":"still here"}\n\n'])
    );
    // One bad frame must not cost the rest of the turn.
    expect(events).toEqual([{ type: 'token', text: 'still here' }]);
  });

  it('ignores a trailing partial frame', async () => {
    const events = await collect(streamOf(['data: {"type":"token","text":"done"}\n\ndata: {"partial"']));
    expect(events).toEqual([{ type: 'token', text: 'done' }]);
  });
});
