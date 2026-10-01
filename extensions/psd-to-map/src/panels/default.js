'use strict';

const fs = require('fs');
const path = require('path');

const PKG = 'psd-to-map';
const STATIC = path.join(__dirname, '..', '..', 'static');

exports.template = fs.readFileSync(path.join(STATIC, 'template', 'default.html'), 'utf8');
exports.style = fs.readFileSync(path.join(STATIC, 'style', 'default.css'), 'utf8');

exports.$ = {
    envIssue: '#envIssue',
    envText: '#envText',
    installDeps: '#installDeps',
    drop: '#drop',
    psd: '#psd',
    useSelected: '#useSelected',
    browse: '#browse',
    psdInfo: '#psdInfo',
    artboard: '#artboard',
    reloadArtboards: '#reloadArtboards',
    out: '#out',
    openOut: '#openOut',
    hidden: '#hidden',
    skip: '#skip',
    namesInfo: '#namesInfo',
    namesTemplate: '#namesTemplate',
    export: '#export',
    summary: '#summary',
    nodeName: '#nodeName',
    underSelected: '#underSelected',
    replace: '#replace',
    spriteInChild: '#spriteInChild',
    applySorting: '#applySorting',
    build: '#build',
    exportBuild: '#exportBuild',
    issues: '#issues',
    clearLog: '#clearLog',
    log: '#log',
};

/** Currently selected PSD: { path, url, name, defaultOut } */
let current = null;

function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PKG) || '{}');
    } catch (e) {
        return {};
    }
}

function savePrefs(prefs) {
    try {
        localStorage.setItem(PKG, JSON.stringify(prefs));
    } catch (e) {
        /* convenience only */
    }
}

function dbToFs(url) {
    if (url && url.startsWith('db://assets')) {
        return path.join(Editor.Project.path, 'assets', url.substring('db://assets'.length));
    }
    return url || '';
}

function req(method, ...args) {
    return Editor.Message.request(PKG, method, ...args).catch((e) => ({ ok: false, error: e.message }));
}

