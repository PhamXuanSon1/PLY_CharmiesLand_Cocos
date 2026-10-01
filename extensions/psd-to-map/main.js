'use strict';
/**
 * Editor entry point: runs tools/psd2map.py, streams its log to the panel,
 * refreshes the output folder, forces PNGs to import as sprite-frame and asks
 * the scene script to drop a SceneBuilder node under Canvas.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PKG = 'psd-to-map';

function log(message) {
    console.log('[' + PKG + '] ' + message);
}

function emit(line, level) {
    try {
        Editor.Message.broadcast(PKG + ':log', { line: String(line), level: level || 'out' });
    } catch (e) {
        /* panel closed */
    }
}

function scriptPath() {
    return path.join(Editor.Project.path, 'tools', 'psd2map.py');
}

// ---------------------------------------------------------------- paths

/** db://assets/x -> <project>/assets/x (works even if the folder doesn't exist yet). */
function dbToFsSync(url) {
    if (!url) {
        return '';
    }
    if (url.startsWith('db://assets')) {
        return path.join(Editor.Project.path, 'assets', url.substring('db://assets'.length));
    }
    return path.normalize(url);
}

/** <project>/assets/x -> db://assets/x, '' if outside assets. */
function fsToDbSync(fsPath) {
    const rel = path.relative(path.join(Editor.Project.path, 'assets'), path.resolve(fsPath));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        return rel === '' ? 'db://assets' : '';
    }
    return 'db://assets/' + rel.split(path.sep).join('/');
}

async function assetInfo(uuidOrUrl) {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', uuidOrUrl);
    } catch (e) {
        return null;
    }
}

/** uuid / db:// url / fs path -> { path, url, name } of a .psd file. */
async function resolvePsdInput(raw) {
    const item = String(raw || '').trim().replace(/^"|"$/g, '');
    if (!item) {
        return null;
    }
    let fsPath = '';
    if (item.startsWith('db://')) {
        fsPath = dbToFsSync(item);
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(item)) {
        const info = await assetInfo(item);
        fsPath = info ? (info.file || dbToFsSync(info.url)) : '';
    } else {
        fsPath = item;
    }
    fsPath = fsPath ? path.normalize(fsPath) : '';
    if (!fsPath || !fs.existsSync(fsPath) || !fs.statSync(fsPath).isFile()) {
        return null;
    }
    if (path.extname(fsPath).toLowerCase() !== '.psd') {
        return null;
    }
    const name = path.basename(fsPath, path.extname(fsPath));
    return { path: fsPath, url: fsToDbSync(fsPath), name, defaultOut: 'db://assets/3.Sprites/' + name };
}

/** 'db://assets/x/sprites/pillow_1.png/spriteFrame' -> 'pillow_1' */
function keyFromAssetUrl(p) {
    let s = String(p || '').replace(/\\/g, '/');
    if (s.endsWith('/spriteFrame')) {
        s = s.slice(0, -'/spriteFrame'.length);
    }
    const at = s.indexOf('@');
    if (at >= 0) {
        s = s.substring(0, at);
    }
    s = s.substring(s.lastIndexOf('/') + 1);
    const dot = s.lastIndexOf('.');
    return dot > 0 ? s.substring(0, dot) : s;
}

// ---------------------------------------------------------------- python

let pythonCmd = null;

function runProcess(cmd, args, onLine) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(cmd, args, {
                cwd: Editor.Project.path,
                env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
                windowsHide: true,
            });
        } catch (e) {
            resolve({ code: -1, out: '', err: e.message });
            return;
        }
        let out = '';
        let err = '';
        const pipe = (stream, isErr) => {
            let buf = '';
            stream.on('data', (chunk) => {
                const text = chunk.toString('utf8');
                if (isErr) {
                    err += text;
                } else {
                    out += text;
                }
                buf += text;
                const lines = buf.split(/\r?\n/);
                buf = lines.pop();
                lines.forEach((l) => onLine && onLine(l, isErr));
            });
            stream.on('end', () => {
                if (buf && onLine) {
                    onLine(buf, isErr);
                }
            });
        };
        pipe(child.stdout, false);
        pipe(child.stderr, true);
        child.on('error', (e) => resolve({ code: -1, out, err: err + e.message }));
        child.on('close', (code) => resolve({ code, out, err }));
    });
}

