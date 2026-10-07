import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};
const mode = process.env.OM_TEST_MODE;
const finish = () => {
  if (process.env.OM_RESULT_PATH) write(process.env.OM_RESULT_PATH, { observations: [{ timestamp: '2026-01-02 00:00', content: 'private test observation' }] });
  if (process.env.OM_COST_PATH) write(process.env.OM_COST_PATH, { costUsd: 0.1 });
  process.exit(0);
};
process.on('SIGTERM', () => {
  write(join(process.cwd(), `${process.pid}.term`), { pid: process.pid });
  if (mode === 'cancel-clean') setTimeout(finish, process.env.OM_WORKER === 'consolidator' ? 350 : 150);
});
write(join(process.cwd(), `${process.pid}.ready`), { pid: process.pid, role: process.env.OM_WORKER });
if (mode === 'complete') setTimeout(finish, 100);
else setInterval(() => {}, 1000);
