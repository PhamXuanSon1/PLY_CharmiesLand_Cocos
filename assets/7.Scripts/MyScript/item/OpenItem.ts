/**
 * OpenItem — port từ Assets/_GAME/Script/Item/OpenItem.cs (Unity)
 *
 * KHÁC bản Unity: bỏ Update() poll khoảng cách mỗi frame (bug #2 mục 10.3),
 * ItemController gọi thẳng onItemPlaced() khi ghép xong.
 */

import { _decorator, Component, Node, Sprite } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('OpenItem')
export class OpenItem extends Component {

    @property({ type: [Node], tooltip: 'Object ĐƯỢC BẬT khi item vào đúng đích.' })
    open: Node[] = [];

    @property({ type: [Node], tooltip: 'Object BỊ TẮT khi item vào đúng đích.' })
    close: Node[] = [];

    private isOpened = false;

    /** ItemController gọi khi item đã ghép xong. */
    onItemPlaced(): void {
        if (this.isOpened) return;
        this.isOpened = true;

        // Unity: xoá sprite của chính item đi
        const sr = this.getComponent(Sprite);
        if (sr) sr.spriteFrame = null;

        for (const n of this.open) if (n?.isValid) n.active = true;
        for (const n of this.close) if (n?.isValid) n.active = false;
    }
}
