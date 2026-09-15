/**
 * BoxController — port từ Assets/_GAME/Script/Box/BoxController.cs (Unity)
 *
 * KHÁC bản Unity:
 *   - Không poll Input + Physics.Raycast; đăng ký IPointerHandler ở mức Box.
 *   - DOJump -> TweenUtil.jumpTo.
 *   - SaveLayersAndSetTo20 -> ItemGraphic.bringToFront (lớp kéo).
 *   - Bỏ SetLayerRecursively (dead code bên Unity, không nơi nào gọi).
 */

import { _decorator, BoxCollider2D, Component, EventTouch, Node, randomRange, UITransform, Vec2, Vec3, Enum } from 'cc';
import { DreamyInputManager, InputPriority, IPointerHandler } from '../core/DreamyInputManager';
import { BoxGraphic } from './BoxGraphic';
import { ItemManager } from '../managers/ItemManager';
import { UIManager } from '../managers/UIManager';
import { BaseRoomManager } from '../managers/BaseRoomManager';
import { ItemController } from '../item/ItemController';
import { ItemMovement } from '../item/ItemMovement';
import { HolderSlot } from '../utils/HolderSlot';
import { HandOfBox } from '../utils/HandOfBox';
import { Ply_SoundManager, FxType } from '../ScriptTemplate/Ply_SoundManager';
import { TweenUtil } from '../core/TweenUtil';
import { ui } from '../../Manager/UI';
import { ipm } from '../../Manager/InputManager';

const { ccclass, property } = _decorator;

export enum JumpEasingType {
    backOut = 0,
    backIn = 1,
    backInOut = 2,
    quadOut = 3,
    quadIn = 4,
    quadInOut = 5,
    cubicOut = 6,
    cubicIn = 7,
    cubicInOut = 8,
    sineOut = 9,
    sineIn = 10,
    sineInOut = 11,
    bounceOut = 12,
    bounceIn = 13,
    bounceInOut = 14,
    elasticOut = 15,
    elasticIn = 16,
    elasticInOut = 17,
    linear = 18,
}
Enum(JumpEasingType);

@ccclass('BoxController')
export class BoxController extends Component implements IPointerHandler {

    @property({ type: Node, tooltip: 'Vị trí hộp di chuyển tới sau intro.' })
    MoveAfterIntroPosOfBox: Node | null = null;

    @property({ tooltip: 'Thời gian di chuyển hộp tới vị trí MoveAfterIntroPosOfBox (giây).' })
    moveAfterIntroDuration = 1.2;

    @property({ type: Node, tooltip: 'Bàn tay/chữ hướng dẫn click vào hộp.' })
    handText: Node | null = null;

    @property({ type: HandOfBox, tooltip: 'Script di chuyển bàn tay theo hộp lúc intro.' })
    handOfBox: HandOfBox | null = null;

    @property({ type: Node, tooltip: 'Thanh trượt UI hiện khi bắt đầu tương tác.' })
    slider: Node | null = null;

    @property({ tooltip: 'Đã xong lượt click tutorial mở hộp đầu tiên chưa.' })
    finishedTutorial = false;

    // ========================================== THÔNG SỐ NHẢY ITEM (DOJUMP)
    @property({ tooltip: 'Độ cao cực đại của đường bay Parabol (pixel).' })
    jumpHeight = 150;

    @property({ tooltip: 'Thời gian item bay từ hộp tới Holder (giây).' })
    jumpDuration = 1.0;

    /** Số nhịp nảy khi bay (mặc định 1: bay phát lên luôn, không hiện Inspector) */
    readonly jumpCount = 1;

    @property({
        type: Enum(JumpEasingType),
        tooltip: 'Kiểu gia tốc nảy (easing).',
    })
    jumpEasing: JumpEasingType | string = JumpEasingType.backOut;

    /** Lấy chuỗi easing tương ứng cho TweenUtil, hỗ trợ cả Enum lẫn chuỗi cũ */
    private getEasingString(): string {
        if (typeof this.jumpEasing === 'number') {
            return JumpEasingType[this.jumpEasing] ?? 'backOut';
        }
        return this.jumpEasing || 'backOut';
    }

