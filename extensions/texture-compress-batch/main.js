'use strict';
/**
 * Editor entry point: preset lookup, folder resolution, sprite-frame scan and
 * the meta update loop. Metas are written through asset-db (save-asset-meta)
 * so the editor re-imports them itself; a plain file write + refresh is used
 * as a fallback for editors that lack that message.
 */

const fs = require('fs');
const path = require('path');

const PKG = 'texture-compress-batch';
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tga', '.psd'];

function log(message) {
    console.log('[' + PKG + '] ' + message);
}

// ---------------------------------------------------------------- presets

function builderJsonPath() {
    return path.join(Editor.Project.path, 'settings', 'v2', 'packages', 'builder.json');
}

/** Presets defined in Project Settings -> Texture Compress. */
function readPresets() {
    const file = builderJsonPath();
    if (!fs.existsSync(file)) {
        return [];
    }
    let json;
    try {
        json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        log('cannot parse builder.json: ' + e.message);
        return [];
    }
    const userPreset = (json.textureCompressConfig && json.textureCompressConfig.userPreset) || {};
    return Object.keys(userPreset).map((id) => {
        const p = userPreset[id] || {};
        const formats = [];
        for (const platform of Object.keys(p.options || {})) {
            for (const fmt of Object.keys(p.options[platform] || {})) {
                const cfg = p.options[platform][fmt] || {};
                formats.push(platform + ':' + fmt + (cfg.quality !== undefined ? '@' + cfg.quality : ''));
            }
        }
        return { id, name: p.name || id, formats };
    });
}

function findPreset(idOrName) {
    const presets = readPresets();
    return presets.find((p) => p.id === idOrName || p.name === idOrName) || null;
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
        return (await Editor.Message.request('asset-db', 'query-url', fsPath)) || '';
    } catch (e) {
        return '';
    }
}

async function assetInfo(uuidOrUrl) {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', uuidOrUrl);
    } catch (e) {
        return null;
    }
}

/**
 * Accepts a uuid, db:// url or fs path and returns { url, path } of the folder.
 * A file resolves to its parent folder.
 */
async function resolveFolderInput(raw) {
    const item = String(raw || '').trim();
    if (!item) {
        return null;
    }
    let url = '';
    let fsPath = '';
    if (item.startsWith('db://')) {
        url = item;
        fsPath = await dbToFs(item);
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(item) || !/[\\/]/.test(item)) {
        const info = await assetInfo(item);
        if (!info) {
            return null;
        }
        url = info.url;
        fsPath = path.normalize(info.file || (await dbToFs(info.url)));
    } else {
        fsPath = path.normalize(item);
        url = await fsToDb(fsPath);
    }
    if (!fsPath || !fs.existsSync(fsPath)) {
        return null;
    }
    if (fs.statSync(fsPath).isFile()) {
        fsPath = path.dirname(fsPath);
        url = url ? url.replace(/\/[^/]+$/, '') : await fsToDb(fsPath);
    }
    url = url.replace(/\/+$/, '');
    return { url, path: fsPath };
}

// ---------------------------------------------------------------- scan

function walkMetas(dir, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkMetas(full, out);
        } else if (entry.isFile() && entry.name.endsWith('.meta')) {
            out.push(full);
        }
    }
    return out;
}

function isSpriteFrameMeta(metaPath, json) {
    const assetExt = path.extname(metaPath.slice(0, -'.meta'.length)).toLowerCase();
    return json.importer === 'image' && IMAGE_EXTS.indexOf(assetExt) !== -1
        && !!json.userData && json.userData.type === 'sprite-frame';
}

function isAutoAtlasMeta(json) {
    return json.importer === 'auto-atlas';
}

/**
 * Walks the folder and classifies every candidate meta against the requested
 * preset. Returns rows with action = 'update' | 'skip' with a reason.
 */
