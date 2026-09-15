/**
 * InputManager — gom toàn bộ input về một chỗ.
 *
 * Bên Unity, 5 script cùng poll Input mỗi frame (ItemController — MỖI item!,
 * BoxController, WorldScrollManager, BaseRoom, UIManager) và thứ tự ưu tiên
 * do Unity quyết định ngẫu nhiên. Port 1-1 sang Cocos sẽ vỡ.
 *
 * Ở đây: đăng ký input MỘT LẦN, rồi dispatch theo chuỗi ưu tiên tường minh.
 * Handler đầu tiên trả true sẽ "bắt" (capture) và giữ chuỗi move/up tiếp theo.
 *
 * Đặt component này lên 1 node bất kỳ trong scene (vd node "Root").
 * Xem COCOS_MIGRATION_PLAN.md mục 5.2.
 */

import { _decorator, Component, Node, input, Input, EventTouch, Vec3, Vec2, UITransform, Layers, Collider2D } from 'cc';
import { EDITOR } from 'cc/env';
import { ItemGraphic } from '../item/ItemGraphic';
import { ItemManager } from '../managers/ItemManager';
import { UIManager } from '../managers/UIManager';

const { ccclass, property, executeInEditMode } = _decorator;

const Ed: any = (globalThis as any).Editor;

/** Số nhỏ = ưu tiên cao. Khớp thứ tự ở plan mục 5.2. */
export enum InputPriority {
    UI = 0,        // CTA / overlay end-game — nuốt sự kiện
    Item = 10,     // kéo item
    Box = 20,      // click hộp
    Scroll = 30,   // cuộn thanh bar
    Room = 40,     // pan/zoom căn phòng
}

export interface IPointerHandler {
    /** Node dùng để so thứ tự render khi nhiều handler cùng priority cùng trúng. */
    readonly node: Node;
    readonly inputPriority: number;

    /** Điểm chạm có nằm trong vùng của handler này không. */
    hitTest(worldPos: Vec3): boolean;

    /** Trả true để "bắt" sự kiện — các handler sau sẽ không nhận nữa. */
    onPointerDown(worldPos: Vec3, ev: EventTouch): boolean;

    onPointerMove?(worldPos: Vec3, ev: EventTouch): void;
    onPointerUp?(worldPos: Vec3, ev: EventTouch): void;

    /** Bị huỷ giữa chừng (vd chạm ngón thứ 2). */
    onPointerCancel?(): void;
}

/**
 * Nhận pinch 2 ngón. Tách riêng khỏi IPointerHandler vì chuỗi capture 1 ngón
 * bị huỷ ngay khi ngón thứ 2 chạm xuống.
 */
export interface IPinchHandler {
    /** delta > 0 = hai ngón xoè ra = phóng to. Đơn vị: pixel. */
    onPinch(deltaDistance: number): void;
}

@ccclass('DreamyInputManager')
@executeInEditMode(true)
export class DreamyInputManager extends Component {

    /** Thay cho UIManager.canInput bên Unity. */
    static canInput = true;

    static instance: DreamyInputManager | null = null;

    @property({
        type: Node,
        tooltip: 'Node chứa lớp kéo (item đang cầm sẽ tạm nằm dưới đây để nổi lên trên cùng).\n'
            + 'Để trống = tự dò / dùng chính node này.',
    })
    dragLayerRoot: Node | null = null;

    // ---- Cấu hình LayerMask nhận Click / Touch ----
    @property({
        type: Layers.BitMask,
        tooltip: 'Chỉ các Node có Layer nằm trong mask này mới nhận click / kéo thả (vd: chỉ tick layer "Item", "UI_2D", v.v.). Mặc định: Tất cả.'
    })
    interactableLayers: number = 0xffffffff;

    @property({ tooltip: 'In log chi tiết mỗi lần bắt/nhả sự kiện' })
    verbose = false;

    private handlers: IPointerHandler[] = [];
    private pinchHandlers: IPinchHandler[] = [];
    private captor: IPointerHandler | null = null;
    private activeTouches = 0;
    /** Khoảng cách giữa 2 ngón ở frame trước, -1 = chưa có. */
    private lastPinchDistance = -1;

