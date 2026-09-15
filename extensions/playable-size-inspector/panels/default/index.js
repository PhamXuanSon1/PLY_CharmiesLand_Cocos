'use strict';

const fs = require('fs/promises');
const path = require('path');

const template = require('fs').readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const style = require('fs').readFileSync(path.join(__dirname, 'index.css'), 'utf8');
const DEFAULT_BUILD_ROOT = 'build/web-mobile';
const DEFAULT_OUTPUT_ROOT = 'build/playable-size-inspector/web-mobile';
const DEFAULT_EXPORT_ROOT = 'build/playable-size-inspector/exports';
const SAFE_BULK_MAX_TEXTURE_SIZE = 4096;
const SAFE_BULK_JPEG_QUALITY = 82;

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    scanButton: '#scan-button',
    scanSourceSelect: '#scan-source-select',
    optimizeExportButton: '#optimize-export-button',
    buildRootInput: '#build-root-input',
    outputRootInput: '#output-root-input',
    exportRootInput: '#export-root-input',
    tabOverview: '#tab-overview',
    tabTypes: '#tab-types',
    tabAssets: '#tab-assets',
    tabImports: '#tab-imports',
    panelOverview: '#panel-overview',
    panelTypes: '#panel-types',
    panelAssets: '#panel-assets',
    panelImports: '#panel-imports',
    filterAll: '#filter-all',
    filterTexture: '#filter-texture',
    filterAudio: '#filter-audio',
    filterFont: '#filter-font',
    filterModel: '#filter-model',
    filterPrefab: '#filter-prefab',
    filterImport: '#filter-import',
    filterScript: '#filter-script',
    summary: '#summary',
    status: '#status',
    recommendation: '#recommendation',
    overview: '#overview',
    typeResults: '#type-results',
    assetResults: '#asset-results',
    importResults: '#import-results',
    detail: '#detail',
    batchPngQuality: '#batch-png-quality',
    batchApplyPngBtn: '#batch-apply-png-btn',
    batchResetPngBtn: '#batch-reset-png-btn',
    batchStatus: '#batch-status',
    batchAudioBitrate: '#batch-audio-bitrate',
    batchSelectAllAudioBtn: '#batch-select-all-audio-btn',
    batchClearAudioBtn: '#batch-clear-audio-btn',
    batchApplyAudioBtn: '#batch-apply-audio-btn',
    batchResetAudioBtn: '#batch-reset-audio-btn',
    batchAudioStatus: '#batch-audio-status',
  },

  ready() {
    this.state = {
      scanning: false,
      activeTab: 'overview',
      assetFilter: 'all',
      selectedKind: 'asset',
      selectedIndex: -1,
      typeRows: [],
      assetRows: [],
      importRows: [],
      fileIndex: new Map(),
      assetEntries: [],
      previewByAsset: new Map(),
      exportMetrics: null,
      totalBuildBytes: 0,
      projectRoot: Editor.Project.path,
      buildRoot: '',
      scanSourceLabel: 'Original Build',
      tickedAudio: new Set(),
    };

    this.$.scanButton.addEventListener('confirm', () => {
      void scanPlayable.call(this);
    });

    this.$.optimizeExportButton.addEventListener('confirm', () => {
      void optimizeAndExportAll.call(this);
    });

    this.$.outputRootInput.addEventListener('confirm', () => {
      void refreshOptimizedScanAvailability.call(this);
    });

    if (this.$.batchApplyPngBtn) {
      this.$.batchApplyPngBtn.addEventListener('click', () => {
        void runBatchPngOptimizeAction.call(this);
      });
    }

    if (this.$.batchResetPngBtn) {
      this.$.batchResetPngBtn.addEventListener('click', () => {
        void runBatchPngResetAction.call(this);
      });
    }

    if (this.$.batchSelectAllAudioBtn) {
      this.$.batchSelectAllAudioBtn.addEventListener('click', () => {
        setAllVisibleAudioTicked.call(this, true);
      });
    }

    if (this.$.batchClearAudioBtn) {
      this.$.batchClearAudioBtn.addEventListener('click', () => {
        this.state.tickedAudio.clear();
        renderAssetResults.call(this);
        updateAudioBatchStatus.call(this);
      });
    }

    if (this.$.batchApplyAudioBtn) {
      this.$.batchApplyAudioBtn.addEventListener('click', () => {
        void runBatchAudioAction.call(this, 'optimize');
      });
    }

    if (this.$.batchResetAudioBtn) {
      this.$.batchResetAudioBtn.addEventListener('click', () => {
        void runBatchAudioAction.call(this, 'reset');
      });
    }

    updateAudioBatchStatus.call(this);

    this.$.assetResults.tabIndex = 0;
    this.$.assetResults.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return;
      }
      event.preventDefault();
      moveAssetSelection.call(this, event.key === 'ArrowDown' ? 1 : -1);
    });

    for (const button of [this.$.tabOverview, this.$.tabTypes, this.$.tabAssets, this.$.tabImports]) {
      button.addEventListener('click', () => {
        this.state.activeTab = button.dataset.tab;
        renderTabs.call(this);
      });
    }

    for (const button of [
      this.$.filterAll,
      this.$.filterTexture,
      this.$.filterAudio,
      this.$.filterFont,
      this.$.filterModel,
      this.$.filterPrefab,
      this.$.filterImport,
      this.$.filterScript,
    ]) {
      button.addEventListener('click', () => {
        this.state.assetFilter = button.dataset.filter;
        ensureValidAssetSelection.call(this);
        renderAssetFilters.call(this);
        renderAssetResults.call(this);
        renderDetail.call(this);
      });
    }

    renderTabs.call(this);
    renderAssetFilters.call(this);
    void refreshOptimizedScanAvailability.call(this);
  },
});

async function refreshOptimizedScanAvailability() {
  const option = this.$.scanSourceSelect.querySelector('option[value="optimized"]');
  if (!option) {
    return;
  }

  const outputRootInput = String(this.$.outputRootInput.value || DEFAULT_OUTPUT_ROOT).trim() || DEFAULT_OUTPUT_ROOT;
  const outputRoot = path.resolve(Editor.Project.path, outputRootInput);
  let available = false;
  try {
    available = (await fs.stat(outputRoot)).isDirectory();
  } catch (_error) {
    available = false;
  }
  option.textContent = `Optimized Copy (${available ? 'Available' : 'Not created'})`;
}

async function optimizeAndExportAll() {
  if (this.state.scanning) {
    return;
  }

  const sourceRootInput = String(this.$.buildRootInput.value || DEFAULT_BUILD_ROOT).trim() || DEFAULT_BUILD_ROOT;
  const outputRootInput = String(this.$.outputRootInput.value || DEFAULT_OUTPUT_ROOT).trim() || DEFAULT_OUTPUT_ROOT;
  const exportRootInput = String(this.$.exportRootInput.value || DEFAULT_EXPORT_ROOT).trim() || DEFAULT_EXPORT_ROOT;
  const sourceRoot = path.resolve(Editor.Project.path, sourceRootInput);
  const optimizedRoot = path.resolve(Editor.Project.path, outputRootInput);
  const exportRoot = path.resolve(Editor.Project.path, exportRootInput);

  this.state.scanning = true;
  setStatus.call(this, 'Optimizing copy and exporting all networks...');
  this.$.summary.textContent = 'Optimize + export in progress...';
  this.$.recommendation.textContent = `Using optimized build copy at ${outputRootInput} and exporting network outputs to ${exportRootInput}...`;

  try {
    const result = await Editor.Message.request('playable-size-inspector', 'optimize-export-all', {
      sourceRoot,
      optimizedRoot,
      exportRoot,
      maxTextureSize: SAFE_BULK_MAX_TEXTURE_SIZE,
      jpegQuality: SAFE_BULK_JPEG_QUALITY,
    });

    const optimizeReport = result.optimizeReport || {};
    const exportReport = result.exportReport || {};
    const optimizedAnalysis = exportReport.optimizedAnalysis || null;
    const beforeMB = round((Number(optimizeReport.totalBeforeBytes || 0) / (1024 * 1024)));
    const afterMB = round((Number(optimizeReport.totalAfterBytes || 0) / (1024 * 1024)));
    const optimizedFiles = Number(optimizeReport.optimizedFiles || 0);
    const buildSavedKB = round((Number(optimizeReport.totalBeforeBytes || 0) - Number(optimizeReport.totalAfterBytes || 0)) / 1024);
    const packageCount = Number(optimizedAnalysis && optimizedAnalysis.packageCount || 0);
    const largestPackage = optimizedAnalysis && optimizedAnalysis.largestPackage || null;
    const buildName = String(exportReport.optimizedReport && exportReport.optimizedReport.buildName || '').trim();

    this.state.exportMetrics = {
      optimized: optimizedAnalysis,
    };
    this.$.summary.textContent = `Build: ${beforeMB} MB -> ${afterMB} MB (saved ${buildSavedKB} KB) | ${packageCount} network outputs`;
    this.$.recommendation.textContent = `Build name: ${buildName || 'unknown'}. Optimized ${optimizedFiles} files. Largest final package: ${formatBytes(largestPackage ? largestPackage.bytes : 0)}. Latest outputs replaced the previous files in ${exportRootInput}.`;
    setStatus.call(this, `Exported optimized network outputs to ${exportRootInput}`);
    void refreshOptimizedScanAvailability.call(this);

    this.state.scanning = false;
  } catch (error) {
    console.error('[playable-size-inspector] optimize-export-all failed:', error);
    this.$.summary.textContent = 'Optimize + export failed';
    this.$.recommendation.textContent = error.message || String(error);
    setStatus.call(this, error.message || String(error));
    this.state.scanning = false;
  }
}

