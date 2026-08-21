/**
 * Durable-enough record of an in-flight paid Meshy task, so closing or reloading the Forge cannot
 * orphan a task the owner already paid for.
 *
 * DURABILITY BOUNDARY, stated plainly: the record lives in the browser's localStorage on the Forge
 * workstation. It survives tab close/reload/browser restart on that machine and profile; it does not
 * survive a cleared profile or follow the owner to another machine. That is the deliberate ceiling
 * for a zero-dependency repo with no durable datastore -- the provider itself remains the source of
 * truth, and the server's task-status route can re-attach to any taskId the owner still has.
 *
 * Storage is injected (never touched at module scope) so the module is unit-testable in Node and so
 * every read/write is guarded: a broken or unavailable storage must degrade to "no pending task",
 * never crash the Forge.
 */
export const PENDING_TASK_STORAGE_KEY = 'gq-forge-pending-meshy-task/1';

export const TERMINAL_MESHY_STATUSES = Object.freeze(['SUCCEEDED', 'FAILED', 'CANCELED']);

export function isTerminalMeshyStatus(status) {
  return TERMINAL_MESHY_STATUSES.includes(status);
}

// How many CONSECUTIVE failed polls of an ALREADY-PAID task the Forge tolerates before it stops
// polling. Stopping is not the same as abandoning the task: the pending record deliberately
// survives, so the owner resumes this exact taskId instead of paying for a replacement. A network
// blip during a two-minute generation must never become a second charge.
export const MAX_CONSECUTIVE_POLL_FAILURES = 6;

export function shouldAbandonPolling(consecutiveFailures) {
  return consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES;
}

function validRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.taskId === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(value.taskId)
    && typeof value.kind === 'string' && value.kind.length > 0
    && typeof value.idempotencyKey === 'string' && value.idempotencyKey.length >= 8
    && typeof value.createdAt === 'string' && value.createdAt.length > 0;
}

export function savePendingTask(storage, record) {
  if (!validRecord(record)) throw new Error('pending Meshy task record is malformed');
  const stored = {
    taskId: record.taskId,
    kind: record.kind,
    idempotencyKey: record.idempotencyKey,
    createdAt: record.createdAt,
  };
  try {
    storage.setItem(PENDING_TASK_STORAGE_KEY, JSON.stringify(stored));
  } catch { /* storage unavailable: the in-memory poll still runs; resume is best-effort */ }
  return stored;
}

export function loadPendingTask(storage) {
  let raw = null;
  try {
    raw = storage.getItem(PENDING_TASK_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!validRecord(parsed)) throw new Error('malformed');
    return parsed;
  } catch {
    clearPendingTask(storage);
    return null;
  }
}

export function clearPendingTask(storage) {
  try {
    storage.removeItem(PENDING_TASK_STORAGE_KEY);
  } catch { /* nothing to clear if storage is unavailable */ }
}