/** Finds a working python (python / py -3), cached. */
async function findPython() {
    if (pythonCmd) {
        return pythonCmd;
    }
    for (const cand of [['python', []], ['py', ['-3']], ['python3', []]]) {
        const res = await runProcess(cand[0], cand[1].concat(['--version']));
        if (res.code === 0 && /Python 3/.test(res.out + res.err)) {
            pythonCmd = cand;
            return pythonCmd;
        }
    }
    return null;
}

async function checkEnv() {
    const py = await findPython();
    if (!py) {
        return { ok: false, code: 'no-python', error: 'Không tìm thấy Python 3. Cài từ python.org (tick "Add python.exe to PATH") rồi mở lại Cocos.' };
    }
    if (!fs.existsSync(scriptPath())) {
        return { ok: false, code: 'no-script', error: 'Thiếu ' + scriptPath() };
    }
    const res = await runProcess(py[0], py[1].concat(['-c', 'import psd_tools']));
    if (res.code !== 0) {
        return { ok: false, code: 'no-psd-tools', error: 'Python chưa có thư viện psd-tools. Bấm "Cài psd-tools".' };
    }
    return { ok: true, py };
}

// ---------------------------------------------------------------- sprite-frame

function walkPngMetas(dir, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkPngMetas(full, out);
        } else if (entry.isFile() && /\.png\.meta$/i.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/** Every exported PNG must import as sprite-frame, or SceneBuilder can't find it. */
async function ensureSpriteFrames(spritesDir) {
    let fixed = 0;
    let total = 0;
    for (const metaPath of walkPngMetas(spritesDir, [])) {
        total++;
        let json;
        try {
            json = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (e) {
            continue;
        }
        if (json.userData && json.userData.type === 'sprite-frame') {
            continue;
        }
        try {
            const meta = await Editor.Message.request('asset-db', 'query-asset-meta', json.uuid);
            meta.userData = Object.assign({}, meta.userData, { type: 'sprite-frame' });
            await Editor.Message.request('asset-db', 'save-asset-meta', json.uuid, JSON.stringify(meta));
            fixed++;
        } catch (e) {
            emit('Không đổi được sprite-frame: ' + path.basename(metaPath) + ' (' + e.message + ')', 'err');
        }
    }
    return { fixed, total };
}

// ---------------------------------------------------------------- methods

exports.methods = {
    openPanel() {
        Editor.Panel.open(PKG);
    },

    /** From the Assets context menu: open the panel with this PSD selected. */
    async openWith(uuid) {
        await Editor.Panel.open(PKG);
        const psd = await resolvePsdInput(uuid);
        if (psd) {
            setTimeout(() => Editor.Message.broadcast(PKG + ':select', psd), 300);
        }
    },

    async collectSelected() {
        let uuids = [];
        try {
            uuids = Editor.Selection.getSelected('asset') || [];
        } catch (e) {
            uuids = [];
        }
        for (const uuid of uuids) {
            const psd = await resolvePsdInput(uuid);
            if (psd) {
                return { ok: true, psd };
            }
        }
        return { ok: false, error: 'Chưa chọn file .psd nào trong panel Assets.' };
    },

    async browsePsd(current) {
        const start = current && fs.existsSync(current) ? path.dirname(current) : path.join(Editor.Project.path, 'assets');
        const result = await Editor.Dialog.select({
            title: 'Chọn file PSD',
            path: start,
            type: 'file',
            filters: [{ name: 'Photoshop', extensions: ['psd'] }],
        });
        if (!result || result.canceled || !result.filePaths || !result.filePaths.length) {
            return { ok: false };
        }
        const psd = await resolvePsdInput(result.filePaths[0]);
        return psd ? { ok: true, psd } : { ok: false, error: 'Không phải file .psd' };
    },

    async resolvePsd(raw) {
        const psd = await resolvePsdInput(raw);
        return psd ? { ok: true, psd } : { ok: false, error: 'Không phải file .psd: ' + raw };
    },

    async listArtboards(psdPath) {
        const env = await checkEnv();
        if (!env.ok) {
            return env;
        }
        const res = await runProcess(env.py[0], env.py[1].concat([scriptPath(), psdPath, '--list']));
        if (res.code !== 0) {
            return { ok: false, error: (res.err || res.out).trim().split(/\r?\n/).pop() };
        }
        const artboards = [];
        let size = '';
        for (const line of res.out.split(/\r?\n/)) {
            const m = /^\s+\d+\.\s(.*?)\s{2}bbox=\((\d+), (\d+), (\d+), (\d+)\)/.exec(line);
            if (m) {
                artboards.push({ name: m[1], w: m[4] - m[2], h: m[5] - m[3] });
            }
            const s = /^PSD .*\((\d+), (\d+)\)\s*$/.exec(line);
            if (s) {
                size = s[1] + 'x' + s[2];
            }
        }
        return { ok: true, artboards, size };
    },

    async installDeps() {
        const py = await findPython();
        if (!py) {
            return { ok: false, error: 'Không tìm thấy Python 3.' };
        }
        emit('$ pip install psd-tools', 'cmd');
        const res = await runProcess(py[0], py[1].concat(['-m', 'pip', 'install', 'psd-tools']), (l, isErr) => emit(l, isErr ? 'err' : 'out'));
        return res.code === 0 ? { ok: true } : { ok: false, error: 'pip install thất bại (xem log).' };
    },

    /**
     * options: { psd, out (db:// or fs), artboard, hidden, skip, names }
     * Returns { ok, outUrl, jsonUrl, spritesUrl, nodes, sprites, renamed, fixed }
     */
    async exportPsd(options) {
        const o = options || {};
        const psd = await resolvePsdInput(o.psd);
        if (!psd) {
            return { ok: false, error: 'Chưa chọn file PSD hợp lệ.' };
        }
        const env = await checkEnv();
        if (!env.ok) {
            return env;
        }

        const outRaw = String(o.out || psd.defaultOut).trim().replace(/\/+$/, '');
        const outFs = dbToFsSync(outRaw);
        const outUrl = outRaw.startsWith('db://') ? outRaw : fsToDbSync(outFs);
        if (!outUrl) {
            return { ok: false, error: 'Thư mục xuất phải nằm trong assets/: ' + outRaw };
        }

        const args = [scriptPath(), psd.path, '--out', outFs];
        if (o.artboard) {
            args.push('--artboard', o.artboard);
        }
        if (o.hidden) {
            args.push('--hidden');
        }
        if (o.skip) {
            args.push('--skip', o.skip);
        }
        if (o.names) {
            args.push('--names', dbToFsSync(o.names));
        }

        emit('$ python ' + args.map((a) => (/\s/.test(a) ? '"' + a + '"' : a)).join(' '), 'cmd');
        const res = await runProcess(env.py[0], env.py[1].concat(args), (l, isErr) => emit(l, isErr ? 'err' : 'out'));
        if (res.code !== 0) {
            return { ok: false, error: 'psd2map.py lỗi (exit ' + res.code + '), xem log.' };
        }

        const done = /Xong: (\d+) node \((\d+) sprite, (\d+) PNG\)/.exec(res.out);
        const renamed = /Doi ten (\d+)\/(\d+)/.exec(res.out);

        emit('Đang import vào asset-db...', 'cmd');
        await Editor.Message.request('asset-db', 'refresh-asset', outUrl).catch(() => null);
        const sf = await ensureSpriteFrames(path.join(outFs, 'sprites'));
        if (sf.fixed) {
            emit('Đã đổi ' + sf.fixed + '/' + sf.total + ' PNG sang sprite-frame.', 'ok');
        } else {
            emit(sf.total + ' PNG đều là sprite-frame.', 'ok');
        }

        const jsonUrl = outUrl + '/' + psd.name + '.json';
        log('exported ' + psd.path + ' -> ' + outUrl);
        return {
            ok: true,
            psdName: psd.name,
            outUrl,
            outPath: outFs,
            jsonUrl,
            spritesUrl: outUrl + '/sprites',
            nodes: done ? +done[1] : 0,
            sprites: done ? +done[2] : 0,
            pngs: done ? +done[3] : 0,
            renamed: renamed ? +renamed[1] : 0,
            fixed: sf.fixed,
        };
    },

    /**
     * Writes <out>/<psd>.names.json listing every node path with an empty value
     * (keeps existing entries). Returns its path so the panel can open it.
     */
    async namesTemplate(options) {
        const o = options || {};
        const psd = await resolvePsdInput(o.psd);
        if (!psd) {
            return { ok: false, error: 'Chưa chọn file PSD.' };
        }
        const outFs = dbToFsSync(String(o.out || psd.defaultOut).trim());
        const jsonFile = path.join(outFs, psd.name + '.json');
        if (!fs.existsSync(jsonFile)) {
            return { ok: false, error: 'Chưa có ' + psd.name + '.json — bấm Export trước.' };
        }
        const namesFile = path.join(outFs, psd.name + '.names.json');
        let names = {};
        if (fs.existsSync(namesFile)) {
            try {
                names = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
            } catch (e) {
                return { ok: false, error: 'names.json hiện tại bị lỗi JSON: ' + e.message };
            }
        }
        const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        const result = { _doc: names._doc || 'Map tên node cho SceneBuilder. Key = path node (hoặc tên PNG), value = tên mới. Để trống = giữ tên gốc. Sửa xong bấm Export lại.' };
        let added = 0;
        for (const n of data.nodes || []) {
            if (Object.prototype.hasOwnProperty.call(names, n.path)) {
                result[n.path] = names[n.path];
            } else if (n.sprite && Object.prototype.hasOwnProperty.call(names, n.sprite.key)) {
                result[n.sprite.key] = names[n.sprite.key];
            } else {
                result[n.path] = '';
                added++;
            }
        }
        for (const k of Object.keys(names)) {
            if (!(k in result)) {
                result[k] = names[k];
            }
        }
        fs.writeFileSync(namesFile, JSON.stringify(result, null, 2) + '\n', 'utf8');
        await Editor.Message.request('asset-db', 'refresh-asset', fsToDbSync(namesFile)).catch(() => null);
        try {
            require('electron').shell.openPath(namesFile);
        } catch (e) {
            /* open manually */
        }
        return { ok: true, file: namesFile, added };
    },

    /** Builds the JSON's node tree as "<name>" under Canvas (or the selected node). */
    async buildScene(options) {
        const o = options || {};
        const jsonFile = dbToFsSync(o.jsonUrl);
        if (!fs.existsSync(jsonFile)) {
            return { ok: false, error: 'Chưa có ' + o.jsonUrl + ' — bấm Export trước.' };
        }
        let data;
        try {
            data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        } catch (e) {
            return { ok: false, error: 'JSON lỗi: ' + e.message };
        }

        // key (tên PNG) -> uuid của SpriteFrame
        const frames = {};
        const infos = await Editor.Message.request('asset-db', 'query-assets',
            { pattern: o.spritesUrl + '/**/*', ccType: 'cc.SpriteFrame' }).catch(() => []) || [];
        for (const info of infos) {
            const key = keyFromAssetUrl(info.url || info.path || '');
            if (key) {
                frames[key] = info.uuid;
            }
        }
        if (!infos.length) {
            emit('Không thấy SpriteFrame nào trong ' + o.spritesUrl + ' (PNG chưa import / chưa là sprite-frame?)', 'err');
        }

        let parentUuid = '';
        if (o.underSelected) {
            try {
                parentUuid = (Editor.Selection.getSelected('node') || [])[0] || '';
            } catch (e) {
                parentUuid = '';
            }
        }
        try {
            return await Editor.Message.request('scene', 'execute-scene-script', {
                name: PKG,
                method: 'build',
                args: [{
                    data,
                    frames,
                    nodeName: o.nodeName,
                    parentUuid,
                    replace: !!o.replace,
                    spriteInChild: o.spriteInChild !== false,
                    imageSuffix: o.imageSuffix || 'Image',
                    applySorting: o.applySorting !== false,
                }],
            });
        } catch (e) {
            return { ok: false, error: 'Scene script lỗi: ' + e.message + ' (đã mở scene chưa?)' };
        }
    },

    reveal(target) {
        const p = dbToFsSync(String(target || ''));
        try {
            require('electron').shell.openPath(p);
        } catch (e) {
            /* ignore */
        }
    },
};

exports.load = function () {};
exports.unload = function () {};
