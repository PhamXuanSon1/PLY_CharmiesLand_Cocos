'use strict';
/**
 * Assets panel context menu: right-click a .psd -> "PSD to Map..." opens the
 * panel with that file already selected.
 */

const PKG = 'psd-to-map';

exports.onAssetMenu = function (assetInfo) {
    if (!assetInfo || assetInfo.isDirectory || !/\.psd$/i.test(assetInfo.url || assetInfo.file || '')) {
        return [];
    }
    return [{
        label: 'PSD to Map...',
        click() {
            Editor.Message.send(PKG, 'open-with', assetInfo.uuid);
        },
    }];
};