async function buildPlan(options) {
    const o = options || {};
    const folder = await resolveFolderInput(o.folder);
    if (!folder) {
        throw new Error('Folder not found: ' + (o.folder || '(empty)'));
    }

    const mode = o.mode === 'disable' ? 'disable' : 'enable';
    let preset = null;
    if (mode === 'enable') {
        preset = findPreset(o.presetId);
        if (!preset) {
            throw new Error('Preset not found: ' + (o.presetId || '(empty)') + '. Create one in Project Settings -> Texture Compress.');
        }
    }

    const rows = [];
    for (const metaPath of walkMetas(folder.path, [])) {
        let json;
        try {
            json = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (e) {
            rows.push({ metaPath, name: path.basename(metaPath), kind: '?', action: 'error', reason: e.message });
            continue;
        }
        const kind = isSpriteFrameMeta(metaPath, json) ? 'sprite-frame'
            : (o.includeAtlas && isAutoAtlasMeta(json)) ? 'auto-atlas' : '';
        if (!kind) {
            continue;
        }
        const assetPath = metaPath.slice(0, -'.meta'.length);
        const row = {
            metaPath,
            assetPath,
            uuid: json.uuid,
            name: path.relative(folder.path, assetPath).split(path.sep).join('/'),
            kind,
            current: (json.userData && json.userData.compressSettings) || null,
            action: 'update',
            reason: '',
        };
        const cur = row.current;
        const enabled = !!(cur && cur.useCompressTexture);
        if (mode === 'disable') {
            if (!enabled) {
                row.action = 'skip';
                row.reason = 'not compressed';
            }
        } else if (enabled && cur.presetId === preset.id) {
            row.action = 'skip';
            row.reason = 'already ' + preset.name;
        } else if (enabled && cur.presetId !== preset.id && !o.force) {
            const other = findPreset(cur.presetId);
            row.action = 'skip';
            row.reason = 'uses other preset (' + (other ? other.name : cur.presetId) + ') - tick Override to replace';
        }
        rows.push(row);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return { folder, mode, preset, includeAtlas: !!o.includeAtlas, force: !!o.force, rows };
}

// ---------------------------------------------------------------- write

function patchUserData(userData, plan) {
    const ud = userData || {};
    if (plan.mode === 'disable') {
        delete ud.compressSettings;
    } else {
        ud.compressSettings = { useCompressTexture: true, presetId: plan.preset.id };
    }
    return ud;
}

/** Preferred path: let asset-db rewrite the meta and re-import. */
async function writeViaAssetDb(row, plan) {
    const meta = await Editor.Message.request('asset-db', 'query-asset-meta', row.uuid);
    if (!meta) {
        throw new Error('query-asset-meta returned nothing');
    }
    meta.userData = patchUserData(meta.userData, plan);
    await Editor.Message.request('asset-db', 'save-asset-meta', row.uuid, JSON.stringify(meta));
}

/** Fallback: edit the file on disk, keep EOL/indent as Cocos wrote it, then refresh. */
async function writeViaFile(row, plan) {
    const raw = fs.readFileSync(row.metaPath, 'utf8');
    const json = JSON.parse(raw);
    json.userData = patchUserData(json.userData, plan);
    const eol = raw.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    const trailing = /\r?\n$/.test(raw) ? eol : '';
    fs.writeFileSync(row.metaPath, JSON.stringify(json, null, 2).replace(/\n/g, eol) + trailing, 'utf8');
    const url = await fsToDb(row.assetPath);
    if (url) {
        await Editor.Message.request('asset-db', 'refresh-asset', url).catch(() => null);
    }
}

// ---------------------------------------------------------------- methods

exports.methods = {
    openPanel() {
        Editor.Panel.open(PKG);
    },

    listPresets() {
        return { ok: true, presets: readPresets(), file: builderJsonPath() };
    },

    /** Folder (or first asset's folder) currently selected in the Assets panel. */
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
        const folder = await resolveFolderInput(uuids[0]);
        if (!folder) {
            return { ok: false, error: 'Selected asset could not be resolved.' };
        }
        return { ok: true, folder };
    },

    async browseFolder(currentUrl) {
        const start = await dbToFs(currentUrl);
        const result = await Editor.Dialog.select({
            title: 'Select folder to scan',
            path: start && fs.existsSync(start) ? start : path.join(Editor.Project.path, 'assets'),
            type: 'directory',
        });
        if (!result || result.canceled || !result.filePaths || !result.filePaths.length) {
            return { ok: false };
        }
        const folder = await resolveFolderInput(result.filePaths[0]);
        if (!folder) {
            return { ok: false, error: 'Folder is outside the asset database.' };
        }
        return { ok: true, folder };
    },

    async resolveFolder(raw) {
        const folder = await resolveFolderInput(raw);
        return folder ? { ok: true, folder } : { ok: false, error: 'Not a folder inside assets: ' + raw };
    },

    /** Dry run: what would change. */
    async scan(options) {
        try {
            const plan = await buildPlan(options);
            return { ok: true, plan };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    },

    async apply(options) {
        let plan;
        try {
            plan = await buildPlan(options);
        } catch (e) {
            return { ok: false, error: e.message };
        }

        const targets = plan.rows.filter((r) => r.action === 'update');
        let useAssetDb = true;
        let updated = 0;
        const failed = [];
        for (const row of targets) {
            try {
                if (useAssetDb) {
                    try {
                        await writeViaAssetDb(row, plan);
                    } catch (e) {
                        // Older editors: no save-asset-meta. Switch to file mode for the rest.
                        log('save-asset-meta failed (' + e.message + '), falling back to file write');
                        useAssetDb = false;
                        await writeViaFile(row, plan);
                    }
                } else {
                    await writeViaFile(row, plan);
                }
                row.action = 'done';
                updated++;
            } catch (e) {
                row.action = 'error';
                row.reason = e.message;
                failed.push(row.name + ': ' + e.message);
            }
        }

        log((plan.mode === 'disable' ? 'disabled' : 'enabled ' + plan.preset.name) + ' on ' + updated + ' asset(s) in ' + plan.folder.url);
        return { ok: true, plan, updated, failed, viaAssetDb: useAssetDb };
    },

    /** Assets panel context menu: apply preset to the right-clicked folder. */
    async applyFromMenu(payload) {
        const p = payload || {};
        const res = await exports.methods.apply({
            folder: p.uuid || p.url,
            presetId: p.presetId,
            mode: p.mode || 'enable',
            includeAtlas: !!p.includeAtlas,
            force: !!p.force,
        });
        if (!res.ok) {
            Editor.Dialog.error(res.error, { title: 'Texture Compress Batch' });
            return res;
        }
        const skipped = res.plan.rows.length - res.updated - res.failed.length;
        const title = res.plan.mode === 'disable' ? 'Texture Compress disabled' : 'Texture Compress: ' + res.plan.preset.name;
        Editor.Dialog.info(
            res.updated + ' updated, ' + skipped + ' skipped' + (res.failed.length ? ', ' + res.failed.length + ' failed' : '')
            + '\n' + res.plan.folder.url,
            { title }
        );
        return res;
    },
};

exports.load = function () {};
exports.unload = function () {};
