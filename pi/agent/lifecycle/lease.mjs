import { DatabaseSync } from 'node:sqlite';
import { openSync, closeSync, mkdirSync, realpathSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// SQLite header marker, not application data or a runtime-version allowlist.
const INITIALIZED = 0x50494c47;
const INITIALIZATION_LOCK_DEADLINE_MS = 500;
const fault = code => Object.assign(new Error(), { code });
const validRoot = value => Number.isSafeInteger(value?.pid) && value.pid > 1 && typeof value.started === 'string' && !!value.started.trim();

function canonicalFile(file) {
  try { return realpathSync(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return join(realpathSync(dirname(file)), basename(file));
  }
}
function readOwner(metadata) {
  try {
    const owner = JSON.parse(readFileSync(metadata, 'utf8'));
    if (!validRoot(owner) || typeof owner.generation !== 'string' || !owner.generation ||
      !['preparing', 'active', 'released', 'recovery'].includes(owner.status)) return null;
    return owner;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
function leaseStem(canonical) {
  return join(dirname(canonical), '.pi-lifecycle', createHash('sha256').update(canonical).digest('hex'));
}
// Read-only evidence for a worker's fixed original owner. Never creates a file
// or opens the SQLite database; active ownership still requires helper probing.
export function inspectOwner(file) {
  const sessionFile = canonicalFile(file);
  return { sessionFile, owner: readOwner(`${leaseStem(sessionFile)}.owner.json`) };
}
export function isSqliteBusy(error) {
  return Number.isInteger(error.errcode) && (error.errcode & 255) === 5;
}

function rootIsGone(owner) {
  // ESRCH is positive kernel evidence. Permission/query failures are not death.
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

export function acquireLease(file) {
  const canonical = canonicalFile(file);
  const directory = join(dirname(canonical), '.pi-lifecycle');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stem = leaseStem(canonical);
  const database = `${stem}.sqlite`;
  const metadata = `${stem}.owner.json`;
  // Provision permissions BEFORE SQLite opens the file. Creation grants no
  // priority: the first transaction holder determines initialization state.
  // Never open/read/close the database through fs APIs in a SQLite holder.
  try { const fd = openSync(database, 'wx', 0o600); closeSync(fd); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  let db;
  try {
    db = new DatabaseSync(database, { timeout: 0 });
    db.exec('BEGIN IMMEDIATE');
  } catch (error) {
    try { db?.close(); } catch { /* Preserve the acquisition result. */ }
    if (isSqliteBusy(error)) {
      let owner;
      try { owner = readOwner(metadata); } catch {}
      return { type: 'conflict', reason: 'busy', owner, sessionFile: canonical };
    }
    throw error;
  }
  let marker, recovered = false;
  try {
    const previous = readOwner(metadata);
    if (previous && previous.status !== 'released' && !rootIsGone(previous)) {
      db.close();
      return { type: 'conflict', reason: 'recovery', owner: previous, sessionFile: canonical };
    }
    // Even a clean release may follow writes made after the contender loaded.
    recovered = !!previous;
    marker = db.prepare('PRAGMA application_id').get().application_id;
    if ((marker !== 0 && marker !== INITIALIZED) ||
      (marker === 0 && db.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get())) throw fault('LOCK_DATABASE_UNRECOGNIZED');
    if (previous === null || (marker === INITIALIZED && !previous)) throw fault('OWNER_METADATA_UNVERIFIABLE');
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }

  const generation = randomUUID();
  let phase = marker === INITIALIZED ? 'reserved' : 'initializing';
  let owner;
  function expect(...phases) {
    if (phase === 'closed') throw fault('LEASE_CLOSED');
    if (!phases.includes(phase)) throw fault('LEASE_NOT_READY');
  }
  function publishRecord(value) {
    if (!db.isTransaction) throw fault('LEASE_NOT_READY');
    const next = { ...value, generation };
    const temporary = `${metadata}.${generation}.tmp`;
    // Synchronous, atomic sidecar publication completes under the transaction.
    // Only metadata may be renamed. The database inode is never replaced.
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    renameSync(temporary, metadata);
    owner = next;
  }
  function boundedLockOperation(sql) {
    db.exec(`PRAGMA busy_timeout = ${INITIALIZATION_LOCK_DEADLINE_MS}`);
    try { db.exec(sql); }
    finally { db.exec('PRAGMA busy_timeout = 0'); }
  }
  const lease = {
    database, metadata, generation, sessionFile: canonical,
    prepare(value) {
      expect('initializing');
      if (!validRoot(value)) throw fault('OWNER_IDENTITY_INVALID');
      publishRecord({ ...value, status: 'preparing' });
      phase = 'preparing';
    },
    commitInitialization() {
      expect('preparing');
      db.exec(`PRAGMA application_id = ${INITIALIZED}`);
      boundedLockOperation('COMMIT');
      phase = 'gap';
    },
    reacquire() {
      expect('gap');
      boundedLockOperation('BEGIN IMMEDIATE');
      const current = readOwner(metadata);
      if (!current) throw fault('OWNER_METADATA_UNVERIFIABLE');
      if (current.generation !== generation || current.status !== 'preparing' ||
        current.pid !== owner.pid || current.started !== owner.started) throw fault('OWNER_INITIALIZATION_CHANGED');
      if (db.prepare('PRAGMA application_id').get().application_id !== INITIALIZED) throw fault('LOCK_DATABASE_UNRECOGNIZED');
      phase = 'prepared';
    },
    publish(value) {
      expect('initializing', 'reserved', 'prepared', 'owned');
      if (!validRoot(value)) throw fault('OWNER_IDENTITY_INVALID');
      if (phase === 'initializing') {
        lease.prepare(value);
        lease.commitInitialization();
        lease.reacquire();
      }
      if (owner && (owner.pid !== value.pid || owner.started !== value.started)) throw fault('OWNER_IDENTITY_INVALID');
      publishRecord({ ...value, status: 'active' });
      phase = 'owned';
    },
    assertOwned() {
      expect('owned');
      if (!db.isTransaction) throw fault('LEASE_NOT_READY');
    },
    release({ rootExited = false } = {}) {
      if (phase === 'closed') return;
      try {
        // A gap or failed reacquisition can hold stale/changed evidence. Never
        // update it without a verified held transaction for this generation.
        if (owner && phase !== 'gap' && db.isTransaction) publishRecord({ ...owner, status: rootExited ? 'recovery' : 'released' });
      } finally {
        phase = 'closed';
        db.close();
      }
    },
  };
  return { type: 'acquired', lease, recovered };
}
