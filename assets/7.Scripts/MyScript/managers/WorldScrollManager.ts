/**
 * WorldScrollManager — port từ Assets/_GAME/Script/Manager/WorldScrollManager.cs (Unity)
 *
 * KHÁC bản Unity:
 *   - Không tự poll Input; đăng ký làm IPointerHandler ở mức ưu tiên Scroll,
 *     nên item luôn được ưu tiên trước (Item = 10 < Scroll = 30).
 *   - cam.ViewportToWorldPoint -> tự tính mép màn hình từ orthoHeight + aspect.
 *   - DOTween.IsTweening -> TweenUtil.isTweening.
 *
 * Mọi khoảng cách ở đây là PIXEL (exporter đã nhân K).
 */

import { _decorator, Component, Node, Vec3, EventTouch, Camera, math } from 'cc';
import { ItemController } from '../item/ItemController';
import { DreamyInputManager, InputPriority, IPointerHandler } from '../core/DreamyInputManager';
import { TweenUtil } from '../core/TweenUtil';
import { UIManager } from './UIManager';

const { ccclass, property } = _decorator;

@ccclass('WorldScrollManager')
export class WorldScrollManager extends Component implements IPointerHandler {

    static instance: WorldScrollManager | null = null;

    @property({ type: Node, tooltip: 'Anchor lấy toạ độ Y cho item trên thanh bar.' })
    itemAnchor: Node | null = null;

    @property({ type: Camera, tooltip: 'Camera dùng để tính mép trái/phải màn hình.' })
    mainCamera: Camera | null = null;

    @property({ tooltip: 'Khoảng cách từ mép trái màn hình tới item đầu (px).' })
    leftPadding = 200;

    @property({ tooltip: 'Khoảng cách tối thiểu từ mép phải tới item cuối (px).' })
    rightPadding = 200;

    @property({ tooltip: 'Khoảng cách giữa các item (px).' })
    spacing = 200;

    @property({ tooltip: 'Ngưỡng phân biệt Cuộn và Click (px).' })
    dragThreshold = 20;

    private activeItems: ItemController[] = [];
    private itemBaseX = new Map<ItemController, number>();

    private scrolling = false;
    private lastPointer = new Vec3();
    private currentScrollOffset = 0;
    private minX = 0;
    private maxX = 0;

    private currentDraggedItem: ItemController | null = null;

    readonly inputPriority = InputPriority.Scroll;

    // ======================================================== lifecycle
    onLoad() {
        WorldScrollManager.instance = this;
    }

    onEnable() {
        DreamyInputManager.register(this);
    }

    onDisable() {
        DreamyInputManager.unregister(this);
    }

    onDestroy() {
        if (WorldScrollManager.instance === this) WorldScrollManager.instance = null;
    }

    // ======================================================== mép màn hình
    /** Unity: cam.ViewportToWorldPoint(0,0).x + leftPadding */
    private getStartX(): number {
        const cam = this.mainCamera;
        if (!cam) return this.node.worldPosition.x;
        const halfW = cam.orthoHeight * (cam.camera ? cam.camera.aspect : 1);
        return cam.node.worldPosition.x - halfW + this.leftPadding;
    }

    private screenRightX(): number {
        const cam = this.mainCamera;
        if (!cam) return this.node.worldPosition.x;
        const halfW = cam.orthoHeight * (cam.camera ? cam.camera.aspect : 1);
        return cam.node.worldPosition.x + halfW;
    }

    /** Unity: CalculateScrollLimits */
    private calculateScrollLimits(maxItemX: number): void {
        this.maxX = 0;
        if (this.mainCamera) {
            this.minX = (this.screenRightX() - this.rightPadding) - maxItemX;
        } else {
            this.minX = -(maxItemX - this.getStartX());
        }
        if (this.minX > this.maxX) this.minX = this.maxX;
    }

    // ======================================================== xếp item
    /** Unity: SetupItems */
    setupItems(items: Node[]): void {
        this.activeItems.length = 0;
        this.itemBaseX.clear();
        this.currentScrollOffset = 0;

        let startX = this.getStartX();
        let maxItemX = startX;

        for (const node of items) {
            if (!node || !node.isValid) continue;
            const item = node.getComponent(ItemController);
            if (!item) continue;

            this.activeItems.push(item);
            this.itemBaseX.set(item, startX);

            node.active = true;

            const targetY = this.itemAnchor
                ? this.itemAnchor.worldPosition.y
                : node.worldPosition.y;
            node.setWorldPosition(startX, targetY, node.worldPosition.z);

            const g = item.itemGraphic;
            if (g) {
                node.setScale(g.listScale.clone());
                node.eulerAngles = g.listRotation.clone();
            }

            maxItemX = startX;
            startX += this.spacing;
        }

        this.calculateScrollLimits(maxItemX);
    }

