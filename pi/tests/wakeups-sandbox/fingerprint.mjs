import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

// Hash the installed package and all bundled dependencies, not selected entrypoints.
// The root must be the installed package directory, never the user's agentDir.
export function fingerprint(root) {
  const hash = createHash('sha256');
  const packageRoot = realpathSync(root);
  function visit(path, relative, ancestors) {
    const real = realpathSync(path);
    if (real !== packageRoot && !real.startsWith(`${packageRoot}/`)) {
      throw new Error('PACKAGE_LINK_OUTSIDE_ROOT');
    }
    const stat = lstatSync(path);
    hash.update(JSON.stringify([relative, stat.mode & 0o777]));
    if (stat.isSymbolicLink()) {
      hash.update(JSON.stringify(['link', readlinkSync(path)]));
      visit(real, `${relative}/@target`, ancestors);
    } else if (stat.isDirectory()) {
      if (ancestors.has(real)) throw new Error('PACKAGE_SYMLINK_CYCLE');
      const next = new Set([...ancestors, real]);
      hash.update('directory');
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${relative}/${name}`, next);
    } else if (stat.isFile()) {
      hash.update(JSON.stringify(['file', stat.size]));
      hash.update(readFileSync(path));
    } else {
      throw new Error('UNSUPPORTED_PACKAGE_ENTRY');
    }
  }
  visit(root, '.', new Set());
  return hash.digest('hex');
}

export function nodeIdentity() {
  return {
    version: process.version,
    binary: realpathSync(process.execPath),
    sha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),
  };
}
