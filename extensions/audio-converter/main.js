'use strict';
/**
 * Editor entry point: asset-db path conversion, input collection, the convert
 * loop with progress, backups and asset refresh. The ffmpeg work lives in
 * ./src/core/audio.js.
 */

const fs = require('fs');
const path = require('path');
const {
    OUTPUT_FORMATS,
    isAudioFile,
    findFfmpeg,
    findFfprobe,
    probeAudioFile,
    convertFile,
    formatBytes,
} = require('./src/core/audio');
const { mkdirp } = require('./src/core/fsx');

const PKG = 'audio-converter';

const state = {
    running: false,
    percent: 0,
    message: '',
    log: [],
    cancelled: false,
};

function log(message) {
    state.log.push(message);
    console.log('[' + PKG + '] ' + message);
}

// ---------------------------------------------------------------- paths

async function dbToFs(url) {
    if (!url) {
        return '';
    }
    if (!url.startsWith('db://')) {
        return path.normalize(url);
    }
    const result = await Editor.Message.request('asset-db', 'query-path', url).catch(() => null);
    return result ? path.normalize(result) : '';
}

async function fsToDb(fsPath) {
    if (!fsPath) {
        return '';
    }
    try {
        const url = await Editor.Message.request('asset-db', 'query-url', fsPath);
        return url || '';
    } catch (e) {
        return '';
    }
}

/** db:// folder that may not exist yet -> fs path. */
async function resolveFolder(url) {
    if (!url) {
        return '';
    }
    if (!url.startsWith('db://')) {
        return path.normalize(url);
    }
    const direct = await Editor.Message.request('asset-db', 'query-path', url).catch(() => null);
    if (direct) {
        return path.normalize(direct);
    }
    const parts = url.replace(/\/+$/, '').split('/');
    const tail = [];
    while (parts.length > 2) {
        tail.unshift(parts.pop());
        const parentPath = await Editor.Message.request('asset-db', 'query-path', parts.join('/')).catch(() => null);
        if (parentPath) {
            return path.normalize(path.join(parentPath, tail.join(path.sep)));
        }
    }
    return path.normalize(path.join(Editor.Project.path, url.replace('db://', '')));
}

async function assetInfo(uuidOrUrl) {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', uuidOrUrl);
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------- inputs

function walkAudio(dir, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkAudio(full, out);
        } else if (entry.isFile() && isAudioFile(full)) {
            out.push(full);
        }
    }
}

/**
 * Accepts uuids, db:// urls and fs paths (files or folders) and returns a flat
 * list of audio files with their codec/duration/size.
 */
async function expandInputs(items) {
    const files = [];
    const errors = [];
    for (const raw of items || []) {
        const item = String(raw || '').trim();
        if (!item) {
            continue;
        }
        let fsPath = '';
        if (item.startsWith('db://')) {
            fsPath = await dbToFs(item);
        } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item) || /^[0-9a-zA-Z+/]{22,23}$/.test(item)) {
            const info = await assetInfo(item);
            fsPath = info && info.file ? path.normalize(info.file) : '';
        } else {
            fsPath = path.normalize(item);
        }
        if (!fsPath || !fs.existsSync(fsPath)) {
            errors.push('Not found: ' + item);
            continue;
        }
        const stat = fs.statSync(fsPath);
        if (stat.isDirectory()) {
            walkAudio(fsPath, files);
        } else if (isAudioFile(fsPath)) {
            files.push(fsPath);
        } else {
            errors.push('Not an audio file: ' + path.basename(fsPath));
        }
    }
    const unique = Array.from(new Set(files.map((f) => path.normalize(f))));
    const rows = [];
    for (const file of unique) {
        try {
            const info = await probeAudioFile(file);
            rows.push({
                path: file,
                url: await fsToDb(file),
                name: path.basename(file),
                codec: info.codec,
                durationSec: info.durationSec,
                bitrateKbps: info.bitrateKbps,
                sampleRate: info.sampleRate,
                channels: info.channels,
                bytes: info.bytes,
            });
        } catch (e) {
            errors.push(path.basename(file) + ': ' + e.message);
        }
    }
    return { files: rows, errors };
}

// ---------------------------------------------------------------- planning

/**
 * Where the converted file goes.
 *   sibling - next to the source, same base name, new extension
 *   suffix  - next to the source with a name suffix
 *   folder  - into a chosen folder, keeping the base name
 */
function buildOutputPath(file, options) {
    const format = OUTPUT_FORMATS[options.format];
    const ext = format.ext;
    const base = path.basename(file, path.extname(file));
    if (options.output === 'folder') {
        return path.join(options.folder, base + ext);
    }
    if (options.output === 'suffix') {
        return path.join(path.dirname(file), base + (options.suffix || '_converted') + ext);
    }
    return path.join(path.dirname(file), base + ext);
}

