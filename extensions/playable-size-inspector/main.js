'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PACKAGE_NAME = 'playable-size-inspector';
const WORKSPACE_DIRECTORY = 'playable-size-inspector';

exports.methods = {
  openPanel() {
    Editor.Panel.open(PACKAGE_NAME);
  },

  async revealAsset(payload) {
    const uuid = String(payload && payload.uuid || '').trim();
    const url = String(payload && payload.url || '').trim();

    if (!uuid && !url) {
      return { ok: false, reason: 'missing-target' };
    }

    const targetUuid = uuid || await resolveUuidFromUrl(url);
    if (!targetUuid) {
      return { ok: false, reason: 'uuid-not-found' };
    }

    const selection = Editor.Selection;
    if (selection && typeof selection.select === 'function') {
      try {
        selection.select('asset', targetUuid);
      } catch (_error) {
        try {
          selection.select(targetUuid);
        } catch (_innerError) {
          // Fall through to other reveal methods.
        }
      }
    }

    try {
      await Editor.Message.request('assets', 'twinkle', targetUuid);
      return { ok: true, mode: 'assets.twinkle', uuid: targetUuid };
    } catch (_error) {
      // Some versions may not expose assets.twinkle.
    }

    try {
      await Editor.Message.request('asset-db', 'open-asset', targetUuid);
      return { ok: true, mode: 'asset-db.open-asset', uuid: targetUuid };
    } catch (_error) {
      // Some versions may not allow opening by uuid.
    }

    try {
      await Editor.Message.request('asset-db', 'open-asset', { uuid: targetUuid });
      return { ok: true, mode: 'asset-db.open-asset-object', uuid: targetUuid };
    } catch (_error) {
      // Last fallback below.
    }

    return { ok: true, mode: 'selection-only', uuid: targetUuid };
  },

  async optimizeExportAll(payload) {
    const sourceRoot = String(payload && payload.sourceRoot || '').trim();
    const optimizedRoot = String(payload && payload.optimizedRoot || '').trim();
    const exportRoot = String(payload && payload.exportRoot || '').trim();
    const maxTextureSize = Number(payload && payload.maxTextureSize || 1024);
    const jpegQuality = Number(payload && payload.jpegQuality || 82);

    if (!sourceRoot || !optimizedRoot || !exportRoot) {
      throw new Error('Missing sourceRoot, optimizedRoot, or exportRoot.');
    }

    const defaultOriginalRoot = path.join(Editor.Project.path, 'build', 'web-mobile');
    const originalSourceRoot = isSameResolvedPath(sourceRoot, optimizedRoot)
      ? defaultOriginalRoot
      : sourceRoot;
    const hasOriginalSource = await pathExists(originalSourceRoot);
    const effectiveSourceRoot = hasOriginalSource ? originalSourceRoot : sourceRoot;
    if (isSameResolvedPath(effectiveSourceRoot, optimizedRoot)) {
      throw new Error('Original build/web-mobile was not found. Build the web-mobile target before Optimize + Export All.');
    }
    const optimizedRootExists = await pathExists(optimizedRoot);
    const optimizedCopyHasUnsafeResizes = optimizedRootExists
      && await hasUnsafePngDimensionChanges(effectiveSourceRoot, optimizedRoot);
    const optimizedCopyHasChanges = optimizedRootExists
      && !optimizedCopyHasUnsafeResizes
      && !isSameResolvedPath(effectiveSourceRoot, optimizedRoot)
      && !await areBuildRootsEquivalent(effectiveSourceRoot, optimizedRoot);

    // Preserve per-asset edits. If the copy is still byte-for-byte equivalent,
    // run the bulk optimizer instead of silently exporting an unchanged build.
    const optimizeReport = optimizedCopyHasChanges
      ? await summarizeExistingOptimizedCopy(effectiveSourceRoot, optimizedRoot, {
          maxTextureSize,
          jpegQuality,
          skippedReason: 'preserved-existing-asset-optimizations',
        })
      : await runOptimizeScript({
          sourceRoot: effectiveSourceRoot,
          outputRoot: optimizedRoot,
          maxTextureSize,
          jpegQuality,
        });

    const optimizedReport = await runIsolatedAdapterExport({
      webMobileRoot: optimizedRoot,
      exportRoot,
    });

    return {
      optimizeReport,
      exportReport: {
        optimizedReport,
        optimizedAnalysis: optimizedReport.analysis || null,
      },
    };
  },

  async optimizeSelectedAsset(payload) {
    const sourceRoot = String(payload && payload.sourceRoot || '').trim();
    const outputRoot = String(payload && payload.outputRoot || '').trim();
    const relativePath = String(payload && payload.relativePath || '').trim();
    const assetKind = String(payload && payload.assetKind || '').trim();
    const maxTextureSize = Number(payload && payload.maxTextureSize || 1024);
    const jpegQuality = Number(payload && payload.jpegQuality || 82);
    const targetFormat = String(payload && payload.targetFormat || 'original').trim() || 'original';
    const audioBitrate = Number(payload && payload.audioBitrate || 96);
    const pngQuality = String(payload && payload.pngQuality || '65-85').trim() || '65-85';

    if (!sourceRoot || !outputRoot || !relativePath) {
      throw new Error('Missing sourceRoot, outputRoot, or relativePath.');
    }

    if (isSameResolvedPath(sourceRoot, outputRoot)) {
      throw new Error('Build Root and Output Root must be different so the original asset stays untouched.');
    }

    await ensureOutputBuildCopy({
      sourceRoot,
      outputRoot,
    });

    const resolvedSourceFile = resolveBuildFile(sourceRoot, relativePath);
    const resolvedDestinationFile = resolveBuildFile(outputRoot, relativePath);
    await fs.access(resolvedSourceFile);

    if (assetKind === 'audio') {
      return await runSafeAudioOptimizeToDestination({
        inputPath: resolvedSourceFile,
        outputPath: resolvedDestinationFile,
        audioBitrate,
      });
    }

    if (path.extname(resolvedDestinationFile).toLowerCase() === '.png') {
      return await runSafePngQuantToDestination({
        inputPath: resolvedSourceFile,
        outputPath: resolvedDestinationFile,
        pngQuality,
      });
    }

    const sourceExtension = path.extname(resolvedDestinationFile).toLowerCase();
    const desiredExtension = getTargetExtension(targetFormat, sourceExtension);

    if (desiredExtension !== sourceExtension) {
      throw new Error('Safe apply does not support changing the built file extension.');
    }

    if (resolvedSourceFile.toLowerCase() === resolvedDestinationFile.toLowerCase()) {
      const tempOutputPath = path.join(
        path.dirname(resolvedDestinationFile),
        `${path.basename(resolvedDestinationFile)}.opt-temp${path.extname(resolvedDestinationFile)}`
      );

      const report = await runSingleImageOptimize({
        inputPath: resolvedSourceFile,
        outputPath: tempOutputPath,
        maxTextureSize,
        jpegQuality,
        targetFormat,
        keepLargerOutput: false,
        allowResize: false,
      });

      await fs.rm(resolvedDestinationFile, { force: true });
      await fs.rename(tempOutputPath, resolvedDestinationFile);

      return {
        ...report,
        outputPath: resolvedDestinationFile,
      };
    }

    return await runSingleImageOptimize({
      inputPath: resolvedSourceFile,
      outputPath: resolvedDestinationFile,
      maxTextureSize,
      jpegQuality,
      targetFormat,
      keepLargerOutput: false,
      allowResize: false,
    });
  },

  async resetSelectedAsset(payload) {
    const sourceRoot = String(payload && payload.sourceRoot || '').trim();
    const outputRoot = String(payload && payload.outputRoot || '').trim();
    const relativePath = String(payload && payload.relativePath || '').trim();

    if (!sourceRoot || !outputRoot || !relativePath) {
      throw new Error('Missing sourceRoot, outputRoot, or relativePath.');
    }
    if (isSameResolvedPath(sourceRoot, outputRoot)) {
      throw new Error('Build Root and Output Root must be different so Reset cannot overwrite the original build.');
    }

    const sourceFile = resolveBuildFile(sourceRoot, relativePath);
    const outputFile = resolveBuildFile(outputRoot, relativePath);
    const sourceStat = await fs.stat(sourceFile);

    await ensureOutputBuildCopy({ sourceRoot, outputRoot });
    const beforeBytes = await fs.stat(outputFile).then((stat) => stat.size).catch(() => sourceStat.size);
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.copyFile(sourceFile, outputFile);

    return {
      inputPath: sourceFile,
      outputPath: outputFile,
      beforeBytes,
      afterBytes: sourceStat.size,
      optimized: false,
      reset: true,
      skippedReason: 'reset-to-original',
    };
  },

  async optimizeSelectedAudio(payload) {
    const sourceRoot = String(payload && payload.sourceRoot || '').trim();
    const outputRoot = String(payload && payload.outputRoot || '').trim();
    const audioBitrate = Number(payload && payload.audioBitrate || 96);
    const relativePaths = Array.isArray(payload && payload.relativePaths)
      ? payload.relativePaths.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (!sourceRoot || !outputRoot) {
      throw new Error('Missing sourceRoot or outputRoot.');
    }
    if (isSameResolvedPath(sourceRoot, outputRoot)) {
      throw new Error('Build Root and Output Root must be different so the original asset stays untouched.');
    }
    if (!relativePaths.length) {
      throw new Error('Tick at least one audio file before running the batch optimize.');
    }

    await ensureOutputBuildCopy({ sourceRoot, outputRoot });

    const reports = await runWithConcurrency(relativePaths, 3, async (relativePath) => {
      const normalized = toPosixRelative(relativePath);
      try {
        const inputPath = resolveBuildFile(sourceRoot, relativePath);
        const outputPath = resolveBuildFile(outputRoot, relativePath);
        const report = await runSafeAudioOptimizeToDestination({
          inputPath,
          outputPath,
          audioBitrate,
        });
        return { relativePath: normalized, ...report };
      } catch (error) {
        return {
          relativePath: normalized,
          error: error.message || String(error),
          optimized: false,
        };
      }
    });

    return summarizeBatchAssetReports(reports, { audioBitrate });
  },

  async resetSelectedAudio(payload) {
    const sourceRoot = String(payload && payload.sourceRoot || '').trim();
    const outputRoot = String(payload && payload.outputRoot || '').trim();
    const relativePaths = Array.isArray(payload && payload.relativePaths)
      ? payload.relativePaths.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (!sourceRoot || !outputRoot) {
      throw new Error('Missing sourceRoot or outputRoot.');
    }
    if (isSameResolvedPath(sourceRoot, outputRoot)) {
      throw new Error('Build Root and Output Root must be different so Reset cannot overwrite the original build.');
    }
    if (!relativePaths.length) {
      throw new Error('Tick at least one audio file before running the batch reset.');
    }

    await ensureOutputBuildCopy({ sourceRoot, outputRoot });

    const reports = await runWithConcurrency(relativePaths, 8, async (relativePath) => {
      const normalized = toPosixRelative(relativePath);
      try {
        const sourceFile = resolveBuildFile(sourceRoot, relativePath);
        const outputFile = resolveBuildFile(outputRoot, relativePath);
        const sourceStat = await fs.stat(sourceFile);
        const beforeBytes = await fs.stat(outputFile).then((stat) => stat.size).catch(() => sourceStat.size);
        await fs.mkdir(path.dirname(outputFile), { recursive: true });
        await fs.copyFile(sourceFile, outputFile);
        return {
          relativePath: normalized,
          inputPath: sourceFile,
          outputPath: outputFile,
          beforeBytes,
          afterBytes: sourceStat.size,
          optimized: false,
          reset: true,
          skippedReason: 'reset-to-original',
        };
      } catch (error) {
        return {
          relativePath: normalized,
          error: error.message || String(error),
          optimized: false,
        };
      }
    });

    return summarizeBatchAssetReports(reports, {});
  },

  async optimizeAllPngs(payload) {
    const sourceRoot = String(payload && payload.sourceRoot || '').trim();
    const outputRoot = String(payload && payload.outputRoot || '').trim();
    const pngQuality = normalizePngQuality(String(payload && payload.pngQuality || '65-85').trim());

    if (!sourceRoot || !outputRoot) {
      throw new Error('Missing sourceRoot or outputRoot.');
    }

    if (isSameResolvedPath(sourceRoot, outputRoot)) {
      throw new Error('Build Root and Output Root must be different so the original asset stays untouched.');
    }

    await ensureOutputBuildCopy({ sourceRoot, outputRoot });

    const allFiles = await collectAllFiles(sourceRoot);
    const pngFiles = allFiles.filter(f => path.extname(f.fullPath).toLowerCase() === '.png');

    const reports = await runWithConcurrency(pngFiles, 4, async (file) => {
      const relPath = path.relative(sourceRoot, file.fullPath);
      const destPath = path.join(outputRoot, relPath);
      try {
        const report = await runSafePngQuantToDestination({
          inputPath: file.fullPath,
          outputPath: destPath,
          pngQuality,
        });
        return {
          relativePath: relPath.replace(/\\/g, '/'),
          ...report,
        };
      } catch (err) {
        return {
          relativePath: relPath.replace(/\\/g, '/'),
          error: err.message,
          optimized: false,
          beforeBytes: file.size,
          afterBytes: file.size,
        };
      }
    });

    let totalBeforeBytes = 0;
    let totalAfterBytes = 0;
    let optimizedCount = 0;
    let unchangedCount = 0;
    let failedCount = 0;

    for (const rep of reports) {
      totalBeforeBytes += Number(rep.beforeBytes || 0);
      totalAfterBytes += Number(rep.afterBytes || 0);
      if (rep.error) {
        failedCount++;
      } else if (rep.optimized) {
        optimizedCount++;
      } else {
        unchangedCount++;
      }
    }

    return {
      totalPngs: pngFiles.length,
      optimizedCount,
      unchangedCount,
      failedCount,
      totalBeforeBytes,
      totalAfterBytes,
      savedBytes: Math.max(0, totalBeforeBytes - totalAfterBytes),
      pngQuality,
      results: reports,
    };
  },

  async resetAllPngs(payload) {
    const sourceRoot = String(payload && payload.sourceRoot || '').trim();
    const outputRoot = String(payload && payload.outputRoot || '').trim();

    if (!sourceRoot || !outputRoot) {
      throw new Error('Missing sourceRoot or outputRoot.');
    }
    if (isSameResolvedPath(sourceRoot, outputRoot)) {
      throw new Error('Build Root and Output Root must be different.');
    }

    await ensureOutputBuildCopy({ sourceRoot, outputRoot });
    const allFiles = await collectAllFiles(sourceRoot);
    const pngFiles = allFiles.filter(f => path.extname(f.fullPath).toLowerCase() === '.png');

    const reports = await runWithConcurrency(pngFiles, 8, async (file) => {
      const relPath = path.relative(sourceRoot, file.fullPath);
      const destPath = path.join(outputRoot, relPath);
      await fs.copyFile(file.fullPath, destPath);
      return {
        relativePath: relPath.replace(/\\/g, '/'),
        beforeBytes: file.size,
        afterBytes: file.size,
        outputPath: destPath,
      };
    });

    return {
      totalPngs: pngFiles.length,
      results: reports,
    };
  },
};

