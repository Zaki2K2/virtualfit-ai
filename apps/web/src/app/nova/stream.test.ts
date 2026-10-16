import { expect, it } from 'vitest';
import { consumeNovaStream } from './stream';

it('recovers fragmented UTF-8 and multiple SSE events without truncating text', async () => {
  const encoded = new TextEncoder().encode(
    'event: delta\ndata: {"text":"Nova ✦"}\n\nevent: done\ndata: {"ok":true}\n\n',
  );
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of encoded) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const events: unknown[] = [];
  await consumeNovaStream(new Response(stream), (event, data) => events.push({ event, data }));
  expect(events).toEqual([
    { event: 'delta', data: { text: 'Nova ✦' } },
    { event: 'done', data: { ok: true } },
  ]);
});