    // ------------------------------------------------------------ lifecycle
    onLoad() {
        DreamyInputManager.instance = this;
        if (this.dragLayerRoot) {
            ItemGraphic.dragLayerRoot = this.dragLayerRoot;
        } else {
            ItemGraphic.dragLayerRoot = null;
        }
    }

    /** Kiểm tra xem một Node có Layer hợp lệ để nhận Click/Touch hay không */
    static isNodeInteractable(node: Node): boolean {
        if (!node || !node.isValid || !node.activeInHierarchy) return false;
        const m = DreamyInputManager.instance;
        if (m && m.interactableLayers !== -1 && m.interactableLayers !== 0xffffffff) {
            if ((m.interactableLayers & node.layer) === 0) {
                return false;
            }
        }
        return true;
    }




    onEnable() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    onDisable() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    onDestroy() {
        if (DreamyInputManager.instance === this) DreamyInputManager.instance = null;
    }

    // ------------------------------------------------------------ đăng ký
    static register(h: IPointerHandler): void {
        const m = DreamyInputManager.instance;
        if (m && m.handlers.indexOf(h) < 0) m.handlers.push(h);
    }

    static unregister(h: IPointerHandler): void {
        const m = DreamyInputManager.instance;
        if (!m) return;
        const i = m.handlers.indexOf(h);
        if (i >= 0) m.handlers.splice(i, 1);
        if (m.captor === h) m.captor = null;
    }

    static registerPinch(h: IPinchHandler): void {
        const m = DreamyInputManager.instance;
        if (m && m.pinchHandlers.indexOf(h) < 0) m.pinchHandlers.push(h);
    }

    static unregisterPinch(h: IPinchHandler): void {
        const m = DreamyInputManager.instance;
        if (!m) return;
        const i = m.pinchHandlers.indexOf(h);
        if (i >= 0) m.pinchHandlers.splice(i, 1);
    }

    // ------------------------------------------------------------ dispatch
    private onTouchStart(ev: EventTouch): void {
        this.activeTouches = ev.getAllTouches()?.length ?? 1;

        // Unity: if (Input.touchCount >= 2) { isDragging = false; return; }
        if (this.activeTouches >= 2) {
            this.cancelCaptor();
            return;
        }
        if (!DreamyInputManager.canInput) return;

        // Nếu game đã kết thúc -> Mọi cú chạm tiếp theo trên màn hình sẽ mở store ngay
        if (UIManager.instance?.isGameEnded) {
            UIManager.instance.gotoStore();
            return;
        }

        const worldPos = DreamyInputManager.toWorld(ev);

        // Broadcast: ItemManager cần biết mọi lần chạm (reset idle timer, first-click,
        // bắn CHALLENGE_STARTED). KHÔNG nuốt sự kiện — bên Unity đây là phần
        // ItemManager.Update tự poll Input.
        ItemManager.instance?.onAnyPointerDown();

        const candidates = this.handlers
            .filter((h) => {
                if (!h.node || !h.node.isValid || !h.node.activeInHierarchy) return false;
                // UI handler (như UIManager) không bị ràng buộc bởi layer mask của gameplay
                if (h.inputPriority !== InputPriority.UI && !DreamyInputManager.isNodeInteractable(h.node)) {
                    return false;
                }
                return h.hitTest(worldPos);
            })
            .sort((a, b) => (a.inputPriority - b.inputPriority)
                || (-DreamyInputManager.compareRenderOrder(a.node, b.node)));


        for (const h of candidates) {
            if (h.onPointerDown(worldPos, ev)) {
                this.captor = h;
                if (this.verbose) console.log('[InputManager] bắt bởi', h.node.name);
                return;
            }
        }
    }

    private onTouchMove(ev: EventTouch): void {
        const touches = ev.getAllTouches() ?? [];
        this.activeTouches = touches.length || 1;

        if (this.activeTouches >= 2) {
            this.cancelCaptor();
            this.handlePinch(touches);
            return;
        }

        this.lastPinchDistance = -1;
        if (!this.captor) return;
        this.captor.onPointerMove?.(DreamyInputManager.toWorld(ev), ev);
    }