function toPosixRelative(relativePath) {
  return String(relativePath || '').split(path.sep).join('/');
}

function summarizeBatchAssetReports(reports, extra = {}) {
  let totalBeforeBytes = 0;
  let totalAfterBytes = 0;
  let optimizedCount = 0;
  let unchangedCount = 0;
  let failedCount = 0;

  for (const report of reports) {
    totalBeforeBytes += Number(report.beforeBytes || 0);
    totalAfterBytes += Number(report.afterBytes || report.beforeBytes || 0);
    if (report.error) {
      failedCount++;
    } else if (report.optimized) {
      optimizedCount++;
    } else {
      unchangedCount++;
    }
  }

  return {
    totalFiles: reports.length,
    optimizedCount,
    unchangedCount,
    failedCount,
    totalBeforeBytes,
    totalAfterBytes,
    savedBytes: Math.max(0, totalBeforeBytes - totalAfterBytes),
    results: reports,
    ...extra,
  };
}

async function runOptimizeScript({ sourceRoot, outputRoot, maxTextureSize, jpegQuality }) {
  const scriptPath = path.join(__dirname, 'scripts', 'optimize-build-copy.ps1');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-SourceRoot', sourceRoot,
    '-OutputRoot', outputRoot,
    '-MaxTextureSize', String(Math.round(maxTextureSize)),
    '-JpegQuality', String(Math.round(jpegQuality)),
  ];

  return await new Promise((resolve, reject) => {
    execFile('powershell.exe', args, {
      cwd: Editor.Project.path,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr && stderr.trim() ? stderr.trim() : error.message;
        reject(new Error(message));
        return;
      }

      const text = String(stdout || '').trim();
      if (!text) {
        reject(new Error('Optimization script returned no output.'));
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch (parseError) {
        reject(new Error(`Failed to parse optimizer output: ${parseError.message}\n${text}`));
      }
    });
  });
}