exports.methods = {
    // ------------------------------------------------------------ state

    outUrl() {
        return (this.$.out.value || '').trim().replace(/\/+$/, '') || (current ? current.defaultOut : '');
    },

    collect() {
        return {
            psd: current ? current.path : this.$.psd.value.trim(),
            out: this.outUrl(),
            artboard: this.$.artboard.value || '',
            hidden: !!this.$.hidden.value,
            skip: (this.$.skip.value || '').trim(),
        };
    },

    persist() {
        savePrefs({
            psd: current ? current.path : '',
            out: (this.$.out.value || '').trim(),
            hidden: !!this.$.hidden.value,
            skip: (this.$.skip.value || '').trim(),
            underSelected: !!this.$.underSelected.value,
            replace: !!this.$.replace.value,
            spriteInChild: !!this.$.spriteInChild.value,
            applySorting: !!this.$.applySorting.value,
        });
    },

    setBusy(busy) {
        ['export', 'build', 'exportBuild', 'namesTemplate', 'reloadArtboards', 'installDeps'].forEach((k) => {
            this.$[k].disabled = busy;
        });
    },

    // ------------------------------------------------------------ output

    onLog(msg) {
        const m = msg || {};
        let level = m.level || 'out';
        const line = String(m.line || '');
        if (level === 'out') {
            if (/^\s+(skip|empty|blank)\s/.test(line)) {
                level = 'warn';
            } else if (/^Xong:|^Doi ten/.test(line)) {
                level = 'ok';
            } else if (/^\s{2}\S/.test(line)) {
                level = 'dim';
            }
        }
        const div = document.createElement('div');
        div.className = level;
        div.textContent = line;
        const log = this.$.log;
        const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
        log.appendChild(div);
        while (log.childElementCount > 3000) {
            log.removeChild(log.firstChild);
        }
        if (stick) {
            log.scrollTop = log.scrollHeight;
        }
    },

    showIssues(issues) {
        if (!issues || !issues.length) {
            this.$.issues.classList.add('hidden');
            this.$.issues.innerHTML = '';
            return;
        }
        this.$.issues.classList.remove('hidden');
        this.$.issues.innerHTML = issues
            .map((i) => '<div class="issue ' + escapeHtml(i.level || 'info') + '">' + escapeHtml(i.message) + '</div>')
            .join('');
    },

    showEnv(res) {
        if (!res || res.ok || !res.code) {
            this.$.envIssue.classList.add('hidden');
            return;
        }
        this.$.envIssue.classList.remove('hidden');
        this.$.envText.textContent = res.error;
        this.$.installDeps.classList.toggle('hidden', res.code !== 'no-psd-tools');
    },

    refreshNamesInfo() {
        if (!current) {
            this.$.namesInfo.textContent = '';
            return;
        }
        const file = path.join(dbToFs(this.outUrl()), current.name + '.names.json');
        this.$.namesInfo.textContent = fs.existsSync(file)
            ? '✓ ' + current.name + '.names.json (Export sẽ đổi tên theo file này)'
            : 'Chưa có names.json — giữ tên layer gốc';
    },

    // ------------------------------------------------------------ PSD

    async setPsd(psd, keepOut) {
        if (!psd) {
            return;
        }
        current = psd;
        this.$.psd.value = psd.path;
        if (!keepOut) {
            this.$.out.value = psd.defaultOut;
        }
        this.$.nodeName.value = psd.name;
        this.$.psdInfo.textContent = psd.url || psd.path;
        this.showIssues([]);
        this.$.summary.textContent = '';
        this.persist();
        this.refreshNamesInfo();
        await this.loadArtboards();
    },

    onSelect(psd) {
        this.setPsd(psd);
    },

    async loadArtboards() {
        if (!current) {
            return;
        }
        this.$.artboard.innerHTML = '<option value="">(đang đọc...)</option>';
        const res = await req('list-artboards', current.path);
        this.showEnv(res);
        if (!res || !res.ok) {
            this.$.artboard.innerHTML = '<option value="">(artboard đầu tiên)</option>';
            if (res && !res.code) {
                this.showIssues([{ level: 'error', message: res.error || 'Không đọc được PSD.' }]);
            }
            return;
        }
        const boards = res.artboards || [];
        this.$.artboard.innerHTML = boards.length
            ? boards.map((b, i) => '<option value="' + escapeHtml(i === 0 ? '' : b.name) + '">'
                + escapeHtml(b.name + '  (' + b.w + 'x' + b.h + ')' + (i === 0 ? '  — mặc định' : '')) + '</option>').join('')
            : '<option value="">(không có artboard — xuất cả file ' + escapeHtml(res.size) + ')</option>';
        this.$.psdInfo.textContent = (current.url || current.path) + '   ·   ' + res.size
            + (boards.length ? '   ·   ' + boards.length + ' artboard' : '');
    },

    async resolveAndSet(raw) {
        const res = await req('resolve-psd', raw);
        if (!res || !res.ok) {
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Không phải file .psd' }]);
            return;
        }
        await this.setPsd(res.psd);
    },

    async onUseSelected() {
        const res = await req('collect-selected');
        if (!res || !res.ok) {
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Không đọc được selection.' }]);
            return;
        }
        await this.setPsd(res.psd);
    },

    async onBrowse() {
        const res = await req('browse-psd', current ? current.path : '');
        if (res && res.ok) {
            await this.setPsd(res.psd);
        } else if (res && res.error) {
            this.showIssues([{ level: 'error', message: res.error }]);
        }
    },

    async onDrop(event) {
        event.preventDefault();
        this.$.drop.classList.remove('hover');
        const items = [];
        const dt = event.dataTransfer;
        if (dt) {
            if (dt.files && dt.files.length && dt.files[0].path) {
                items.push(dt.files[0].path);
            }
            for (const key of ['value', 'uuid', 'text/plain']) {
                let v = '';
                try {
                    v = dt.getData(key);
                } catch (e) {
                    v = '';
                }
                if (!v) {
                    continue;
                }
                try {
                    const parsed = JSON.parse(v);
                    const list = Array.isArray(parsed) ? parsed : [parsed];
                    list.forEach((p) => items.push(typeof p === 'string' ? p : p && (p.uuid || p.value || p.url || p.path)));
                } catch (e) {
                    v.split(/[\n,]/).forEach((s) => items.push(s.trim()));
                }
                break;
            }
        }
        const detail = event.detail;
        if (detail) {
            (Array.isArray(detail) ? detail : [detail]).forEach((d) => items.push(typeof d === 'string' ? d : d && (d.uuid || d.value)));
        }
        for (const item of items.filter(Boolean)) {
            const res = await req('resolve-psd', item);
            if (res && res.ok) {
                await this.setPsd(res.psd);
                return;
            }
        }
        await this.onUseSelected();
    },

    // ------------------------------------------------------------ actions

    async doExport() {
        if (!current) {
            this.showIssues([{ level: 'error', message: 'Chọn file PSD trước.' }]);
            return null;
        }
        this.persist();
        this.showIssues([]);
        this.$.summary.textContent = 'Đang xuất...';
        const res = await req('export', this.collect());
        this.showEnv(res);
        this.refreshNamesInfo();
        if (!res || !res.ok) {
            this.$.summary.textContent = '';
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Export lỗi.' }]);
            return null;
        }
        this.$.summary.textContent = res.nodes + ' node · ' + res.pngs + ' PNG'
            + (res.renamed ? ' · đổi tên ' + res.renamed : '');
        const issues = [{ level: 'ok', message: 'Đã xuất vào ' + res.outUrl + (res.fixed ? ' — đã chuyển ' + res.fixed + ' PNG sang sprite-frame.' : '.') }];
        if (!res.renamed) {
            issues.push({ level: 'info', message: 'Layer tên số (1, 2, 3...)? Bấm "Tạo / sửa names.json", điền tên rồi Export lại.' });
        }
        this.showIssues(issues);
        return res;
    },

    async doBuild(exported) {
        if (!current) {
            this.showIssues([{ level: 'error', message: 'Chọn file PSD trước.' }]);
            return;
        }
        this.persist();
        const outUrl = exported ? exported.outUrl : this.outUrl();
        const opts = {
            jsonUrl: outUrl + '/' + current.name + '.json',
            spritesUrl: outUrl + '/sprites',
            nodeName: (this.$.nodeName.value || '').trim() || current.name,
            underSelected: !!this.$.underSelected.value,
            replace: !!this.$.replace.value,
            spriteInChild: !!this.$.spriteInChild.value,
            applySorting: !!this.$.applySorting.value,
        };
        this.onLog({ line: 'Dựng ' + opts.jsonUrl + ' vào scene...', level: 'cmd' });
        const res = await req('build-scene', opts);
        if (!res || !res.ok) {
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Dựng lỗi.' }]);
            return;
        }
        const issues = [{
            level: res.missing ? 'warn' : 'ok',
            message: (res.replaced ? 'Đã thay node cũ. ' : '') + 'Đã dựng "' + res.node + '": ' + res.nodes + ' node, ' + res.frames + ' SpriteFrame'
                + (res.missing ? ', THIẾU ẢNH ' + res.missing + ' sprite: ' + res.missingKeys.join(', ') : '')
                + (res.warnings > res.missing ? ' · ' + (res.warnings - res.missing) + ' cảnh báo khác (xem Console)' : '')
                + '. Nhấn Ctrl+S để lưu scene.',
        }];
        if (!res.uiLayer) {
            issues.push({ level: 'warn', message: 'Node cha không thuộc layer UI_2D — sprite có thể không hiện. Đặt dưới Canvas.' });
        }
        this.showIssues(issues);
        this.onLog({ line: issues.map((i) => i.message).join('\n'), level: res.missing ? 'warn' : 'ok' });
    },

    async onExport() {
        this.setBusy(true);
        await this.doExport();
        this.setBusy(false);
    },

    async onBuild() {
        this.setBusy(true);
        await this.doBuild(null);
        this.setBusy(false);
    },

    async onExportBuild() {
        this.setBusy(true);
        const res = await this.doExport();
        if (res) {
            // để asset-db import xong sub-asset spriteFrame trước khi SceneBuilder query
            await new Promise((r) => setTimeout(r, 800));
            await this.doBuild(res);
        }
        this.setBusy(false);
    },

    async onNamesTemplate() {
        this.setBusy(true);
        const res = await req('names-template', this.collect());
        this.setBusy(false);
        this.refreshNamesInfo();
        if (!res || !res.ok) {
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Lỗi tạo names.json' }]);
            return;
        }
        this.showIssues([{
            level: 'info',
            message: 'Đã mở ' + path.basename(res.file) + (res.added ? ' (thêm ' + res.added + ' dòng trống)' : '')
                + '. Điền tên mới vào value (để trống = giữ tên), lưu file, rồi bấm Export.',
        }]);
    },

    async onInstallDeps() {
        this.setBusy(true);
        const res = await req('install-deps');
        this.setBusy(false);
        if (!res || !res.ok) {
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Cài thất bại.' }]);
            return;
        }
        this.$.envIssue.classList.add('hidden');
        this.showIssues([{ level: 'ok', message: 'Đã cài psd-tools.' }]);
        await this.loadArtboards();
    },
};

