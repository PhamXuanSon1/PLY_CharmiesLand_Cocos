/**
 * ItemBarManager — thanh item ở đáy màn hình gồm N slot cố định (HolderSlot).
 *
 * Thay cho WorldScrollManager (thanh cuộn chứa toàn bộ item) và Box (hộp nhả item):
 *   - Lúc bắt đầu: ẩn hết item, đổ item vào các slot (gán holder trước, rồi scale 0 -> x1.2 -> x1).
 *   - Ghép đúng 1 item -> slot trống. Refill theo `refillMode`:
 *       Batch     : cả thanh trống mới bung đợt tiếp theo (như mẫu 3/15).
 *       Immediate : ghép 1 bù 1 ngay.
 *   - Thả hụt: ItemController tự bay về slot (currentHolderSlot) — không đụng ở đây.
 *
 * Thứ tự item lấy theo ItemManager.getCurrentItem() (itemList / spawnFromLast).
 */

import { _decorator, Component, Node, Vec3, Enum, tween, UITransform } from 'cc';
import { ItemManager } from './ItemManager';
import { ItemController } from '../item/ItemController';
import { ItemMovement } from '../item/ItemMovement';
import { ItemGraphic } from '../item/ItemGraphic';
import { HolderSlot } from '../utils/HolderSlot';
import { TweenUtil } from '../core/TweenUtil';

const { ccclass, property } = _decorator;

export enum RefillMode {
    /** Cả thanh trống mới bung đợt mới. */
    Batch = 0,
    /** Ghép xong 1 item thì bù ngay 1 item vào slot trống. */
    Immediate = 1,
}
Enum(RefillMode);

@ccclass('ItemBarManager')
export class ItemBarManager extends Component {

    static instance: ItemBarManager | null = null;

    // ⚠ Dùng Node[] thay vì HolderSlot[]: ItemBarManager <-> ItemController import vòng,
    //   type HolderSlot có thể là undefined lúc decorator chạy -> property bị bỏ.
    @property({ type: [Node], tooltip: 'Các node slot trên thanh bar (trống = tự lấy HolderSlot con của node này).' })
    slotNodes: Node[] = [];

    /** HolderSlot tương ứng slotNodes (resolve ở onLoad). */
    slots: HolderSlot[] = [];

    // ---- nhíp (tweezers) ----
    @property({ type: Node, tooltip: 'Node nhíp: inactive bình thường, active khi đang kéo item và đi theo con trỏ.' })
    tweezers: Node | null = null;

    @property({ type: Node, tooltip: 'Node con của Tweezers — item được gắn làm con của node này khi kéo (đầu kẹp).' })
    dragPosition: Node | null = null;

    @property({ tooltip: 'Hiện bóng (shadow) ở target NGAY khi item xuất hiện trên slot, không cần kéo.' })
    showShadowInSlot = true;

    @property({ type: Enum(RefillMode), tooltip: 'Batch: hết cả thanh mới bung đợt mới. Immediate: ghép 1 bù 1.' })
    refillMode: RefillMode = RefillMode.Batch;

    @property({ tooltip: 'Độ trễ trước khi bung đợt đầu tiên (giây).' })
    firstSpawnDelay = 0.3;

    @property({ tooltip: 'Độ trễ sau khi thanh trống trước khi bung đợt tiếp (giây).' })
    refillDelay = 0.25;

    @property({ tooltip: 'Giãn cách giữa các item trong cùng 1 đợt (giây). 0 = cả đợt hiện cùng lúc.' })
    spawnDelay = 0;

    @property({ tooltip: 'Thời gian item phóng to 0 -> overshoot (giây).' })
    popDuration = 0.25;

    @property({ tooltip: 'Hệ số overshoot: scale lên listScale * hệ số này rồi mới về listScale (1.2 = nảy 20%).' })
    popOvershoot = 1.2;

    @property({ tooltip: 'Thời gian co từ overshoot về listScale (giây).' })
    popSettleDuration = 0.15;

    // ---- fit item vào khung slot ----
    @property({ tooltip: 'Co giãn item cho vừa Content Size (UITransform) của slot và căn giữa slot. Tắt = dùng listScale như cũ.' })
    fitToSlot = true;

    @property({
        tooltip: 'Item chiếm bao nhiêu % khung slot (0.85 = chừa 15% lề). Tính theo cạnh bị chạm trước.',
        range: [0.1, 1.5, 0.01], slide: true,
        visible(this: ItemBarManager) { return this.fitToSlot; },
    })
    fitFill = 0.85;

