'use strict';
/**
 * Assets panel context menu: right-click a folder -> "Texture Compress" ->
 * pick a preset (or "Disable") and it is applied to every SpriteFrame below.
 * Runs in the Assets panel process, so builder.json is read directly here.
 */

const fs = require('fs');
const path = require('path');

const PKG = 'texture-compress-batch';

function readPresets() {
    try {
        const file = path.join(Editor.Project.path, 'settings', 'v2', 'packages', 'builder.json');
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        const userPreset = (json.textureCompressConfig && json.textureCompressConfig.userPreset) || {};
        return Object.keys(userPreset).map((id) => ({ id, name: (userPreset[id] && userPreset[id].name) || id }));
    } catch (e) {
        return [];
    }
}

exports.onAssetMenu = function (assetInfo) {
    if (!assetInfo || !assetInfo.isDirectory) {
        return [];
    }
    const presets = readPresets();
    const send = (presetId, mode) => () => {
        Editor.Message.send(PKG, 'apply-from-menu', {
            uuid: assetInfo.uuid,
            url: assetInfo.url,
            presetId,
            mode,
            includeAtlas: true,
            force: true,
        });
    };

    const submenu = presets.map((p) => ({ label: 'Enable: ' + p.name, click: send(p.id, 'enable') }));
    if (!submenu.length) {
        submenu.push({ label: '(no preset in Project Settings)', enabled: false });
    }
    submenu.push({ type: 'separator' });
    submenu.push({ label: 'Disable', click: send('', 'disable') });
    submenu.push({ type: 'separator' });
    submenu.push({ label: 'Open panel...', click: () => Editor.Message.send(PKG, 'open-panel') });

    return [{ label: 'Texture Compress', submenu }];
};
