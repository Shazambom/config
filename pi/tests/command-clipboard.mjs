// Private CLI preload. Pi 1.0.4 uses darwin-platform.node, including getFilePaths,
// not just @mariozechner/clipboard. Never load a native backend or launch helpers.
import Module, { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const root = process.env.PI_SELECTION_PROOF;
const record = (event, details = {}) => appendFileSync(`${root}/events.jsonl`, JSON.stringify({ event, ...details }) + '\n');
const backend = {
  getFilePaths() { record('files'); return []; },
  getImage() { record('image'); return null; },
  getText() { record('paste'); return 'PASTE_FIXTURE'; },
  setText(text) { writeFileSync(`${root}/clipboard.txt`, text); record('copy', { text }); },
};
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === '@mariozechner/clipboard' || /(?:darwin|linux|win32)-platform(?:-x11)?\.node$/.test(id)) {
    record('backend', { id });
    return backend;
  }
  return load.call(this, id, ...args);
};
process.dlopen = () => { throw new Error('Test blocks native addons'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[name] = () => { throw new Error(`Test blocks child_process.${name}`); };
}
syncBuiltinESMExports();
const write = process.stdout.write;
process.stdout.write = function (data, ...args) {
  if (String(data).includes('\x1b]52;')) throw new Error('Test blocks OSC 52 clipboard writes');
  return write.call(this, data, ...args);
};
globalThis.fetch = async () => { throw new Error('Test blocks network'); };
record('isolated');
