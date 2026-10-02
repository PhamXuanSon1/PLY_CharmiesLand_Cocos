/**
 * ItemController — Quản lý tương tác, kéo thả và ghép item vào vị trí đích (Target).
 * Sử dụng hệ thống âm thanh từ PLY_SoundManager (sm).
 */

import { _decorator, Animation, BoxCollider2D, Collider2D, Component, Enum, EventTouch, Node, ParticleSystem2D, Tween, tween, UITransform, Vec2, Vec3 } from 'cc';
import { DreamyInputManager, InputPriority, IPointerHandler } from '../core/DreamyInputManager';
import { ItemGraphic } from './ItemGraphic';
import { ItemMovement } from './ItemMovement';
import { OpenItem } from './OpenItem';
import { ItemManager } from '../managers/ItemManager';
import { UIManager } from '../managers/UIManager';
import { ItemBarManager } from '../managers/ItemBarManager';
import { SeatHandler } from '../utils/SeatHandler';
import { HolderSlot } from '../utils/HolderSlot';
import { TurnOnSpine } from '../utils/TurnOnSpine';
import { ChangeLight } from '../utils/ChangeLight';
import { Ply_Pool, PoolType as PlyPoolType } from '../ScriptTemplate/Ply_Pool';
import { ObjectPool, PoolType } from '../core/ObjectPool';
import { SmokeEffect } from '../effects/SmokeEffect';
import { TweenUtil } from '../core/TweenUtil';
import { Ply_SoundManager, FxType } from '../ScriptTemplate/Ply_SoundManager';

const { ccclass, property } = _decorator;

/** Danh sách các loại âm thanh chất liệu tuỳ chọn khi ghép đúng */
export enum MaterialType {
    None = 0,
    ClickBox = 1,
    PickItem = 2,
    HeavyWood = 3,
    SmallWood = 4,
    Cloth = 5,
    DropMetal = 6,
    Glass = 7,
    DropOnFloor = 8,
    Cat1 = 9,
    Cat2 = 10,
    Cat3 = 11,
    Water = 12,
    BurnOn = 13,
    BookOpen = 14,
    CapyDrop = 15,
    Grass = 16,
    Chair = 17,
    CoinBag = 18,
    GoldChest = 19,
    WoodenFish = 20,
    Window = 21,
    WoodenDoor = 22,
    Skeleton = 23,
    WoodenChair = 24,
    ComCop = 25,
    Rem = 26,
    ClothesDrop = 27,
    Decor = 28,
}
Enum(MaterialType);

@ccclass('ItemController')
export class ItemController extends Component implements IPointerHandler {

    // ---- Vị trí đích ----
    @property({ type: Node, tooltip: 'Vị trí đích mà item cần được kéo vào để ghép.' })
    targetPoint: Node | null = null;

    // ---- Tham số kéo thả & Snap ----
    @property({ tooltip: 'Khoảng cách tối thiểu để item tự hút vào đích (pixel).' })
    snapDistance = 200;

    @property({ tooltip: 'Thời gian bay vào vị trí đích (giây).' })
    moveDuration = 0.2;

    @property({
        type: Enum(MaterialType),
        tooltip: 'Âm thanh chất liệu tuỳ chọn khi ghép đúng (None = không phát/tuỳ chọn).'
    })
    materialType: MaterialType = MaterialType.None;

    @property({
        type: [Enum(MaterialType)],
        tooltip: 'Danh sach FX phat lan luot khi ghep dung. Neu co gia tri o day, Material Type se duoc bo qua.'
    })
    materialTypes: MaterialType[] = [];

    /** Đã ghép thành công vào đích hay chưa */
    isPlaced = false;

    @property({ tooltip: 'Luôn hiện bóng ở đích ngay từ đầu; thả hụt / huỷ kéo KHÔNG tắt bóng, chỉ tắt khi ghép đúng.' })
    persistentShadow = false;

    // ---- Nhấp nhô khi nằm chờ trong vùng spawn (mode Box.spawnAllOnFirstClick, không có holder) ----
    @property({ tooltip: 'Khoảng cách nhấp nhô lên xuống khi item nằm chờ trong vùng spawn (px). 0 = tắt.' })
    idleBobDistance = 30;

