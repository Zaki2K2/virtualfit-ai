import net from 'node:net';

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * True when some process already accepts connections on the port.
 *
 * Why not rely on EADDRINUSE: on Windows a second process can bind a port that is already bound
 * (no exclusive-use flag), so `listen()` "succeeds" while requests keep going to the stale process.
 * Connecting is the reliable check. Call it BEFORE listening.
 */
export async function isPortInUse(port: number, timeoutMs = 700): Promise<boolean> {
  const results = await Promise.all(
    ['127.0.0.1', '::1'].map((host) => canConnect(host, port, timeoutMs)),
  );
  return results.some(Boolean);
}
