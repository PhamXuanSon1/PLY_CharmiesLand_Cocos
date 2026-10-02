'use strict';

const { join } = require('path');
module.paths.push(join(Editor.App.path, 'node_modules'));

function findByUuid(root, uuid) {
    if (!root) return null;
    if (root.uuid === uuid) return root;
    for (const child of root.children) {
        const found = findByUuid(child, uuid);
        if (found) return found;
    }
    return null;
}

function findItemManager(root, cc) {
    for (const component of root.getComponentsInChildren(cc.Component)) {
        const name = cc.js.getClassName(component.constructor) || component.constructor.name;
        if (name === 'ItemManager' && Array.isArray(component.itemList)) return component;
    }
    return null;
}

function measure(node, cc) {
    const rects = [];
    const inverse = node.worldMatrix.clone().invert();
    for (const transform of node.getComponentsInChildren(cc.UITransform)) {
        const size = transform.contentSize;
        if (size.width <= 0 && size.height <= 0) continue;
        const local = new cc.Rect(-size.width * transform.anchorX, -size.height * transform.anchorY,
            size.width, size.height);
        const corners = [
            new cc.Vec3(local.xMin, local.yMin, 0), new cc.Vec3(local.xMax, local.yMin, 0),
            new cc.Vec3(local.xMin, local.yMax, 0), new cc.Vec3(local.xMax, local.yMax, 0),
        ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const corner of corners) {
            const world = cc.Vec3.transformMat4(new cc.Vec3(), corner, transform.node.worldMatrix);
            const point = cc.Vec3.transformMat4(new cc.Vec3(), world, inverse);
            minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
        }
        rects.push(new cc.Rect(minX, minY, maxX - minX, maxY - minY));
    }
    if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
    const bounds = rects.reduce((a, b) => cc.Rect.union(new cc.Rect(), a, b));
    const scale = node.scale;
    return {
        x: bounds.x * Math.abs(scale.x), y: bounds.y * Math.abs(scale.y),
        width: bounds.width * Math.abs(scale.x), height: bounds.height * Math.abs(scale.y),
    };
}

function getSpriteUuid(node, cc) {
    for (const sprite of node.getComponentsInChildren(cc.Sprite)) {
        if (sprite.spriteFrame) return sprite.spriteFrame.uuid || '';
    }
    return '';
}

exports.methods = {
    loadItems(parentUuid) {
        const cc = require('cc');
        const scene = cc.director.getScene();
        if (!scene) return { ok: false, error: 'Chưa mở scene.' };
        const parent = findByUuid(scene, parentUuid);
        if (!parent) return { ok: false, error: 'Không tìm thấy node cha đã chọn. Hãy refresh lại.' };
        const manager = findItemManager(scene, cc);
        return {
            ok: true,
            parent: { uuid: parent.uuid, name: parent.name },
            managerFound: !!manager,
            spawnFromLast: manager ? manager.spawnFromLast : false,
            currentOrder: manager ? manager.itemList.map((node) => node && node.uuid).filter(Boolean) : [],
            items: parent.children.map((node, index) => ({
                uuid: node.uuid,
                name: node.name,
                active: node.active,
                siblingIndex: index,
                spriteUuid: getSpriteUuid(node, cc),
                bounds: measure(node, cc),
            })),
        };
    },

    applyLayout(options) {
        const cc = require('cc');
        const scene = cc.director.getScene();
        if (!scene) return { ok: false, error: 'Chưa mở scene.' };
        const parent = findByUuid(scene, options.parentUuid);
        if (!parent) return { ok: false, error: 'Không tìm thấy node cha đã chọn. Hãy refresh lại.' };

        const manager = findItemManager(scene, cc);
        if (!manager) return { ok: false, error: 'Không tìm thấy component ItemManager trong scene đang mở.' };
        const byUuid = new Map(parent.children.map((node) => [node.uuid, node]));
        const items = options.itemUuids.map((uuid) => byUuid.get(uuid)).filter(Boolean);
        if (items.length !== options.itemUuids.length) {
            return { ok: false, error: 'Danh sách item đã thay đổi trong scene. Hãy bấm Tải lại trước khi Apply.' };
        }
        if (!items.length) return { ok: false, error: 'Node cha không có item con để sắp xếp.' };
        const selectedItems = new Set(items);
        const preservedItems = manager.itemList.filter((node) => node && node.isValid && !selectedItems.has(node));

        const cols = Math.max(1, Math.floor(Number(options.columns) || 1));
        const gapX = Number(options.spacingX) || 0;
        const gapY = Number(options.spacingY) || 0;
        const arrangedItems = options.skipInactive ? items.filter((node) => node.active) : items;
        const rects = arrangedItems.map((node) => measure(node, cc));
        const rowCount = Math.ceil(arrangedItems.length / cols);
        const colWidths = Array(cols).fill(0);
        const rowHeights = Array(rowCount).fill(0);
        rects.forEach((rect, i) => {
            colWidths[i % cols] = Math.max(colWidths[i % cols], rect.width);
            const row = Math.floor(i / cols);
            rowHeights[row] = Math.max(rowHeights[row], rect.height);
        });
        const usedCols = Math.min(cols, arrangedItems.length);
        const totalW = usedCols
            ? colWidths.slice(0, usedCols).reduce((a, b) => a + b, 0) + gapX * (usedCols - 1)
            : 0;
        const totalH = rowCount ? rowHeights.reduce((a, b) => a + b, 0) + gapY * (rowCount - 1) : 0;
        let originX = Number(options.startX) || 0;
        let originY = Number(options.startY) || 0;
        if (options.centerGrid) { originX -= totalW / 2; originY += totalH / 2; }
        const colX = [];
        let x = originX;
        for (let col = 0; col < cols; col++) { colX.push(x); x += colWidths[col] + gapX; }
        const rowY = [];
        let y = originY;
        for (let row = 0; row < rowCount; row++) { rowY.push(y); y -= rowHeights[row] + gapY; }

        arrangedItems.forEach((node, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const rect = rects[i];
            const left = colX[col] + (colWidths[col] - rect.width) / 2;
            const bottom = rowY[row] - rowHeights[row] + (rowHeights[row] - rect.height) / 2;
            const pos = node.position.clone();
            pos.x = left - rect.x;
            pos.y = bottom - rect.y;
            node.setPosition(pos);
        });

        const spawnOrder = items.concat(preservedItems);
        manager.itemList = manager.spawnFromLast ? spawnOrder.slice().reverse() : spawnOrder;
        try { Editor.Message.send('scene', 'snapshot'); } catch (e) { /* scene may be closing */ }
        return { ok: true, count: items.length, arranged: arrangedItems.length, preserved: preservedItems.length,
            columns: Math.min(cols, arrangedItems.length), rows: rowCount,
            gridWidth: Math.round(totalW), gridHeight: Math.round(totalH), spawnFromLast: !!manager.spawnFromLast };
    },
};