    @property({ tooltip: 'Cho phép phóng TO item nhỏ hơn khung. Tắt = chỉ thu nhỏ item to quá khung.', visible(this: ItemBarManager) { return this.fitToSlot; } })
    fitAllowUpscale = true;

    @property({
        tooltip: 'Phóng to tối đa bao nhiêu lần so với listScale (2.5 = to nhất x2.5). Item nhỏ sẽ dừng ở mức này thay vì phóng tới chạm khung. 0 = không giới hạn.',
        range: [0, 10, 0.1],
        visible(this: ItemBarManager) { return this.fitToSlot && this.fitAllowUpscale; },
    })
    fitMaxUpscale = 2.5;

    private spawning = false;

    // ======================================================== lifecycle
    onLoad() {
        ItemBarManager.instance = this;
        this.slots = this.slotNodes
            .map(n => n?.getComponent(HolderSlot) ?? null)
            .filter((s): s is HolderSlot => !!s);
        if (this.slots.length === 0) this.slots = this.getComponentsInChildren(HolderSlot);
    }

    onDestroy() {
        if (ItemBarManager.instance === this) ItemBarManager.instance = null;
    }

    // ======================================================== tweezers
    /** Có dùng nhíp để kéo không (đã gán đủ tweezers + dragPosition). */
    get hasTweezers(): boolean {
        return !!(this.tweezers?.isValid && this.dragPosition?.isValid);
    }

    /** Bật nhíp tại vị trí con trỏ. */
    showTweezers(worldPos: Vec3): void {
        if (!this.hasTweezers) return;
        this.tweezers!.active = true;
        this.moveTweezers(worldPos);
    }

    /** Nhíp đi theo con trỏ (item là con của DragPosition nên đi theo). */
    moveTweezers(worldPos: Vec3): void {
        if (!this.hasTweezers) return;
        const t = this.tweezers!;
        t.setWorldPosition(worldPos.x, worldPos.y, t.worldPosition.z);
    }

    hideTweezers(): void {
        if (this.tweezers?.isValid) this.tweezers.active = false;
    }

    start() {
        this.hideTweezers();
        // Ẩn hết item cho tới khi được đưa lên thanh
        for (const node of ItemManager.instance?.itemList ?? []) {
            if (node?.isValid) node.active = false;
        }
        this.scheduleOnce(() => this.spawnNextBatch(), this.firstSpawnDelay);
    }

    // ======================================================== spawn
    /** Đổ item vào MỌI slot đang trống (mỗi item cách nhau spawnDelay). */
    spawnNextBatch(): void {
        if (this.spawning) return;
        // Không chặn khi isGameEnded: hết End Game Count vẫn bung đợt tiếp để người chơi thấy
        // còn item, nhưng mọi cú chạm lúc này đều mở store (DreamyInputManager -> gotoStore).
        const im = ItemManager.instance;
        if (!im) return;

        const empties = this.slots.filter(s => s && s.isValid && s.isEmpty);
        if (empties.length === 0) return;

        const pairs: { slot: HolderSlot; node: Node }[] = [];
        for (const slot of empties) {
            const node = im.getCurrentItem();
            if (!node) break;
            pairs.push({ slot, node });
        }
        if (pairs.length === 0) return;

        this.spawning = true;
        let firstItem: ItemController | null = null;

        pairs.forEach(({ slot, node }, i) => {
            slot.lockSlot();   // giữ chỗ ngay, tránh 2 lần spawn cùng 1 slot
            const item = node.getComponent(ItemController);
            if (!firstItem && item) firstItem = item;

            TweenUtil.delayedCall(this, i * this.spawnDelay, () => {
                this.popItemIntoSlot(node, slot, i === pairs.length - 1 ? () => {
                    this.spawning = false;
                    im.showFirstDragHint(firstItem);
                } : undefined);
            });
        });
    }

