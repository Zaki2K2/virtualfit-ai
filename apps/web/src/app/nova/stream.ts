/** Incremental SSE decoder shared by the live UI and fragmentation regressions. */
export async function consumeNovaStream(
  response: Response,
  onEvent: (event: string, data: unknown) => void,
) {
  if (!response.body) throw new Error('Nova returned no stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      pending = pending.replace(/\r\n/g, '\n');
      for (;;) {
        const end = pending.indexOf('\n\n');
        if (end < 0) break;
        const block = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const event = block
          .split('\n')
          .find((line) => line.startsWith('event: '))
          ?.slice(7);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');
        if (event && data) onEvent(event, JSON.parse(data));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
