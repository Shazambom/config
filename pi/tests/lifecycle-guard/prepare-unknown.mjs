// Create only a private lab's initialized lock, then damage its owner sidecar.
import { acquireLease } from '../../agent/lifecycle/lease.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, statSync } from 'node:fs';
const [kind, file] = process.argv.slice(2);
if (!['unknown-missing', 'unknown-corrupt'].includes(kind) || !file) throw new Error('Expected private fixture kind and session path');
const { lease } = acquireLease(file);
lease.publish({ pid: process.pid, started: execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim() });
lease.assertOwned();
lease.release();
if (kind === 'unknown-missing') unlinkSync(lease.metadata);
else writeFileSync(lease.metadata, 'SYNTHETIC_OWNER_SECRET invalid JSON\n');
console.log(JSON.stringify({ metadata: lease.metadata, database: lease.database, inode: statSync(lease.database, { bigint: true }).ino.toString() }));