async function scanPlayable() {
  if (this.state.scanning) {
    return;
  }

  this.state.scanning = true;
  const scanOptimized = String(this.$.scanSourceSelect.value || 'original') === 'optimized';
  const buildRootInput = scanOptimized
    ? String(this.$.outputRootInput.value || DEFAULT_OUTPUT_ROOT).trim() || DEFAULT_OUTPUT_ROOT
    : String(this.$.buildRootInput.value || DEFAULT_BUILD_ROOT).trim() || DEFAULT_BUILD_ROOT;
  const scanSourceLabel = scanOptimized ? 'Optimized Copy' : 'Original Build';

  resetForScan.call(this);
  setStatus.call(this, `Scanning ${scanSourceLabel}...`);

  try {
    const projectRoot = Editor.Project.path;
    const buildRoot = path.resolve(projectRoot, buildRootInput);
    const assetsIndexPath = path.join(projectRoot, 'library', '.assets-data.json');

    try {
      const buildRootStat = await fs.stat(buildRoot);
      if (!buildRootStat.isDirectory()) {
        throw new Error('not-directory');
      }
    } catch (_error) {
      const hint = scanOptimized
        ? 'Apply an asset optimization or run Optimize + Export All first.'
        : 'Build the web-mobile target in Cocos first.';
      throw new Error(`${scanSourceLabel} was not found at ${buildRootInput}. ${hint}`);
    }

    this.state.projectRoot = projectRoot;
    this.state.buildRoot = buildRoot;
    this.state.scanSourceLabel = scanSourceLabel;

    const assetEntries = await readAssetEntries(assetsIndexPath);
    const dependencyIndex = await buildPrefabDependencyIndex({
      projectRoot,
      buildRoot,
      assetEntries,
    });
    const buildFiles = await collectBuildFiles(buildRoot);
    const packedAssetIndex = await buildPackedAssetIndex({ buildFiles, assetEntries });
    const fileIndex = indexBuildFiles(buildFiles);
    const typeRows = buildTypeSummary(buildFiles);
    const assetRows = await buildAssetRows({
      buildFiles,
      assetEntries,
      buildRoot,
      dependencyIndex,
      packedAssetIndex,
    });
    const importRows = await buildImportRows({
      buildFiles,
      assetEntries,
      projectRoot,
      buildRoot,
    });

    this.state.assetEntries = assetEntries;
    this.state.fileIndex = fileIndex;
    this.state.typeRows = typeRows;
    this.state.assetRows = assetRows;
    // A fresh scan replaces every row, so stale ticks would point at nothing.
    this.state.tickedAudio.clear();
    this.state.importRows = importRows;
    this.state.totalBuildBytes = buildFiles.reduce((sum, file) => sum + file.size, 0);

    if (assetRows.length) {
      this.state.selectedKind = 'asset';
      this.state.selectedIndex = 0;
    } else if (typeRows.length) {
      this.state.selectedKind = 'type';
      this.state.selectedIndex = 0;
    } else if (importRows.length) {
      this.state.selectedKind = 'import';
      this.state.selectedIndex = 0;
    } else {
      this.state.selectedKind = 'asset';
      this.state.selectedIndex = -1;
    }

    renderSummary.call(this, buildFiles, typeRows, assetRows, importRows, scanSourceLabel);
    renderOverview.call(this, buildFiles, typeRows);
    renderAssetFilters.call(this);
    renderTypeResults.call(this);
    renderAssetResults.call(this);
    renderImportResults.call(this);
    renderDetail.call(this);

    setStatus.call(this, `${scanSourceLabel} scan complete. ${buildFiles.length} files analyzed.`);
  } catch (error) {
    console.error('[playable-size-inspector] Scan failed:', error);
    this.$.summary.textContent = 'Scan failed';
    this.$.overview.className = 'panel-content empty';
    this.$.overview.textContent = error.message || String(error);
    this.$.typeResults.className = 'panel-content empty';
    this.$.typeResults.textContent = 'Scan failed.';
    this.$.assetResults.className = 'panel-content empty';
    this.$.assetResults.textContent = 'Scan failed.';
    this.$.importResults.className = 'panel-content empty';
    this.$.importResults.textContent = 'Scan failed.';
    this.$.detail.className = 'detail empty';
    this.$.detail.textContent = 'Scan failed.';
    this.$.recommendation.textContent = error.message || String(error);
    setStatus.call(this, error.message || String(error));
  } finally {
    this.state.scanning = false;
  }
}

function resetForScan() {
  this.state.previewByAsset = new Map();
  this.$.summary.textContent = 'Scanning...';
  this.$.recommendation.textContent = 'Crunching build files and source mappings...';
  this.$.overview.className = 'panel-content empty';
  this.$.overview.textContent = 'Scanning build overview...';
  this.$.typeResults.className = 'panel-content empty';
  this.$.typeResults.textContent = 'Scanning type groups...';
  this.$.assetResults.className = 'panel-content empty';
  this.$.assetResults.textContent = 'Scanning all built files...';
  this.$.importResults.className = 'panel-content empty';
  this.$.importResults.textContent = 'Scanning all import JSON files...';
  this.$.detail.className = 'detail empty';
  this.$.detail.textContent = 'Scan in progress...';
}

function renderTabs() {
  const pairs = [
    ['overview', this.$.tabOverview, this.$.panelOverview],
    ['types', this.$.tabTypes, this.$.panelTypes],
    ['assets', this.$.tabAssets, this.$.panelAssets],
    ['imports', this.$.tabImports, this.$.panelImports],
  ];

  for (const [name, button, panel] of pairs) {
    const active = this.state.activeTab === name;
    button.classList.toggle('active', active);
    panel.classList.toggle('active', active);
  }
}

function renderAssetFilters() {
  const buttons = [
    this.$.filterAll,
    this.$.filterTexture,
    this.$.filterAudio,
    this.$.filterFont,
    this.$.filterModel,
    this.$.filterPrefab,
    this.$.filterImport,
    this.$.filterScript,
  ];

  for (const button of buttons) {
    button.classList.toggle('active', button.dataset.filter === this.state.assetFilter);
  }
}

async function readAssetEntries(indexPath) {
  const raw = await fs.readFile(indexPath, 'utf8');
  const data = JSON.parse(raw);
  const entries = [];

  for (const [uuid, info] of Object.entries(data)) {
    const url = String(info && info.url || '');
    if (!url.startsWith('db://assets/')) {
      continue;
    }

    const rootAssetUrl = url.split('@')[0];
    const extension = path.extname(rootAssetUrl).toLowerCase();
    const normalizedUrl = normalizeAssetToken(rootAssetUrl);
    const leafToken = path.basename(rootAssetUrl, extension).toLowerCase();
    const compactUuid = compactUuidString(uuid);
    const tokens = Array.from(new Set([
      normalizedUrl,
      leafToken,
      uuid.toLowerCase(),
      compactUuid,
    ].filter(Boolean)));

    entries.push({
      uuid,
      compactUuid,
      url,
      normalizedUrl,
      leafToken,
      tokens,
      extension,
      category: categorizeSourceExtension(extension),
    });
  }

  return entries;
}

async function buildPrefabDependencyIndex({ projectRoot, buildRoot, assetEntries }) {
  const settingsPath = path.join(buildRoot, 'src', 'settings.json');
  let launchSceneUrl = '';
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    launchSceneUrl = String(settings && settings.launch && settings.launch.launchScene || '');
  } catch (_error) {
    return new Map();
  }

  const documentExtensions = new Set(['.scene', '.prefab', '.material', '.mtl', '.anim']);
  const documents = [];
  for (const entry of assetEntries) {
    if (!documentExtensions.has(entry.extension)) {
      continue;
    }
    const relativeAssetPath = entry.url.replace(/^db:\/\/assets\//, '');
    const fullPath = path.join(projectRoot, 'assets', relativeAssetPath.replace(/\//g, path.sep));
    try {
      const text = await fs.readFile(fullPath, 'utf8');
      const references = [];
      const pattern = /"__uuid__"\s*:\s*"([^"]+)"/g;
      let match = pattern.exec(text);
      while (match) {
        references.push(normalizeDependencyUuid(match[1]));
        match = pattern.exec(text);
      }
      documents.push({
        uuid: normalizeDependencyUuid(entry.uuid),
        url: entry.url,
        label: path.basename(relativeAssetPath),
        references: Array.from(new Set(references.filter(Boolean))),
      });
    } catch (_error) {
      // Ignore source documents that are unavailable during an editor refresh.
    }
  }

  const documentByUuid = new Map(documents.map((document) => [document.uuid, document]));
  const launchDocument = documents.find((document) => document.url.toLowerCase() === launchSceneUrl.toLowerCase());
  if (!launchDocument) {
    return new Map();
  }

  const dependencyIndex = new Map();
  const queue = [{ document: launchDocument, chain: [launchDocument.label] }];
  const visitedDocuments = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || visitedDocuments.has(current.document.uuid)) {
      continue;
    }
    visitedDocuments.add(current.document.uuid);

    for (const referenceUuid of current.document.references) {
      let chains = dependencyIndex.get(referenceUuid);
      if (!chains) {
        chains = [];
        dependencyIndex.set(referenceUuid, chains);
      }
      const chainLabel = current.chain.join(' > ');
      if (!chains.includes(chainLabel) && chains.length < 3) {
        chains.push(chainLabel);
      }

      const referencedDocument = documentByUuid.get(referenceUuid);
      if (referencedDocument && !visitedDocuments.has(referencedDocument.uuid)) {
        queue.push({
          document: referencedDocument,
          chain: current.chain.concat(referencedDocument.label),
        });
      }
    }
  }

  return dependencyIndex;
}

function normalizeDependencyUuid(uuid) {
  return String(uuid || '').split('@')[0].toLowerCase();
}

async function buildPackedAssetIndex({ buildFiles, assetEntries }) {
  const assetByUuid = new Map(assetEntries.map((entry) => [String(entry.uuid || '').toLowerCase(), entry]));
  const buildFileByPath = new Map(buildFiles.map((file) => [normalizeBuildPath(file.relativePath), file]));
  const packedAssetIndex = new Map();
  const configFiles = buildFiles.filter((file) => /^config(?:\.[^.]+)?\.json$/i.test(file.name));

  for (const configFile of configFiles) {
    let config;
    try {
      config = JSON.parse(await fs.readFile(configFile.fullPath, 'utf8'));
    } catch (_error) {
      continue;
    }

    const uuids = Array.isArray(config.uuids) ? config.uuids : [];
    const packs = config.packs && typeof config.packs === 'object' ? config.packs : {};
    const bundleRoot = path.posix.dirname(normalizeBuildPath(configFile.relativePath));
    const importBase = String(config.importBase || 'import').replace(/^\/+|\/+$/g, '');

    for (const [packId, uuidIndexes] of Object.entries(packs)) {
      if (!Array.isArray(uuidIndexes)) {
        continue;
      }

      const packPrefix = packId.slice(0, 2);
      const basePath = `${bundleRoot}/${importBase}/${packPrefix}/${packId}`;
      const packedFile = buildFileByPath.get(`${basePath}.json`)
        || buildFileByPath.get(`${basePath}.cconb`);
      if (!packedFile) {
        continue;
      }

      const matchedAssets = uuidIndexes
        .map((index) => decompressCocosUuid(uuids[index]))
        .map((uuid) => assetByUuid.get(String(uuid || '').toLowerCase()))
        .filter(Boolean);
      const packedAssets = Array.from(new Map(
        matchedAssets.map((entry) => [String(entry.url || '').split('@')[0].toLowerCase(), entry]),
      ).values());
      if (packedAssets.length) {
        packedAssetIndex.set(normalizeBuildPath(packedFile.relativePath), packedAssets);
      }
    }
  }

  return packedAssetIndex;
}

