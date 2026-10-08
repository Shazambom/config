// Persist a synthetic saved session through the installed SessionManager API.
// Pi defers disk creation until an assistant entry exists. No model is invoked.
import { pathToFileURL } from 'node:url';
const [modulePath, cwd, id] = process.argv.slice(2);
const { SessionManager } = await import(pathToFileURL(modulePath).href);
const session = SessionManager.create(cwd, undefined, { id });
session.appendCustomEntry('universal-history', { synthetic: true });
session.appendMessage({
  role: 'assistant', content: [{ type: 'text', text: 'PI_SYNTHETIC_SAVED_HISTORY' }],
  api: 'anthropic-messages', provider: 'synthetic', model: 'offline-fixture',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop', timestamp: Date.now(),
});
