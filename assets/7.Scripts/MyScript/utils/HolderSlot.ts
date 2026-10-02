/**
 * HolderSlot — port từ Assets/_GAME/Script/Utils/HolderSlot.cs (Unity)
 *
 * ⚠ Bên Unity `itemInSlot.position` trả về COPY. Cocos `node.worldPosition` trả về
 *   REFERENCE dùng chung -> phải .clone(), nếu không bobbing sẽ trôi dần.
 *   Xem COCOS_MIGRATION_PLAN.md mục 4.2.
 *
 * glue Cocos: sticker — hình bóng TRẮNG nằm DƯỚI ảnh item khi item chờ trong slot
 *   (kiểu sticker dán). Cách làm: duplicate mọi Sprite của item vào node con
 *   "__Sticker__" (index 0 = vẽ trước = nằm sau), gán material sprite-silhouette
 *   (shader xuất màu phẳng theo Sprite.color, giữ alpha texture) và xếp các bản sao
 *   lệch đều quanh vòng tròn bán kính stickerWidth (px) -> viền dày đều mọi phía
 *   (KHÔNG scale, vì scale làm vật dài bị viền lệch).
 *   Tắt khi cầm item lên, bật lại khi thả hụt bay về slot, huỷ khi ghép đúng.
 */

import {
    _decorator, Component, Node, Vec3, tween, Tween, Sprite, UITransform, Color, Material,
} from 'cc';

const { ccclass, property } = _decorator;

const STICKER_NAME = '__Sticker__';

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

    // ---- sticker ----
    @property({ tooltip: 'Hiện hình bóng trắng (sticker) dưới ảnh item khi item nằm trong slot.' })
    stickerEnabled = true;

    @property({ type: Material, tooltip: 'Material hình bóng (assets/8.Materials/sprite-silhouette.mtl). Trống = chỉ nhân màu (không trắng hẳn).' })
    silhouetteMaterial: Material | null = null;

    @property({ tooltip: 'Độ dày viền sticker (px, tính theo local của item).' })
    stickerWidth = 12;

    @property({ tooltip: 'Số hướng lệch trên 1 vòng (8-16). Càng nhiều viền càng tròn, càng tốn sprite.' })
    stickerSamples = 12;

    @property({ tooltip: 'Số vòng (1 = chỉ vòng ngoài; 2 = thêm vòng giữa để lấp kẽ khi viền dày).' })
    stickerRings = 2;

    @property({ type: Color, tooltip: 'Màu sticker.' })
    stickerColor: Color = new Color(255, 255, 255, 255);

    /** Độ lệch world của item so với originPosition sau khi ItemBarManager fit + căn giữa. */
    readonly fitOffset = new Vec3();

    private bobbing: Tween<Node> | null = null;
    private sticker: Node | null = null;

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
        this.buildSticker();
        this.startBobbingAnimation();
    }

    clearSlot(): void {
        this.stopBobbingAnimation();
        this.destroySticker();
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

    // ======================================================== sticker
    /** Bật/tắt sticker (tắt khi cầm item lên, bật lại khi item về slot). */
    setStickerVisible(visible: boolean): void {
        if (this.sticker && this.sticker.isValid) this.sticker.active = visible && this.stickerEnabled;
    }

    /** Dựng lại sticker theo bounds hiện tại của item (gọi sau khi item đã về đúng scale). */
    refreshSticker(): void {
        this.buildSticker();
    }

    private buildSticker(): void {
        this.destroySticker();
        if (!this.stickerEnabled) return;
        const item = this.itemInSlot;
        if (!item || !item.isValid) return;

        // Sprite của item (không tính sticker cũ)
        const sprites = item.getComponentsInChildren(Sprite)
            .filter(sp => sp.node !== item && !HolderSlot.isStickerNode(sp.node));
        if (sprites.length === 0) return;

        // Container nằm ở index 0 của item -> vẽ trước = nằm SAU ảnh gốc, đi theo item (bobbing/kéo).
        const st = new Node(STICKER_NAME);
        st.layer = item.layer;
        st.addComponent(UITransform).setContentSize(0, 0);
        st.setParent(item);
        st.setSiblingIndex(0);

        // Các điểm lệch: mỗi vòng bán kính r = width * k/rings, `samples` hướng đều nhau
        const offsets: { x: number; y: number }[] = [];
        const rings = Math.max(1, Math.floor(this.stickerRings));
        const samples = Math.max(4, Math.floor(this.stickerSamples));
        for (let k = 1; k <= rings; k++) {
            const r = this.stickerWidth * k / rings;
            for (let i = 0; i < samples; i++) {
                const a = (Math.PI * 2 * i) / samples + (k % 2 ? 0 : Math.PI / samples);
                offsets.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
            }
        }

        for (const src of sprites) {
            const srcUt = src.node.getComponent(UITransform);
            for (const off of offsets) {
                const n = new Node(`${src.node.name}Sticker`);
                n.layer = src.node.layer;
                n.setParent(st);
                // duplicate transform local của ảnh gốc + lệch theo hướng
                const pos = src.node.position.clone();
                n.setPosition(pos.x + off.x, pos.y + off.y, pos.z);
                n.setRotation(src.node.rotation.clone());
                n.setScale(src.node.scale.clone());

                const ut = n.addComponent(UITransform);
                if (srcUt) {
                    ut.setContentSize(srcUt.contentSize.clone());
                    ut.setAnchorPoint(srcUt.anchorPoint.clone());
                }
                const sp = n.addComponent(Sprite);
                sp.spriteFrame = src.spriteFrame;
                sp.sizeMode = src.sizeMode;
                sp.type = src.type;
                sp.trim = src.trim;
                sp.color = this.stickerColor.clone();
                if (this.silhouetteMaterial) sp.customMaterial = this.silhouetteMaterial;
            }
        }

        this.sticker = st;
    }

    private destroySticker(): void {
        if (this.sticker && this.sticker.isValid) this.sticker.destroy();
        this.sticker = null;
        // dọn sticker cũ còn sót trên item (vd reload)
        const item = this.itemInSlot;
        const old = item?.isValid ? item.getChildByName(STICKER_NAME) : null;
        if (old) old.destroy();
    }

    static isStickerNode(n: Node): boolean {
        for (let p: Node | null = n; p; p = p.parent) if (p.name === STICKER_NAME) return true;
        return false;
    }
}