async function buildPlan(options) {
    const o = options || {};
    const formatKey = o.format || 'mp3';
    if (!OUTPUT_FORMATS[formatKey]) {
        throw new Error('Unknown output format: ' + formatKey);
    }
    if (!findFfmpeg()) {
        throw new Error('ffmpeg was not found. Put ffmpeg.exe in extensions/audio-converter/tools/ffmpeg, or install the playable-size-inspector extension, or add ffmpeg to PATH.');
    }

    const outMode = o.output || 'sibling';
    const folder = outMode === 'folder' ? await resolveFolder(o.folderUrl) : '';
    if (outMode === 'folder' && !folder) {
        throw new Error('Output folder is empty.');
    }

    const outOpts = { format: formatKey, output: outMode, suffix: o.suffix || '', folder };
    const rows = [];
    for (const file of o.files || []) {
        const row = { path: file, name: path.basename(file), ok: true, error: '', skipped: false };
        try {
            if (!fs.existsSync(file)) {
                throw new Error('file not found');
            }
            const info = await probeAudioFile(file);
            row.codec = info.codec;
            row.durationSec = info.durationSec;
            row.bitrateKbps = info.bitrateKbps;
            row.sampleRate = info.sampleRate;
            row.channels = info.channels;
            row.bytesIn = info.bytes;
            row.outputPath = buildOutputPath(file, outOpts);
            row.sameFile = path.normalize(row.outputPath).toLowerCase() === path.normalize(file).toLowerCase();
            row.overwrites = !row.sameFile && fs.existsSync(row.outputPath);

            // Re-encoding a file onto itself would need a temp round trip and
            // gains nothing, so only allow it when settings actually change it.
            if (row.sameFile && !o.reencodeSameFormat) {
                row.skipped = true;
                row.reason = 'already ' + formatKey + ' (tick "Re-encode same format" to force)';
            }
            if (row.overwrites && !o.overwriteExisting) {
                row.skipped = true;
                row.reason = 'output already exists';
            }
        } catch (e) {
            row.ok = false;
            row.error = e.message;
        }
        rows.push(row);
    }

    return {
        rows,
        format: formatKey,
        output: outMode,
        folder,
        rateMode: o.rateMode || 'cbr',
        bitrateKbps: Number(o.bitrateKbps) || 128,
        vbrQuality: Number(o.vbrQuality) || 4,
        sampleRate: Number(o.sampleRate) || 0,
        channels: Number(o.channels) || 0,
        normalize: !!o.normalize,
        trimSilence: !!o.trimSilence,
        deleteSource: !!o.deleteSource,
        backup: o.backup !== false,
        refresh: o.refresh !== false,
        ffmpeg: findFfmpeg(),
        ffprobe: findFfprobe(),
    };
}

function backupRoot() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    return path.join(Editor.Project.path, 'temp', 'audio-converter-backup', stamp);
}

function backupFile(file, root) {
    const rel = path.relative(Editor.Project.path, file);
    const safeRel = rel.startsWith('..') ? path.basename(file) : rel;
    const dest = path.join(root, safeRel);
    mkdirp(path.dirname(dest));
    fs.copyFileSync(file, dest);
    // The .meta carries the uuid; keep it so a restore brings back the asset id.
    if (fs.existsSync(file + '.meta')) {
        fs.copyFileSync(file + '.meta', dest + '.meta');
    }
    return dest;
}

// ---------------------------------------------------------------- methods