    @property({ tooltip: 'Thời gian 1 chu kỳ nhấp nhô (giây).' })
    idleBobDuration = 1.5;


    itemGraphic: ItemGraphic = null!;
    itemMovement: ItemMovement = null!;
    currentHolderSlot: HolderSlot | null = null;

    readonly inputPriority = InputPriority.Item;

    private dragging = false;
    /** Lần kéo này dùng nhíp (item là con của ItemBar.Tweezers/DragPosition). */
    private usingTweezers = false;
    private moving = false;
    private itemCollider: Collider2D | null = null;
    private initialWorldPos = new Vec3();

    /** glue Cocos: lần cầm này item có được cấp bóng lúc kéo không — snap xong mới trừ 1 lượt. */
    private usedDragShadow = false;

    private idleBob: Tween<Node> | null = null;
    /** Vị trí world gốc lúc bắt đầu nhấp nhô — thả hụt sẽ bay về đây rồi nhấp nhô lại. */
    private idleBobBaseWorldPos: Vec3 | null = null;

    // ======================================================== Lifecycle
    onLoad() {
        this.itemGraphic = this.getComponent(ItemGraphic) ?? this.addComponent(ItemGraphic);
        this.itemMovement = this.getComponent(ItemMovement) ?? this.addComponent(ItemMovement);
        this.setupCollider();
    }

    onEnable() {
        if (!this.itemGraphic) this.itemGraphic = this.getComponent(ItemGraphic) ?? this.addComponent(ItemGraphic);
        if (!this.itemMovement) this.itemMovement = this.getComponent(ItemMovement) ?? this.addComponent(ItemMovement);
        DreamyInputManager.register(this);
    }

    onDisable() {
        DreamyInputManager.unregister(this);
    }

    /** Đồng bộ collider để Item luôn dùng Collider 2D (Box/Polygon/Circle) cho thao tác kéo-thả. */
    private setupCollider(): void {
        this.itemCollider = this.getComponent(Collider2D) ?? this.addComponent(BoxCollider2D);
    }

