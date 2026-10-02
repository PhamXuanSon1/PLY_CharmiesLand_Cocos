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
    searchInput: '#searchInput', searchButton: '#searchButton',
};

let parentUuid = '';
let itemList = [];
let itemData = [];
let lastSearchTerm = '';
let searchIndex = 0;

function req(method, ...args) {
    return Editor.Message.request(PKG, method, ...args).catch((e) => ({ ok: false, error: e.message }));
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateGridColumns(panel) {
    const columns = Math.max(1, Math.floor(Number(panel.$.columns.value) || 1));
    panel.$.list.style.setProperty('--grid-columns', columns);
}

function searchItems(panel) {
    const term = String(panel.$.searchInput.value || '').trim().toLocaleLowerCase();
    const cards = Array.from(panel.$.list.querySelectorAll('.item'));
    cards.forEach((card) => card.classList.remove('search-match', 'search-current'));
    if (!term) {
        panel.$.status.textContent = 'Nhập tên item cần tìm.';
        return;
    }

    const matches = cards.filter((card) => {
        const name = card.querySelector('.details strong');
        return name && name.textContent.toLocaleLowerCase().includes(term);
    });
    if (!matches.length) {
        lastSearchTerm = term;
        searchIndex = 0;
        panel.$.status.textContent = 'Không tìm thấy item phù hợp.';
        return;
    }

    if (term === lastSearchTerm) searchIndex = (searchIndex + 1) % matches.length;
    else {
        lastSearchTerm = term;
        searchIndex = 0;
    }
    matches.forEach((card) => card.classList.add('search-match'));
    const current = matches[searchIndex];
    current.classList.add('search-current');
    current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    panel.$.status.textContent = matches.length > 1
        ? 'Tìm thấy ' + matches.length + ' item. Đang xem kết quả ' + (searchIndex + 1) + '.'
        : 'Đã tìm thấy item.';
}

async function renderList(panel) {
    updateGridColumns(panel);
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
        const inactiveClass = item.active ? '' : ' inactive';
        return '<div class="item' + inactiveClass + '" role="listitem" draggable="true" data-index="' + index + '">' +
            '<span class="order">' + (index + 1) + '</span>' +
            '<img class="thumb"' + (src ? ' src="' + escapeHtml(src) + '"' : '') + ' alt="" onerror="this.classList.add(\'missing\')">' +
            '<div class="details"><strong>' + escapeHtml(item.name) + '</strong><span>' + (item.active ? 'Active' : 'Inactive') +
            (item.spriteUuid ? '' : ' · No Sprite') + '</span></div>' +
            '</div>';
    }));
    panel.$.list.innerHTML = rows.join('') || '<div class="empty">Node cha chưa có node con.</div>';
    panel.$.list.querySelectorAll('.item').forEach((row) => {
        row.addEventListener('dragstart', (event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', row.dataset.index);
        });
        row.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', (event) => {
            event.preventDefault();
            row.classList.remove('drag-over');
            const from = Number(event.dataTransfer.getData('text/plain'));
            const to = Number(row.dataset.index);
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= itemList.length || to >= itemList.length || from === to) return;
            [itemList[from], itemList[to]] = [itemList[to], itemList[from]];
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
            ? 'Đã xếp ' + res.count + ' item, cập nhật thứ tự node con và ItemManager.itemList. Nhấn Ctrl+S để lưu scene.'
            : ((res && res.error) || 'Apply thất bại.');
    },
};

exports.ready = function () {
    this.$.load.addEventListener('confirm', this.loadItems.bind(this));
    this.$.apply.addEventListener('confirm', this.apply.bind(this));
    this.$.searchButton.addEventListener('confirm', () => searchItems(this));
    this.$.searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') searchItems(this);
    });
    this.$.searchInput.addEventListener('input', () => {
        lastSearchTerm = '';
        searchIndex = 0;
        this.$.status.textContent = '';
        this.$.list.querySelectorAll('.item').forEach((card) => card.classList.remove('search-match', 'search-current'));
    });
    this.$.columns.addEventListener('input', () => updateGridColumns(this));
};
exports.close = function () {};
