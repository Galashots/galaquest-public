/**
 * Read-only passthrough of the canonical asset registry (docs/asset-production/asset-registry-v1.json)
 * for Studio's Library mode (#92 STUDIO-V2A).
 *
 * This is deliberately NOT a second asset database: it reads the one canonical file on every request
 * (no copy, no cache, no hand-maintained list) and augments each record with exactly one derived,
 * live fact the registry itself cannot know in advance -- whether THIS running checkout can actually
 * serve that record's bytes right now. The registry's own custody/recoverability fields describe
 * durable recovery coordinates that may live on another branch, in Drive, or with a provider; those
 * stay exactly as recorded. `runtime_availability` answers the narrower question Studio's "truthful
 * loadability" requirement needs: can `/api/asset-registry`'s caller actually GET the bytes from this
 * server, and if not, why not, in the registry's own vocabulary -- never a guess, never a default.
 *
 * Zero provider/network calls. Zero credential handling. Zero spend surface: this module only reads
 * local files that are already in the repository.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const REGISTRY_PATH = join(REPO_ROOT, 'docs', 'asset-production', 'asset-registry-v1.json');

export const ASSET_REGISTRY_ROUTE = '/api/asset-registry';

function isServableRepoPath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.includes('..')
    && !path.includes('\\')
    && path.startsWith('public/');
}

/**
 * Pure function (no I/O): given one canonical registry record, decide whether this checkout can
 * serve its bytes and, when it cannot, say exactly why using the record's own recorded custody
 * facts. `existsOnDisk` is injected so this stays unit-testable without touching the real filesystem.
 */
export function computeRuntimeAvailability(record, existsOnDisk = existsSync, repoRoot = REPO_ROOT) {
  const gitLocations = (record.custody_locations ?? []).filter((loc) => loc.kind === 'GIT');
  // source.path is the record's declared primary path; a GIT custody location's repo_path is the
  // fallback. Both are supposed to agree when both exist, but only one is guaranteed to be present.
  const candidatePaths = [record.source?.path, ...gitLocations.map((loc) => loc.repo_path)]
    .filter((path) => typeof path === 'string' && path.length > 0);

  for (const repoPath of candidatePaths) {
    if (!isServableRepoPath(repoPath)) continue;
    if (existsOnDisk(join(repoRoot, repoPath))) {
      return Object.freeze({
        loadable: true,
        runtimeUrl: `/${repoPath.slice('public/'.length)}`,
        repoPath,
        reason: null,
      });
    }
  }

  let reason;
  if (candidatePaths.length === 0) {
    reason = `no repo-relative path recorded for this asset (custody: ${record.custody ?? 'UNKNOWN'})`;
  } else if (!candidatePaths.some(isServableRepoPath)) {
    reason = `recorded path(s) are outside public/ and cannot be served by this runtime: ${candidatePaths.join(', ')}`;
  } else {
    const branches = [...new Set(gitLocations.map((loc) => loc.git_ref).filter(Boolean))];
    reason = branches.length
      ? `recorded on git ref(s) ${branches.join(', ')}, not present in this checkout`
      : `declared path not found in this checkout (custody: ${record.custody ?? 'UNKNOWN'})`;
  }
  return Object.freeze({
    loadable: false,
    runtimeUrl: null,
    repoPath: candidatePaths.find(isServableRepoPath) ?? candidatePaths[0] ?? null,
    reason,
  });
}

export async function loadAugmentedRegistry(registryPath = REGISTRY_PATH, repoRoot = REPO_ROOT) {
  const raw = JSON.parse(await readFile(registryPath, 'utf8'));
  return {
    ...raw,
    records: raw.records.map((record) => ({
      ...record,
      runtime_availability: computeRuntimeAvailability(record, existsSync, repoRoot),
    })),
  };
}

/** Same shape as server.mjs's other route handlers: returns false for any non-matching URL. */
export async function handleRegistryApiRequest(request, response) {
  const pathname = new URL(request.url ?? '/', 'http://runtime.local').pathname;
  if (pathname !== ASSET_REGISTRY_ROUTE) return false;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end('method not allowed');
    return true;
  }

  try {
    const augmented = await loadAugmentedRegistry();
    const body = JSON.stringify(augmented);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`registry unavailable: ${error.message}`);
  }
  return true;
}
