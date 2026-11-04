// Private OS actors. These do not load the SDK, extensions, settings or auth.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import installShell from '../../agent/wakeups/shell.mjs';
const [role, directory] = process.argv.slice(2);
const self = fileURLToPath(import.meta.url);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
if (role === 'worker' || role === 'grandchild' || role === 'sentinel') {
  process.on('SIGTERM', () => {});
  writeFileSync(join(directory, `${role}.json`), JSON.stringify({ pid: process.pid, ppid: process.ppid }));
  if (role === 'worker') spawn(process.execPath, [self, 'grandchild', directory], { stdio: 'inherit' });
  setInterval(() => {}, 1000);
} else if (role === 'root') {
  const definition = JSON.parse(readFileSync(new URL('../wakeups-sandbox/interface-v1.json', import.meta.url))).tools.find(t => t.name === 'watch_shell');
  const handlers = new Map();
  let tool, owned = true;
  const token = {}, owner = { sessionFile: join(directory, 'session'), generation: 'fixture' };
  const pi = { on(name, fn) { handlers.set(name, fn); }, registerTool(t) { tool = t; },
    sendMessage(message) { process.send({ type: 'event', message }); } };
  installShell(pi, definition, { readOwner: () => owned ? owner : undefined, getIncarnation: () => token,
    isCurrent: (o, i) => owned && o === owner && i === token }, { getShellConfig: () => ({ shell: '/bin/sh', args: ['-c'] }) });
  const ctx = { cwd: directory, mode: 'tui', ui: { notify(text) { process.send({ type: 'warning', text }); } } };
  process.on('message', async message => {
    if (message === 'shutdown') { await handlers.get('session_shutdown')(); process.send({ type: 'shutdown' }); }
    if (message === 'lose-owner') owned = false;
  });
  const receipt = await tool.execute('fixture-call', {
    command: `exec ${quote(process.execPath)} ${quote(self)} worker ${quote(directory)}`, on_exit: 'report',
  }, undefined, undefined, ctx);
  handlers.get('message_end')({ message: { role: 'toolResult', toolName: 'watch_shell', toolCallId: 'fixture-call', details: receipt.details, isError: false } });
  process.send({ type: 'receipt', receipt });
}
