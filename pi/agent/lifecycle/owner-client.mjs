import { connect } from 'node:net';

// Loopback transport only. Callers retain sidecar/admission/lifetime policy.
export async function ownerRequest(owner, file, action, deadline) {
  if (!Number.isInteger(owner?.port) || owner.port < 1 || owner.port > 65535 || !owner.generation) throw new Error('Owner helper unavailable');
  return await new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: owner.port, signal: AbortSignal.timeout(deadline) });
    socket.on('error', reject);
    let text = '';
    socket.on('data', data => { text += data; if (text.length > 8192) socket.destroy(new Error('Invalid owner response')); });
    socket.on('end', () => {
      try {
        const response = JSON.parse(text);
        if (response.type !== 'owner' || response.file !== file || response.generation !== owner.generation ||
          response.pid !== owner.pid || response.started !== owner.started) throw new Error('Owner changed');
        resolve();
      } catch (error) { reject(error); }
    });
    socket.on('connect', () => socket.end(JSON.stringify({ action, file, generation: owner.generation }) + '\n'));
  });
}
