'use strict';

const fs = require('fs');
const path = require('path');

const PKG = 'texture-compress-batch';
const STATIC = path.join(__dirname, '..', '..', 'static');

exports.template = fs.readFileSync(path.join(STATIC, 'template', 'default.html'), 'utf8');
exports.style = fs.readFileSync(path.join(STATIC, 'style', 'default.css'), 'utf8');

exports.$ = {
    drop: '#drop',
    folder: '#folder',
    useSelected: '#useSelected',
    browse: '#browse',
    mode: '#mode',
    rowPreset: '#rowPreset',
    preset: '#preset',
    reloadPresets: '#reloadPresets',
    presetHint: '#presetHint',
    includeAtlas: '#includeAtlas',
    rowForce: '#rowForce',
    force: '#force',
    scan: '#scan',
    apply: '#apply',
    summary: '#summary',
    issues: '#issues',
    list: '#list',
};

let presets = [];

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

exports.methods = {
    collect() {
        return {
            folder: this.$.folder.value.trim(),
            mode: this.$.mode.value,
            presetId: this.$.preset.value,
            includeAtlas: !!this.$.includeAtlas.value,
            force: !!this.$.force.value,
        };
    },

    persist() {
        savePrefs(this.collect());
    },

    updateVisibility() {
        const disable = this.$.mode.value === 'disable';
        this.$.rowPreset.classList.toggle('hidden', disable);
        this.$.presetHint.classList.toggle('hidden', disable);
        this.$.rowForce.classList.toggle('hidden', disable);
        this.$.apply.textContent = disable ? 'Disable' : 'Apply';
        this.updatePresetHint();
    },

    updatePresetHint() {
        const p = presets.find((x) => x.id === this.$.preset.value);
        this.$.presetHint.textContent = p
            ? 'id: ' + p.id + (p.formats.length ? '   |   ' + p.formats.join(', ') : '')
            : '';
    },

    async loadPresets() {
        const keep = this.$.preset.value;
        const res = await Editor.Message.request(PKG, 'list-presets').catch(() => null);
        presets = (res && res.presets) || [];
        this.$.preset.innerHTML = presets.length
            ? presets.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + '</option>').join('')
            : '<option value="">(no preset in Project Settings)</option>';
        const wanted = keep || loadPrefs().presetId;
        this.$.preset.value = presets.some((p) => p.id === wanted) ? wanted : (presets[0] ? presets[0].id : '');
        this.updatePresetHint();
        if (!presets.length) {
            this.showIssues([{ level: 'info', message: 'Chưa có preset nào. Tạo trong Project Settings → Texture Compress rồi bấm ↻.' }]);
        }
    },

    setFolder(folder) {
        if (!folder) {
            return;
        }
        this.$.folder.value = folder.url || folder.path;
        this.persist();
        this.clearResult();
    },

    setBusy(busy) {
        this.$.scan.disabled = busy;
        this.$.apply.disabled = busy;
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

    clearResult() {
        this.$.list.classList.add('hidden');
        this.$.list.innerHTML = '';
        this.$.summary.textContent = '';
        this.showIssues([]);
    },

    renderPlan(plan, applied) {
        const rows = plan.rows;
        const count = (a) => rows.filter((r) => r.action === a).length;
        const parts = [];
        if (applied) {
            parts.push(count('done') + ' updated');
        } else {
            parts.push(count('update') + ' to update');
        }
        parts.push(count('skip') + ' skipped');
        if (count('error')) {
            parts.push(count('error') + ' error');
        }
        this.$.summary.textContent = rows.length + ' found · ' + parts.join(' · ');

        if (!rows.length) {
            this.$.list.classList.remove('hidden');
            this.$.list.innerHTML = '<span class="muted">Không có SpriteFrame nào trong ' + escapeHtml(plan.folder.url || plan.folder.path) + '</span>';
            return;
        }
        const label = { update: 'will update', done: 'updated', skip: 'skip', error: 'error' };
        this.$.list.classList.remove('hidden');
        this.$.list.innerHTML = '<table><thead><tr><th>Asset</th><th>Type</th><th>Current</th><th>Status</th></tr></thead><tbody>'
            + rows.map((r) => {
                const cur = r.current && r.current.useCompressTexture
                    ? (presets.find((p) => p.id === r.current.presetId) || { name: r.current.presetId }).name
                    : '-';
                return '<tr>'
                    + '<td class="name" title="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</td>'
                    + '<td class="kind">' + escapeHtml(r.kind) + '</td>'
                    + '<td class="kind">' + escapeHtml(cur) + '</td>'
                    + '<td class="st-' + escapeHtml(r.action) + '">' + escapeHtml(label[r.action] || r.action)
                    + (r.reason ? ' <span class="muted">— ' + escapeHtml(r.reason) + '</span>' : '') + '</td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    },

    async onUseSelected() {
        const res = await Editor.Message.request(PKG, 'collect-selected').catch((e) => ({ ok: false, error: e.message }));
        if (!res || !res.ok) {
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Cannot read selection.' }]);
            return;
        }
        this.setFolder(res.folder);
    },

    async onBrowse() {
        const res = await Editor.Message.request(PKG, 'browse-folder', this.$.folder.value.trim()).catch(() => null);
        if (!res || !res.ok) {
            if (res && res.error) {
                this.showIssues([{ level: 'error', message: res.error }]);
            }
            return;
        }
        this.setFolder(res.folder);
    },

    async onDrop(event) {
        event.preventDefault();
        this.$.drop.classList.remove('hover');
        const items = [];
        const dt = event.dataTransfer;
        if (dt) {
            for (const key of ['value', 'uuid', 'text/plain']) {
                let v = '';
                try {
                    v = dt.getData(key);
                } catch (e) {
                    v = '';
                }
                if (v) {
                    try {
                        const parsed = JSON.parse(v);
                        if (Array.isArray(parsed)) {
                            parsed.forEach((p) => items.push(typeof p === 'string' ? p : p && (p.uuid || p.value || p.url || p.path)));
                        } else if (parsed && typeof parsed === 'object') {
                            items.push(parsed.uuid || parsed.value || parsed.url || parsed.path);
                        } else {
                            items.push(String(parsed));
                        }
                    } catch (e) {
                        v.split(/[\n,]/).forEach((s) => items.push(s.trim()));
                    }
                    break;
                }
            }
            if (dt.files && dt.files.length && dt.files[0].path) {
                items.push(dt.files[0].path);
            }
        }
        const detail = event.detail;
        if (detail) {
            if (Array.isArray(detail)) {
                detail.forEach((d) => items.push(typeof d === 'string' ? d : d && (d.uuid || d.value)));
            } else if (detail.uuid || detail.value) {
                items.push(detail.uuid || detail.value);
            }
        }
        const first = items.filter(Boolean)[0];
        if (!first) {
            return this.onUseSelected();
        }
        const res = await Editor.Message.request(PKG, 'resolve-folder', first).catch(() => null);
        if (!res || !res.ok) {
            return this.onUseSelected();
        }
        this.setFolder(res.folder);
    },

    async onScan() {
        this.persist();
        this.clearResult();
        this.setBusy(true);
        const res = await Editor.Message.request(PKG, 'scan', this.collect()).catch((e) => ({ ok: false, error: e.message }));
        this.setBusy(false);
        if (!res || !res.ok) {
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Scan failed.' }]);
            return;
        }
        this.renderPlan(res.plan, false);
    },

    async onApply() {
        this.persist();
        this.clearResult();
        this.setBusy(true);
        const res = await Editor.Message.request(PKG, 'apply', this.collect()).catch((e) => ({ ok: false, error: e.message }));
        this.setBusy(false);
        if (!res || !res.ok) {
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Apply failed.' }]);
            return;
        }
        this.renderPlan(res.plan, true);
        const issues = [];
        if (res.updated) {
            issues.push({
                level: 'info',
                message: res.viaAssetDb
                    ? 'Đã ghi ' + res.updated + ' meta qua asset-db, editor đang re-import.'
                    : 'Đã ghi ' + res.updated + ' meta trực tiếp và refresh asset. Nếu Inspector chưa cập nhật, Refresh panel Assets (Ctrl+R).',
            });
        }
        res.failed.forEach((f) => issues.push({ level: 'error', message: f }));
        this.showIssues(issues);
    },
};

exports.ready = async function () {
    const prefs = loadPrefs();
    this.$.folder.value = prefs.folder || '';
    this.$.mode.value = prefs.mode || 'enable';
    this.$.includeAtlas.value = !!prefs.includeAtlas;
    this.$.force.value = !!prefs.force;

    await this.loadPresets();
    this.updateVisibility();

    this.$.useSelected.addEventListener('confirm', this.onUseSelected.bind(this));
    this.$.browse.addEventListener('confirm', this.onBrowse.bind(this));
    this.$.reloadPresets.addEventListener('confirm', this.loadPresets.bind(this));
    this.$.scan.addEventListener('confirm', this.onScan.bind(this));
    this.$.apply.addEventListener('confirm', this.onApply.bind(this));
    this.$.mode.addEventListener('change', () => { this.updateVisibility(); this.persist(); });
    this.$.preset.addEventListener('change', () => { this.updatePresetHint(); this.persist(); });
    this.$.includeAtlas.addEventListener('change', this.persist.bind(this));
    this.$.force.addEventListener('change', this.persist.bind(this));
    this.$.folder.addEventListener('change', () => { this.persist(); this.clearResult(); });

    const drop = this.$.drop;
    drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('hover');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('hover'));
    drop.addEventListener('drop', this.onDrop.bind(this));
};

exports.close = function () {};