    // ======================================================== input
    /** Cuộn nhận sự kiện ở bất kỳ đâu — item đã được ưu tiên trước. */
    hitTest(_worldPos: Vec3): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        return this.activeItems.length > 0;
    }

    onPointerDown(worldPos: Vec3, _ev: EventTouch): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        // Đang kéo item thì không cuộn (Unity: if (!ItemManager.isDragging) HandleInput()).
        // Thực tế InputManager đã chặn sẵn vì item bắt sự kiện trước, đây là lớp bảo hiểm.
        if (this.currentDraggedItem) return false;
        this.lastPointer.set(worldPos);
        this.scrolling = false;
        return true;   // giữ chuỗi move/up để còn phân biệt cuộn hay click
    }

    onPointerMove(worldPos: Vec3, _ev: EventTouch): void {
        const dx = worldPos.x - this.lastPointer.x;
        const dy = worldPos.y - this.lastPointer.y;

        if (!this.scrolling
            && Math.abs(dx) > this.dragThreshold
            && Math.abs(dx) > Math.abs(dy)) {
            this.scrolling = true;
        }

        if (this.scrolling) {
            this.currentScrollOffset = math.clamp(
                this.currentScrollOffset + dx, this.minX, this.maxX);
            this.lastPointer.set(worldPos);
        }
    }

    onPointerUp(): void {
        this.scrolling = false;
    }

    onPointerCancel(): void {
        this.scrolling = false;
    }

    isScrolling(): boolean {
        return this.scrolling;
    }

    // ======================================================== cập nhật vị trí
    update() {
        if (this.activeItems.length === 0) return;
        this.updateAllItemsPositions();
    }

    /** Unity: UpdateAllItemsPositions */
    private updateAllItemsPositions(): void {
        const anchorY = this.itemAnchor ? this.itemAnchor.worldPosition.y : 0;

        for (const item of this.activeItems) {
            if (!item || !item.isValid) continue;
            if (item === this.currentDraggedItem) continue;

            // Bỏ qua item đang animate (bay về khay / dồn danh sách)
            if (TweenUtil.isTweening(item.node)) continue;

            const baseX = this.itemBaseX.get(item);
            if (baseX === undefined) continue;

            const p = item.node.worldPosition;
            const y = this.itemAnchor ? anchorY : p.y;
            item.node.setWorldPosition(baseX + this.currentScrollOffset, y, p.z);
        }
    }

    /** Unity: ReorganizeList */
    private reorganizeList(animate = false): void {
        let startX = this.getStartX();
        let maxItemX = startX;

        for (const item of this.activeItems) {
            if (!item || !item.isValid) continue;

            this.itemBaseX.set(item, startX);

            // Item đang bị kéo thì không cộng spacing, để chỗ trống được lấp
            if (item === this.currentDraggedItem) continue;

            const p = item.node.worldPosition;
            const targetY = this.itemAnchor ? this.itemAnchor.worldPosition.y : p.y;
            const target = new Vec3(startX + this.currentScrollOffset, targetY, p.z);

            if (animate) TweenUtil.moveTo(item.node, target, 0.3, 'quadOut');
            else item.node.setWorldPosition(target);

            maxItemX = startX;
            startX += this.spacing;
        }

        this.calculateScrollLimits(maxItemX);
    }

    // ======================================================== hook từ ItemController
    /** Unity: ItemPickedUp */
    itemPickedUp(item: ItemController): void {
        if (this.activeItems.indexOf(item) < 0) return;
        this.currentDraggedItem = item;
        this.reorganizeList(true);
    }

    /** Unity: ItemReturned */
    itemReturned(item: ItemController): void {
        if (this.activeItems.indexOf(item) < 0 || this.currentDraggedItem !== item) return;

        this.currentDraggedItem = null;
        this.reorganizeList(true);

        const baseX = this.itemBaseX.get(item) ?? item.node.worldPosition.x;
        const p = item.node.worldPosition;
        const targetY = this.itemAnchor ? this.itemAnchor.worldPosition.y : p.y;

        TweenUtil.killAll(item.node);
        TweenUtil.moveTo(
            item.node,
            new Vec3(baseX + this.currentScrollOffset, targetY, p.z),
            0.3, 'quadOut',
            () => { item.itemGraphic?.restoreOriginalLayers(); },
        );

        const g = item.itemGraphic;
        if (g) {
            TweenUtil.scaleTo(item.node, g.listScale, 0.3);
            TweenUtil.rotateTo(item.node, g.listRotation, 0.3);
        }
    }

    /** Unity: ItemPlaced */
    itemPlaced(item: ItemController): void {
        const i = this.activeItems.indexOf(item);
        if (i < 0) return;
        this.activeItems.splice(i, 1);
        this.itemBaseX.delete(item);
        if (this.currentDraggedItem === item) this.currentDraggedItem = null;
        this.reorganizeList(true);
    }

    getActiveItemsCount(): number {
        return this.activeItems.length;
    }

    getActiveItems(): ItemController[] {
        return this.activeItems;
    }
}