    @property({ tooltip: 'Độ trễ từ khi click hộp đến khi bắt đầu spawn đồ (giây). Mặc định 0.35s khớp anim mở nắp.' })
    firstOpenSpawnDelay = 0.35;

    @property({ tooltip: 'Khoảng cách giữa các lần phát sound liên tục khi item đang bay ra (giây).' })
    burstSoundInterval = 0.08;

    // ========================================== SPAWN TẤT CẢ ITEM RA VÙNG
    @property({ tooltip: 'Click đầu tiên: spawn TẤT CẢ item bay ra vùng Spawn Area (thay vì từng item vào holder), sau đó hộp bay đi và ẩn.' })
    spawnAllOnFirstClick = false;

    @property({ type: Node, tooltip: 'Node có BoxCollider2D xác định vùng item rơi xuống (random trong vùng collider).' })
    spawnArea: Node | null = null;

    @property({ tooltip: 'Khoảng cách thời gian giữa 2 item bay ra (giây). 0 = bắn TẤT CẢ đồng loạt cùng lúc.' })
    spawnInterval = 0.25;

    @property({ tooltip: 'Bật: item sau chỉ bắn khi item trước ĐÃ ĐÁP XUỐNG vùng (+ Spawn Interval). Tắt: chỉ cách nhau Spawn Interval.' })
    waitPreviousLanded = false;

    @property({ type: Node, tooltip: 'Vị trí hộp bay tới rồi ẩn (bỏ trống = thu nhỏ tại chỗ).' })
    boxExitPos: Node | null = null;

    @property({ tooltip: 'Thời gian hộp bay đi (giây).' })
    boxExitDuration = 0.8;

    @property({ tooltip: 'Chờ thêm sau khi item cuối bay ra rồi hộp mới bay đi (giây).' })
    boxExitDelay = 0.3;

    private isClicked = false;
    private isClosing = false;
    private boxGraphic: BoxGraphic | null = null;

    readonly inputPriority = InputPriority.Box;

    // ======================================================== lifecycle
    onLoad() {
        this.boxGraphic = this.getComponent(BoxGraphic);
        this.boxGraphic?.playReady();
    }

    start() {
        // Mode spawn tất cả: item nằm trong hộp cho tới khi click, nên ẩn hết lúc mở màn
        if (this.spawnAllOnFirstClick) {
            for (const node of ItemManager.instance?.itemList ?? []) {
                if (node?.isValid) node.active = false;
            }
        }
    }

    private onSpawnSoundTick: (() => void) | null = null;
    private onStopSoundEarlyTick: (() => void) | null = null;
    private isSpawningSound = false;

    onEnable() {
        DreamyInputManager.register(this);
        this.node.on(Node.EventType.TOUCH_START, this.onDirectTouch, this);
    }

    onDisable() {
        this.stopSpawningSound();
        this.boxGraphic?.stopClickLoop();
        DreamyInputManager.unregister(this);
        this.node.off(Node.EventType.TOUCH_START, this.onDirectTouch, this);
    }

    onDestroy() {
        this.stopSpawningSound();
        this.boxGraphic?.stopClickLoop();
    }

    private onDirectTouch(): void {
        this.onClick();
    }