exports.ready = async function () {
    const prefs = loadPrefs();
    this.$.hidden.value = !!prefs.hidden;
    this.$.skip.value = prefs.skip || '';
    this.$.underSelected.value = !!prefs.underSelected;
    this.$.replace.value = !!prefs.replace;
    this.$.spriteInChild.value = prefs.spriteInChild !== false;
    this.$.applySorting.value = prefs.applySorting !== false;
    this.$.artboard.innerHTML = '<option value="">(artboard đầu tiên)</option>';

    this.$.useSelected.addEventListener('confirm', this.onUseSelected.bind(this));
    this.$.browse.addEventListener('confirm', this.onBrowse.bind(this));
    this.$.reloadArtboards.addEventListener('confirm', this.loadArtboards.bind(this));
    this.$.openOut.addEventListener('confirm', () => Editor.Message.send(PKG, 'reveal', this.outUrl()));
    this.$.namesTemplate.addEventListener('confirm', this.onNamesTemplate.bind(this));
    this.$.export.addEventListener('confirm', this.onExport.bind(this));
    this.$.build.addEventListener('confirm', this.onBuild.bind(this));
    this.$.exportBuild.addEventListener('confirm', this.onExportBuild.bind(this));
    this.$.installDeps.addEventListener('confirm', this.onInstallDeps.bind(this));
    this.$.clearLog.addEventListener('confirm', () => { this.$.log.innerHTML = ''; });
    this.$.psd.addEventListener('change', () => this.resolveAndSet(this.$.psd.value));
    this.$.out.addEventListener('change', () => { this.persist(); this.refreshNamesInfo(); });
    ['hidden', 'skip', 'underSelected', 'replace', 'spriteInChild', 'applySorting'].forEach((k) => this.$[k].addEventListener('change', this.persist.bind(this)));

    const drop = this.$.drop;
    drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('hover');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('hover'));
    drop.addEventListener('drop', this.onDrop.bind(this));

    if (prefs.psd && fs.existsSync(prefs.psd)) {
        const res = await req('resolve-psd', prefs.psd);
        if (res && res.ok) {
            this.$.out.value = prefs.out || res.psd.defaultOut;
            await this.setPsd(res.psd, true);
        }
    }
};

exports.close = function () {};