exports.methods = {
    openPanel() {
        Editor.Panel.open(PKG);
    },

    /** Audio (or folders) currently selected in the Assets panel. */
    async collectSelected() {
        let uuids = [];
        try {
            uuids = Editor.Selection.getSelected('asset') || [];
        } catch (e) {
            uuids = [];
        }
        if (!uuids.length) {
            return { ok: false, error: 'Nothing is selected in the Assets panel.' };
        }
        const result = await expandInputs(uuids);
        return { ok: true, files: result.files, errors: result.errors };
    },

    async resolveInputs(items) {
        const result = await expandInputs(items);
        return { ok: true, files: result.files, errors: result.errors };
    },

    async browseFiles() {
        const result = await Editor.Dialog.select({
            title: 'Select audio files',
            path: path.join(Editor.Project.path, 'assets'),
            type: 'file',
            multi: true,
            filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'opus', 'wma', 'aiff', 'aif'] }],
        });
        if (!result || result.canceled || !result.filePaths || !result.filePaths.length) {
            return { ok: false };
        }
        const expanded = await expandInputs(result.filePaths);
        return { ok: true, files: expanded.files, errors: expanded.errors };
    },

    async browseFolder(currentUrl) {
        const start = (await resolveFolder(currentUrl)) || path.join(Editor.Project.path, 'assets');
        const result = await Editor.Dialog.select({
            title: 'Select output folder',
            path: fs.existsSync(start) ? start : Editor.Project.path,
            type: 'directory',
        });
        if (!result || result.canceled || !result.filePaths || !result.filePaths.length) {
            return { ok: false };
        }
        const dir = result.filePaths[0];
        return { ok: true, path: dir, url: (await fsToDb(dir)) || dir };
    },

    /** Dry run: computes output paths and what would be skipped, writes nothing. */
    async analyze(options) {
        try {
            const plan = await buildPlan(options);
            return { ok: true, plan };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    },

    async run(options) {
        if (state.running) {
            return { ok: false, error: 'A conversion is already in progress.' };
        }
        state.running = true;
        state.cancelled = false;
        state.percent = 0;
        state.message = 'Planning...';
        state.log = [];
        try {
            const plan = await buildPlan(options);
            const todo = plan.rows.filter((r) => r.ok && !r.skipped);
            if (!todo.length) {
                throw new Error('Nothing to do: every file is skipped or invalid.');
            }

            const root = plan.backup ? backupRoot() : '';
            let done = 0;
            let bytesIn = 0;
            let bytesOut = 0;
            const touchedDirs = new Set();

            for (const row of todo) {
                if (state.cancelled) {
                    row.ok = false;
                    row.error = 'cancelled';
                    continue;
                }
                state.message = 'Converting ' + row.name + ' (' + (done + 1) + '/' + todo.length + ')';
                try {
                    if (root) {
                        row.backupPath = backupFile(row.path, root);
                    }
                    const res = await convertFile(row.path, row.outputPath, {
                        format: plan.format,
                        rateMode: plan.rateMode,
                        bitrateKbps: plan.bitrateKbps,
                        vbrQuality: plan.vbrQuality,
                        sampleRate: plan.sampleRate,
                        channels: plan.channels,
                        normalize: plan.normalize,
                        trimSilence: plan.trimSilence,
                    });
                    row.bytesOut = res.bytesOut;
                    bytesIn += res.bytesIn;
                    bytesOut += res.bytesOut;
                    touchedDirs.add(path.dirname(row.outputPath));

                    if (plan.deleteSource && !row.sameFile) {
                        // Also remove the .meta, otherwise the asset-db keeps a
                        // dangling entry for a file that no longer exists.
                        try {
                            fs.unlinkSync(row.path);
                            if (fs.existsSync(row.path + '.meta')) {
                                fs.unlinkSync(row.path + '.meta');
                            }
                            row.sourceDeleted = true;
                            touchedDirs.add(path.dirname(row.path));
                        } catch (e) {
                            log('WARN could not delete source ' + row.name + ': ' + e.message);
                        }
                    }

                    log(
                        row.name + ' -> ' + path.basename(row.outputPath) +
                        '  ' + formatBytes(res.bytesIn) + ' -> ' + formatBytes(res.bytesOut)
                    );
                } catch (e) {
                    row.ok = false;
                    row.error = e.message;
                    log('ERROR ' + row.name + ': ' + e.message);
                }
                done += 1;
                state.percent = Math.round((done / todo.length) * 100);
            }

            const refreshed = [];
            if (plan.refresh && touchedDirs.size) {
                state.message = 'Refreshing asset database...';
                for (const dir of touchedDirs) {
                    const url = await fsToDb(dir);
                    if (url) {
                        await Editor.Message.request('asset-db', 'refresh-asset', url).catch(() => null);
                        refreshed.push(url);
                    }
                }
            }

            state.message = state.cancelled ? 'Cancelled.' : 'Done.';
            return {
                ok: true,
                result: {
                    rows: plan.rows,
                    bytesIn,
                    bytesOut,
                    backupRoot: root,
                    refreshed,
                    cancelled: state.cancelled,
                    log: state.log.slice(),
                },
            };
        } catch (e) {
            log('ERROR ' + e.message);
            return { ok: false, error: e.message, log: state.log.slice() };
        } finally {
            state.running = false;
            state.percent = 100;
        }
    },

    progressStatus() {
        return { running: state.running, percent: state.percent, message: state.message, log: state.log.slice(-60) };
    },

    cancel() {
        state.cancelled = true;
        return { ok: true };
    },

    reveal(target) {
        try {
            require('electron').shell.showItemInFolder(target);
        } catch (e) {
            console.warn('[' + PKG + '] cannot reveal ' + target + ': ' + e.message);
        }
    },
};

exports.load = function () {};
exports.unload = function () {};
