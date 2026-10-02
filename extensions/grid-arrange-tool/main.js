'use strict';

const path = require('path');

const PKG = 'grid-arrange-tool';

exports.methods = {
    openPanel() {
        Editor.Panel.open(PKG);
    },

    async loadItems(parentUuid) {
        if (!parentUuid) {
            return { ok: false, error: 'Hãy chọn node cha chứa các item trong Hierarchy.' };
        }
        try {
            return await Editor.Message.request('scene', 'execute-scene-script', {
                name: PKG,
                method: 'loadItems',
                args: [parentUuid],
            });
        } catch (e) {
            return { ok: false, error: 'Không đọc được scene đang mở: ' + e.message };
        }
    },

    async applyLayout(options) {
        const o = options || {};
        if (!o.parentUuid || !Array.isArray(o.itemUuids)) {
            return { ok: false, error: 'Thiếu node cha hoặc thứ tự item.' };
        }
        try {
            return await Editor.Message.request('scene', 'execute-scene-script', {
                name: PKG,
                method: 'applyLayout',
                args: [o],
            });
        } catch (e) {
            return { ok: false, error: 'Không cập nhật được scene: ' + e.message };
        }
    },

    async thumbnailPath(uuid) {
        if (!uuid) return '';
        try {
            const baseUuid = String(uuid).split('@')[0];
            const info = await Editor.Message.request('asset-db', 'query-asset-info', baseUuid);
            if (!info) return '';
            if (info.file) return path.resolve(info.file);
            if (info.url && info.url.startsWith('db://assets')) {
                return path.join(Editor.Project.path, 'assets', info.url.substring('db://assets'.length));
            }
            return info.path ? path.resolve(info.path) : '';
        } catch (e) {
            return '';
        }
    },
};

exports.load = function () {};
exports.unload = function () {};
