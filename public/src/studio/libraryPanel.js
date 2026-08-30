/**
 * The Owner-facing Library/Inspect UI (#92 STUDIO-V2A). Deliberately thin: every filter option,
 * every listed asset, and every inspected fact is read straight from `window.__galaQuestStudio`'s
 * registry-backed methods (api.js) -- this file only renders DOM and forwards clicks. An agent
 * driving the same workflow uses `api.listAssets`/`api.loadAsset`/`api.getAssetInspection` directly
 * and never needs this module or DOM-click automation.
 */
export function installLibraryPanel({ api }) {
  const panel = document.querySelector('#library-panel');
  const inspectPanel = document.querySelector('#inspect-panel');
  const openButton = document.querySelector('#library-open');
  const closeButton = document.querySelector('#library-close');
  const inspectCloseButton = document.querySelector('#inspect-close');
  const search = document.querySelector('#library-search');
  const kindSelect = document.querySelector('#library-kind');
  const lifecycleSelect = document.querySelector('#library-lifecycle');
  const custodySelect = document.querySelector('#library-custody');
  const loadableOnlyBox = document.querySelector('#library-loadable-only');
  const resultsList = document.querySelector('#library-results');
  const status = document.querySelector('#library-status');
  const countLabel = document.querySelector('#library-count');
  const clearButton = document.querySelector('#library-clear');
  const factsPre = document.querySelector('#inspect-facts');

  let activeAssetId = null;

  function fillFilterOptions(select, values, placeholderLabel) {
    const current = select.value;
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = placeholderLabel;
    select.appendChild(placeholder);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    select.value = values.includes(current) ? current : '';
  }

  async function refreshFilterOptions() {
    const options = await api.getLibraryFilterOptions();
    fillFilterOptions(kindSelect, options.kinds, 'kind: all');
    fillFilterOptions(lifecycleSelect, options.lifecycles, 'lifecycle: all');
    fillFilterOptions(custodySelect, options.custodies, 'custody: all');
  }

  async function refreshResults() {
    const filter = {
      query: search.value || undefined,
      kind: kindSelect.value || undefined,
      lifecycle: lifecycleSelect.value || undefined,
      custody: custodySelect.value || undefined,
      loadableOnly: loadableOnlyBox.checked || undefined,
    };
    const assets = await api.listAssets(filter);
    countLabel.textContent = `${assets.length} asset${assets.length === 1 ? '' : 's'}`;
    resultsList.innerHTML = '';
    for (const asset of assets) {
      const item = document.createElement('li');
      item.dataset.assetId = asset.assetId;
      item.setAttribute('aria-current', String(asset.assetId === activeAssetId));
      // Truthful list rendering: an asset the registry cannot serve here says so in the row
      // itself, rather than looking identical to a loadable one until clicked.
      if (asset.loadable === false) item.className = 'unavailable';
      const badge = asset.loadable === false ? ' — not staged in this checkout' : asset.loadable === 'UNKNOWN' ? ' — availability unknown' : '';
      item.textContent = `${asset.displayName}${badge}`;
      item.title = `${asset.assetId} · ${asset.kind} · ${asset.lifecycle} · ${asset.custody}`;
      item.addEventListener('click', () => selectAsset(asset.assetId));
      resultsList.appendChild(item);
    }
  }

  async function refreshInspect() {
    if (!activeAssetId) {
      factsPre.textContent = 'select an asset in the Library to inspect it.';
      return;
    }
    const facts = await api.getAssetInspection(activeAssetId);
    factsPre.textContent = JSON.stringify(facts, null, 2);
  }

  async function selectAsset(assetId) {
    activeAssetId = assetId;
    status.textContent = 'loading…';
    for (const item of resultsList.children) {
      item.setAttribute('aria-current', String(item.dataset.assetId === assetId));
    }
    try {
      const result = await api.loadAsset(assetId);
      status.textContent = result.loaded
        ? `loaded ${assetId}`
        : `NOT LOADED — ${result.reason}`;
    } catch (error) {
      status.textContent = `failed: ${error.message}`;
    }
    await refreshInspect();
  }

  openButton.addEventListener('click', async () => {
    panel.hidden = false;
    inspectPanel.hidden = false;
    status.textContent = 'loading registry…';
    await refreshFilterOptions();
    await refreshResults();
    status.textContent = activeAssetId ? status.textContent : 'select an asset';
  });
  closeButton.addEventListener('click', () => { panel.hidden = true; });
  inspectCloseButton.addEventListener('click', () => { inspectPanel.hidden = true; });
  clearButton.addEventListener('click', () => {
    api.clearLibraryAsset();
    activeAssetId = null;
    for (const item of resultsList.children) item.setAttribute('aria-current', 'false');
    status.textContent = 'showing hero';
    refreshInspect();
  });
  search.addEventListener('input', () => { refreshResults(); });
  kindSelect.addEventListener('change', () => { refreshResults(); });
  lifecycleSelect.addEventListener('change', () => { refreshResults(); });
  custodySelect.addEventListener('change', () => { refreshResults(); });
  loadableOnlyBox.addEventListener('change', () => { refreshResults(); });

  return { refreshResults, refreshInspect, selectAsset };
}
