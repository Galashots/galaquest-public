import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function assertSafeRequestedRef(ref) {
  if (typeof ref !== 'string' || ref.length < 1 || ref.length > 200) {
    throw new Error('requested ref must be a non-empty string no longer than 200 characters');
  }
  if (!/^(?!-)(?!.*(?:\.\.|@\{|\\))[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) {
    throw new Error(`requested ref ${JSON.stringify(ref)} is not a safe branch, tag or commit name`);
  }
  return ref;
}

/** Resolve the exact commit to review. Production fetches from origin first; tests can resolve a
 * local ref without a network remote by passing fetch:false. */
export function resolveRequestedRef(repoRoot, ref, { fetch = true } = {}) {
  assertSafeRequestedRef(ref);
  if (fetch) {
    git(repoRoot, ['fetch', '--no-tags', 'origin', ref]);
    return git(repoRoot, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}']);
  }
  return git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
}

/** Build a fresh detached worktree at exactly `sha`, verify both identity and cleanliness, and
 * return an idempotent cleanup function. The caller chooses a path under its own trusted scratch
 * root; an existing path is refused rather than recursively deleting an unknown directory. */
export function createDetachedReviewWorktree({ repoRoot, sha, worktreePath }) {
  if (existsSync(worktreePath)) throw new Error(`review worktree path already exists: ${worktreePath}`);
  mkdirSync(dirname(worktreePath), { recursive: true });
  git(repoRoot, ['worktree', 'add', '--detach', worktreePath, sha]);

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try { git(repoRoot, ['worktree', 'remove', '--force', worktreePath]); } catch { /* best effort below */ }
    rmSync(worktreePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  try {
    const actualSha = git(worktreePath, ['rev-parse', 'HEAD']);
    if (actualSha !== sha) {
      throw new Error(`review worktree HEAD ${actualSha} does not equal requested SHA ${sha}`);
    }
    const dirty = git(worktreePath, ['status', '--porcelain', '--untracked-files=all']);
    if (dirty.length > 0) throw new Error(`review worktree is not clean:\n${dirty}`);
    return { repoRoot: worktreePath, sha, actualSha, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