async function summarizeBuildRoot(rootPath, options = {}) {
  const resolvedRoot = path.resolve(rootPath);
  const files = await collectAllFiles(resolvedRoot);
  const imageFiles = files.filter((file) => ['.png', '.jpg', '.jpeg', '.bmp'].includes(path.extname(file.fullPath).toLowerCase()));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return {
    sourceRoot: resolvedRoot,
    outputRoot: resolvedRoot,
    maxTextureSize: Number(options.maxTextureSize || 0),
    jpegQuality: Number(options.jpegQuality || 0),
    totalFiles: files.length,
    imageFiles: imageFiles.length,
    optimizedFiles: 0,
    totalBeforeBytes: totalBytes,
    totalAfterBytes: totalBytes,
    optimizedBeforeBytes: 0,
    optimizedAfterBytes: 0,
    files: [],
    skippedReason: String(options.skippedReason || 'already-optimized-root'),
  };
}

async function summarizeExistingOptimizedCopy(sourceRoot, outputRoot, options = {}) {
  const [sourceFiles, outputFiles] = await Promise.all([
    collectAllFiles(sourceRoot),
    collectAllFiles(outputRoot),
  ]);
  const sourceByPath = new Map(sourceFiles.map((file) => [
    path.relative(sourceRoot, file.fullPath).replace(/\\/g, '/').toLowerCase(),
    file,
  ]));
  const changedFiles = [];

  for (const outputFile of outputFiles) {
    const relativePath = path.relative(outputRoot, outputFile.fullPath).replace(/\\/g, '/');
    const sourceFile = sourceByPath.get(relativePath.toLowerCase());
    if (!sourceFile || sourceFile.size === outputFile.size) {
      continue;
    }
    changedFiles.push({
      relativePath,
      beforeBytes: sourceFile.size,
      afterBytes: outputFile.size,
      optimized: outputFile.size < sourceFile.size,
    });
  }

  const reducedFiles = changedFiles.filter((file) => file.optimized);
  const totalBeforeBytes = sourceFiles.reduce((sum, file) => sum + file.size, 0);
  const totalAfterBytes = outputFiles.reduce((sum, file) => sum + file.size, 0);

  return {
    sourceRoot: path.resolve(sourceRoot),
    outputRoot: path.resolve(outputRoot),
    maxTextureSize: Number(options.maxTextureSize || 0),
    jpegQuality: Number(options.jpegQuality || 0),
    totalFiles: outputFiles.length,
    imageFiles: outputFiles.filter((file) => ['.png', '.jpg', '.jpeg', '.bmp'].includes(path.extname(file.fullPath).toLowerCase())).length,
    optimizedFiles: reducedFiles.length,
    totalBeforeBytes,
    totalAfterBytes,
    optimizedBeforeBytes: reducedFiles.reduce((sum, file) => sum + file.beforeBytes, 0),
    optimizedAfterBytes: reducedFiles.reduce((sum, file) => sum + file.afterBytes, 0),
    files: reducedFiles.sort((left, right) => (right.beforeBytes - right.afterBytes) - (left.beforeBytes - left.afterBytes)).slice(0, 100),
    skippedReason: String(options.skippedReason || 'preserved-existing-copy'),
  };
}

