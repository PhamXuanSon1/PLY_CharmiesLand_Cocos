/**
 * HolderSlot — port từ Assets/_GAME/Script/Utils/HolderSlot.cs (Unity)
 *
 * ⚠ Bên Unity `itemInSlot.position` trả về COPY. Cocos `node.worldPosition` trả về
 *   REFERENCE dùng chung -> phải .clone(), nếu không bobbing sẽ trôi dần.
 *   Xem COCOS_MIGRATION_PLAN.md mục 4.2.
 */

import { _decorator, Component, Node, Vec3, tween, Tween } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('HolderSlot')
export class HolderSlot extends Component {

    @property({ tooltip: 'Slot này đang trống hay đã có item.' })
    isEmpty = true;

    @property({ type: Node, tooltip: 'Vị trí neo gốc của slot.' })
    originPosition: Node | null = null;

    @property({ type: Node, tooltip: 'Item hiện đang nằm trong slot.' })
    itemInSlot: Node | null = null;

    @property({ tooltip: 'Khoảng cách nhấp nhô lên xuống (px).' })
    bobbingDistance = 30;

    @property({ tooltip: 'Thời gian 1 chu kỳ nhấp nhô (giây).' })
    bobbingDuration = 1.5;

    private bobbing: Tween<Node> | null = null;

    start() {
        if (!this.originPosition) this.originPosition = this.node;
    }

    lockSlot(): void {
        this.isEmpty = false;
    }

    setItem(item: Node): void {
        this.itemInSlot = item;
        this.isEmpty = false;
        // Đặt Item là node con (Child) của Holder slot này
        item.setParent(this.node, true);
        this.startBobbingAnimation();
    }

    clearSlot(): void {
        this.stopBobbingAnimation();
        this.itemInSlot = null;
        this.isEmpty = true;
    }

    startBobbingAnimation(): void {
        const item = this.itemInSlot;
        if (!item || !item.isValid) return;

        this.stopBobbingAnimation();

        const startPos = item.position.clone();
        const upPos = new Vec3(startPos.x, startPos.y + this.bobbingDistance, startPos.z);
        const half = this.bobbingDuration / 2;

        this.bobbing = tween(item)
            .repeatForever(
                tween(item)
                    .to(half, { position: upPos }, { easing: 'sineInOut' })
                    .to(half, { position: startPos }, { easing: 'sineInOut' }),
            )
            .start();
    }

    stopBobbingAnimation(): void {
        if (this.bobbing) {
            this.bobbing.stop();
            this.bobbing = null;
        }
    }
}
