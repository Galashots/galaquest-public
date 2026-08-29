/**
 * Browser-side access to the same-origin registry passthrough (net/registryApi.mjs). One fetch,
 * memoized for the page's lifetime -- Library re-reads the in-memory result rather than a second
 * network round trip per filter change; `clearAssetRegistryCache` exists only for tests/hard refresh.
 */
const ASSET_REGISTRY_ROUTE = '/api/asset-registry';

let cached = null;

export function fetchAssetRegistry({ force = false } = {}) {
  if (force) cached = null;
  if (!cached) {
    cached = fetch(ASSET_REGISTRY_ROUTE).then((response) => {
      if (!response.ok) throw new Error(`asset registry fetch failed: HTTP ${response.status}`);
      return response.json();
    }).catch((error) => {
      cached = null; // a failed fetch must not permanently poison the cache
      throw error;
    });
  }
  return cached;
}

export function clearAssetRegistryCache() {
  cached = null;
}