    // ======================================================== input
    hitTest(worldPos: Vec3): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        if (this.isClicked || this.isClosing) return false;
        if (DreamyInputManager.hitTestCollider(this.node, worldPos)) return true;
        const ut = this.getComponent(UITransform);
        if (ut && ut.getBoundingBoxToWorld().contains(new Vec2(worldPos.x, worldPos.y))) {
            return true;
        }
        return false;
    }

    onPointerDown(_worldPos: Vec3, _ev: EventTouch): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        if (this.isClicked || this.isClosing) return false;
        this.onClick();
        return true;
    }

    /** Phát 1 tiếng và tự động ngắt trước khi lần phát tiếp theo diễn ra 0.01s */
    private playOneBurstSound(fx: FxType, volumeScale: number = 1): void {
        if (this.onStopSoundEarlyTick) {
            this.unschedule(this.onStopSoundEarlyTick);
            this.onStopSoundEarlyTick = null;
        }

        Ply_SoundManager.Ins?.playFxCutoff(fx, volumeScale);

        // Dừng âm thanh trước 0.01 giây so với lần phát tiếp theo để tránh nghẽn/lag audio buffer
        const stopDelay = Math.max(0.005, this.burstSoundInterval - 0.01);
        this.onStopSoundEarlyTick = () => {
            Ply_SoundManager.Ins?.stopFxCutoff();
            this.onStopSoundEarlyTick = null;
        };
        this.scheduleOnce(this.onStopSoundEarlyTick, stopDelay);
    }

    /** Bắt đầu phát sound liên tục trong suốt quá trình các item bay ra */
    private startSpawningSound(): void {
        this.stopSpawningSound();
        if (this.burstSoundInterval <= 0) return;

        this.isSpawningSound = true;
        let tick = 0;

        // Phát tiếng đầu tiên ngay lập tức
        this.playOneBurstSound(FxType.ClickBox, 1.0);

        this.onSpawnSoundTick = () => {
            if (!this.isSpawningSound) return;
            const volMod = 0.85 + (tick++ % 3) * 0.08;
            this.playOneBurstSound(FxType.ClickBox, volMod);
        };

        this.schedule(this.onSpawnSoundTick, this.burstSoundInterval);
    }

    /** Dừng phát sound liên tục (khi item cuối cùng bắt đầu bay lên) */
    private stopSpawningSound(): void {
        this.isSpawningSound = false;
        if (this.onSpawnSoundTick) {
            this.unschedule(this.onSpawnSoundTick);
            this.onSpawnSoundTick = null;
        }
        if (this.onStopSoundEarlyTick) {
            this.unschedule(this.onStopSoundEarlyTick);
            this.onStopSoundEarlyTick = null;
        }
        // Ngắt ngay lập tức âm thanh đang phát dở
        Ply_SoundManager.Ins?.stopFxCutoff();
    }

    /**
     * Phát 10 lần âm thanh playFxOneShot chồng lớp khi bung đồ trong mode tức thì.
     */
    private playSpawnBurstSound(): void {
        Ply_SoundManager.Ins?.playBurstFx(
            FxType.ClickBox,
            10,
            this.burstSoundInterval,
        );
    }

    // ======================================================== logic
    /** Unity: OnClick */
    private onClick(): void {
        if (UIManager.instance?.isGameEnded) {
            UIManager.instance.gotoStore();
            return;
        }
        if (this.isClicked || this.isClosing) return;

        Ply_SoundManager.Ins?.playFx(FxType.ClickBox);

        const im = ItemManager.instance;
        if (im) {
            if (im.handIntro) im.handIntro.active = false;
            im.enableFirstClickObjects();
        }

        if (this.handText) {
            this.handText.active = false;
        }

        if (this.handOfBox) {
            this.handOfBox.moveAfterIntro(this.moveAfterIntroDuration);
            this.handOfBox.node.active = false;
        }

        this.isClicked = true;

        if (this.slider) this.slider.active = true;

        // ---- CLICK ĐẦU TIÊN ----
        if (!this.finishedTutorial) {
            ui?.firstMove();
            ipm?.fisrtTap();

            this.boxGraphic?.playFirstOpen();

            if (this.spawnAllOnFirstClick) {
                // khoá click tiếp theo + chặn BoxManager.closeAndHide (hộp tự bay đi sau khi spawn xong)
                this.isClosing = true;
                TweenUtil.delayedCall(this, this.firstOpenSpawnDelay, () => this.spawnAllItems());
            } else {
                TweenUtil.delayedCall(this, this.firstOpenSpawnDelay, () => this.spawnItem());
            }

            if (this.MoveAfterIntroPosOfBox) {
                TweenUtil.moveTo(this.node, this.MoveAfterIntroPosOfBox.worldPosition, this.moveAfterIntroDuration, 'linear');
            }

            const finish = () => {
                this.finishedTutorial = true;
                // Unity giữ cờ này trên ItemManager — đồng bộ để script khác đọc được
                if (ItemManager.instance) ItemManager.instance.finishedTutorial = true;
                this.isClicked = false;
            };

            if (BaseRoomManager.instance) BaseRoomManager.instance.playIntroAnimation(finish);
            else finish();

            return;
        }

        // ---- NHỮNG CLICK SAU ----
        this.boxGraphic?.playItemDispense();
        this.spawnItem();
        this.isClicked = false;
    }

    /** Unity: SpawnItem */
    private spawnItem(): void {
        const im = ItemManager.instance;
        if (!im) return;

        if (!im.hasAvailableHolder()) {
            console.warn('[BoxController] Hết holder trống!');
            return;
        }

        const currentItem = im.getCurrentItem();
        if (!currentItem) {
            console.warn('[BoxController] Hết item rồi!');
            return;
        }

        this.playSpawnBurstSound();

        currentItem.setWorldPosition(this.node.worldPosition.clone());
        currentItem.active = true;

        const itemScript = currentItem.getComponent(ItemController);

        // ⚠ Chốt scale gốc TRƯỚC khi setScale(0), nếu không ItemMovement.start()
        //   sẽ chụp nhầm [0,0,0] và item bị scale về 0 ngay khi click.
        currentItem.getComponent(ItemMovement)?.captureOriginal();

        // Đặt scale ban đầu bằng 0 khi vừa sinh ra tại hộp
        currentItem.setScale(0, 0, 0);

        // Tween scale phóng to dần từ 0 lên 1 (hoặc target scale) trong quá trình bay
        const targetScale = im.enablePopScale ? im.popScaleAmount : 1;
        TweenUtil.scaleTo(currentItem, new Vec3(targetScale, targetScale, targetScale), 0.4, 'backOut');

        currentItem.setRotationFromEuler(0, 0, randomRange(-90, 90));

        const holder = im.getCurrentHolder();
        if (!holder) return;

        const holderSlot = holder.getComponent(HolderSlot);
        if (holderSlot) {
            holderSlot.isEmpty = false;
            if (itemScript) itemScript.currentHolderSlot = holderSlot;
        }

        // Unity: DOJump(holder.position, 1.5f, 1, 1f).SetEase(Ease.OutBack)
        TweenUtil.jumpTo(
            currentItem,
            holder.worldPosition,
            this.jumpHeight,
            this.jumpCount,
            this.jumpDuration,
            this.getEasingString(),
            () => {
                if (!holderSlot) return;
                holderSlot.setItem(currentItem);
                if (itemScript) im.showFirstDragHint(itemScript);
            },
        );
    }

    // ======================================================== spawn tất cả ra vùng
    /** Lấy hết item còn lại trong ItemManager, bắn lần lượt ra Spawn Area rồi cho hộp bay đi. */
    private spawnAllItems(): void {
        const im = ItemManager.instance;
        if (!im) return;

        const items: Node[] = [];
        for (let n = im.getCurrentItem(); n; n = im.getCurrentItem()) items.push(n);

        if (items.length === 0) {
            console.warn('[BoxController] Không có item nào để spawn!');
            this.exitBox();
            return;
        }

        // Không có giãn cách -> bắn đồng loạt tất cả trong cùng 1 frame
        if (this.spawnInterval <= 0 && !this.waitPreviousLanded) {
            this.boxGraphic?.playItemDispense();
            this.playSpawnBurstSound();
            for (const node of items) this.launchItemToArea(node);
            TweenUtil.delayedCall(this, this.jumpDuration + this.boxExitDelay, () => this.onAllItemsLanded());
            return;
        }

        // Bắn tuần tự: phát sound liên tục cho tới khi item cuối cùng bắt đầu bay lên
        this.startSpawningSound();
        this.launchSequence(items, 0);
    }

    /** Mọi item đã đáp xuống: hiện hint vào item trên cùng rồi hộp bay đi. */
    private onAllItemsLanded(): void {
        this.stopSpawningSound();
        const im = ItemManager.instance;
        if (im) im.showFirstDragHint(im.getTopmostAvailableItem());
        this.exitBox();
    }

    /** Bắn tuần tự item[index] -> chờ -> item[index+1] ... -> hết thì hộp bay đi. */
    private launchSequence(items: Node[], index: number): void {
        if (UIManager.instance?.isGameEnded) {
            this.stopSpawningSound();
            return;
        }

        if (index >= items.length) {
            this.stopSpawningSound();
            // item cuối đã bắn; chờ nó đáp xuống rồi hiện hint (vào item trên cùng) và hộp bay đi
            const wait = (this.waitPreviousLanded ? 0 : this.jumpDuration) + this.boxExitDelay;
            TweenUtil.delayedCall(this, wait, () => this.onAllItemsLanded());
            return;
        }

        // Khi item cuối cùng bắt đầu bay lên -> dừng phát sound liên tục!
        if (index === items.length - 1) {
            this.stopSpawningSound();
        }

        // Mỗi khi spawn 1 item, play lại 1 lần (đang play dở thì ngắt và play lại ngay từ đầu)
        this.boxGraphic?.playItemDispense();

        const next = () => TweenUtil.delayedCall(this, this.spawnInterval, () => this.launchSequence(items, index + 1));

        this.launchItemToArea(items[index], this.waitPreviousLanded ? next : undefined);
        if (!this.waitPreviousLanded) next();
    }

    /** Một item bay từ hộp tới điểm random trong Spawn Area (không dùng holder). */
    private launchItemToArea(node: Node, onLanded?: () => void): void {
        if (!node?.isValid) { onLanded?.(); return; }
        const im = ItemManager.instance;

        node.setWorldPosition(this.node.worldPosition.clone());
        node.active = true;

        // Chốt scale gốc TRƯỚC khi setScale(0) — xem ghi chú ở spawnItem()
        node.getComponent(ItemMovement)?.captureOriginal();
        node.setScale(0, 0, 0);

        const targetScale = im?.enablePopScale ? im.popScaleAmount : 1;
        TweenUtil.scaleTo(node, new Vec3(targetScale, targetScale, targetScale), 0.4, 'backOut');
        node.setRotationFromEuler(0, 0, randomRange(-90, 90));

        const dest = this.randomPointInSpawnArea(node.worldPosition.z);
        const itemScript = node.getComponent(ItemController);

        TweenUtil.jumpTo(
            node, dest, this.jumpHeight, this.jumpCount, this.jumpDuration, this.getEasingString(),
            () => {
                // Không có holder -> item tự nhấp nhô tại chỗ (thay HolderSlot.startBobbingAnimation)
                itemScript?.startIdleBobbing();
                onLanded?.();
            },
        );
    }

    /** Điểm random trong worldAABB của BoxCollider2D trên Spawn Area. */
    private randomPointInSpawnArea(z: number): Vec3 {
        const area = this.spawnArea;
        const col = area?.getComponent(BoxCollider2D);
        if (col) {
            const r = col.worldAABB;
            return new Vec3(randomRange(r.xMin, r.xMax), randomRange(r.yMin, r.yMax), z);
        }
        if (area) {
            console.warn('[BoxController] Spawn Area thiếu BoxCollider2D, dùng tâm node.');
            return new Vec3(area.worldPosition.x, area.worldPosition.y, z);
        }
        console.warn('[BoxController] Chưa gán Spawn Area!');
        return this.node.worldPosition.clone();
    }

    /** Hộp bay tới Box Exit Pos (hoặc thu nhỏ tại chỗ) rồi inactive. */
    private exitBox(): void {
        this.boxGraphic?.playClosing();
        TweenUtil.killAll(this.node);

        const hide = () => { this.node.active = false; };
        if (this.boxExitPos) {
            TweenUtil.moveTo(this.node, this.boxExitPos.worldPosition.clone(), this.boxExitDuration, 'quadIn', hide);
        } else {
            TweenUtil.scaleTo(this.node, Vec3.ZERO, this.boxExitDuration, 'sineInOut', hide);
        }
    }

    /** Khóa tương tác, chạy hiệu ứng đóng và ẩn Box sau thời gian giữ nguyên gameplay cũ. */
    closeAndHide(delay = 2): void {
        if (this.isClosing) return;
        this.isClosing = true;
        this.isClicked = true;
        this.boxGraphic?.playClosing();
        this.scheduleOnce(() => this.goToEndPos(), delay);
    }

    /** Hiệu ứng kết thúc trên node Box; chỉ BoxController được quyền ẩn node này. */
    private goToEndPos(): void {
        TweenUtil.scaleTo(this.node, Vec3.ZERO, 0.5, 'sineInOut', () => {
            this.node.active = false;
        });
    }
}
