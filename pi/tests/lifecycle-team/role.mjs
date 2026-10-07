// Runtime adapter only: production TeamStore and extension callbacks remain intact.
import { createJiti } from 'jiti';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
const [source, directory, role, member] = process.argv.slice(2);
const save = (name, data) => {
  const path = join(directory, `${role}.${name}.json`);
  writeFileSync(`${path}.tmp`, JSON.stringify(data));
  renameSync(`${path}.tmp`, path);
};
const signals = [];
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { signals.push(signal); save('signals', signals); });
save('signals', signals);
// Self-owned watchdog bounds failure cleanup without signalling any PID.
const watchdog = setTimeout(() => { save('watchdog', { expired: true }); process.exit(90); }, 45000);
const jiti = createJiti(import.meta.url, { alias: {
  '@sinclair/typebox': import.meta.resolve('typebox').replace('file://', ''),
} });
const { TeamStore, processIdentity } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const extension = (await jiti.import(join(source, 'pi-extension/subagents/team-extension.ts'))).default;
process.env.PI_TEAM_DIR = join(directory, 'team');
process.env.PI_TEAM_MEMBER = member;
const handlers = new Map();
const emitter = new EventEmitter();
let tools = [];
let shutdowns = 0;
const pi = {
  on: (name, callback) => handlers.set(name, callback),
  events: {
    on: (name, callback) => { emitter.on(name, callback); return () => emitter.off(name, callback); },
    emit: (name, value) => emitter.emit(name, value),
  },
  registerTool() {}, registerCommand() {},
  getActiveTools: () => tools,
  setActiveTools: value => { tools = value; },
  sendMessage() { throw new Error('Unexpected message delivery in quiet fixture'); },
  appendEntry() { throw new Error('Unexpected session entry in quiet fixture'); },
};
const context = {
  sessionManager: { getSessionId: () => 'private-fixture', getEntries: () => [] },
  isIdle: () => true, hasPendingMessages: () => false,
  shutdown: () => { shutdowns++; },
};
extension(pi);
await handlers.get('session_start')({}, context);
const store = new TeamStore(process.env.PI_TEAM_DIR);
save('ready', { pid: process.pid, identity: processIdentity(process.pid), member, registration: store.state().members[member] });
let handled = false;
const timer = setInterval(async () => {
  if (existsSync(join(directory, `${role}.exit`))) {
    clearInterval(timer); clearTimeout(watchdog);
    // Exit transport deliberately does not dispatch another lifecycle callback.
    save('exited', { pid: process.pid, signals });
    process.exit(0);
  }
  const command = join(directory, `${role}.command`);
  if (handled || !existsSync(command)) return;
  handled = true;
  try {
    const action = readFileSync(command, 'utf8').trim();
    let retired;
    if (['shutdown', 'new', 'fork'].includes(action)) await handlers.get('session_shutdown')({ reason: action === 'shutdown' ? 'quit' : action }, context);
    else if (action === 'quiet') {
      const gate = {};
      emitter.emit('team:before-exit', gate);
      if (!gate.check) throw new Error('Production before-exit callback not installed');
      retired = await gate.check;
    } else throw new Error(`Unknown action ${action}`);
    save('observed', { action, retired, shutdowns, state: store.state(), signals });
  } catch (error) { save('error', { message: error.stack }); }
}, 20);
