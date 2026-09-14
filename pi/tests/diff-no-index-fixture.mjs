import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { parseDiffSource, getDiff } = await jiti.import('../node_modules/pi-diff-review/src/diff/source.ts');
const { parseDiff } = await jiti.import('../node_modules/pi-diff-review/src/diff/parser.ts');
await testNoIndex();

async function testNoIndex() {
  const { parseViewSource, resolveViewFiles } = await jiti.import('../node_modules/pi-diff-review/src/view/source.ts');
  const { parseViewFiles } = await jiti.import('../node_modules/pi-diff-review/src/view/parser.ts');
  const { buildReviewPrompt, buildViewReviewPrompt } = await jiti.import('../node_modules/pi-diff-review/src/review/prompt.ts');
  const { buildCommentFromSelection } = await jiti.import('../node_modules/pi-diff-review/src/review/comments.ts');
  const root = mkdtempSync(join(tmpdir(), 'portable diff files '));
  const repo = join(root, 'repo');
  const baseline = join(root, 'baseline file.md');
  const design = join(root, 'design file.md');
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const args = `--no-index -- ${quote(baseline)} ${quote(design)}`;
  const runGit = (cwd, args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const comment = line => buildCommentFromSelection([line], { start: 0, end: 0 }, 'Clarify this section.');
  try {
    mkdirSync(repo);
    runGit(repo, ['init', '-q']);
    writeFileSync(join(repo, 'tracked'), 'repository content\n');
    writeFileSync(join(repo, '--no-index'), 'path, not option\n');
    runGit(repo, ['add', '.']);
    const index = readFileSync(join(repo, '.git', 'index'));
    const status = runGit(repo, ['status', '--porcelain=v1', '-z']);
    writeFileSync(baseline, 'heading\noriginal\n');
    writeFileSync(design, 'heading\nrevision\n');
    for (const cwd of [repo, root]) {
      const source = parseDiffSource(args);
      assert.deepEqual(source.args, ['--no-index', '--', baseline, design]);
      const text = getDiff(cwd, source);
      assert.match(text, /-original\n\+revision/);
      const line = parseDiff(text).find(line => line.text === '+revision');
      assert.ok(line?.commentable);
      assert.equal(line.filePath, design);
      assert.equal(line.newLineNumber, 2);
      assert.ok(buildReviewPrompt([comment(line)], source.promptLabel).includes(`${design}:new:2`));
      assert.equal(getDiff(cwd, parseDiffSource(`--no-index -- ${quote(design)} ${quote(design)}`)), '');
      assert.throws(() => getDiff(cwd, parseDiffSource(`--no-index -- ${quote(baseline)} ${quote(join(root, 'missing'))}`)), /missing/);
      assert.throws(() => getDiff(cwd, parseDiffSource(`--no-index --invalid-diff-option -- ${quote(baseline)} ${quote(design)}`)));
      const viewSource = parseViewSource(quote(design));
      assert.deepEqual(resolveViewFiles(cwd, viewSource), [design]);
      const viewLine = parseViewFiles(cwd, [design]).find(line => line.newLineNumber === 2);
      assert.ok(viewLine?.commentable);
      assert.equal(resolve(cwd, viewLine.filePath), design);
      assert.ok(buildViewReviewPrompt([comment(viewLine)], viewSource.promptLabel).includes(`${viewLine.filePath}:new:2`));
    }
    for (const [left, right, expectedPath] of [
      ['baseline file.md', design, design],
      [baseline, 'design file.md', 'design file.md'],
      ['/dev/null', design, design],
      [baseline, '/dev/null', baseline],
    ]) {
      const text = getDiff(root, parseDiffSource(`--no-index -- ${quote(left)} ${quote(right)}`));
      const lines = parseDiff(text).filter(line => line.commentable);
      assert.ok(lines.length > 0);
      assert.ok(lines.every(line => line.filePath === expectedPath), JSON.stringify(lines));
    }
    assert.equal(
      parseDiff(getDiff(root, parseDiffSource(`--no-index ${quote(baseline)} ${quote(design)}`))).find(line => line.text === '+revision').filePath,
      design,
    );
    runGit(repo, ['config', 'core.autocrlf', 'true']);
    runGit(repo, ['config', 'core.safecrlf', 'warn']);
    assert.throws(() => getDiff(repo, parseDiffSource(args)), /warning:/);
    runGit(repo, ['config', '--unset', 'core.autocrlf']);
    runGit(repo, ['config', '--unset', 'core.safecrlf']);
    const custom = getDiff(root, parseDiffSource(`--src-prefix=old/ --dst-prefix=new/ ${args}`));
    assert.ok(custom.includes(`--- old/${baseline.slice(1)}`));
    assert.ok(custom.includes(`+++ new/${design.slice(1)}`));
    const noPrefix = getDiff(root, parseDiffSource(`--no-prefix ${args}`));
    assert.ok(noPrefix.includes(`+++ ${design.slice(1)}`));
    writeFileSync(join(repo, '--no-index'), 'changed path\n');
    assert.throws(() => getDiff(repo, parseDiffSource('--exit-code -- --no-index')), /status 1/);
    assert.throws(() => getDiff(repo, parseDiffSource('--cached --exit-code')), /status 1/);
    assert.throws(() => getDiff(repo, parseDiffSource('missing-revision')), /missing-revision/);
    assert.throws(() => getDiff(root, parseDiffSource('HEAD')));
    writeFileSync(join(repo, '--no-index'), 'path, not option\n');
    assert.deepEqual(readFileSync(join(repo, '.git', 'index')), index);
    assert.equal(runGit(repo, ['status', '--porcelain=v1', '-z']), status);
    assert.equal(readFileSync(join(repo, 'tracked'), 'utf8'), 'repository content\n');
    assert.equal(readFileSync(baseline, 'utf8'), 'heading\noriginal\n');
    assert.equal(readFileSync(design, 'utf8'), 'heading\nrevision\n');
    console.log('PASS: explicit no-index diffs, absolute paths with spaces, review locations, /view, errors, unchanged index and files.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
