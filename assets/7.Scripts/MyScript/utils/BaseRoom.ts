/**
 * BaseRoom — port từ Assets/_GAME/Script/Utils/BaseRoom.cs (Unity)
 * Pan 1 ngón (chỉ trục X) + pinch zoom 2 ngón + mouse wheel cho desktop.
 *
 * KHÁC bản Unity:
 *   - Không poll Input; pan đi qua InputManager ở mức ưu tiên Room (thấp nhất),
 *     nên chạm trúng item / hộp / thanh bar đều được ưu tiên trước.
 *   - Pinch nhận qua InputManager.registerPinch vì chuỗi capture 1-ngón
 *     bị huỷ khi có ngón thứ 2.
 *
 * Mọi khoảng cách là PIXEL.
 */

import { _decorator, Component, Node, Vec3, EventTouch, math, input, Input, EventMouse } from 'cc';
import { DreamyInputManager, InputPriority, IPointerHandler, IPinchHandler } from '../core/DreamyInputManager';
import { UIManager } from '../managers/UIManager';

const { ccclass, property } = _decorator;

@ccclass('BaseRoom')
export class BaseRoom extends Component implements IPointerHandler, IPinchHandler {

    @property({ type: Node, tooltip: 'Giới hạn phải khi kéo màn.' })
    rightLimitPos: Node | null = null;

    @property({ type: Node, tooltip: 'Giới hạn trái khi kéo màn.' })
    leftLimitPos: Node | null = null;

    @property({ tooltip: 'Tốc độ pinch zoom trên mobile.' })
    mobileZoomSpeed = 0.005;

    @property({ tooltip: 'Tốc độ zoom bằng con lăn chuột (desktop).' })
    editorZoomSpeed = 0.1;

    @property({ tooltip: 'Tỉ lệ scale nhỏ nhất.' })
    minScaleMultiplier = 0.8;

    @property({ tooltip: 'Tỉ lệ scale lớn nhất.' })
    maxScaleMultiplier = 1.2;

    @property({ tooltip: 'Tốc độ kéo trượt màn hình.' })
    panSpeed = 1;

    readonly inputPriority = InputPriority.Room;

    private originalLocalScale = new Vec3(1, 1, 1);
    private currentScaleFactor = 1;
    private originalScaleInitialized = false;
    private interactionEnabled = false;

    private dragStartWorld = new Vec3();
    private roomStartPosition = new Vec3();
    private dragging = false;

    // ======================================================== lifecycle
    onLoad() {
        if (!this.originalScaleInitialized) {
            this.originalLocalScale = this.node.scale.clone();
            this.currentScaleFactor = 1;
            this.originalScaleInitialized = true;
        }
    }

    onEnable() {
        DreamyInputManager.register(this);
        DreamyInputManager.registerPinch(this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }

    onDisable() {
        DreamyInputManager.unregister(this);
        DreamyInputManager.unregisterPinch(this);
        input.off(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }

    /** Unity: InitializeOriginalScale */
    initializeOriginalScale(originalScale: Vec3): void {
        this.originalLocalScale = originalScale.clone();
        this.currentScaleFactor = this.originalLocalScale.x !== 0
            ? this.node.scale.x / this.originalLocalScale.x
            : 1;
        this.originalScaleInitialized = true;
    }

    enableInteraction(): void {
        this.interactionEnabled = true;
    }

    // ======================================================== pan
    hitTest(worldPos: Vec3): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        if (!this.interactionEnabled) return false;
        return DreamyInputManager.hitTestCollider(this.node, worldPos);
    }

    onPointerDown(worldPos: Vec3, _ev: EventTouch): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        if (!this.interactionEnabled) return false;
        this.dragging = true;
        this.dragStartWorld.set(worldPos);
        this.roomStartPosition.set(this.node.worldPosition);
        return true;
    }

    onPointerMove(worldPos: Vec3, _ev: EventTouch): void {
        if (!this.dragging) return;

        const diffX = worldPos.x - this.dragStartWorld.x;
        const target = new Vec3(
            this.roomStartPosition.x + diffX * this.panSpeed,
            this.roomStartPosition.y,
            this.roomStartPosition.z,
        );
        this.node.setWorldPosition(this.clampPosition(target));
    }

    onPointerUp(): void { this.dragging = false; }
    onPointerCancel(): void { this.dragging = false; }

    // ======================================================== zoom
    /** Pinch 2 ngón. delta > 0 = xoè ra = phóng to. */
    onPinch(deltaDistance: number): void {
        if (UIManager.instance?.isGameEnded) return;
        if (!this.interactionEnabled) return;
        this.dragging = false;   // đang pinch thì không pan
        this.setScaleFactor(this.currentScaleFactor + deltaDistance * this.mobileZoomSpeed);
    }

    private onMouseWheel(ev: EventMouse): void {
        if (UIManager.instance?.isGameEnded) return;
        if (!this.interactionEnabled) return;
        const scroll = ev.getScrollY();
        if (Math.abs(scroll) < 0.01) return;
        // Chuẩn hoá về ±1 rồi nhân tốc độ, tránh phụ thuộc đơn vị của từng browser
        const dir = scroll > 0 ? 1 : -1;
        this.setScaleFactor(this.currentScaleFactor * (1 + dir * this.editorZoomSpeed));
    }

    private setScaleFactor(factor: number): void {
        this.currentScaleFactor = math.clamp(factor, this.minScaleMultiplier, this.maxScaleMultiplier);
        this.node.setScale(
            this.originalLocalScale.x * this.currentScaleFactor,
            this.originalLocalScale.y * this.currentScaleFactor,
            this.originalLocalScale.z * this.currentScaleFactor,
        );
        this.node.setWorldPosition(this.clampPosition(this.node.worldPosition.clone()));
    }

    // ======================================================== clamp
    /** Unity: ClampPosition — chỉ kẹp trục X. */
    private clampPosition(position: Vec3): Vec3 {
        const left = this.leftLimitPos?.worldPosition.x;
        const right = this.rightLimitPos?.worldPosition.x;

        if (left !== undefined && right !== undefined) {
            position.x = math.clamp(position.x, Math.min(left, right), Math.max(left, right));
        } else if (left !== undefined) {
            position.x = Math.max(position.x, left);
        } else if (right !== undefined) {
            position.x = Math.min(position.x, right);
        }
        return position;
    }
}
