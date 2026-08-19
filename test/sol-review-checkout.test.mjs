import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertSafeRequestedRef,
  createDetachedReviewWorktree,
  resolveRequestedRef,
} from '../tools/sol-review/reviewCheckout.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('a review worktree is detached at the exact requested SHA, even when the worker checkout is dirty and newer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-sol-review-checkout-'));
  const repo = join(dir, 'repo');
  const review = join(dir, 'review');
  try {
    git(dir, ['init', repo]);
    git(repo, ['config', 'user.email', 'test@galaquest.invalid']);
    git(repo, ['config', 'user.name', 'GalaQuest test']);
    // Scoped to THIS throwaway repo, never to shared config. On Windows a global core.autocrlf=true
    // rewrites LF to CRLF on checkout, so the review worktree handed back 'requested revision\r\n'
    // and this test failed for a line-ending reason that has nothing to do with checkout integrity
    // (green on Linux CI throughout). Pinning the fixture repo's own line endings keeps the
    // assertion below BYTE-EXACT, which is the point of it -- normalising the comparison instead
    // would weaken the very evidence-custody property this test exists to prove. A linked worktree
    // shares its repo's config, so this covers the review checkout too.
    git(repo, ['config', 'core.autocrlf', 'false']);
    git(repo, ['config', 'core.eol', 'lf']);
    writeFileSync(join(repo, 'asset.txt'), 'requested revision\n');
    git(repo, ['add', 'asset.txt']);
    git(repo, ['commit', '-m', 'requested']);
    const requestedSha = git(repo, ['rev-parse', 'HEAD']);

    writeFileSync(join(repo, 'asset.txt'), 'newer worker checkout\n');
    git(repo, ['commit', '-am', 'newer']);
    writeFileSync(join(repo, 'dirty-only.txt'), 'must not leak into review\n');

    assert.equal(resolveRequestedRef(repo, requestedSha, { fetch: false }), requestedSha);
    const checkout = createDetachedReviewWorktree({ repoRoot: repo, sha: requestedSha, worktreePath: review });
    try {
      assert.equal(checkout.actualSha, requestedSha);
      assert.equal(readFileSync(join(review, 'asset.txt'), 'utf8'), 'requested revision\n');
      assert.equal(git(review, ['status', '--porcelain', '--untracked-files=all']), '');
      assert.equal(readFileSync(join(repo, 'dirty-only.txt'), 'utf8'), 'must not leak into review\n',
        'the worker checkout remains separate and may be dirty without contaminating evidence');
    } finally {
      checkout.cleanup();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('requested refs reject option injection and traversal-like spellings before git sees them', () => {
  for (const ref of ['--upload-pack=evil', '../main', 'main..evil', 'main@{1}', 'main\\evil']) {
    assert.throws(() => assertSafeRequestedRef(ref), /safe branch, tag or commit name/);
  }
  for (const ref of ['main', 'agent/integrate-gameplay-sr5', '53ab5abda8afc38461655d940c2ce199609cf47d']) {
    assert.equal(assertSafeRequestedRef(ref), ref);
  }
});

test('the worker trusts its local schema and threads the isolated checkout through every runtime boundary', () => {
  const worker = readFileSync(new URL('../tools/sol-review/worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /TRUSTED_SCHEMA_PATH/);
  assert.doesNotMatch(worker, /CONTROL_SCHEMA_PATH/,
    'the control branch must carry requests, not authority for executable protocol shape');
  assert.match(worker, /createDetachedReviewWorktree\(\{ repoRoot: REPO_ROOT, sha, worktreePath \}\)/);
  assert.match(worker, /startOwnedServer\(\{ repoRoot \}\)/,
    'the server must run from the isolated target checkout');
  assert.match(worker, /actualReviewedSha: review\?\.actualSha \?\? null/);
  assert.match(worker, /checkout\?\.cleanup\(\)/,
    'the detached worktree must be removed on success and failure');
});
