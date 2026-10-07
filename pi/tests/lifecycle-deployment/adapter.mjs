// The lab intentionally passes --no-extensions. Remove only that flag here;
// retain the controller's process receipts, private PTY and loopback provider.
import { readFileSync, copyFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
const directory = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'));
const lab = process.env.LIFECYCLE_LAB;
if (process.argv.length === 3 && process.argv[2] === '--version') {
  process.argv[1] = config.cli;
} else {
if (!lab || !process.argv.includes('--no-extensions')) throw new Error('Only launch through the private lifecycle lab');
copyFileSync(join(lab, 'agent/models.json'), join(config.agent, 'models.json'));
process.env.PI_CODING_AGENT_DIR = config.agent;
process.env.XDG_CACHE_HOME = join(directory, 'cache');
process.env.JITI_CACHE_DIR = join(directory, 'cache/jiti');
process.env.TMPDIR = join(directory, 'tmp');
mkdirSync(process.env.TMPDIR, { recursive: true });
process.argv = [process.argv[0], config.cli, ...process.argv.slice(2).filter(arg => arg !== '--no-extensions'), '--provider', 'lifecycle', '--model', 'offline'];
appendFileSync(join(directory, 'launch.jsonl'), JSON.stringify({ pid: process.pid, argv: process.argv, agent: config.agent }) + '\n');
}
await import(pathToFileURL(config.cli).href);
