/**
 * ChangeLight — port từ Assets/_GAME/Script/Utils/ChangeLight.cs (Unity)
 *
 * KHÁC bản Unity: bỏ Update() poll mỗi frame VÀ thêm cờ isChanged.
 * Bản Unity thiếu cờ chặn nên gọi Change() lại mỗi frame sau khi thoả điều kiện
 * (bug #1 mục 10.3).
 */

import { _decorator, Component, Node, Sprite } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('ChangeLight')
export class ChangeLight extends Component {

    /** Tự đăng ký để ItemController khỏi phải quét cả scene mỗi lần ghép item. */
    private static all: ChangeLight[] = [];

    static notifyItemPlaced(): void {
        for (const c of ChangeLight.all) {
            if (c && c.isValid) c.onAnyItemPlaced();
        }
    }

    onEnable() {
        if (ChangeLight.all.indexOf(this) < 0) ChangeLight.all.push(this);
    }

    onDisable() {
        const i = ChangeLight.all.indexOf(this);
        if (i >= 0) ChangeLight.all.splice(i, 1);
    }

    @property({ type: Node, tooltip: 'Ảnh sáng dùng để thay thế khi đủ điều kiện.' })
    Img2: Node | null = null;

    @property({ type: Node, tooltip: 'Item thứ 1 cần ghép xong.' })
    Item1: Node | null = null;

    @property({ type: Node, tooltip: 'Item thứ 2 cần ghép xong.' })
    Item2: Node | null = null;

    private isChanged = false;

    /** ItemController gọi mỗi khi có item bất kỳ được ghép xong. */
    onAnyItemPlaced(): void {
        if (this.isChanged) return;

        type Placed = { isPlaced?: boolean };
        const a = this.Item1?.getComponent('ItemController') as Placed | null;
        const b = this.Item2?.getComponent('ItemController') as Placed | null;
        if (!a || !b) return;
        if (!a.isPlaced || !b.isPlaced) return;

        this.change();
        this.isChanged = true;
    }

    change(): void {
        const dst = this.getComponent(Sprite);
        const src = this.Img2?.getComponent(Sprite);
        if (dst && src) dst.spriteFrame = src.spriteFrame;
    }
}