async function collectAllFiles(root) {
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
      files.push({
        fullPath,
        size: stat.size,
      });
    }
  }

  await walk(root);
  return files;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function runSingleImageOptimize({ inputPath, outputPath, maxTextureSize, jpegQuality, targetFormat = 'original', keepLargerOutput = false, allowResize = false }) {
  const scriptPath = path.join(__dirname, 'scripts', 'optimize-image-file.ps1');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-InputPath', inputPath,
    '-OutputPath', outputPath,
    '-MaxTextureSize', String(Math.round(maxTextureSize)),
    '-JpegQuality', String(Math.round(jpegQuality)),
    '-TargetFormat', targetFormat,
    '-KeepLargerOutputFlag', keepLargerOutput ? '1' : '0',
    '-AllowResizeFlag', allowResize ? '1' : '0',
  ];

  return await new Promise((resolve, reject) => {
    execFile('powershell.exe', args, {
      cwd: Editor.Project.path,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr && stderr.trim() ? stderr.trim() : error.message;
        reject(new Error(message));
        return;
      }

      const text = String(stdout || '').trim();
      if (!text) {
        reject(new Error('Image optimizer returned no output.'));
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch (parseError) {
        reject(new Error(`Failed to parse image optimizer output: ${parseError.message}\n${text}`));
      }
    });
  });
}