    /** Unity: BaseRoom.HandleZoom — so khoảng cách 2 ngón giữa frame này và frame trước. */
    private handlePinch(touches: readonly { getUILocation(): Vec2 }[]): void {
        if (this.pinchHandlers.length === 0 || touches.length < 2) return;

        const a = touches[0].getUILocation();
        const b = touches[1].getUILocation();
        const dist = Vec2.distance(a, b);

        if (this.lastPinchDistance >= 0) {
            const delta = dist - this.lastPinchDistance;
            if (Math.abs(delta) > 0.01) {
                for (const h of this.pinchHandlers) h.onPinch(delta);
            }
        }
        this.lastPinchDistance = dist;
    }

    private onTouchEnd(ev: EventTouch): void {
        this.activeTouches = 0;
        this.lastPinchDistance = -1;
        const c = this.captor;
        this.captor = null;
        c?.onPointerUp?.(DreamyInputManager.toWorld(ev), ev);
        if (this.verbose && c) console.log('[InputManager] nhả', c.node.name);
    }

    private onTouchCancel(ev: EventTouch): void {
        this.activeTouches = 0;
        this.lastPinchDistance = -1;
        const c = this.captor;
        this.captor = null;
        // TOUCH_CANCEL vẫn phải xử lý như nhả tay, nếu không item sẽ dính vào chuột
        c?.onPointerUp?.(DreamyInputManager.toWorld(ev), ev);
    }

    private cancelCaptor(): void {
        const c = this.captor;
        this.captor = null;
        if (c) (c.onPointerCancel ?? c.onPointerUp)?.call(c, c.node.worldPosition, undefined as never);
    }

    // ------------------------------------------------------------ helper
    /**
     * Vị trí chạm trong world space của UI.
     * getUILocation() dùng chung hệ toạ độ với worldPosition của node UI.
     * ⚠ Nếu item bị lệch khi kéo thì đây là chỗ đầu tiên cần soi.
     */
    static toWorld(ev: EventTouch): Vec3 {
        if (!ev) return new Vec3();
        const p: Vec2 = ev.getUILocation();
        return new Vec3(p.x, p.y, 0);
    }

    /** Thay cho Physics.RaycastAll — hit-test bằng Collider2D (BoxCollider2D, CircleCollider2D, PolygonCollider2D...) trên Node */
    static hitTestCollider(node: Node, worldPos: Vec3): boolean {
        if (!node || !DreamyInputManager.isNodeInteractable(node)) return false;
        const collider = node.getComponent(Collider2D);
        if (!collider || !collider.worldAABB) return false;
        return collider.worldAABB.contains(new Vec2(worldPos.x, worldPos.y));
    }

    /** Tương thích ngược: chuyển hướng về hitTestCollider */
    static hitTestNode(node: Node, worldPos: Vec3): boolean {
        return DreamyInputManager.hitTestCollider(node, worldPos);
    }

    /**
     * So thứ tự render. > 0 nghĩa là `a` nằm TRÊN `b`.
     * Cocos render theo thứ tự duyệt cây, nên so chuỗi siblingIndex từ gốc xuống.
     * Đây là thứ thay cho "chọn hit có sortingOrder cao nhất" bên Unity.
     */
    static compareRenderOrder(a: Node, b: Node): number {
        const pa = DreamyInputManager.siblingPath(a);
        const pb = DreamyInputManager.siblingPath(b);
        const n = Math.min(pa.length, pb.length);
        for (let i = 0; i < n; i++) {
            if (pa[i] !== pb[i]) return pa[i] - pb[i];
        }
        return pa.length - pb.length;   // con render sau cha
    }

    private static siblingPath(node: Node): number[] {
        const path: number[] = [];
        for (let n: Node | null = node; n && n.parent; n = n.parent) {
            path.push(n.getSiblingIndex());
        }
        return path.reverse();
    }
}
