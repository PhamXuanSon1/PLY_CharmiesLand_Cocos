'use strict';

const fs = require('fs');
const path = require('path');
const { formatBytes, formatDuration } = require('../core/audio');

const PKG = 'audio-converter';
const STATIC = path.join(__dirname, '..', '..', 'static');

exports.template = fs.readFileSync(path.join(STATIC, 'template', 'default.html'), 'utf8');
exports.style = fs.readFileSync(path.join(STATIC, 'style', 'default.css'), 'utf8');

exports.$ = {
    drop: '#drop',
    addSelected: '#addSelected',
    browse: '#browse',
    clear: '#clear',
    fileList: '#fileList',
    format: '#format',
    rowRateMode: '#rowRateMode',
    rateMode: '#rateMode',
    rowBitrate: '#rowBitrate',
    bitrateKbps: '#bitrateKbps',
    bitratePresets: '#bitratePresets',
    rowVbr: '#rowVbr',
    vbrQuality: '#vbrQuality',
    vbrHint: '#vbrHint',
    sampleRate: '#sampleRate',
    channels: '#channels',
    normalize: '#normalize',
    trimSilence: '#trimSilence',
    output: '#output',
    rowSuffix: '#rowSuffix',
    suffix: '#suffix',
    rowFolder: '#rowFolder',
    folder: '#folder',
    browseFolder: '#browseFolder',
    deleteSource: '#deleteSource',
    overwriteExisting: '#overwriteExisting',
    reencodeSameFormat: '#reencodeSameFormat',
    backup: '#backup',
    refresh: '#refresh',
    preview: '#preview',
    convert: '#convert',
    cancelBtn: '#cancelBtn',
    revealBackup: '#revealBackup',
    progressWrap: '#progressWrap',
    progress: '#progress',
    progressText: '#progressText',
    issues: '#issues',
    result: '#result',
    logWrap: '#logWrap',
    log: '#log',
};

/** @type {Array<{path:string,url:string,name:string,codec:string,durationSec:number,bitrateKbps:number,sampleRate:number,channels:number,bytes:number}>} */
let files = [];
let lastBackupRoot = '';
let pollTimer = null;

/** Formats where bitrate / VBR quality make no sense. */
const LOSSLESS = ['wav', 'flac'];

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

function displayName(f) {
    return f.url || f.path;
}