async function runSafeAudioOptimizeToDestination({ inputPath, outputPath, audioBitrate }) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);

  if (resolvedInput.toLowerCase() === resolvedOutput.toLowerCase()) {
    const tempOutputPath = path.join(
      path.dirname(resolvedOutput),
      `${path.basename(resolvedOutput)}.audio-opt-temp${path.extname(resolvedOutput)}`
    );

    const report = await runSingleAudioOptimize({
      inputPath: resolvedInput,
      outputPath: tempOutputPath,
      audioBitrate,
    });

    await fs.rm(resolvedOutput, { force: true });
    await fs.rename(tempOutputPath, resolvedOutput);
    return {
      ...report,
      outputPath: resolvedOutput,
    };
  }

  return await runSingleAudioOptimize({
    inputPath: resolvedInput,
    outputPath: resolvedOutput,
    audioBitrate,
  });
}

async function runSafePngQuantToDestination({ inputPath, outputPath, pngQuality }) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);

  if (resolvedInput.toLowerCase() === resolvedOutput.toLowerCase()) {
    const tempOutputPath = path.join(
      path.dirname(resolvedOutput),
      `${path.basename(resolvedOutput)}.pngquant-temp.png`,
    );
    try {
      const report = await runPngQuantOptimize({
        inputPath: resolvedInput,
        outputPath: tempOutputPath,
        pngQuality,
      });
      await fs.rm(resolvedOutput, { force: true });
      await fs.rename(tempOutputPath, resolvedOutput);
      return { ...report, outputPath: resolvedOutput };
    } finally {
      await fs.rm(tempOutputPath, { force: true }).catch(() => {});
    }
  }

  return await runPngQuantOptimize({
    inputPath: resolvedInput,
    outputPath: resolvedOutput,
    pngQuality,
  });
}

async function runPngQuantOptimize({ inputPath, outputPath, pngQuality }) {
  const pngquantPath = path.join(__dirname, 'tools', 'pngquant', 'pngquant.exe');
  const quality = normalizePngQuality(pngQuality);
  const beforeBytes = (await fs.stat(inputPath)).size;
  const beforeDimensions = await readPngDimensions(inputPath);

  await fs.access(pngquantPath).catch(() => {
    throw new Error('pngquant.exe was not found in tools/pngquant.');
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.rm(outputPath, { force: true });

  let skippedReason = '';
  await new Promise((resolve, reject) => {
    execFile(pngquantPath, [
      '--quality', quality,
      '--speed', '3',
      // Dithering can make already-indexed PNGs larger and defeats size optimization.
      '--nofs',
      '--strip',
      '--skip-if-larger',
      '--force',
      '--output', outputPath,
      inputPath,
    ], {
      cwd: Editor.Project.path,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      if (Number(error.code) === 98 || Number(error.code) === 99) {
        skippedReason = Number(error.code) === 99 ? 'quality-not-met' : 'no-gain';
        resolve();
        return;
      }
      reject(new Error(stderr && stderr.trim() ? stderr.trim() : error.message));
    });
  });

  if (!await pathExists(outputPath)) {
    await fs.copyFile(inputPath, outputPath);
  }

  let afterBytes = (await fs.stat(outputPath)).size;
  const afterDimensions = await readPngDimensions(outputPath);
  if (
    !beforeDimensions
    || !afterDimensions
    || beforeDimensions.width !== afterDimensions.width
    || beforeDimensions.height !== afterDimensions.height
  ) {
    await fs.copyFile(inputPath, outputPath);
    throw new Error('PNG optimization was rejected because texture dimensions changed.');
  }

  const optimized = afterBytes < beforeBytes;
  if (!optimized) {
    await fs.copyFile(inputPath, outputPath);
    afterBytes = beforeBytes;
  }
  return {
    inputPath: path.resolve(inputPath),
    outputPath: path.resolve(outputPath),
    extension: '.png',
    outputFormat: '.png',
    beforeBytes,
    afterBytes,
    originalWidth: beforeDimensions.width,
    originalHeight: beforeDimensions.height,
    outputWidth: afterDimensions.width,
    outputHeight: afterDimensions.height,
    hasAlpha: true,
    resized: false,
    optimized,
    pngQuality: quality,
    dithering: 'disabled',
    skippedReason: optimized ? '' : (skippedReason || 'no-gain'),
  };
}

function normalizePngQuality(value) {
  const quality = String(value || '65-85');
  return ['80-95', '65-85', '50-75', '45-70', '30-50'].includes(quality) || /^\d{1,3}-\d{1,3}$/.test(quality) ? quality : '65-85';
}

async function runWithConcurrency(items, limit, fn) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

async function runSingleAudioOptimize({ inputPath, outputPath, audioBitrate }) {
  const ffmpegPath = path.join(__dirname, 'tools', 'ffmpeg', 'ffmpeg.exe');
  const ffprobePath = path.join(__dirname, 'tools', 'ffmpeg', 'ffprobe.exe');
  const inputExtension = path.extname(inputPath).toLowerCase();
  const outputExtension = path.extname(outputPath).toLowerCase();

  if (!['.mp3', '.ogg'].includes(inputExtension) || !['.mp3', '.ogg'].includes(outputExtension)) {
    throw new Error('Safe audio optimize currently supports only .mp3 and .ogg files.');
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const beforeInfo = await probeAudioFile(ffprobePath, inputPath);
  const beforeBytes = (await fs.stat(inputPath)).size;
  const codecArgs = getAudioCodecArgs(outputExtension, audioBitrate);

  await new Promise((resolve, reject) => {
    execFile(ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-vn',
      ...codecArgs,
      outputPath,
    ], {
      cwd: Editor.Project.path,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr && stderr.trim() ? stderr.trim() : error.message));
        return;
      }
      resolve();
    });
  });

  const afterInfo = await probeAudioFile(ffprobePath, outputPath);
  const afterBytes = (await fs.stat(outputPath)).size;

  return {
    inputPath: path.resolve(inputPath),
    outputPath: path.resolve(outputPath),
    extension: inputExtension,
    outputFormat: outputExtension,
    beforeBytes,
    afterBytes,
    optimized: afterBytes < beforeBytes,
    requestedAudioBitrateKbps: Math.round(audioBitrate),
    originalBitrateKbps: beforeInfo.bitRateKbps,
    outputBitrateKbps: afterInfo.bitRateKbps,
    durationSeconds: afterInfo.durationSeconds || beforeInfo.durationSeconds || 0,
    channels: afterInfo.channels || beforeInfo.channels || 0,
    sampleRate: afterInfo.sampleRate || beforeInfo.sampleRate || 0,
    codecName: afterInfo.codecName || beforeInfo.codecName || '',
  };
}