    // ======================================================== Input & HitTest
    hitTest(worldPos: Vec3): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        if (this.isPlaced || this.moving || !this.node.activeInHierarchy) return false;
        return DreamyInputManager.hitTestCollider(this.node, worldPos);
    }

    /** Bắt đầu nhấc item lên (Pick) */
    onPointerDown(worldPos: Vec3, _ev: EventTouch): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        if (this.isPlaced || this.moving) return false;

        // Đang nhấp nhô -> dừng lại và lấy vị trí gốc (không lấy vị trí giữa chừng của nhịp nhô)
        this.stopIdleBobbing();
        this.initialWorldPos = this.idleBobBaseWorldPos
            ? this.idleBobBaseWorldPos.clone()
            : this.node.worldPosition.clone();

        // 1. Phát âm thanh Pick từ Ply_SoundManager
        Ply_SoundManager.Ins?.playFx(FxType.PickItem);

        // 2. Nhấc item: có nhíp -> bật nhíp tại con trỏ, item làm con của DragPosition và kéo NHÍP;
        //    không có -> đưa item lên lớp kéo như cũ. Sau đó scale item về ĐÚNG world scale
        //    của target (thanh bar scale 1, phòng scale 0.5 -> nếu không item to gấp đôi bóng).
        this.dragging = true;
        const bar = ItemBarManager.instance;
        this.usingTweezers = !!bar?.hasTweezers;
        if (this.usingTweezers) {
            bar!.showTweezers(worldPos);
            this.itemGraphic.attachTo(bar!.dragPosition!);
        } else {
            this.itemGraphic.bringToFront();
        }
        this.itemMovement.startDragAnimation(this.computeDragBaseScale());

        // 3. Hiện bóng (shadow) ở vị trí đích — chỉ hiện khi đang kéo item này, và chỉ
        //    khi chưa dùng hết shadowItemCount lượt (ItemManager.canShowDragShadow)
        //    hoặc item đã tick persistentShadow.
        this.usedDragShadow = !this.persistentShadow
            && ItemManager.instance?.canShowDragShadow(this) !== false;

        if (this.persistentShadow || this.usedDragShadow) this.showTargetShadow();

        // 4. Thông báo cho ItemManager
        const im = ItemManager.instance;
        if (im) {
            if (im.isStuckHintActive) {
                if (im.stuckTargetItem && im.stuckTargetItem !== this) {
                    // Chạm sang item khác -> huỷ stuck hint 5s và chuyển về logic 3s
                    im.cancelStuckHint();
                } else if (im.stuckTargetItem === this) {
                    // Đang kéo đúng item stuck -> tạm ẩn hint trong lúc kéo
                    if (im.handHint) im.handHint.active = false;
                }
            } else {
                if (im.handHint) im.handHint.active = false;
            }

            im.isDragging = true;
            im.setLastItem(this);
            im.resetIdleTimer();
        }

        // Nhấc khỏi slot: dừng nhấp nhô + tắt sticker trắng dưới item
        this.currentHolderSlot?.stopBobbingAnimation();
        this.currentHolderSlot?.setStickerVisible(false);

        return true;
    }

    /** Di chuyển theo ngón tay / chuột */
    onPointerMove(worldPos: Vec3, _ev: EventTouch): void {
        if (!this.dragging) return;
        if (this.usingTweezers) ItemBarManager.instance?.moveTweezers(worldPos);   // kéo nhíp, item đi theo
        else this.itemMovement.moveToPosition(worldPos);
    }

    /** Thả tay khi đang dùng nhíp: chuyển item sang lớp kéo (giữ world) rồi tắt nhíp. */
    private releaseTweezers(): void {
        if (!this.usingTweezers) return;
        this.usingTweezers = false;
        this.itemGraphic.liftToDragLayer();
        ItemBarManager.instance?.hideTweezers();
    }

    /** Thả tay (Pointer Up) */
    onPointerUp(_worldPos: Vec3, _ev: EventTouch): void {
        if (!this.dragging) return;
        this.dragging = false;

        const im = ItemManager.instance;
        if (im) {
            im.isDragging = false;
            im.resetIdleTimer();
        }

        // Snap đúng: giữ scale khớp target (bỏ bump 1.1), NHÍP KẸP item bay tới target,
        //   tới nơi mới đổi cha item vào phòng (xem moveToTarget). Thả hụt: nhả nhíp ngay, về Holder.
        const snapped = this.canSnap();
        this.itemMovement.stopDragAnimation(!snapped);
        if (snapped) {
            this.moveToTarget();
        } else {
            // Thả hụt: FalseIcon ngay tại vị trí thả + sound Fail (đang phát dở thì stop rồi phát lại)
            this.spawnIcon(PlyPoolType.FalseIcon, this.node.worldPosition.clone());
            Ply_SoundManager.Ins?.playFail();
            this.releaseTweezers();
            this.snapFailed();
        }
    }

    /**
     * glue Cocos: scale local (trong lớp kéo) để item có world scale = world scale của target.
     * Giữ dấu (flip) của originalScale.
     */
    private computeDragBaseScale(): Vec3 | null {
        const target = this.targetPoint;
        const parent = this.node.parent;
        if (!target || !target.isValid || !parent) return null;
        const tw = target.worldScale;
        const pw = parent.worldScale;
        const safe = (v: number) => (Math.abs(v) < 1e-6 ? 1 : v);
        const o = this.itemMovement.originalScale;
        const sign = (v: number) => (v < 0 ? -1 : 1);
        return new Vec3(
            Math.abs(tw.x / safe(pw.x)) * sign(o.x),
            Math.abs(tw.y / safe(pw.y)) * sign(o.y),
            Math.abs(tw.z / safe(pw.z)) * sign(o.z || 1),
        );
    }

    /** Huỷ thao tác giữa chừng */
    onPointerCancel(): void {
        if (!this.dragging) return;
        this.dragging = false;
        this.releaseTweezers();
        this.itemMovement.stopDragAnimation();
        if (ItemManager.instance) ItemManager.instance.isDragging = false;
        this.snapFailed();
    }

    // ======================================================== Target shadow
    /** Bật bóng ở đích khi bắt đầu kéo item (hoặc ngay từ đầu nếu persistentShadow). */
    showTargetShadow(): void {
        const target = this.targetPoint;
        if (!target || !target.isValid || this.isPlaced) return;

        // có thể được gọi từ ItemManager.start() khi node item chưa active (onLoad chưa chạy)
        if (!this.itemGraphic) this.itemGraphic = this.getComponent(ItemGraphic) ?? this.addComponent(ItemGraphic);

        target.active = true;
        this.itemGraphic.handleTargetSprites(target, true);
    }

    /** Tắt bóng khi thả tay mà chưa ghép được. Bỏ qua nếu bóng là persistent. */
    private hideTargetShadow(): void {
        const target = this.targetPoint;
        if (!target || !target.isValid || this.isPlaced) return;
        if (this.persistentShadow) return;
        // Item còn nằm trên slot và thanh bar đang bật "bóng hiện sẵn" -> giữ bóng sau khi thả hụt
        if (this.currentHolderSlot && ItemBarManager.instance?.showShadowInSlot) return;

        // trả sprite về màu gốc trước rồi mới ẩn node, để lần sau bật lại sạch sẽ
        this.itemGraphic.restoreTargetSprites();
        target.active = false;
    }

    // ======================================================== Snap Logic
    /** Kiểm tra xem item có đủ gần đích để ghép không */
    /** Item có đủ điều kiện ghép vào target không (vị trí + SeatHandler). */
    private canSnap(): boolean {
        if (!this.targetPoint || !this.targetPoint.isValid) return false;

        const targetCollider = this.targetPoint.getComponent(Collider2D);
        let isSnapped = false;

        if (targetCollider && targetCollider.worldAABB) {
            const itemPos2D = new Vec2(this.node.worldPosition.x, this.node.worldPosition.y);
            isSnapped = targetCollider.worldAABB.contains(itemPos2D);
        }

        if (!isSnapped) {
            const distance = Vec3.distance(this.node.worldPosition, this.targetPoint.worldPosition);
            if (distance <= this.snapDistance) isSnapped = true;
        }

        if (!isSnapped) return false;

        // Kiểm tra điều kiện phụ (SeatHandler nếu có)
        const seat = this.getComponent(SeatHandler);
        if (seat && !seat.canPlace()) {
            console.log('[ItemController] Phải đặt item khác trước!');
            return false;
        }
        return true;
    }

    /** Thả trượt: Bay về vị trí ban đầu (Holder / vị trí nhấc lên), không phát âm thanh */
    private snapFailed(): void {
        // Thả hụt không phát âm thanh
        this.itemMovement.snapFailedAnimation();

        // Thả hụt KHÔNG tốn lượt bóng — lần cầm sau vẫn xin lại bình thường
        this.usedDragShadow = false;

        // Thả hụt -> ẩn bóng đi, chỉ hiện lại khi cầm item lên lần sau
        this.hideTargetShadow();

        if (this.currentHolderSlot) {
            const returnPos = (this.currentHolderSlot.originPosition
                ? this.currentHolderSlot.originPosition.worldPosition.clone()
                : this.currentHolderSlot.node.worldPosition.clone())
                .add(this.currentHolderSlot.fitOffset);   // chỗ đã căn giữa khi fit vào slot

            // ⚠ killAll dừng cả tween scale vừa tạo trong stopDragAnimation -> tween lại sau killAll
            TweenUtil.killAll(this.node);

            // Đổi cha về HolderSlot NGAY (giữ world) rồi mới bay về — item nằm trong slot suốt lúc bay
            this.itemGraphic.restoreOriginalLayers();
            if (this.node.parent !== this.currentHolderSlot.node) {
                this.node.setParent(this.currentHolderSlot.node, true);
            }

            TweenUtil.scaleTo(this.node, this.itemMovement.originalScale.clone(), this.moveDuration, 'quadOut');
            TweenUtil.moveTo(this.node, returnPos, this.moveDuration, 'quadOut', () => {
                this.node.setScale(this.itemMovement.originalScale);
                this.currentHolderSlot?.setStickerVisible(true);
                this.currentHolderSlot?.startBobbingAnimation();
                ItemManager.instance?.showStuckHintAgain();
            });
        } else {
            // Không có holder / scroll: GIỮ NGUYÊN vị trí vừa thả (không bay về chỗ cũ),
            // trả về layer gốc nhưng đưa lên trên cùng của đống item để không bị che.
            this.itemGraphic.restoreOriginalLayers();
            if (this.node.parent) this.node.setSiblingIndex(this.node.parent.children.length - 1);
            // nhấp nhô tiếp tại vị trí mới
            if (this.idleBobBaseWorldPos) this.startIdleBobbing();
            ItemManager.instance?.showStuckHintAgain();
        }
    }

    // ======================================================== idle bobbing (không có holder)
    /** Nhấp nhô tại chỗ, tương tự HolderSlot.startBobbingAnimation nhưng tự chạy trên item. */
    startIdleBobbing(): void {
        this.stopIdleBobbing();
        if (this.idleBobDistance <= 0 || this.isPlaced || !this.node.isValid) return;

        this.idleBobBaseWorldPos = this.node.worldPosition.clone();

        // ⚠ Cocos trả REFERENCE cho position -> phải clone, nếu không bobbing sẽ trôi dần
        const startPos = this.node.position.clone();
        const upPos = new Vec3(startPos.x, startPos.y + this.idleBobDistance, startPos.z);
        const half = this.idleBobDuration / 2;

        this.idleBob = tween(this.node)
            .repeatForever(
                tween(this.node)
                    .to(half, { position: upPos }, { easing: 'sineInOut' })
                    .to(half, { position: startPos }, { easing: 'sineInOut' }),
            )
            .start();
    }

    stopIdleBobbing(): void {
        if (this.idleBob) {
            this.idleBob.stop();
            this.idleBob = null;
        }
    }

    /** Spawn TrueIcon/FalseIcon từ Ply_Pool tại world pos (trong Canvas), tự trả về pool sau iconLifetime. */
    private spawnIcon(type: PlyPoolType, worldPos: Vec3): void {
        const pool = Ply_Pool.Ins;
        if (!pool) return;
        const unit = pool.spawn(type, Vec3.ZERO);
        if (!unit?.node) return;

        const im = ItemManager.instance;
        const parent = im?.iconParent?.isValid ? im.iconParent : ItemBarManager.instance?.node.parent ?? null;
        if (parent) {
            unit.node.setParent(parent, false);
            unit.node.layer = parent.layer;
            unit.node.setSiblingIndex(parent.children.length - 1);   // trên cùng
        }
        unit.node.setWorldPosition(worldPos);
        unit.node.getComponent(Animation)?.play();
        unit.deSpawnByTime(im?.iconLifetime ?? 1);
    }

    /** Ghép đúng: Bay vào Target + bật Target + phát âm thanh Done/LandRight */
    private moveToTarget(): void {
        const target = this.targetPoint!;
        this.moving = true;
        this.stopIdleBobbing();
        this.idleBobBaseWorldPos = null;

        const onArrive = () => {
            // Đang được nhíp kẹp: tới target rồi mới nhả — chuyển item sang lớp kéo (giữ world)
            // để matchItemSortingOrderToTarget bên dưới đổi cha vào phòng, rồi tắt nhíp.
            this.releaseTweezers();

            // Ghép đúng: TrueIcon tại target khi item vừa bay tới
            this.spawnIcon(PlyPoolType.TrueIcon, target.worldPosition.clone());

            // 1. Kích hoạt Target và tất cả các node con của Target
            target.active = true;
            for (const child of target.children) {
                child.active = true;
            }

            this.isPlaced = true;

            // 2. Kích hoạt spine hoặc trigger phụ
            this.getComponent(TurnOnSpine)?.activateSpine();
            this.getComponent(OpenItem)?.onItemPlaced();

            // 3. Phát âm thanh Done / LandRight từ Ply_SoundManager
            const materialTypes = this.materialTypes.length > 0
                ? this.materialTypes
                : [this.materialType];
            const fxTypes = materialTypes
                .filter((materialType) => materialType !== MaterialType.None)
                .map((materialType) => this.materialTypeToFxType(materialType))
                .filter((fxType): fxType is FxType => fxType !== null);
            if (fxTypes.length > 0) {
                Ply_SoundManager.Ins?.playFxSequence(fxTypes);
            } else {
                Ply_SoundManager.Ins?.playFx(FxType.HeavyWood);
            }


            // 4. Giải phóng slot nếu nằm trong thanh bar, báo thanh bar refill
            if (this.currentHolderSlot) {
                this.currentHolderSlot.clearSlot();
                this.currentHolderSlot = null;
            }
            ItemBarManager.instance?.itemPlaced(this);

            this.itemGraphic.restoreOriginalLayers();
            this.itemGraphic.matchItemSortingOrderToTarget(target);
            this.node.setWorldRotation(target.worldRotation);
            this.itemGraphic.restoreTargetSprites();

            this.moving = false;
            DreamyInputManager.unregister(this);

            // 5. Ẩn item đi (hình ảnh ở Target đã hiện lên thay thế)
            this.node.active = false;

            // 6. Hiệu ứng Blink / Star FX
            this.spawnBlinkEffect(target);

            // 7. Báo cho ItemManager tiến độ
            //    Item được cấp bóng lúc kéo -> giờ mới trừ 1 lượt trong shadowItemCount.
            if (this.usedDragShadow) {
                this.usedDragShadow = false;
                ItemManager.instance?.notifyDragShadowPlaced();
            }
            ItemManager.instance?.itemArrivedAtTarget();
            ItemManager.instance?.setLastItem(null);

            ChangeLight.notifyItemPlaced();
        };

        const bar = ItemBarManager.instance;
        const carrier = this.usingTweezers && bar?.tweezers?.isValid ? bar.tweezers : null;
        if (carrier) {
            // Tween NHÍP sao cho item (con của DragPosition) đáp đúng target: giữ offset nhíp - item
            const off = carrier.worldPosition.clone().subtract(this.node.worldPosition);
            const dest = target.worldPosition.clone().add(off);
            tween(carrier)
                .to(this.moveDuration, { worldPosition: dest }, { easing: 'quadOut' })
                .call(onArrive)
                .start();
        } else {
            this.itemMovement.moveToTarget(target, this.moveDuration, onArrive);
        }
    }

    private materialTypeToFxType(materialType: MaterialType): FxType | null {
        const soundName = MaterialType[materialType];
        const fxType = FxType[soundName as keyof typeof FxType]
            ?? FxType[`${soundName.charAt(0).toLowerCase()}${soundName.slice(1)}` as keyof typeof FxType];
        return typeof fxType === 'number' ? fxType : null;
    }

    /** Spawn hiệu ứng khói (SmokeEffect) khi đặt đúng vào target */
    private spawnBlinkEffect(target: Node): void {
        let fxNode: Node | null = null;

        // 1. Lấy effect từ Ply_Pool (hoặc ObjectPool)
        if (Ply_Pool.Ins) {
            const unit = Ply_Pool.Ins.spawn(PlyPoolType.CorrectEffect, target.worldPosition);
            if (unit) fxNode = unit.node;
        } else if (ObjectPool.instance) {
            fxNode = ObjectPool.instance.spawn(PoolType.BlinkFX, target.worldPosition);
        }

        if (!fxNode || !fxNode.isValid) return;

        // 2. Cho nó là con của target, đặt tại tâm, vẽ trên cùng
        fxNode.setParent(target, false);
        fxNode.setPosition(Vec3.ZERO);
        fxNode.layer = target.layer;
        fxNode.setSiblingIndex(target.children.length - 1);
        fxNode.active = true;

        // 3. SmokeEffect: reset mọi ParticleSystem2D và tự trả về pool khi xong
        const fx = fxNode.getComponent(SmokeEffect) ?? fxNode.addComponent(SmokeEffect);
        fx.play();
    }
}