exports.methods = {
    collect() {
        return {
            files: files.map((f) => f.path),
            format: this.$.format.value,
            rateMode: this.$.rateMode.value,
            bitrateKbps: Number(this.$.bitrateKbps.value),
            vbrQuality: Number(this.$.vbrQuality.value),
            sampleRate: Number(this.$.sampleRate.value),
            channels: Number(this.$.channels.value),
            normalize: !!this.$.normalize.value,
            trimSilence: !!this.$.trimSilence.value,
            output: this.$.output.value,
            suffix: this.$.suffix.value,
            folderUrl: this.$.folder.value.trim(),
            deleteSource: !!this.$.deleteSource.value,
            overwriteExisting: !!this.$.overwriteExisting.value,
            reencodeSameFormat: !!this.$.reencodeSameFormat.value,
            backup: !!this.$.backup.value,
            refresh: !!this.$.refresh.value,
        };
    },

    updateVisibility() {
        const format = this.$.format.value;
        const lossless = LOSSLESS.indexOf(format) !== -1;
        const vbrSupported = format === 'mp3' || format === 'ogg';
        const vbr = this.$.rateMode.value === 'vbr' && vbrSupported;

        this.$.rowRateMode.classList.toggle('hidden', lossless || !vbrSupported);
        this.$.rowBitrate.classList.toggle('hidden', lossless || vbr);
        this.$.rowVbr.classList.toggle('hidden', lossless || !vbr);
        this.$.vbrHint.textContent = format === 'ogg'
            ? 'OGG: 0 = nhỏ nhất, 10 = tốt nhất'
            : 'MP3: 0 = tốt nhất, 9 = nhỏ nhất';

        const out = this.$.output.value;
        this.$.rowSuffix.classList.toggle('hidden', out !== 'suffix');
        this.$.rowFolder.classList.toggle('hidden', out !== 'folder');
    },

    setBusy(busy) {
        this.$.preview.disabled = busy;
        this.$.convert.disabled = busy;
        this.$.cancelBtn.disabled = !busy;
        this.$.progressWrap.classList.toggle('hidden', !busy);
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

    renderFiles() {
        if (!files.length) {
            this.$.fileList.classList.add('hidden');
            this.$.fileList.innerHTML = '';
            return;
        }
        this.$.fileList.classList.remove('hidden');
        const total = files.reduce((sum, f) => sum + (f.bytes || 0), 0);
        const head = '<div class="listhead">' + files.length + ' file, tổng ' + formatBytes(total) + '</div>';
        const rows = files
            .map((f) => {
                const meta = [
                    (f.codec || '?').toUpperCase(),
                    f.durationSec ? formatDuration(f.durationSec) : '',
                    f.bitrateKbps ? f.bitrateKbps + ' kbps' : '',
                    f.sampleRate ? Math.round(f.sampleRate / 1000) + ' kHz' : '',
                    f.channels === 1 ? 'mono' : f.channels === 2 ? 'stereo' : '',
                    formatBytes(f.bytes),
                ].filter(Boolean).join(' · ');
                return '<div class="listrow"><span class="fname">' + escapeHtml(displayName(f)) +
                    '</span><span class="fmeta">' + escapeHtml(meta) + '</span></div>';
            })
            .join('');
        this.$.fileList.innerHTML = head + rows;
    },

    addFiles(incoming, errors) {
        const byPath = new Map(files.map((f) => [path.normalize(f.path).toLowerCase(), f]));
        for (const f of incoming || []) {
            byPath.set(path.normalize(f.path).toLowerCase(), f);
        }
        files = Array.from(byPath.values());
        this.renderFiles();
        this.showIssues((errors || []).map((e) => ({ level: 'warning', message: e })));
    },

    renderPlan(plan, isResult) {
        const rows = plan.rows || [];
        const todo = rows.filter((r) => r.ok && !r.skipped);
        const skipped = rows.filter((r) => r.ok && r.skipped);
        const failed = rows.filter((r) => !r.ok);

        const lines = rows.map((r) => {
            if (!r.ok) {
                return '<div class="listrow bad"><span class="fname">' + escapeHtml(r.name) +
                    '</span><span class="fmeta">LỖI: ' + escapeHtml(r.error) + '</span></div>';
            }
            if (r.skipped) {
                return '<div class="listrow muted"><span class="fname">' + escapeHtml(r.name) +
                    '</span><span class="fmeta">bỏ qua — ' + escapeHtml(r.reason || '') + '</span></div>';
            }
            const sizes = isResult && r.bytesOut !== undefined
                ? formatBytes(r.bytesIn) + ' → ' + formatBytes(r.bytesOut) +
                  ' (' + (r.bytesIn ? Math.round((1 - r.bytesOut / r.bytesIn) * 100) : 0) + '% nhỏ hơn)'
                : formatBytes(r.bytesIn);
            const deleted = r.sourceDeleted ? ' · đã xoá file gốc' : '';
            return '<div class="listrow"><span class="fname">' + escapeHtml(r.name) + ' → ' +
                escapeHtml(path.basename(r.outputPath)) + '</span><span class="fmeta">' +
                escapeHtml(sizes + deleted) + '</span></div>';
        }).join('');

        let summary = isResult
            ? 'Xong: ' + todo.length + ' file, ' + formatBytes(plan.bytesIn || 0) + ' → ' + formatBytes(plan.bytesOut || 0)
            : 'Sẽ convert ' + todo.length + ' file';
        if (skipped.length) {
            summary += ' · bỏ qua ' + skipped.length;
        }
        if (failed.length) {
            summary += ' · lỗi ' + failed.length;
        }

        this.$.result.classList.remove('hidden');
        this.$.result.innerHTML = '<div class="listhead">' + escapeHtml(summary) + '</div>' + lines;
    },

    appendLog(entries) {
        if (!entries || !entries.length) {
            return;
        }
        this.$.log.textContent = entries.join('\n');
        this.$.logWrap.classList.remove('hidden');
        this.$.log.scrollTop = this.$.log.scrollHeight;
    },

    startPolling() {
        const self = this;
        clearInterval(pollTimer);
        pollTimer = setInterval(async () => {
            const status = await Editor.Message.request(PKG, 'progress-status').catch(() => null);
            if (!status) {
                return;
            }
            self.$.progress.value = status.percent / 100;
            self.$.progressText.textContent = status.message || '';
            self.appendLog(status.log);
            if (!status.running) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }, 200);
    },

    async onAddSelected() {
        const res = await Editor.Message.request(PKG, 'collect-selected').catch((e) => ({ ok: false, error: e.message }));
        if (!res || !res.ok) {
            this.showIssues([{ level: 'warning', message: (res && res.error) || 'Không đọc được selection.' }]);
            return;
        }
        this.addFiles(res.files, res.errors);
    },

    async onBrowse() {
        const res = await Editor.Message.request(PKG, 'browse-files').catch(() => null);
        if (!res || !res.ok) {
            return;
        }
        this.addFiles(res.files, res.errors);
    },

    async onBrowseFolder() {
        const res = await Editor.Message.request(PKG, 'browse-folder', this.$.folder.value.trim()).catch(() => null);
        if (!res || !res.ok) {
            return;
        }
        this.$.folder.value = res.url || res.path;
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
            if (dt.files && dt.files.length) {
                for (const f of dt.files) {
                    if (f.path) {
                        items.push(f.path);
                    }
                }
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
        const clean = items.filter(Boolean);
        if (!clean.length) {
            // Fall back to whatever is selected in the Assets panel (the dragged items usually are).
            return this.onAddSelected();
        }
        const res = await Editor.Message.request(PKG, 'resolve-inputs', clean).catch(() => null);
        if (!res || !res.ok) {
            return this.onAddSelected();
        }
        this.addFiles(res.files, res.errors);
    },

    async onPreview() {
        if (!files.length) {
            this.showIssues([{ level: 'warning', message: 'Thêm ít nhất 1 file âm thanh trước đã.' }]);
            return;
        }
        const options = this.collect();
        savePrefs(options);
        this.setBusy(true);
        this.$.progressText.textContent = 'Đang phân tích...';
        const res = await Editor.Message.request(PKG, 'analyze', options).catch((e) => ({ ok: false, error: e.message }));
        this.setBusy(false);
        if (!res || !res.ok) {
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Analyze thất bại.' }]);
            return;
        }
        this.showIssues([]);
        this.renderPlan(res.plan, false);
    },

    async onConvert() {
        if (!files.length) {
            this.showIssues([{ level: 'warning', message: 'Thêm ít nhất 1 file âm thanh trước đã.' }]);
            return;
        }
        const options = this.collect();
        savePrefs(options);
        this.setBusy(true);
        this.$.log.textContent = '';
        this.$.progress.value = 0;
        this.startPolling();
        const res = await Editor.Message.request(PKG, 'run', options).catch((e) => ({ ok: false, error: e.message }));
        clearInterval(pollTimer);
        pollTimer = null;
        this.setBusy(false);
        if (!res || !res.ok) {
            this.appendLog((res && res.log) || []);
            this.showIssues([{ level: 'error', message: (res && res.error) || 'Convert thất bại.' }]);
            return;
        }
        const result = res.result;
        lastBackupRoot = result.backupRoot || '';
        this.$.revealBackup.classList.toggle('hidden', !lastBackupRoot);
        this.$.progress.value = 1;
        this.$.progressText.textContent = result.cancelled ? 'Đã huỷ.' : 'Xong.';
        this.appendLog(result.log);
        this.renderPlan(result, true);
        const failed = result.rows.filter((r) => !r.ok);
        this.showIssues(failed.map((r) => ({ level: 'error', message: r.name + ': ' + r.error })));

        // Sources may have been deleted or re-encoded in place; re-probe what is left.
        const paths = files.map((f) => f.path).filter((p) => fs.existsSync(p));
        const fresh = await Editor.Message.request(PKG, 'resolve-inputs', paths).catch(() => null);
        if (fresh && fresh.ok) {
            files = fresh.files;
            this.renderFiles();
        }
    },

    async onCancel() {
        await Editor.Message.request(PKG, 'cancel').catch(() => null);
        this.$.progressText.textContent = 'Đang huỷ...';
    },
};

exports.ready = function () {
    const prefs = loadPrefs();
    const setIf = (el, key, fallback) => {
        if (prefs[key] !== undefined && prefs[key] !== null && prefs[key] !== '') {
            el.value = prefs[key];
        } else if (fallback !== undefined) {
            el.value = fallback;
        }
    };
    setIf(this.$.format, 'format', 'mp3');
    setIf(this.$.rateMode, 'rateMode', 'cbr');
    setIf(this.$.bitrateKbps, 'bitrateKbps', 128);
    setIf(this.$.vbrQuality, 'vbrQuality', 4);
    setIf(this.$.sampleRate, 'sampleRate', '0');
    setIf(this.$.channels, 'channels', '0');
    setIf(this.$.normalize, 'normalize', false);
    setIf(this.$.trimSilence, 'trimSilence', false);
    setIf(this.$.output, 'output', 'sibling');
    setIf(this.$.suffix, 'suffix', '_converted');
    setIf(this.$.folder, 'folderUrl', '');
    setIf(this.$.deleteSource, 'deleteSource', false);
    setIf(this.$.overwriteExisting, 'overwriteExisting', false);
    setIf(this.$.reencodeSameFormat, 'reencodeSameFormat', false);
    setIf(this.$.backup, 'backup', true);
    setIf(this.$.refresh, 'refresh', true);
    this.updateVisibility();

    this.$.addSelected.addEventListener('confirm', this.onAddSelected.bind(this));
    this.$.browse.addEventListener('confirm', this.onBrowse.bind(this));
    this.$.browseFolder.addEventListener('confirm', this.onBrowseFolder.bind(this));
    this.$.clear.addEventListener('confirm', () => {
        files = [];
        this.renderFiles();
        this.$.result.classList.add('hidden');
        this.showIssues([]);
    });
    this.$.preview.addEventListener('confirm', this.onPreview.bind(this));
    this.$.convert.addEventListener('confirm', this.onConvert.bind(this));
    this.$.cancelBtn.addEventListener('confirm', this.onCancel.bind(this));
    this.$.revealBackup.addEventListener('confirm', () => {
        if (lastBackupRoot) {
            Editor.Message.send(PKG, 'reveal', lastBackupRoot);
        }
    });
    this.$.format.addEventListener('change', this.updateVisibility.bind(this));
    this.$.rateMode.addEventListener('change', this.updateVisibility.bind(this));
    this.$.output.addEventListener('change', this.updateVisibility.bind(this));
    this.$.bitratePresets.querySelectorAll('ui-button').forEach((btn) => {
        btn.addEventListener('confirm', () => {
            this.$.bitrateKbps.value = Number(btn.getAttribute('data-b'));
        });
    });

    const drop = this.$.drop;
    drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('hover');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('hover'));
    drop.addEventListener('drop', this.onDrop.bind(this));
};

exports.close = function () {
    clearInterval(pollTimer);
    pollTimer = null;
};