    /** Gắn item vào slot TRƯỚC (sticker + bobbing), rồi scale 0 -> listScale*overshoot -> listScale. */
    private popItemIntoSlot(node: Node, slot: HolderSlot, onDone?: () => void): void {
        if (!node.isValid) { onDone?.(); return; }
        const item = node.getComponent(ItemController);
        const g = item?.itemGraphic ?? null;
        const listScale = g?.listScale?.clone() ?? new Vec3(1, 1, 1);

        const origin = slot.originPosition ?? slot.node;
        node.setWorldPosition(origin.worldPosition.clone());
        if (g) node.eulerAngles = g.listRotation.clone();
        slot.fitOffset.set(0, 0, 0);

        node.setScale(listScale);
        node.active = true;

        // Co giãn cho vừa khung slot + căn giữa (đo bounds ở listScale, node phải active)
        let restScale = listScale;
        if (this.fitToSlot && g) restScale = this.fitItemToSlot(node, g, slot, listScale) ?? listScale;

        // Chốt scale gốc TRƯỚC khi setScale(0) (xem ghi chú trong ItemMovement.captureOriginal)
        node.setScale(restScale);
        node.getComponent(ItemMovement)?.captureOriginal();

        // 1. Gán vào holder trước: reparent, dựng sticker (đo bounds ở scale thật), bobbing
        if (item) item.currentHolderSlot = slot;
        slot.setItem(node);

        // Bóng ở target hiện ngay khi item lên slot (không đợi kéo)
        if (this.showShadowInSlot && item) item.showTargetShadow();

        // 2. Rồi mới chạy anim scale 0 -> x1.2 -> x1 (sticker là con của item nên scale theo)
        const over = new Vec3(restScale.x * this.popOvershoot, restScale.y * this.popOvershoot, restScale.z);
        node.setScale(0, 0, 0);
        tween(node)
            .to(this.popDuration, { scale: over }, { easing: 'quadOut' })
            .to(this.popSettleDuration, { scale: restScale }, { easing: 'quadIn' })
            .call(() => onDone?.())
            .start();
    }

    /**
     * Scale item sao cho bounds (gộp mọi UITransform, đã xoay listRotation) vừa
     * Content Size của slot * fitFill, giữ tỉ lệ, rồi dời item để TÂM bounds trùng tâm khung slot.
     * Lưu độ lệch so với originPosition vào slot.fitOffset để thả hụt bay về đúng chỗ.
     * @returns scale mới, null nếu slot không có UITransform / item không đo được
     */
    private fitItemToSlot(node: Node, g: ItemGraphic, slot: HolderSlot, listScale: Vec3): Vec3 | null {
        const slotUt = slot.node.getComponent(UITransform);
        if (!slotUt) return null;

        // Đổi cha vào slot TRƯỚC khi đo: scale local dưới đây là scale trong slot (đúng cái
        // mà anim pop / captureOriginal / snapFailed dùng). Cha cũ (phòng) có thể scale khác.
        node.setParent(slot.node, true);
        node.setScale(listScale);
        const box = g.getCombinedBounds();
        if (!box || box.width <= 1e-3 || box.height <= 1e-3) return null;

        const frame = slotUt.getBoundingBoxToWorld();
        let k = Math.min(frame.width * this.fitFill / box.width, frame.height * this.fitFill / box.height);
        if (!this.fitAllowUpscale) k = Math.min(k, 1);
        else if (this.fitMaxUpscale > 0) k = Math.min(k, this.fitMaxUpscale);

        const scale = new Vec3(listScale.x * k, listScale.y * k, listScale.z);
        node.setScale(scale);

        // Bounds co quanh node theo cùng hệ số k -> tính lại tâm rồi dời cho khớp tâm khung
        const fitted = g.getCombinedBounds() ?? box;
        const pos = node.worldPosition.clone();
        pos.x += frame.center.x - fitted.center.x;
        pos.y += frame.center.y - fitted.center.y;
        node.setWorldPosition(pos);

        const origin = (slot.originPosition ?? slot.node).worldPosition;
        slot.fitOffset.set(pos.x - origin.x, pos.y - origin.y, 0);
        return scale;
    }

    // ======================================================== hook từ ItemController
    /** Item vừa ghép đúng và đã giải phóng slot. */
    itemPlaced(_item: ItemController): void {
        const im = ItemManager.instance;
        if (!im) return;

        if (this.refillMode === RefillMode.Immediate) {
            this.scheduleOnce(() => this.spawnNextBatch(), this.refillDelay);
            return;
        }

        const allEmpty = this.slots.every(s => !s || !s.isValid || s.isEmpty);
        if (allEmpty) this.scheduleOnce(() => this.spawnNextBatch(), this.refillDelay);
    }

    /** Số item đang nằm trên thanh. */
    getActiveItemsCount(): number {
        return this.slots.filter(s => s && s.isValid && !s.isEmpty).length;
    }
}