async function probeAudioFile(ffprobePath, filePath) {
  return await new Promise((resolve, reject) => {
    execFile(ffprobePath, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ], {
      cwd: Editor.Project.path,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr && stderr.trim() ? stderr.trim() : error.message));
        return;
      }

      try {
        const parsed = JSON.parse(String(stdout || '{}'));
        const stream = Array.isArray(parsed.streams)
          ? parsed.streams.find((item) => item.codec_type === 'audio') || parsed.streams[0] || {}
          : {};
        const format = parsed.format || {};

        resolve({
          durationSeconds: roundNumber(Number(format.duration || stream.duration || 0), 3),
          bitRateKbps: Math.round(Number(stream.bit_rate || format.bit_rate || 0) / 1000) || 0,
          sampleRate: Number(stream.sample_rate || 0) || 0,
          channels: Number(stream.channels || 0) || 0,
          codecName: String(stream.codec_name || ''),
        });
      } catch (parseError) {
        reject(new Error(`Failed to parse ffprobe output: ${parseError.message}`));
      }
    });
  });
}

function getAudioCodecArgs(extension, audioBitrate) {
  const bitrate = `${Math.max(24, Math.min(320, Math.round(audioBitrate)))}k`;
  if (extension === '.mp3') {
    return ['-c:a', 'libmp3lame', '-b:a', bitrate];
  }
  if (extension === '.ogg') {
    return ['-c:a', 'libvorbis', '-b:a', bitrate];
  }
  throw new Error(`Unsupported audio extension: ${extension}`);
}

function getTargetExtension(targetFormat, sourceExtension) {
  switch (String(targetFormat || 'original').toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return '.jpg';
    case 'png':
      return '.png';
    default:
      return sourceExtension;
  }
}

function roundNumber(value, digits) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isSameResolvedPath(leftPath, rightPath) {
  return path.resolve(leftPath).toLowerCase() === path.resolve(rightPath).toLowerCase();
}

