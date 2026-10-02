'use strict';

const fs = require('fs');
const path = require('path');
const PKG = 'grid-arrange-tool';

exports.template = fs.readFileSync(path.join(__dirname, '..', '..', 'static', 'template', 'default.html'), 'utf8');
exports.style = fs.readFileSync(path.join(__dirname, '..', '..', 'static', 'style', 'default.css'), 'utf8');
exports.$ = {
    parentName: '#parentName', columns: '#columns', spacingX: '#spacingX', spacingY: '#spacingY',
    startX: '#startX', startY: '#startY', centerGrid: '#centerGrid', skipInactive: '#skipInactive',
    load: '#load', apply: '#apply', list: '#list', status: '#status', spawnMode: '#spawnMode',
};

let parentUuid = '';
let itemList = [];
let itemData = [];

function req(method, ...args) {
    return Editor.Message.request(PKG, method, ...args).catch((e) => ({ ok: false, error: e.message }));
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function moveItem(index, delta, panel) {
    const next = index + delta;
    if (next < 0 || next >= itemList.length) return;
    [itemList[index], itemList[next]] = [itemList[next], itemList[index]];
    renderList(panel);
}

async function renderList(panel) {
    const byUuid = new Map(itemData.map((item) => [item.uuid, item]));
    const rows = await Promise.all(itemList.map(async (uuid, index) => {
        const item = byUuid.get(uuid);
        if (!item) return '';
        const file = item.spriteUuid ? await req('thumbnail-path', item.spriteUuid) : '';
        let src = '';
        if (typeof file === 'string' && file) {
            const normalized = file.replace(/\\/g, '/');
            src = 'file:///' + normalized.split('/').map((part, i) => i === 0 ? part : encodeURIComponent(part)).join('/');
        }
        return '<div class="item" draggable="true" data-index="' + index + '">' +
            '<img class="thumb"' + (src ? ' src="' + escapeHtml(src) + '"' : '') + ' alt="" onerror="this.classList.add(\'missing\')">' +
            '<div class="details"><strong>' + escapeHtml(item.name) + '</strong><span>' + (item.active ? 'Active' : 'Inactive') +
            (item.spriteUuid ? '' : ' · No Sprite') + '</span></div><span class="order">' + (index + 1) + '</span>' +
            '<button class="up" data-index="' + index + '" title="Move up">↑</button>' +
            '<button class="down" data-index="' + index + '" title="Move down">↓</button></div>';
    }));
    panel.$.list.innerHTML = rows.join('') || '<div class="empty">Node cha chưa có node con.</div>';
    panel.$.list.querySelectorAll('.up').forEach((button) => button.addEventListener('click', () => moveItem(Number(button.dataset.index), -1, panel)));
    panel.$.list.querySelectorAll('.down').forEach((button) => button.addEventListener('click', () => moveItem(Number(button.dataset.index), 1, panel)));
    panel.$.list.querySelectorAll('.item').forEach((row) => {
        row.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', row.dataset.index));
        row.addEventListener('dragover', (event) => event.preventDefault());
        row.addEventListener('drop', (event) => {
            event.preventDefault();
            const from = Number(event.dataTransfer.getData('text/plain'));
            const to = Number(row.dataset.index);
            if (from === to || !Number.isInteger(from)) return;
            const [moved] = itemList.splice(from, 1);
            itemList.splice(to, 0, moved);
            renderList(panel);
        });
    });
}

exports.methods = {
    async loadItems() {
        const selected = Editor.Selection.getSelected('node') || [];
        if (!selected.length) {
            this.$.status.textContent = 'Chọn node cha chứa các item trong Hierarchy trước.';
            return;
        }
        const res = await req('load-items', selected[0]);
        if (!res || !res.ok) {
            this.$.status.textContent = (res && res.error) || 'Không tải được item.';
            return;
        }
        parentUuid = res.parent.uuid;
        itemData = res.items || [];
        const byUuid = new Map(itemData.map((item) => [item.uuid, item]));
        const savedOrder = res.spawnFromLast ? (res.currentOrder || []).slice().reverse() : (res.currentOrder || []);
        const saved = savedOrder.filter((uuid) => byUuid.has(uuid));
        itemList = saved.concat(itemData.filter((item) => !saved.includes(item.uuid))
            .sort((a, b) => a.siblingIndex - b.siblingIndex).map((item) => item.uuid));
        this.$.parentName.textContent = res.parent.name + ' · ' + itemData.length + ' items';
        this.$.spawnMode.textContent = res.managerFound
            ? (res.spawnFromLast ? 'Danh sách hiển thị theo thứ tự spawn thực tế; ItemManager lấy từ cuối itemList.' : 'Danh sách hiển thị theo thứ tự spawn thực tế; ItemManager lấy từ đầu itemList.')
            : 'Chưa tìm thấy ItemManager trong scene.';
        this.$.apply.disabled = !res.managerFound || !itemData.length;
        this.$.status.textContent = '';
        await renderList(this);
    },

    async apply() {
        if (!parentUuid || !itemList.length) {
            this.$.status.textContent = 'Hãy tải danh sách item trước.';
            return;
        }
        this.$.apply.disabled = true;
        const res = await req('apply-layout', {
            parentUuid,
            itemUuids: itemList,
            columns: Number(this.$.columns.value),
            spacingX: Number(this.$.spacingX.value),
            spacingY: Number(this.$.spacingY.value),
            startX: Number(this.$.startX.value),
            startY: Number(this.$.startY.value),
            centerGrid: !!this.$.centerGrid.value,
            skipInactive: !!this.$.skipInactive.value,
        });
        this.$.apply.disabled = false;
        this.$.status.textContent = res && res.ok
            ? 'Đã xếp ' + res.count + ' item thành lưới ' + res.columns + ' × ' + res.rows + ' và cập nhật ItemManager.itemList. Nhấn Ctrl+S để lưu scene.'
            : ((res && res.error) || 'Apply thất bại.');
    },
};

exports.ready = function () {
    this.$.load.addEventListener('confirm', this.loadItems.bind(this));
    this.$.apply.addEventListener('confirm', this.apply.bind(this));
};
exports.close = function () {};
