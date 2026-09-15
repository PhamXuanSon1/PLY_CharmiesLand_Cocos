/**
 * ItemGraphic — port từ Assets/_GAME/Script/Item/ItemGraphic.cs (Unity)
 *
 * Bản Unity dài 321 dòng, phần lớn là mô phỏng sortingOrder
 * (SaveLayersAndSetTo20 / RestoreOriginalLayers / MatchItemSortingOrderToTarget /
 *  GetTargetSortingOrderFromSaved / GetSortingOrderRecursive).
 *
 * Cocos render theo thứ tự cây nên toàn bộ phần đó được thay bằng "lớp kéo":
 * khi nhấc item thì chuyển tạm nó sang node DragLayer nằm cuối cây; thả ra
 * thì trả về đúng (parent, siblingIndex) cũ.
 *
 * ⚠ DragLayer phải nằm CÙNG CHUỖI SCALE với item, nếu không item sẽ đổi kích thước
 *   lúc nhấc lên. Với Level542: Scale(0.45) > Items(1.4) > DefaultItem(1) > item.
 *   Nên DragLayer đặt dưới "Items" — cùng cấp với DefaultItem/DynamicItem (đều scale 1).
 *
 * Xem COCOS_MIGRATION_PLAN.md mục 5.1.
 */

import { _decorator, Component, Node, Sprite, Color, Vec3, UITransform, Rect } from 'cc';

const { ccclass, property } = _decorator;

const DRAG_LAYER_NAME = '__DragLayer__';

@ccclass('ItemGraphic')
export class ItemGraphic extends Component {

    // ---- cấu hình chung (bên Unity nằm trên ItemManager) ----
    /** Màu bóng/shadow ở vị trí đích. Unity: ItemManager.targetShadowColor = (51,51,51). */
    static targetShadowColor = new Color(51, 51, 51, 255);
    /** Màu bình thường khi phục hồi. Unity: ItemManager.targetNormalColor = white. */
    static targetNormalColor = new Color(255, 255, 255, 255);
    /** Node chứa DragLayer. InputManager gán. Để null = tự dò (cha của cha item). */
    static dragLayerRoot: Node | null = null;

    // ---- field khớp tên với bản Unity để SceneBuilder gán được từ JSON ----
    @property({ type: Vec3, tooltip: 'Scale của item khi nằm trong danh sách ở dưới cùng.' })
    listScale: Vec3 = new Vec3(1, 1, 1);

    @property({ type: Vec3, tooltip: 'Rotation của item khi nằm trong danh sách ở dưới cùng.' })
    listRotation: Vec3 = new Vec3(0, 0, 0);

    // ---- trạng thái lớp kéo ----
    private savedParent: Node | null = null;
    private savedIndex = -1;

    // ---- trạng thái shadow ở targetPoint ----
    private hiddenTargetSprites: Sprite[] = [];

    // ======================================================== lớp kéo
    /** Unity: SaveLayersAndSetTo20 — đẩy item lên trên cùng khi đang cầm. */
    bringToFront(): void {
        if (this.savedParent) return;                 // đã ở trên cùng rồi

        const layer = this.resolveDragLayer();
        if (!layer) return;

        this.savedParent = this.node.parent;
        this.savedIndex = this.node.getSiblingIndex();
        this.node.setParent(layer, true);             // giữ nguyên world transform
    }

    /** Unity: RestoreOriginalLayers — trả item về đúng chỗ cũ trong cây. */
    restoreOriginalLayers(): void {
        if (!this.savedParent || !this.savedParent.isValid) {
            this.savedParent = null;
            this.savedIndex = -1;
            return;
        }
        this.node.setParent(this.savedParent, true);
        this.node.setSiblingIndex(this.savedIndex);
        this.savedParent = null;
        this.savedIndex = -1;
    }

    /** Có đang được nhấc lên lớp kéo không. */
    get isLifted(): boolean { return this.savedParent !== null; }

    private resolveDragLayer(): Node | null {
        const root = (ItemGraphic.dragLayerRoot && ItemGraphic.dragLayerRoot.isValid)
            ? ItemGraphic.dragLayerRoot
            : this.node.parent ?? this.node.parent?.parent ?? null;
        if (!root) return null;

        let layer = root.getChildByName(DRAG_LAYER_NAME);
        if (!layer) {
            layer = new Node(DRAG_LAYER_NAME);
            layer.layer = root.layer;      // phải là UI_2D, xem ghi chú ở SceneBuilder
            layer.addComponent(UITransform);
            layer.setParent(root);
        }
        layer.setSiblingIndex(root.children.length - 1);   // luôn ở cuối = trên cùng
        return layer;
    }

    /**
     * Unity: MatchItemSortingOrderToTarget — gán order của item bằng order của đích.
     * Cocos: đặt item ngay sau targetPoint trong cây.
     * (Bên Unity item bị tắt ngay sau đó nên phần này gần như không đổi hình ảnh.)
     */
    matchItemSortingOrderToTarget(targetPoint: Node | null): void {
        if (!targetPoint || !targetPoint.parent) return;
        this.node.setParent(targetPoint.parent, true);
        this.node.setSiblingIndex(targetPoint.getSiblingIndex() + 1);
        this.savedParent = null;
        this.savedIndex = -1;
    }

    // ======================================================== shadow ở đích
    /**
     * Unity: HandleTargetSprites — bật shadow (đổi màu tối) hoặc ẩn hẳn sprite ở đích.
     */
    handleTargetSprites(targetPoint: Node | null, isShadowEnabled = true): void {
        if (!targetPoint) return;

        this.hiddenTargetSprites.length = 0;

        const sprites = targetPoint.getComponentsInChildren(Sprite);
        for (const sr of sprites) {
            this.hiddenTargetSprites.push(sr);
            if (isShadowEnabled) {
                sr.color = ItemGraphic.targetShadowColor.clone();
            } else {
                sr.enabled = false;
            }
        }
    }

    /** Unity: RestoreTargetSprites — trả sprite ở đích về màu bình thường. */
    restoreTargetSprites(): void {
        for (const sr of this.hiddenTargetSprites) {
            if (!sr || !sr.isValid) continue;
            sr.enabled = true;
            sr.color = ItemGraphic.targetNormalColor.clone();
        }
        this.hiddenTargetSprites.length = 0;
    }

    // ======================================================== bounds
    /**
     * Unity: GetCombinedBounds — gộp bounds của mọi renderer trong item.
     * Cocos: gộp bounding box (world) của mọi UITransform.
     */
    getCombinedBounds(): Rect | null {
        const uts = this.node.getComponentsInChildren(UITransform);
        if (uts.length === 0) return null;

        let box: Rect | null = null;
        for (const ut of uts) {
            const b = ut.getBoundingBoxToWorld();
            if (b.width <= 0 && b.height <= 0) continue;
            box = box ? box.union(box, b) : b.clone();
        }
        return box;
    }
}