function decompressCocosUuid(value) {
  const rawValue = String(value || '');
  const separatorIndex = rawValue.indexOf('@');
  const uuid = separatorIndex >= 0 ? rawValue.slice(0, separatorIndex) : rawValue;
  const suffix = separatorIndex >= 0 ? rawValue.slice(separatorIndex) : '';
  if (uuid.length !== 22) {
    return `${uuid}${suffix}`;
  }

  const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const hex = '0123456789abcdef';
  const chars = [uuid[0], uuid[1]];
  for (let index = 2; index < 22; index += 2) {
    const left = base64.indexOf(uuid[index]);
    const right = base64.indexOf(uuid[index + 1]);
    if (left < 0 || right < 0) {
      return `${uuid}${suffix}`;
    }
    chars.push(hex[left >> 2]);
    chars.push(hex[((left & 3) << 2) | (right >> 4)]);
    chars.push(hex[right & 15]);
  }

  const compact = chars.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}${suffix}`;
}

function normalizeBuildPath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

async function collectBuildFiles(root) {
  const files = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.stat(fullPath);
      const relativePath = toRelative(root, fullPath);
      const extension = path.extname(entry.name).toLowerCase();
      const buildInfo = categorizeBuildFile(relativePath, extension);

      files.push({
        fullPath,
        relativePath,
        name: entry.name,
        extension,
        size: stat.size,
        sizeKB: round(stat.size / 1024),
        category: buildInfo.category,
        groupLabel: buildInfo.groupLabel,
        isNative: buildInfo.isNative,
        isImport: buildInfo.isImport,
      });
    }
  }

  await walk(root);
  return files.sort((left, right) => right.size - left.size);
}

function indexBuildFiles(buildFiles) {
  const index = new Map();
  for (const file of buildFiles) {
    index.set(file.relativePath, file);
  }
  return index;
}

function buildTypeSummary(buildFiles) {
  const buckets = new Map();

  for (const file of buildFiles) {
    const key = file.category;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        category: key,
        label: typeLabel(key),
        files: 0,
        size: 0,
        examples: [],
      };
      buckets.set(key, bucket);
    }

    bucket.files += 1;
    bucket.size += file.size;
    if (bucket.examples.length < 3) {
      bucket.examples.push(file.relativePath);
    }
  }

  return Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      sizeKB: round(bucket.size / 1024),
      sizeMB: round(bucket.size / (1024 * 1024)),
    }))
    .sort((left, right) => right.size - left.size);
}

async function buildAssetRows({ buildFiles, assetEntries, buildRoot, dependencyIndex, packedAssetIndex }) {
  const rows = await Promise.all(buildFiles.map(async (file) => {
    const sourceMatch = findBestSourceMatch(file, assetEntries);
    const packedSources = packedAssetIndex.get(normalizeBuildPath(file.relativePath)) || [];
    const prefabSources = packedSources.filter((entry) => entry.category === 'prefab');
    const modelSources = Array.from(new Map(packedSources
      .filter((entry) => entry.category === 'model-source')
      .map((entry) => {
        const rootUrl = String(entry.url || '').split('@')[0];
        return [rootUrl.toLowerCase(), {
          uuid: normalizeDependencyUuid(entry.uuid),
          url: rootUrl,
          extension: path.extname(rootUrl).toLowerCase(),
        }];
      })).values());
    const primarySource = prefabSources[0] || modelSources[0] || sourceMatch || packedSources[0] || null;
    const dependencySources = packedSources.length ? packedSources : (primarySource ? [primarySource] : []);
    const includedBy = Array.from(new Set(dependencySources.flatMap((entry) => (
      dependencyIndex.get(normalizeDependencyUuid(entry.uuid)) || []
    )))).slice(0, 3);
    const textureMeta = await readTextureMeta(file.fullPath, file.extension);
    return {
      fullPath: file.fullPath,
      relativePath: file.relativePath,
      name: file.name,
      extension: file.extension,
      size: file.size,
      sizeKB: file.sizeKB,
      sizeMB: round(file.size / (1024 * 1024)),
      category: file.category,
      source: primarySource ? primarySource.url : '',
      sourceUuid: primarySource ? primarySource.uuid : '',
      sourceCategory: primarySource ? primarySource.category : '',
      packedSourceCount: packedSources.length,
      prefabSources: prefabSources.map((entry) => ({ uuid: entry.uuid, url: entry.url })),
      modelSources,
      includedBy,
      textureMeta,
      canOptimizeDirectly: isDirectAssetOptimizationSupported(file),
      buildArea: classifyBuildArea(file.relativePath),
      relativeBuildRoot: toRelative(buildRoot, file.fullPath),
    };
  }));

  return rows.sort((left, right) => right.size - left.size);
}

async function buildImportRows({ buildFiles, assetEntries, projectRoot, buildRoot }) {
  const importCandidates = buildFiles
    .filter((file) => file.isImport && file.extension === '.json')
    .sort((left, right) => right.size - left.size);

  const rows = [];
  for (const file of importCandidates) {
    const text = await fs.readFile(file.fullPath, 'utf8');
    const analysis = analyzeImportFile({
      projectRoot,
      buildRoot,
      file,
      text,
      assetEntries,
    });
    rows.push(analysis);
  }

  return rows;
}

function renderSummary(buildFiles, typeRows, assetRows, importRows, scanSourceLabel = 'Build') {
  const totalSize = buildFiles.reduce((sum, file) => sum + file.size, 0);
  this.$.summary.textContent = `${scanSourceLabel}: ${buildFiles.length} files, ${round(totalSize / (1024 * 1024))} MB total`;

  const heavyType = typeRows[0];
  const heavyImport = importRows[0];
  const parts = [];

  if (heavyType) {
    parts.push(`Largest type: ${heavyType.label} (${heavyType.sizeMB} MB)`);
  }
  if (heavyImport) {
    parts.push(`Heaviest import json: ${heavyImport.relativeBuildPath} (${heavyImport.sizeKB} KB)`);
  }

  this.$.recommendation.textContent = parts.join(' | ') || 'No build files found.';
}

function renderOverview(buildFiles, typeRows) {
  if (!buildFiles.length) {
    this.$.overview.className = 'panel-content empty';
    this.$.overview.textContent = 'No files found.';
    return;
  }

  const totalSize = buildFiles.reduce((sum, file) => sum + file.size, 0);
  const topThree = typeRows.slice(0, 3);
  const cards = [
    {
      label: 'Total Build',
      value: `${round(totalSize / (1024 * 1024))} MB`,
      note: `${buildFiles.length} files`,
    },
    {
      label: 'Largest Type',
      value: topThree[0] ? topThree[0].label : 'N/A',
      note: topThree[0] ? `${topThree[0].sizeMB} MB` : 'No data',
    },
    {
      label: 'Top 3 Share',
      value: `${round(topThree.reduce((sum, row) => sum + row.size, 0) / (1024 * 1024))} MB`,
      note: topThree.length ? topThree.map((row) => row.label).join(', ') : 'No data',
    },
  ];

  const distribution = typeRows.slice(0, 8).map((row) => {
    const percentage = totalSize > 0 ? round((row.size / totalSize) * 100) : 0;
    return `
      <div class="dist-row">
        <div class="dist-meta">
          <span class="dist-label">${escapeHtml(row.label)}</span>
          <span class="dist-size">${row.sizeMB} MB</span>
        </div>
        <div class="dist-bar-track">
          <div class="dist-bar-fill" style="width:${Math.max(4, percentage)}%"></div>
        </div>
        <div class="dist-foot">${percentage}% · ${row.files} files</div>
      </div>
    `;
  }).join('');

  this.$.overview.className = 'panel-content';
  this.$.overview.innerHTML = `
    <div class="overview-grid">
      ${cards.map((card) => `
        <div class="overview-card">
          <div class="overview-label">${escapeHtml(card.label)}</div>
          <div class="overview-value">${escapeHtml(card.value)}</div>
          <div class="overview-note">${escapeHtml(card.note)}</div>
        </div>
      `).join('')}
    </div>
    <div class="distribution">
      ${distribution}
    </div>
    ${renderExportOverview.call(this)}
  `;
}

function renderTypeResults() {
  const rows = this.state.typeRows;
  if (!rows.length) {
    this.$.typeResults.className = 'panel-content empty';
    this.$.typeResults.textContent = 'No type groups found.';
    return;
  }

  this.$.typeResults.className = 'panel-content';
  this.$.typeResults.innerHTML = `
    <table class="result-table compact">
      <thead>
        <tr>
          <th>Type</th>
          <th>MB</th>
          <th>Files</th>
          <th>Sample</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((entry, index) => `
          <tr class="result-row ${isSelected(this, 'type', index) ? 'selected' : ''}" data-kind="type" data-index="${index}">
            <td>${escapeHtml(entry.label)}</td>
            <td class="size-cell">${entry.sizeMB}</td>
            <td>${entry.files}</td>
            <td class="build-file">${escapeHtml(entry.examples[0] || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wireSelectionRows.call(this, this.$.typeResults);
}

function renderAssetResults() {
  const rows = getFilteredAssetRows(this);
  if (!rows.length) {
    this.$.assetResults.className = 'panel-content empty';
    this.$.assetResults.textContent = 'No built assets found for this filter.';
    updateAudioBatchStatus.call(this);
    return;
  }

  const tickableRows = rows.filter(isTickableAudio);
  const allTickable = tickableRows.length > 0;
  const allTicked = allTickable
    && tickableRows.every((entry) => this.state.tickedAudio.has(entry.relativePath));

  this.$.assetResults.className = 'panel-content';
  this.$.assetResults.innerHTML = `
    <table class="result-table">
      <thead>
        <tr>
          <th class="tick-cell"><input type="checkbox" id="tick-all-audio" title="Tick every optimizable audio file in this view"${allTickable && allTicked ? ' checked' : ''}${allTickable ? '' : ' disabled'}></th>
          <th>#</th>
          <th>Built File</th>
          <th>Type</th>
          <th>KB</th>
          <th>Source Asset</th>
          <th>Included By</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((entry, index) => `
          <tr class="result-row ${isSelected(this, 'asset', index) ? 'selected' : ''}" data-kind="asset" data-index="${index}">
            <td class="tick-cell">${isTickableAudio(entry)
              ? `<input type="checkbox" class="row-tick" data-relative-path="${escapeHtml(entry.relativePath)}"${this.state.tickedAudio.has(entry.relativePath) ? ' checked' : ''}>`
              : ''}</td>
            <td>${index + 1}</td>
            <td class="build-file">${escapeHtml(entry.relativePath)}</td>
            <td>${escapeHtml(typeLabel(entry.category))}</td>
            <td class="size-cell">${entry.sizeKB}</td>
            <td class="build-file">${escapeHtml(formatAssetSourceLabel(entry, this.state.assetFilter))}</td>
            <td class="dependency-cell" title="${escapeHtml((entry.includedBy || []).join('\n'))}">${escapeHtml(entry.includedBy && entry.includedBy[0] || 'No prefab chain')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wireSelectionRows.call(this, this.$.assetResults);
  wireAudioTickBoxes.call(this, this.$.assetResults);
  updateAudioBatchStatus.call(this);
}

// Only .mp3/.ogg audio can go through the safe direct optimizer, so those are
// the rows that get a tick box.
function isTickableAudio(entry) {
  return Boolean(entry && entry.category === 'audio' && entry.canOptimizeDirectly);
}

function getTickableAudioRows(panel) {
  return getFilteredAssetRows(panel).filter(isTickableAudio);
}

function setAllVisibleAudioTicked(ticked) {
  for (const entry of getTickableAudioRows(this)) {
    if (ticked) {
      this.state.tickedAudio.add(entry.relativePath);
    } else {
      this.state.tickedAudio.delete(entry.relativePath);
    }
  }
  renderAssetResults.call(this);
  updateAudioBatchStatus.call(this);
}

function wireAudioTickBoxes(root) {
  const tickAll = root.querySelector('#tick-all-audio');
  if (tickAll) {
    tickAll.addEventListener('click', (event) => event.stopPropagation());
    tickAll.addEventListener('change', (event) => {
      setAllVisibleAudioTicked.call(this, event.target.checked);
    });
  }

  for (const box of root.querySelectorAll('.row-tick')) {
    // Stop the row click handler from stealing the tick and re-rendering.
    box.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('change', (event) => {
      const relativePath = box.dataset.relativePath;
      if (event.target.checked) {
        this.state.tickedAudio.add(relativePath);
      } else {
        this.state.tickedAudio.delete(relativePath);
      }
      const tickAllBox = root.querySelector('#tick-all-audio');
      if (tickAllBox && !tickAllBox.disabled) {
        const tickable = getTickableAudioRows(this);
        tickAllBox.checked = tickable.length > 0
          && tickable.every((entry) => this.state.tickedAudio.has(entry.relativePath));
      }
      updateAudioBatchStatus.call(this);
    });
  }
}

function getTickedAudioRows(panel) {
  return panel.state.assetRows.filter(
    (entry) => isTickableAudio(entry) && panel.state.tickedAudio.has(entry.relativePath)
  );
}

function updateAudioBatchStatus() {
  const tickedCount = getTickedAudioRows(this).length;
  const tickedKB = round(
    getTickedAudioRows(this).reduce((sum, entry) => sum + Number(entry.size || 0), 0) / 1024
  );

  if (this.$.batchAudioStatus) {
    this.$.batchAudioStatus.textContent = tickedCount
      ? `${tickedCount} ticked (${tickedKB} KB)`
      : 'No audio ticked';
  }

  for (const button of [this.$.batchApplyAudioBtn, this.$.batchResetAudioBtn]) {
    if (button) {
      button.disabled = tickedCount === 0;
    }
  }
}

function renderImportResults() {
  const rows = this.state.importRows;
  if (!rows.length) {
    this.$.importResults.className = 'panel-content empty';
    this.$.importResults.textContent = 'No heavy import files found.';
    return;
  }

  this.$.importResults.className = 'panel-content';
  this.$.importResults.innerHTML = `
    <table class="result-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Import File</th>
          <th>KB</th>
          <th>Top Sources</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((entry, index) => `
          <tr class="result-row ${isSelected(this, 'import', index) ? 'selected' : ''}" data-kind="import" data-index="${index}">
            <td>${index + 1}</td>
            <td class="build-file">${escapeHtml(entry.relativeBuildPath)}</td>
            <td class="size-cell">${entry.sizeKB}</td>
            <td><div class="source-list">${renderSourceChips(entry.sources.slice(0, 3))}</div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wireSelectionRows.call(this, this.$.importResults);
}

function renderDetail() {
  const selection = getSelectedEntry(this);
  if (!selection) {
    this.$.detail.className = 'detail empty';
    this.$.detail.textContent = 'Run a scan and pick a row to inspect.';
    return;
  }

  if (selection.kind === 'type') {
    renderTypeDetail.call(this, selection.entry);
    return;
  }

  if (selection.kind === 'asset') {
    renderAssetDetail.call(this, selection.entry);
    return;
  }

  renderImportDetail.call(this, selection.entry);
}

function renderTypeDetail(entry) {
  this.$.detail.className = 'detail';
  this.$.detail.innerHTML = `
    <div class="detail-body">
      <div class="detail-block">
        <div class="detail-title">Type Group</div>
        <div class="detail-value">${escapeHtml(entry.label)}</div>
      </div>
      <div class="detail-block twin">
        <div>
          <div class="detail-title">Total Size</div>
          <div class="detail-value">${entry.sizeMB} MB</div>
        </div>
        <div>
          <div class="detail-title">Files</div>
          <div class="detail-value">${entry.files}</div>
        </div>
      </div>
      <div class="detail-block">
        <div class="detail-title">Sample Files</div>
        <ul class="detail-list">${entry.examples.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>
      </div>
    </div>
  `;
}

function renderAssetDetail(entry) {
  const previewState = this.state.previewByAsset.get(entry.relativePath) || null;
  const textureMetaHtml = renderTextureMeta(entry);
  const prefabCount = Array.isArray(entry.prefabSources) ? entry.prefabSources.length : 0;
  const modelCount = Array.isArray(entry.modelSources) ? entry.modelSources.length : 0;
  const displaySource = getAssetDisplaySource(entry, this.state.assetFilter);
  const packedMetaHtml = [
    prefabCount > 0 ? `${prefabCount} prefab${prefabCount > 1 ? 's' : ''} in pack` : '',
    modelCount > 0 ? `${modelCount} model${modelCount > 1 ? 's' : ''} in pack` : '',
  ].filter(Boolean).map((label) => `<span>${escapeHtml(label)}</span>`).join('');

  this.$.detail.className = 'detail';
  this.$.detail.innerHTML = `
    <div class="detail-body">
      <div class="detail-block asset-preview-block">
        <div class="detail-title">Asset Preview</div>
        <div id="detail-asset-preview" class="asset-preview-stage" data-preview-path="${escapeHtml(entry.relativePath)}">
          <div class="detail-note">Loading built asset preview...</div>
        </div>
      </div>
      ${renderAssetOptimizeBox.call(this, entry, previewState)}
      <div class="built-file-compact">
        <div class="detail-title">Built File</div>
        <div class="built-file-path" title="${escapeHtml(entry.relativePath)}">${escapeHtml(entry.relativePath)}</div>
        <div class="built-file-chips">
          <span>${escapeHtml(formatBytes(entry.size || 0))}</span>
          <span>${escapeHtml(typeLabel(entry.category))}</span>
          <span>${escapeHtml(entry.buildArea)}</span>
          ${packedMetaHtml}
          ${textureMetaHtml}
        </div>
        <div class="built-source-line">
          <span>Source</span>
          <span class="clickable-source" data-source-url="${escapeHtml(displaySource.url)}" data-source-uuid="${escapeHtml(displaySource.uuid)}">${escapeHtml(formatAssetSourceLabel(entry, this.state.assetFilter))}</span>
        </div>
        ${modelCount > 1 ? `
          <div class="built-source-line">
            <span>Models In Pack</span>
            <div class="dependency-chains">
              ${entry.modelSources.map((model) => `<span>${escapeHtml(shortAssetLabel(model.url))}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        <div class="built-source-line">
          <span>Included By</span>
          <div class="dependency-chains">
            ${(entry.includedBy && entry.includedBy.length)
              ? entry.includedBy.map((chain) => `<span>${escapeHtml(chain)}</span>`).join('')
              : '<span>No scene/prefab chain found</span>'}
          </div>
        </div>
      </div>
    </div>
  `;

  wireDetailReveal.call(this);
  wireAssetOptimizeControls.call(this, entry);
  void loadInitialAssetPreview.call(this, entry);
}

function renderImportDetail(entry) {
  const markerHtml = entry.markers.length
    ? entry.markers.map((marker) => `<span class="marker-chip">${escapeHtml(marker)}</span>`).join('')
    : '<span class="marker-chip">No markers</span>';

  const sourceHtml = entry.sources.length
    ? entry.sources.slice(0, 20).map((source) => {
        const reasons = source.reasons.join(', ');
        return `<li data-source-url="${escapeHtml(source.url)}" data-source-uuid="${escapeHtml(source.uuid || '')}"><strong>${escapeHtml(source.url)}</strong><br>score ${source.score}${reasons ? ` · ${escapeHtml(reasons)}` : ''}</li>`;
      }).join('')
    : '<li>No matched source assets.</li>';

  this.$.detail.className = 'detail';
  this.$.detail.innerHTML = `
    <div class="detail-body">
      <div class="detail-block">
        <div class="detail-title">Heavy Import File</div>
        <div class="detail-value">${escapeHtml(entry.relativeBuildPath)}</div>
      </div>
      <div class="detail-block twin">
        <div>
          <div class="detail-title">Size</div>
          <div class="detail-value">${entry.sizeKB} KB</div>
        </div>
        <div>
          <div class="detail-title">Top Matched Sources</div>
          <div class="detail-value">${entry.sources.length}</div>
        </div>
      </div>
      <div class="detail-block">
        <div class="detail-title">Markers</div>
        <div class="markers">${markerHtml}</div>
      </div>
      <div class="detail-block">
        <div class="detail-title">Matched Source Assets</div>
        <ul class="detail-list">${sourceHtml}</ul>
      </div>
    </div>
  `;

  wireImportSourceReveal.call(this);
}

function wireSelectionRows(root) {
  for (const row of root.querySelectorAll('.result-row')) {
    row.addEventListener('click', () => {
      this.state.selectedKind = row.dataset.kind;
      this.state.selectedIndex = Number(row.dataset.index);
      if (row.dataset.kind === 'asset') {
        this.$.assetResults.focus({ preventScroll: true });
      }
      renderTypeResults.call(this);
      renderAssetResults.call(this);
      renderImportResults.call(this);
      renderDetail.call(this);
    });

    row.addEventListener('dblclick', () => {
      this.state.selectedKind = row.dataset.kind;
      this.state.selectedIndex = Number(row.dataset.index);
      renderTypeResults.call(this);
      renderAssetResults.call(this);
      renderImportResults.call(this);
      renderDetail.call(this);
      void revealSelectionAsset.call(this);
    });
  }
}

function getFilteredAssetRows(panel) {
  const filter = panel.state.assetFilter;
  if (filter === 'all') {
    return panel.state.assetRows;
  }

  return panel.state.assetRows.filter((entry) => {
    switch (filter) {
      case 'model-bin':
        return entry.category === 'model-bin'
          || entry.sourceCategory === 'model-source'
          || (Array.isArray(entry.modelSources) && entry.modelSources.length > 0);
      case 'prefab':
        return (Array.isArray(entry.prefabSources) && entry.prefabSources.length > 0)
          || entry.sourceCategory === 'prefab'
          || String(entry.source || '').toLowerCase().endsWith('.prefab');
      case 'engine-js':
        return entry.category === 'engine-js' || entry.category === 'game-js';
      case 'import-json':
        return entry.category === 'import-json' || entry.category === 'import-binary';
      default:
        return entry.category === filter;
    }
  });
}

function ensureValidAssetSelection() {
  if (this.state.selectedKind !== 'asset') {
    return;
  }

  const rows = getFilteredAssetRows(this);
  if (!rows.length) {
    this.state.selectedIndex = -1;
    return;
  }

  if (this.state.selectedIndex < 0 || this.state.selectedIndex >= rows.length) {
    this.state.selectedIndex = 0;
  }
}

async function revealSelectionAsset() {
  const selection = getSelectedEntry(this);
  if (!selection) {
    return;
  }

  let payload = null;
  if (selection.kind === 'asset' && (selection.entry.source || selection.entry.sourceUuid)) {
    const displaySource = getAssetDisplaySource(selection.entry, this.state.assetFilter);
    payload = {
      url: displaySource.url,
      uuid: displaySource.uuid,
    };
  }

  if (selection.kind === 'import' && selection.entry.sources && selection.entry.sources[0]) {
    payload = {
      url: selection.entry.sources[0].url || '',
      uuid: selection.entry.sources[0].uuid || '',
    };
  }

  if (!payload) {
    setStatus.call(this, 'No source asset mapped for this row.');
    return;
  }

  await revealAssetInEditor.call(this, payload);
}

function wireDetailReveal() {
  const source = this.$.detail.querySelector('.clickable-source');
  if (!source) {
    return;
  }

  source.addEventListener('dblclick', () => {
    const payload = {
      url: String(source.dataset.sourceUrl || '').trim(),
      uuid: String(source.dataset.sourceUuid || '').trim(),
    };
    void revealAssetInEditor.call(this, payload);
  });
}

function wireImportSourceReveal() {
  for (const item of this.$.detail.querySelectorAll('.detail-list li[data-source-url]')) {
    item.addEventListener('dblclick', () => {
      const payload = {
        url: String(item.dataset.sourceUrl || '').trim(),
        uuid: String(item.dataset.sourceUuid || '').trim(),
      };
      void revealAssetInEditor.call(this, payload);
    });
  }
}

function renderAssetOptimizeBox(entry, previewState) {
  if (entry.category === 'audio') {
    if (!entry.canOptimizeDirectly) {
      return `
        <div class="detail-block optimize-box">
          <div class="detail-title">Direct Optimize</div>
          <div class="detail-note">Safe audio direct optimize currently supports .mp3 and .ogg. .wav is scan-only for now.</div>
        </div>
      `;
    }

    const resultHtml = renderOptimizeResult(previewState, entry);
    return `
      <div class="detail-block optimize-box">
        <div class="detail-title">Direct Optimize</div>
        <div class="detail-note">Every Apply starts from the original Build Root file and only writes into Output Root.</div>
        <div class="optimize-controls">
          <label class="inline-field optimize-inline-field">
            <span>Bitrate</span>
            <select id="detail-audio-bitrate">
              ${renderAudioBitrateOptions(96)}
            </select>
          </label>
          <button id="detail-apply-optimize" class="action-button">Apply To Output Copy</button>
          <button id="detail-reset-optimize" class="action-button reset-button">Reset Asset</button>
        </div>
        <div id="detail-optimize-result">${resultHtml}</div>
      </div>
    `;
  }

  if (entry.category !== 'texture') {
    return '';
  }

  if (!entry.canOptimizeDirectly) {
    return `
      <div class="detail-block optimize-box">
        <div class="detail-title">Direct Optimize</div>
        <div class="detail-note">Safe direct optimize currently supports .png, .jpg, .jpeg, and .bmp build textures.</div>
      </div>
    `;
  }

  const resultHtml = renderOptimizeResult(previewState, entry);
  const extension = String(entry.extension || '').toLowerCase();
  const qualityControl = extension === '.png'
    ? `
      <label class="inline-field optimize-inline-field">
        <span>PNG Quality</span>
        <select id="detail-png-quality">
          <option value="80-95">High 80-95</option>
          <option value="65-85" selected>Balanced 65-85 ⭐</option>
          <option value="50-75">Medium 50-75</option>
          <option value="45-70">Aggressive 45-70</option>
          <option value="30-50">Ultra Small 30-50</option>
        </select>
      </label>
    `
    : extension === '.jpg' || extension === '.jpeg'
      ? `
        <label class="inline-field optimize-inline-field">
          <span>JPG Q</span>
          <input id="detail-jpeg-quality" type="number" min="30" max="95" value="${SAFE_BULK_JPEG_QUALITY}">
        </label>
      `
      : '';

  const batchPngButton = extension === '.png'
    ? `<button id="detail-apply-all-pngs" class="action-button batch-apply-btn" title="Optimize ALL PNGs in project using this quality">⚡ Apply To All PNGs</button>`
    : '';

  return `
    <div class="detail-block optimize-box">
      <div class="detail-title">Direct Optimize</div>
        <div class="detail-note">Every Apply starts from the original Build Root file. Keeps filename, format, dimensions, and alpha; only a smaller result replaces the Output Root copy.</div>
      <div class="optimize-controls">
        ${qualityControl}
        <button id="detail-apply-optimize" class="action-button">Apply To Output Copy</button>
        ${batchPngButton}
        <button id="detail-reset-optimize" class="action-button reset-button">Reset Asset</button>
      </div>
      <div id="detail-optimize-result">${resultHtml}</div>
    </div>
  `;
}

function renderTextureMeta(entry) {
  if (!entry.textureMeta) {
    return '';
  }

  const meta = entry.textureMeta;
  const labels = [];
  if (meta.width > 0 && meta.height > 0) {
    labels.push(`${meta.width} x ${meta.height}`);
  }
  if (typeof meta.hasAlpha === 'boolean') {
    labels.push(meta.hasAlpha ? 'alpha detected' : 'no alpha detected');
  }
  if (meta.formatLabel) {
    labels.push(meta.formatLabel);
  }

  return `<span>${escapeHtml(labels.join(' | ') || 'No texture metadata')}</span>`;
}

async function loadInitialAssetPreview(entry) {
  const previewPath = entry.relativePath;
  const extension = String(entry.extension || '').toLowerCase();
  const mimeType = getImageMimeType(extension);
  const previewKind = mimeType.startsWith('image/')
    ? 'image'
    : mimeType.startsWith('audio/')
      ? 'audio'
      : '';
  let stage = this.$.detail.querySelector('#detail-asset-preview');

  if (!stage || stage.dataset.previewPath !== previewPath) {
    return;
  }
  if (!previewKind) {
    stage.innerHTML = `<div class="asset-preview-unavailable">No visual preview for ${escapeHtml(extension || typeLabel(entry.category))}</div>`;
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(entry.fullPath);
    stage = this.$.detail.querySelector('#detail-asset-preview');
    if (!stage || stage.dataset.previewPath !== previewPath) {
      return;
    }

    if (previewKind === 'audio') {
      stage.innerHTML = `<audio class="asset-preview-audio" controls src="${escapeHtml(dataUrl)}"></audio>`;
      return;
    }

    stage.innerHTML = `<img class="asset-preview-image" src="${escapeHtml(dataUrl)}" alt="Built asset preview">`;
  } catch (error) {
    stage = this.$.detail.querySelector('#detail-asset-preview');
    if (stage && stage.dataset.previewPath === previewPath) {
      stage.innerHTML = `<div class="asset-preview-unavailable">${escapeHtml(error.message || 'Could not load preview.')}</div>`;
    }
  }
}

function renderOptimizeResult(previewState, entry) {
  if (!previewState) {
    return '<div class="detail-note">Apply to see the exact size reduction.</div>';
  }

  if (previewState.status === 'loading') {
    return `<div class="detail-note">${escapeHtml(previewState.message || 'Optimizing asset...')}</div>`;
  }

  if (previewState.status === 'error') {
    return `<div class="detail-note error">${escapeHtml(previewState.message || 'Optimization failed.')}</div>`;
  }

  const report = previewState.report || {};
  const beforeBytes = Number(report.beforeBytes || 0);
  const afterBytes = Number(report.afterBytes || 0);
  const deltaBytes = beforeBytes - afterBytes;
  const deltaPercent = beforeBytes > 0 ? round((deltaBytes / beforeBytes) * 100) : 0;
  const gainLabel = deltaBytes >= 0
    ? `Saved ${formatBytes(deltaBytes)} (${String(deltaPercent)}%)`
    : `Larger by ${formatBytes(Math.abs(deltaBytes))} (${String(Math.abs(deltaPercent))}%)`;
  const badge = report.optimized ? 'Applied to output copy' : 'Kept original (no gain)';

  if (entry && entry.category === 'audio') {
    return `
      <div class="preview-shell">
        <div class="preview-summary">
          <span class="preview-badge">${escapeHtml(badge)}</span>
          <span>${escapeHtml(formatBytes(beforeBytes))} -> ${escapeHtml(formatBytes(afterBytes))}</span>
          <span>${escapeHtml(gainLabel)}</span>
          <span>Bitrate ${escapeHtml(String(report.originalBitrateKbps || 0))}k -> ${escapeHtml(String(report.outputBitrateKbps || report.requestedAudioBitrateKbps || 0))}k</span>
          <span>${escapeHtml(String(report.channels || 0))} ch | ${escapeHtml(String(report.sampleRate || 0))} Hz</span>
          <span>${escapeHtml(String(report.durationSeconds || 0))} s | ${escapeHtml(String(report.codecName || 'audio'))}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="preview-shell">
        <div class="preview-summary">
          <span class="preview-badge">${escapeHtml(badge)}</span>
          <span>${escapeHtml(formatBytes(beforeBytes))} -> ${escapeHtml(formatBytes(afterBytes))}</span>
          <span>${escapeHtml(gainLabel)}</span>
        <span>${escapeHtml(String(report.originalWidth || 0))}x${escapeHtml(String(report.originalHeight || 0))}</span>
        <span>Format ${escapeHtml(String(report.outputFormat || report.extension || ''))}</span>
        ${report.pngQuality ? `<span>PNG quality ${escapeHtml(String(report.pngQuality))}</span>` : ''}
      </div>
    </div>
  `;
}

function wireAssetOptimizeControls(entry) {
  const applyButton = this.$.detail.querySelector('#detail-apply-optimize');
  const resetButton = this.$.detail.querySelector('#detail-reset-optimize');
  const audioBitrateInput = this.$.detail.querySelector('#detail-audio-bitrate');
  const qualityInput = this.$.detail.querySelector('#detail-jpeg-quality');
  const pngQualityInput = this.$.detail.querySelector('#detail-png-quality');

  const applyAllButton = this.$.detail.querySelector('#detail-apply-all-pngs');

  if (!applyButton && !resetButton && !applyAllButton) {
    return;
  }

  if (applyButton) {
    applyButton.addEventListener('click', () => {
      void runAssetOptimizeAction.call(this, entry, {
        jpegQuality: qualityInput ? clampInteger(Number(qualityInput.value), 30, 95, 82) : 82,
        pngQuality: pngQualityInput ? String(pngQualityInput.value || '65-85') : '65-85',
        audioBitrate: audioBitrateInput ? clampAudioBitrate(Number(audioBitrateInput.value)) : 96,
      });
    });
  }

  if (applyAllButton) {
    applyAllButton.addEventListener('click', () => {
      const q = pngQualityInput ? String(pngQualityInput.value || '65-85') : '65-85';
      void runBatchPngOptimizeAction.call(this, { pngQuality: q });
    });
  }

  if (resetButton) {
    resetButton.addEventListener('click', () => {
      void runAssetResetAction.call(this, entry);
    });
  }
}

function moveAssetSelection(direction) {
  const rows = getFilteredAssetRows(this);
  if (!rows.length) {
    return;
  }

  const currentIndex = this.state.selectedKind === 'asset'
    ? this.state.selectedIndex
    : (direction > 0 ? -1 : rows.length);
  this.state.selectedKind = 'asset';
  this.state.selectedIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + direction));
  renderAssetResults.call(this);
  renderDetail.call(this);

  const selectedRow = this.$.assetResults.querySelector('.result-row.selected');
  if (selectedRow) {
    selectedRow.scrollIntoView({ block: 'nearest' });
  }
}

async function runAssetOptimizeAction(entry, options) {
  if (!entry || !entry.canOptimizeDirectly) {
    setStatus.call(this, 'This asset does not support safe direct optimization yet.');
    return;
  }

  const jpegQuality = clampInteger(Number(options.jpegQuality), 30, 95, 82);
  const pngQuality = normalizePngQualityOption(options.pngQuality);
  const audioBitrate = clampAudioBitrate(Number(options.audioBitrate));
  const currentState = {
    status: 'loading',
    message: 'Optimizing selected asset into output copy...',
  };

  this.state.previewByAsset.set(entry.relativePath, currentState);
  renderDetail.call(this);
  setStatus.call(this, currentState.message);

  try {
    const sourceRootInput = String(this.$.buildRootInput.value || DEFAULT_BUILD_ROOT).trim() || DEFAULT_BUILD_ROOT;
    const outputRootInput = String(this.$.outputRootInput.value || DEFAULT_OUTPUT_ROOT).trim() || DEFAULT_OUTPUT_ROOT;
    const sourceRoot = path.resolve(Editor.Project.path, sourceRootInput);
    const outputRoot = path.resolve(Editor.Project.path, outputRootInput);
    const report = await Editor.Message.request('playable-size-inspector', 'optimize-selected-asset', {
      sourceRoot,
      outputRoot,
      relativePath: entry.relativePath,
      assetKind: entry.category,
      maxTextureSize: SAFE_BULK_MAX_TEXTURE_SIZE,
      jpegQuality,
      pngQuality,
      targetFormat: 'original',
      audioBitrate,
    });

    const previewState = {
      status: 'ready',
      report,
    };

    this.state.previewByAsset.set(entry.relativePath, previewState);

    applyOptimizedAssetToState.call(this, entry, report);
    void refreshOptimizedScanAvailability.call(this);
    setStatus.call(this, report.optimized
      ? `Optimized ${entry.relativePath} into output copy.`
      : `Kept original ${entry.relativePath}; no smaller safe result.`);
    this.$.recommendation.textContent = `Asset Preview now shows the output copy. Saved ${formatBytes(Math.max(0, Number(report.beforeBytes || 0) - Number(report.afterBytes || 0)))}.`;
  } catch (error) {
    console.error('[playable-size-inspector] asset optimize action failed:', error);
    this.state.previewByAsset.set(entry.relativePath, {
      status: 'error',
      message: error.message || String(error),
    });
    setStatus.call(this, error.message || String(error));
  }

  renderDetail.call(this);
}

async function runAssetResetAction(entry) {
  const sourceRootInput = String(this.$.buildRootInput.value || DEFAULT_BUILD_ROOT).trim() || DEFAULT_BUILD_ROOT;
  const outputRootInput = String(this.$.outputRootInput.value || DEFAULT_OUTPUT_ROOT).trim() || DEFAULT_OUTPUT_ROOT;
  const sourceRoot = path.resolve(Editor.Project.path, sourceRootInput);
  const outputRoot = path.resolve(Editor.Project.path, outputRootInput);

  setStatus.call(this, `Restoring ${entry.relativePath} from original build...`);
  try {
    const report = await Editor.Message.request('playable-size-inspector', 'reset-selected-asset', {
      sourceRoot,
      outputRoot,
      relativePath: entry.relativePath,
    });
    this.state.previewByAsset.delete(entry.relativePath);
    applyOptimizedAssetToState.call(this, entry, report);
    void refreshOptimizedScanAvailability.call(this);
    setStatus.call(this, `Reset ${entry.relativePath} to the original build asset.`);
    this.$.recommendation.textContent = 'Asset Preview now shows the restored original file in Output Root.';
} catch (error) {
    console.error('[playable-size-inspector] asset reset failed:', error);
    setStatus.call(this, error.message || String(error));
  }

  renderDetail.call(this);
}

async function runBatchAudioAction(mode) {
  if (this.state.scanning) {
    return;
  }

  const targets = getTickedAudioRows(this);
  if (!targets.length) {
    setStatus.call(this, 'Tick at least one audio file first.');
    return;
  }

  const isReset = mode === 'reset';
  const audioBitrate = Number((this.$.batchAudioBitrate && this.$.batchAudioBitrate.value) || 96);
  const sourceRootInput = String(this.$.buildRootInput.value || DEFAULT_BUILD_ROOT).trim() || DEFAULT_BUILD_ROOT;
  const outputRootInput = String(this.$.outputRootInput.value || DEFAULT_OUTPUT_ROOT).trim() || DEFAULT_OUTPUT_ROOT;
  const sourceRoot = path.resolve(Editor.Project.path, sourceRootInput);
  const outputRoot = path.resolve(Editor.Project.path, outputRootInput);
  const relativePaths = targets.map((entry) => entry.relativePath);

  this.state.scanning = true;
  const busyLabel = isReset
    ? `Resetting ${targets.length} audio files to original...`
    : `Optimizing ${targets.length} audio files at ${audioBitrate} kbps...`;
  if (this.$.batchAudioStatus) {
    this.$.batchAudioStatus.textContent = busyLabel;
  }
  setStatus.call(this, busyLabel);
  this.$.recommendation.textContent = busyLabel;

  try {
    const report = await Editor.Message.request(
      'playable-size-inspector',
      isReset ? 'reset-selected-audio' : 'optimize-selected-audio',
      { sourceRoot, outputRoot, relativePaths, audioBitrate }
    );

    if (Array.isArray(report.results)) {
      for (const res of report.results) {
        if (res.error) {
          continue;
        }

        const row = this.state.assetRows.find((item) => item.relativePath === res.relativePath);
        if (row && res.afterBytes) {
          row.fullPath = res.outputPath || row.fullPath;
          row.size = res.afterBytes;
          row.sizeKB = round(res.afterBytes / 1024);
          row.sizeMB = round(res.afterBytes / (1024 * 1024));
          row.relativeBuildRoot = res.relativePath;
        }

        this.state.previewByAsset.set(res.relativePath, {
          status: 'ready',
          report: res,
        });
      }
      recalculateAllMetricsFromAssetRows.call(this);
    }

    if (this.$.scanSourceSelect) {
      this.$.scanSourceSelect.value = 'optimized';
    }
    this.state.scanSourceLabel = 'Optimized Copy';
    await refreshOptimizedScanAvailability.call(this);

    const savedKB = round(Number(report.savedBytes || 0) / 1024);
    const failedNote = report.failedCount ? ` ${report.failedCount} failed.` : '';
    const msg = isReset
      ? `Reset ${report.totalFiles - report.failedCount}/${report.totalFiles} audio files to original.${failedNote}`
      : `Optimized ${report.optimizedCount}/${report.totalFiles} audio files, saved ${savedKB} KB at ${audioBitrate} kbps.${failedNote}`;

    renderSummaryFromState.call(this);
    renderOverviewFromState.call(this);
    renderTypeResults.call(this);
    renderAssetResults.call(this);
    renderDetail.call(this);

    setStatus.call(this, msg);
    this.$.recommendation.textContent = `${msg} Output copy is active.`;
    // Set last: renderAssetResults resets this line to the ticked-count readout.
    if (this.$.batchAudioStatus) {
      this.$.batchAudioStatus.textContent = isReset
        ? `Reset ${report.totalFiles - report.failedCount}/${report.totalFiles}`
        : `Saved ${savedKB} KB (${report.optimizedCount}/${report.totalFiles})`;
    }
  } catch (error) {
    console.error(`[playable-size-inspector] batch audio ${mode} failed:`, error);
    if (this.$.batchAudioStatus) {
      this.$.batchAudioStatus.textContent = `Batch audio ${mode} failed`;
    }
    setStatus.call(this, error.message || String(error));
    this.$.recommendation.textContent = error.message || String(error);
  } finally {
    this.state.scanning = false;
  }
}

async function runBatchPngOptimizeAction(options = {}) {
  if (this.state.scanning) {
    return;
  }

  const pngQuality = normalizePngQualityOption(options.pngQuality || (this.$.batchPngQuality && this.$.batchPngQuality.value) || '65-85');
  const sourceRootInput = String(this.$.buildRootInput.value || DEFAULT_BUILD_ROOT).trim() || DEFAULT_BUILD_ROOT;
  const outputRootInput = String(this.$.outputRootInput.value || DEFAULT_OUTPUT_ROOT).trim() || DEFAULT_OUTPUT_ROOT;
  const sourceRoot = path.resolve(Editor.Project.path, sourceRootInput);
  const outputRoot = path.resolve(Editor.Project.path, outputRootInput);

  this.state.scanning = true;
  const batchStatus = this.$.batchStatus || (this.shadowRoot && this.shadowRoot.querySelector('#batch-status'));
  if (batchStatus) {
    batchStatus.textContent = `Optimizing all PNGs (Quality: ${pngQuality})...`;
  }
  setStatus.call(this, `Optimizing all PNG files with quality ${pngQuality}...`);
  this.$.recommendation.textContent = `Batch PNG optimization in progress with quality ${pngQuality}...`;

  try {
    const report = await Editor.Message.request('playable-size-inspector', 'optimize-all-pngs', {
      sourceRoot,
      outputRoot,
      pngQuality,
    });

    if (Array.isArray(report.results)) {
      for (const res of report.results) {
        const row = this.state.assetRows.find((item) => item.relativePath === res.relativePath);
        if (row && res.afterBytes) {
          row.fullPath = res.outputPath || row.fullPath;
          row.size = res.afterBytes;
          row.sizeKB = round(res.afterBytes / 1024);
          row.sizeMB = round(res.afterBytes / (1024 * 1024));
          row.relativeBuildRoot = res.relativePath;
        }

        if (res.optimized) {
          this.state.previewByAsset.set(res.relativePath, {
            status: 'ready',
            report: res,
          });
        }
      }
      recalculateAllMetricsFromAssetRows.call(this);
    }

    if (this.$.scanSourceSelect) {
      this.$.scanSourceSelect.value = 'optimized';
    }
    this.state.scanSourceLabel = 'Optimized Copy';
    await refreshOptimizedScanAvailability.call(this);

    const savedKB = round(Number(report.savedBytes || 0) / 1024);
    const msg = `Batch optimize complete! ${report.optimizedCount}/${report.totalPngs} PNGs optimized, saved ${savedKB} KB (Quality: ${pngQuality}).`;
    if (batchStatus) {
      batchStatus.textContent = `Saved ${savedKB} KB (${report.optimizedCount}/${report.totalPngs} PNGs)`;
    }
    setStatus.call(this, msg);
    this.$.recommendation.textContent = `${msg} Output copy is active.`;

    renderSummaryFromState.call(this);
    renderOverviewFromState.call(this);
    renderTypeResults.call(this);
    renderAssetResults.call(this);
    renderDetail.call(this);
  } catch (error) {
    console.error('[playable-size-inspector] batch PNG optimize failed:', error);
    if (batchStatus) {
      batchStatus.textContent = 'Batch optimize failed';
    }
    setStatus.call(this, error.message || String(error));
    this.$.recommendation.textContent = error.message || String(error);
  } finally {
    this.state.scanning = false;
  }
}

async function runBatchPngResetAction() {
  if (this.state.scanning) {
    return;
  }

  const sourceRootInput = String(this.$.buildRootInput.value || DEFAULT_BUILD_ROOT).trim() || DEFAULT_BUILD_ROOT;
  const outputRootInput = String(this.$.outputRootInput.value || DEFAULT_OUTPUT_ROOT).trim() || DEFAULT_OUTPUT_ROOT;
  const sourceRoot = path.resolve(Editor.Project.path, sourceRootInput);
  const outputRoot = path.resolve(Editor.Project.path, outputRootInput);

  this.state.scanning = true;
  const batchStatus = this.$.batchStatus || (this.shadowRoot && this.shadowRoot.querySelector('#batch-status'));
  if (batchStatus) {
    batchStatus.textContent = 'Resetting all PNGs to original...';
  }
  setStatus.call(this, 'Restoring all PNGs from original build...');

  try {
    const report = await Editor.Message.request('playable-size-inspector', 'reset-all-pngs', {
      sourceRoot,
      outputRoot,
    });

    if (Array.isArray(report.results)) {
      for (const res of report.results) {
        const row = this.state.assetRows.find((item) => item.relativePath === res.relativePath);
        if (row && res.afterBytes) {
          row.size = res.afterBytes;
          row.sizeKB = round(res.afterBytes / 1024);
          row.sizeMB = round(res.afterBytes / (1024 * 1024));
        }
        this.state.previewByAsset.delete(res.relativePath);
      }
      recalculateAllMetricsFromAssetRows.call(this);
    }

    if (batchStatus) {
      batchStatus.textContent = 'All PNGs reset to original.';
    }
    setStatus.call(this, `Reset ${report.totalPngs} PNGs to original.`);
    this.$.recommendation.textContent = 'All PNGs restored from original build in Output Root.';

    renderSummaryFromState.call(this);
    renderOverviewFromState.call(this);
    renderTypeResults.call(this);
    renderAssetResults.call(this);
    renderDetail.call(this);
  } catch (error) {
    console.error('[playable-size-inspector] batch PNG reset failed:', error);
    if (batchStatus) {
      batchStatus.textContent = 'Reset failed';
    }
    setStatus.call(this, error.message || String(error));
  } finally {
    this.state.scanning = false;
  }
}

function recalculateAllMetricsFromAssetRows() {
  this.state.totalBuildBytes = this.state.assetRows.reduce((sum, item) => sum + Number(item.size || 0), 0);
  for (const typeRow of this.state.typeRows) {
    const matching = this.state.assetRows.filter((item) => item.category === typeRow.category);
    const typeSize = matching.reduce((sum, item) => sum + Number(item.size || 0), 0);
    typeRow.size = typeSize;
    typeRow.sizeKB = round(typeSize / 1024);
    typeRow.sizeMB = round(typeSize / (1024 * 1024));
  }
  this.state.assetRows.sort((left, right) => right.size - left.size);
  this.state.typeRows.sort((left, right) => right.size - left.size);
}

async function readFileAsDataUrl(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = getImageMimeType(extension);
  if (!mimeType) {
    return '';
  }

  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function getImageMimeType(extension) {
  switch (extension) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.bmp':
      return 'image/bmp';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
      return 'audio/ogg';
    case '.wav':
      return 'audio/wav';
    default:
      return '';
  }
}

function renderAudioBitrateOptions(selectedValue) {
  return [128, 96, 64, 48, 32, 24].map((value) => {
    const selected = value === selectedValue ? ' selected' : '';
    return `<option value="${value}"${selected}>${value} kbps</option>`;
  }).join('');
}

function normalizePngQualityOption(value) {
  const quality = String(value || '65-85');
  return ['80-95', '65-85', '50-75', '45-70', '30-50'].includes(quality) || /^\d{1,3}-\d{1,3}$/.test(quality) ? quality : '65-85';
}

async function readTextureMeta(filePath, extension) {
  if (!['.png', '.jpg', '.jpeg', '.bmp'].includes(extension)) {
    return null;
  }

  try {
    const buffer = await fs.readFile(filePath);
    switch (extension) {
      case '.png':
        return readPngMeta(buffer);
      case '.jpg':
      case '.jpeg':
        return readJpegMeta(buffer);
      case '.bmp':
        return readBmpMeta(buffer);
      default:
        return null;
    }
  } catch (_error) {
    return null;
  }
}

function readPngMeta(buffer) {
  if (!buffer || buffer.length < 26) {
    return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer.readUInt8(25);
  const hasAlpha = colorType === 4 || colorType === 6;

  return {
    width,
    height,
    hasAlpha,
    formatLabel: `PNG color type ${colorType}`,
  };
}

function readJpegMeta(buffer) {
  if (!buffer || buffer.length < 4 || buffer.readUInt16BE(0) !== 0xFFD8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xFF) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xC0 && marker <= 0xC3 && offset + 8 < buffer.length) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
        hasAlpha: false,
        formatLabel: 'JPEG baseline',
      };
    }

    if (length <= 0) {
      break;
    }
    offset += 2 + length;
  }

  return null;
}

function readBmpMeta(buffer) {
  if (!buffer || buffer.length < 30 || buffer.toString('ascii', 0, 2) !== 'BM') {
    return null;
  }

  const width = Math.abs(buffer.readInt32LE(18));
  const height = Math.abs(buffer.readInt32LE(22));
  const bitsPerPixel = buffer.readUInt16LE(28);

  return {
    width,
    height,
    hasAlpha: bitsPerPixel === 32,
    formatLabel: `BMP ${bitsPerPixel} bpp`,
  };
}

function clampAudioBitrate(value) {
  const numeric = Number(value);
  if ([128, 96, 64, 48, 32, 24].includes(numeric)) {
    return numeric;
  }
  if (numeric >= 112) {
    return 128;
  }
  if (numeric >= 80) {
    return 96;
  }
  if (numeric >= 56) {
    return 64;
  }
  if (numeric >= 40) {
    return 48;
  }
  if (numeric >= 28) {
    return 32;
  }
  return 24;
}

async function revealAssetInEditor(payload) {
  if (!payload || (!payload.url && !payload.uuid)) {
    setStatus.call(this, 'No source asset mapped for this row.');
    return;
  }

  try {
    const result = await Editor.Message.request('playable-size-inspector', 'reveal-asset', payload);
    if (result && result.ok) {
      setStatus.call(this, `Highlighted asset ${payload.url || payload.uuid}`);
      return;
    }
  } catch (error) {
    console.warn('[playable-size-inspector] reveal-asset failed:', error);
  }

  setStatus.call(this, 'Could not highlight asset in Editor.');
}

function getSelectedEntry(panel) {
  if (panel.state.selectedIndex < 0) {
    return null;
  }

  if (panel.state.selectedKind === 'type') {
    return { kind: 'type', entry: panel.state.typeRows[panel.state.selectedIndex] };
  }
  if (panel.state.selectedKind === 'asset') {
    return { kind: 'asset', entry: getFilteredAssetRows(panel)[panel.state.selectedIndex] };
  }
  if (panel.state.selectedKind === 'import') {
    return { kind: 'import', entry: panel.state.importRows[panel.state.selectedIndex] };
  }

  return null;
}

function isSelected(panel, kind, index) {
  return panel.state.selectedKind === kind && panel.state.selectedIndex === index;
}

function setStatus(message) {
  this.$.status.textContent = message;
}

function applyOptimizedAssetToState(entry, report) {
  const row = this.state.assetRows.find((item) => item.relativePath === entry.relativePath);
  const currentBytes = Number(row && row.size || entry.size || report.beforeBytes || 0);
  const afterBytes = Number(report.afterBytes || currentBytes);
  const deltaBytes = afterBytes - currentBytes;
  if (row) {
    row.fullPath = report.outputPath || row.fullPath;
    row.size = afterBytes;
    row.sizeKB = round(afterBytes / 1024);
    row.sizeMB = round(afterBytes / (1024 * 1024));
    row.relativeBuildRoot = entry.relativePath;
  }

  const typeRow = this.state.typeRows.find((item) => item.category === entry.category);
  if (typeRow) {
    typeRow.size = Math.max(0, Number(typeRow.size || 0) + deltaBytes);
    typeRow.sizeKB = round(typeRow.size / 1024);
    typeRow.sizeMB = round(typeRow.size / (1024 * 1024));
  }

  this.state.totalBuildBytes = Math.max(0, Number(this.state.totalBuildBytes || 0) + deltaBytes);
  this.state.assetRows.sort((left, right) => right.size - left.size);
  this.state.typeRows.sort((left, right) => right.size - left.size);
  selectAssetByRelativePath.call(this, entry.relativePath);
  renderSummaryFromState.call(this);
  renderOverviewFromState.call(this);
  renderTypeResults.call(this);
  renderAssetResults.call(this);
}

function selectAssetByRelativePath(relativePath) {
  const rows = getFilteredAssetRows(this);
  const index = rows.findIndex((item) => item.relativePath === relativePath);
  this.state.selectedKind = 'asset';
  this.state.selectedIndex = index >= 0 ? index : Math.min(this.state.selectedIndex, rows.length - 1);
}

function renderSummaryFromState() {
  const heavyType = this.state.typeRows[0];
  const heavyImport = this.state.importRows[0];
  const parts = [];

  this.$.summary.textContent = `${this.state.scanSourceLabel}: ${this.state.assetRows.length} build files, ${round(this.state.totalBuildBytes / (1024 * 1024))} MB total`;

  if (heavyType) {
    parts.push(`Largest type: ${heavyType.label} (${heavyType.sizeMB} MB)`);
  }
  if (heavyImport) {
    parts.push(`Heaviest import json: ${heavyImport.relativeBuildPath} (${heavyImport.sizeKB} KB)`);
  }

  this.$.recommendation.textContent = parts.join(' | ') || 'No build files found.';
}

function renderOverviewFromState() {
  const totalSize = Number(this.state.totalBuildBytes || 0);
  const topThree = this.state.typeRows.slice(0, 3);
  const cards = [
    {
      label: 'Total Build',
      value: `${round(totalSize / (1024 * 1024))} MB`,
      note: `${this.state.assetRows.length} build files loaded`,
    },
    {
      label: 'Largest Type',
      value: topThree[0] ? topThree[0].label : 'N/A',
      note: topThree[0] ? `${topThree[0].sizeMB} MB` : 'No data',
    },
    {
      label: 'Top 3 Share',
      value: `${round(topThree.reduce((sum, row) => sum + row.size, 0) / (1024 * 1024))} MB`,
      note: topThree.length ? topThree.map((row) => row.label).join(', ') : 'No data',
    },
  ];

  const distribution = this.state.typeRows.slice(0, 8).map((row) => {
    const percentage = totalSize > 0 ? round((row.size / totalSize) * 100) : 0;
    return `
      <div class="dist-row">
        <div class="dist-meta">
          <span class="dist-label">${escapeHtml(row.label)}</span>
          <span class="dist-size">${row.sizeMB} MB</span>
        </div>
        <div class="dist-bar-track">
          <div class="dist-bar-fill" style="width:${Math.max(4, percentage)}%"></div>
        </div>
        <div class="dist-foot">${percentage}% · ${row.files} files</div>
      </div>
    `;
  }).join('');

  this.$.overview.className = 'panel-content';
  this.$.overview.innerHTML = `
    <div class="overview-grid">
      ${cards.map((card) => `
        <div class="overview-card">
          <div class="overview-label">${escapeHtml(card.label)}</div>
          <div class="overview-value">${escapeHtml(card.value)}</div>
          <div class="overview-note">${escapeHtml(card.note)}</div>
        </div>
      `).join('')}
    </div>
    <div class="distribution">${distribution}</div>
    ${renderExportOverview.call(this)}
  `;
}

function renderExportOverview() {
  const metrics = this.state.exportMetrics;
  const optimized = metrics && metrics.optimized ? metrics.optimized : null;
  if (!optimized || !optimized.packageCount) {
    return '';
  }

  const largest = optimized.largestPackage || null;
  const rows = (Array.isArray(optimized.packages) ? optimized.packages : [])
    .slice(0, 8)
    .map((item) => `
      <div class="dist-row">
        <div class="dist-meta">
          <span class="dist-label">${escapeHtml(item.network || 'root')}</span>
          <span class="dist-size">${escapeHtml(formatBytes(item.bytes || 0))}</span>
        </div>
        <div class="dist-foot">${escapeHtml(item.kind === 'folder' ? `${item.fileCount || 0} files` : 'single HTML')} | ${escapeHtml(item.relativePath || '')}</div>
      </div>
    `)
    .join('');

  return `
    <div class="export-overview">
      <div class="panel-head export-head">Latest Network Outputs</div>
      <div class="overview-grid export-grid">
        <div class="overview-card">
          <div class="overview-label">Networks</div>
          <div class="overview-value">${escapeHtml(String(optimized.packageCount || 0))}</div>
          <div class="overview-note">One latest output per network</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">Stored Output</div>
          <div class="overview-value">${escapeHtml(formatBytes(optimized.totalExportBytes || 0))}</div>
          <div class="overview-note">All network deliverables</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">Largest Package</div>
          <div class="overview-value">${escapeHtml(formatBytes(largest ? largest.bytes : 0))}</div>
          <div class="overview-note">${escapeHtml(largest ? largest.relativePath : 'No data')}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">Intermediate</div>
          <div class="overview-value">Removed</div>
          <div class="overview-note">No baseline duplicate or single-file template</div>
        </div>
      </div>
      <div class="distribution">${rows}</div>
    </div>
  `;
}

function isDirectAssetOptimizationSupported(file) {
  if (file.category === 'texture') {
    return ['.png', '.jpg', '.jpeg', '.bmp'].includes(file.extension);
  }
  if (file.category === 'audio') {
    return ['.mp3', '.ogg'].includes(file.extension);
  }
  return false;
}

function findBestSourceMatch(file, assetEntries) {
  const baseName = file.name;
  const stem = baseName.replace(file.extension, '');
  const compactStem = compactUuidString(stem.split('@')[0]);
  const normalizedPath = normalizeAssetToken(file.relativePath);

  let best = null;
  let bestScore = -1;
  for (const entry of assetEntries) {
    let score = 0;

    if (compactStem && entry.compactUuid === compactStem) {
      score += 10;
    }

    if (stem && entry.uuid.toLowerCase() === stem.toLowerCase()) {
      score += 8;
    }

    if (entry.leafToken && normalizedPath.includes(entry.leafToken)) {
      score += 4;
    }

    if (entry.normalizedUrl && normalizedPath.includes(entry.normalizedUrl)) {
      score += 6;
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore > 0 ? best : null;
}

function analyzeImportFile({ projectRoot, buildRoot, file, text, assetEntries }) {
  const scores = new Map();
  const matchedBy = new Map();
  const strings = collectStringMatches(text);
  const lowerText = text.toLowerCase();

  for (const entry of assetEntries) {
    let score = 0;
    const reasons = [];

    if (entry.leafToken && lowerText.includes(entry.leafToken)) {
      score += 5;
      reasons.push('leaf');
    }

    if (entry.normalizedUrl && lowerText.includes(entry.normalizedUrl)) {
      score += 8;
      reasons.push('path');
    }

    if (entry.compactUuid && lowerText.includes(entry.compactUuid)) {
      score += 4;
      reasons.push('uuid');
    }

    for (const value of strings) {
      const normalized = normalizeAssetToken(value);
      if (!normalized) {
        continue;
      }

      if (entry.tokens.includes(normalized)) {
        score += 4;
        reasons.push('string');
        continue;
      }

      for (const token of entry.tokens) {
        if (!token) {
          continue;
        }
        if (normalized.endsWith(token) || token.endsWith(normalized)) {
          score += 2;
          reasons.push('partial');
          break;
        }
      }
    }

    if (score > 0) {
      scores.set(entry.url, score + extensionBonus(entry.extension));
      matchedBy.set(entry.url, Array.from(new Set(reasons)));
    }
  }

  const sources = assetEntries
    .filter((entry) => scores.has(entry.url))
    .map((entry) => ({
      url: entry.url,
      uuid: entry.uuid,
      score: scores.get(entry.url),
      reasons: matchedBy.get(entry.url) || [],
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.url.localeCompare(right.url);
    });

  const markers = strings
    .filter((value) => isInterestingMarker(value))
    .slice(0, 12);

  return {
    relativePath: toRelative(projectRoot, file.fullPath),
    relativeBuildPath: toRelative(buildRoot, file.fullPath),
    sizeKB: round(file.size / 1024),
    markers,
    sources,
  };
}

function collectStringMatches(text) {
  const matches = text.match(/"([^"\\]|\\.)*"/g) || [];
  return Array.from(new Set(matches
    .map((value) => value.slice(1, -1))
    .filter((value) => value.length >= 3)));
}

function categorizeBuildFile(relativePath, extension) {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();

  if (normalized.includes('/native/')) {
    return {
      category: categorizeNativeExtension(extension),
      groupLabel: 'native',
      isNative: true,
      isImport: false,
    };
  }

  if (normalized.includes('/import/')) {
    return {
      category: extension === '.cconb' ? 'import-binary' : 'import-json',
      groupLabel: 'import',
      isNative: false,
      isImport: true,
    };
  }

  if (normalized.endsWith('/config.json') || normalized.endsWith('/settings.json')) {
    return {
      category: 'config',
      groupLabel: 'config',
      isNative: false,
      isImport: false,
    };
  }

  if (extension === '.js') {
    return {
      category: normalized.includes('cocos-js/') ? 'engine-js' : 'game-js',
      groupLabel: 'script',
      isNative: false,
      isImport: false,
    };
  }

  if (extension === '.json') {
    return {
      category: 'json',
      groupLabel: 'json',
      isNative: false,
      isImport: false,
    };
  }

  if (extension === '.html') {
    return { category: 'html', groupLabel: 'html', isNative: false, isImport: false };
  }

  if (extension === '.css') {
    return { category: 'css', groupLabel: 'css', isNative: false, isImport: false };
  }

  return {
    category: extension ? extension.slice(1) : 'other',
    groupLabel: 'other',
    isNative: false,
    isImport: false,
  };
}

function categorizeNativeExtension(extension) {
  switch (extension) {
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
    case '.bmp':
      return 'texture';
    case '.mp3':
    case '.wav':
    case '.ogg':
      return 'audio';
    case '.ttf':
    case '.otf':
    case '.woff':
    case '.woff2':
      return 'font';
    case '.bin':
      return 'model-bin';
    case '.json':
      return 'json';
    default:
      return 'native-other';
  }
}

function categorizeSourceExtension(extension) {
  switch (extension) {
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
    case '.bmp':
      return 'texture';
    case '.mp3':
    case '.wav':
    case '.ogg':
      return 'audio';
    case '.ttf':
    case '.otf':
    case '.woff':
    case '.woff2':
      return 'font';
    case '.fbx':
    case '.glb':
    case '.gltf':
      return 'model-source';
    case '.prefab':
      return 'prefab';
    case '.scene':
      return 'scene';
    default:
      return extension ? extension.slice(1) : 'asset';
  }
}

function classifyBuildArea(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith('assets/main/')) {
    return 'main bundle';
  }
  if (normalized.startsWith('assets/internal/')) {
    return 'internal bundle';
  }
  if (normalized.startsWith('src/')) {
    return 'bootstrap src';
  }
  if (normalized.startsWith('cocos-js/')) {
    return 'engine';
  }
  return 'root';
}

function typeLabel(category) {
  const labels = {
    texture: 'Textures',
    audio: 'Audio',
    font: 'Fonts',
    'model-bin': 'Model Binary',
    'model-source': 'Model Source',
    'import-json': 'Import JSON',
    'import-binary': 'Import Binary',
    'engine-js': 'Engine JS',
    'game-js': 'Game JS',
    config: 'Config JSON',
    json: 'JSON',
    html: 'HTML',
    css: 'CSS',
    'native-other': 'Native Other',
  };

  return labels[category] || category;
}

function renderSourceChips(sources) {
  if (!sources.length) {
    return '<span class="source-chip">No match</span>';
  }
  return sources.map((source) => `<span class="source-chip">${escapeHtml(shortAssetLabel(source.url))}</span>`).join('');
}

function normalizeAssetToken(value) {
  let token = String(value || '').trim();
  if (!token) {
    return '';
  }
  if (token.startsWith('../')) {
    token = token.slice(3);
  }
  if (token.startsWith('db://assets/')) {
    token = token.slice('db://assets/'.length);
  }
  token = token.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return token.toLowerCase();
}

function compactUuidString(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extensionBonus(extension) {
  switch (extension) {
    case '.mtl': return 3;
    case '.effect': return 3;
    case '.prefab': return 2;
    case '.scene': return 2;
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
    case '.mp3':
    case '.wav':
    case '.ttf':
    case '.otf':
      return 1;
    default:
      return 0;
  }
}

function isInterestingMarker(value) {
  return /^[A-Za-z0-9_./@-]+$/.test(value)
    && !/^cc\./.test(value)
    && !/^_[A-Za-z]/.test(value)
    && !/^(mainColor|emissive|albedo|Constants|CC[A-Za-z]|USE_[A-Z_]+)$/.test(value);
}

function shortAssetLabel(url) {
  return url.replace(/^db:\/\/assets\//, '');
}

function getAssetDisplaySource(entry, filter) {
  if (filter === 'model-bin' && Array.isArray(entry.modelSources) && entry.modelSources.length) {
    return entry.modelSources[0];
  }
  if (filter === 'prefab' && Array.isArray(entry.prefabSources) && entry.prefabSources.length) {
    return entry.prefabSources[0];
  }
  if (entry.sourceCategory === 'model-source') {
    return {
      uuid: normalizeDependencyUuid(entry.sourceUuid),
      url: String(entry.source || '').split('@')[0],
    };
  }
  return { uuid: entry.sourceUuid || '', url: entry.source || '' };
}

function formatAssetSourceLabel(entry, filter = '') {
  const modelCount = Array.isArray(entry.modelSources) ? entry.modelSources.length : 0;
  if ((filter === 'model-bin' || !entry.prefabSources || !entry.prefabSources.length) && modelCount > 0) {
    const firstModel = shortAssetLabel(entry.modelSources[0].url);
    return modelCount > 1 ? `${firstModel} (+${modelCount - 1} models in pack)` : firstModel;
  }
  if (filter === 'model-bin' && entry.sourceCategory === 'model-source') {
    return shortAssetLabel(String(entry.source || '').split('@')[0]);
  }
  const prefabCount = Array.isArray(entry.prefabSources) ? entry.prefabSources.length : 0;
  if (prefabCount > 0) {
    const firstPrefab = shortAssetLabel(entry.prefabSources[0].url);
    return prefabCount > 1 ? `${firstPrefab} (+${prefabCount - 1} prefabs in pack)` : firstPrefab;
  }
  if (entry.source) {
    const packedCount = Number(entry.packedSourceCount || 0);
    const suffix = packedCount > 1 ? ` (+${packedCount - 1} packed assets)` : '';
    return `${shortAssetLabel(entry.source)}${suffix}`;
  }
  return 'No source match';
}

function toRelative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function clampInteger(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function formatBytes(value) {
  const size = Math.max(0, Number(value) || 0);
  if (size >= 1024 * 1024) {
    return `${round(size / (1024 * 1024))} MB`;
  }
  if (size >= 1024) {
    return `${round(size / 1024)} KB`;
  }
  return `${Math.round(size)} B`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