function resolveBuildFile(rootPath, relativePath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedFile = path.resolve(resolvedRoot, String(relativePath).replace(/\//g, path.sep));
  if (!isPathInside(resolvedFile, resolvedRoot)) {
    throw new Error('Asset path must stay inside its build root.');
  }
  return resolvedFile;
}

function isPathInside(candidatePath, parentPath) {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

async function ensureOutputBuildCopy({ sourceRoot, outputRoot }) {
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedOutput = path.resolve(outputRoot);

  try {
    const stat = await fs.stat(resolvedOutput);
    if (stat.isDirectory()) {
      return;
    }
  } catch (_error) {
    // Output copy not created yet.
  }

  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.cp(resolvedSource, resolvedOutput, { recursive: true, force: true });
}

async function areBuildRootsEquivalent(leftRoot, rightRoot) {
  const [leftFiles, rightFiles] = await Promise.all([
    collectAllFiles(leftRoot),
    collectAllFiles(rightRoot),
  ]);

  if (leftFiles.length !== rightFiles.length) {
    return false;
  }

  const rightByPath = new Map(rightFiles.map((file) => [
    path.relative(rightRoot, file.fullPath).replace(/\\/g, '/').toLowerCase(),
    file,
  ]));

  for (const file of leftFiles) {
    const relativePath = path.relative(leftRoot, file.fullPath).replace(/\\/g, '/').toLowerCase();
    const rightFile = rightByPath.get(relativePath);
    if (!rightFile || rightFile.size !== file.size) {
      return false;
    }

    const [leftContent, rightContent] = await Promise.all([
      fs.readFile(file.fullPath),
      fs.readFile(rightFile.fullPath),
    ]);
    const leftHash = crypto.createHash('sha256').update(leftContent).digest('hex');
    const rightHash = crypto.createHash('sha256').update(rightContent).digest('hex');
    if (leftHash !== rightHash) {
      return false;
    }
  }

  return true;
}

async function hasUnsafePngDimensionChanges(sourceRoot, outputRoot) {
  const sourceFiles = await collectAllFiles(sourceRoot);

  for (const sourceFile of sourceFiles) {
    if (path.extname(sourceFile.fullPath).toLowerCase() !== '.png') {
      continue;
    }

    const relativePath = path.relative(sourceRoot, sourceFile.fullPath);
    const outputPath = path.join(outputRoot, relativePath);
    if (!await pathExists(outputPath)) {
      continue;
    }

    const [sourceDimensions, outputDimensions] = await Promise.all([
      readPngDimensions(sourceFile.fullPath),
      readPngDimensions(outputPath),
    ]);
    if (
      sourceDimensions
      && outputDimensions
      && (sourceDimensions.width !== outputDimensions.width || sourceDimensions.height !== outputDimensions.height)
    ) {
      return true;
    }
  }

  return false;
}

async function readPngDimensions(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(24);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const isPng = bytesRead === 24
      && buffer.toString('ascii', 1, 4) === 'PNG'
      && buffer.toString('ascii', 12, 16) === 'IHDR';
    if (!isPng) {
      return null;
    }
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } finally {
    await handle.close();
  }
}

async function runIsolatedAdapterExport({ webMobileRoot, exportRoot }) {
  const projectRoot = Editor.Project.path;
  const buildRoot = path.join(projectRoot, 'build');
  const playableRoot = path.join(buildRoot, WORKSPACE_DIRECTORY);
  const backupRoot = path.join(playableRoot, `.adapter-backup-${Date.now()}`);
  const stagingRoot = path.join(playableRoot, `.adapter-staging-${Date.now()}`);
  const webMobileRootResolved = path.resolve(webMobileRoot);
  const exportRootResolved = path.resolve(exportRoot);
  const playableRootResolved = path.resolve(playableRoot);
  const buildWebMobileResolved = path.resolve(path.join(buildRoot, 'web-mobile'));

  if (
    !isPathInside(webMobileRootResolved, playableRootResolved)
    && !isSameResolvedPath(webMobileRootResolved, buildWebMobileResolved)
  ) {
    throw new Error(`Export source root must be either build/web-mobile or a folder inside build/${WORKSPACE_DIRECTORY}.`);
  }
  if (!isPathInside(exportRootResolved, playableRootResolved)) {
    throw new Error(`Export root must stay inside build/${WORKSPACE_DIRECTORY}.`);
  }

  await fs.mkdir(playableRoot, { recursive: true });
  await fs.mkdir(backupRoot, { recursive: true });

  const preservedNames = new Set([
    path.basename(playableRoot),
    path.basename(backupRoot),
  ]);
  let activeSourceRoot = webMobileRootResolved;

  const originalEntries = await fs.readdir(buildRoot, { withFileTypes: true });
  const movedEntries = [];

  try {
    if (isSameResolvedPath(webMobileRootResolved, buildWebMobileResolved)) {
      await fs.rm(stagingRoot, { recursive: true, force: true });
      await copyDirectory(webMobileRootResolved, stagingRoot);
      activeSourceRoot = stagingRoot;
    }

    for (const entry of originalEntries) {
      if (preservedNames.has(entry.name)) {
        continue;
      }

      const from = path.join(buildRoot, entry.name);
      const to = path.join(backupRoot, entry.name);
      await fs.rename(from, to);
      movedEntries.push(entry.name);
    }

    await copyDirectory(activeSourceRoot, path.join(buildRoot, 'web-mobile'));
    const buildInfo = await runAdapterExportOnly(projectRoot);

    await fs.rm(exportRootResolved, { recursive: true, force: true });
    await fs.mkdir(exportRootResolved, { recursive: true });

    const exportedEntries = await fs.readdir(buildRoot, { withFileTypes: true });
    const copiedEntries = [];
    for (const entry of exportedEntries) {
      if (
        entry.name === 'web-mobile'
        || entry.name === path.basename(playableRoot)
        || entry.name.toLowerCase() === 'single-file-3x.html'
      ) {
        continue;
      }

      const from = path.join(buildRoot, entry.name);
      const to = path.join(exportRootResolved, entry.name);
      await copyPath(from, to);
      copiedEntries.push(entry.name);
    }

    const analysis = await analyzeExportRoot(exportRootResolved);

    return {
      exportRoot: exportRootResolved,
      buildName: buildInfo.name,
      exportedEntries: copiedEntries,
      analysis,
    };
  } finally {
    const cleanupEntries = await fs.readdir(buildRoot, { withFileTypes: true });
    for (const entry of cleanupEntries) {
      if (entry.name === path.basename(playableRoot)) {
        continue;
      }
      await fs.rm(path.join(buildRoot, entry.name), { recursive: true, force: true });
    }

    const backupEntries = await fs.readdir(backupRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of backupEntries) {
      await fs.rename(path.join(backupRoot, entry.name), path.join(buildRoot, entry.name));
    }

    await fs.rm(backupRoot, { recursive: true, force: true });
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function runAdapterExportOnly(projectRoot) {
  const adapterRoot = await findPlayableAdapterRoot(projectRoot);
  const adapterMainPath = path.join(adapterRoot, 'main.js');
  const mainSource = await fs.readFile(adapterMainPath, 'utf8').catch(() => '');
  const runtimeMatch = mainSource.match(/require\(["'](\.\/3x-[^"']+\.js)["']\)/);

  if (!runtimeMatch) {
    throw new Error('Could not locate the playable adapter 3.x runtime for export-only mode.');
  }

  const runtimePath = path.resolve(adapterRoot, runtimeMatch[1]);
  const adapterRuntime = require(runtimePath);
  if (!adapterRuntime || typeof adapterRuntime.initBuildFinishedEvent !== 'function') {
    throw new Error('The installed playable adapter does not expose export-only adaptation.');
  }

  // Calling adapter-build launches a new Cocos build and overwrites optimized
  // assets. The after-build entry packages the prepared web-mobile tree only.
  const buildInfo = await resolveWebMobileBuildInfo(projectRoot);
  await adapterRuntime.initBuildFinishedEvent({
    platform: 'web-mobile',
    name: buildInfo.name,
    outputName: buildInfo.outputName,
  });
  return buildInfo;
}

async function findPlayableAdapterRoot(projectRoot) {
  const extensionRoots = new Set([
    path.join(projectRoot, 'extensions'),
    path.dirname(__dirname),
  ]);

  for (const extensionsRoot of extensionRoots) {
    const exactRoot = path.join(extensionsRoot, 'playable-ads-adapter');
    if (await isPackageNamed(exactRoot, 'playable-ads-adapter')) {
      return exactRoot;
    }

    const entries = await fs.readdir(extensionsRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidateRoot = path.join(extensionsRoot, entry.name);
      if (await isPackageNamed(candidateRoot, 'playable-ads-adapter')) {
        return candidateRoot;
      }
    }
  }

  throw new Error('Playable Ads Adapter was not found. Install it in this project before exporting network packages.');
}

async function isPackageNamed(packageRoot, expectedName) {
  const packageJson = await readJsonFile(path.join(packageRoot, 'package.json'));
  return packageJson && packageJson.name === expectedName;
}

async function resolveWebMobileBuildInfo(projectRoot) {
  const webMobileProfile = await readJsonFile(
    path.join(projectRoot, 'profiles', 'v2', 'packages', 'web-mobile.json'),
  );
  const builderProfile = await readJsonFile(
    path.join(projectRoot, 'profiles', 'v2', 'packages', 'builder.json'),
  );
  const webMobileCommon = webMobileProfile && webMobileProfile.builder && webMobileProfile.builder.common;
  const taskMap = builderProfile && builderProfile.BuildTaskManager && builderProfile.BuildTaskManager.taskMap;
  const latestWebMobileTask = taskMap
    ? Object.values(taskMap)
      .filter((task) => task && task.options && task.options.platform === 'web-mobile')
      .sort((left, right) => Number(right.id || 0) - Number(left.id || 0))[0]
    : null;
  const taskOptions = latestWebMobileTask && latestWebMobileTask.options;
  const name = String(
    webMobileCommon && webMobileCommon.name
      || taskOptions && taskOptions.name
      || path.basename(projectRoot),
  ).trim();
  const outputName = String(
    webMobileCommon && webMobileCommon.outputName
      || taskOptions && taskOptions.outputName
      || 'web-mobile',
  ).trim();

  return { name, outputName };
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

async function copyDirectory(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true, force: true });
}

async function copyPath(from, to) {
  const stat = await fs.stat(from);
  if (stat.isDirectory()) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.cp(from, to, { recursive: true, force: true });
    return;
  }

  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function analyzeExportRoot(exportRoot) {
  const files = await collectAllFiles(exportRoot);
  const rootEntries = await fs.readdir(exportRoot, { withFileTypes: true });
  const packages = [];

  for (const entry of rootEntries) {
    const fullPath = path.join(exportRoot, entry.name);
    if (entry.isDirectory()) {
      const packageFiles = await collectAllFiles(fullPath);
      packages.push({
        network: entry.name,
        relativePath: entry.name,
        kind: 'folder',
        fileCount: packageFiles.length,
        bytes: packageFiles.reduce((sum, file) => sum + file.size, 0),
      });
      continue;
    }
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.html') {
      const stat = await fs.stat(fullPath);
      packages.push({
        network: path.basename(entry.name, path.extname(entry.name)),
        relativePath: entry.name,
        kind: 'single-html',
        fileCount: 1,
        bytes: stat.size,
      });
    }
  }

  packages.sort((left, right) => right.bytes - left.bytes);
  const htmlFiles = files
    .filter((file) => path.extname(file.fullPath).toLowerCase() === '.html')
    .map((file) => {
      const relativePath = path.relative(exportRoot, file.fullPath).replace(/\\/g, '/');
      const segments = relativePath.split('/').filter(Boolean);
      const network = segments.length > 1 ? segments[0] : 'root';
      return {
        relativePath,
        network,
        bytes: file.size,
      };
    })
    .sort((left, right) => right.bytes - left.bytes);

  const totalExportBytes = files.reduce((sum, file) => sum + file.size, 0);
  const totalHtmlBytes = htmlFiles.reduce((sum, file) => sum + file.bytes, 0);

  return {
    totalExportBytes,
    totalHtmlBytes,
    packageCount: packages.length,
    packages,
    largestPackage: packages[0] || null,
    htmlFileCount: htmlFiles.length,
    htmlFiles,
    largestHtml: htmlFiles[0] || null,
    smallestHtml: htmlFiles.length ? htmlFiles[htmlFiles.length - 1] : null,
  };
}

async function resolveUuidFromUrl(url) {
  if (!url) {
    return '';
  }

  try {
    const info = await Editor.Message.request('asset-db', 'query-asset-info', url);
    if (info && info.uuid) {
      return info.uuid;
    }
  } catch (_error) {
    // Some versions use object payloads.
  }

  try {
    const info = await Editor.Message.request('asset-db', 'query-asset-info', { url });
    if (info && info.uuid) {
      return info.uuid;
    }
  } catch (_error) {
    // Ignore and return empty below.
  }

  return '';
}

exports.load = function load() {
  console.log(`[${PACKAGE_NAME}] loaded`);
};

exports.unload = function unload() {};
