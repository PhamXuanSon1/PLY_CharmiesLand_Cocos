/**
 * ItemManager — port từ Assets/_GAME/Script/Manager/ItemManager.cs (Unity)
 *
 * BỎ so với bản Unity:
 *   - Toàn bộ khối Luna (optimizeForLuna / objectsToDisableForLuna /
 *     animatorsToDisableForLuna) — project này không build Luna.
 *
 * GLUE riêng cho Cocos (Unity không có, nhưng bắt buộc phải có ở đây):
 *   - ItemGraphic.targetShadowColor/targetNormalColor là static -> phải bơm màu
 *     từ ItemManager xuống lúc onLoad.
 *   - ensureHolders(): SceneBuilder dựng scene từ JSON nên holderItemList có thể
 *     rỗng/null, phải tự dò HolderSlot trong scene.
 *   - WorldScrollManager.setupItems(): bên Unity item nằm sẵn đúng vị trí trong
 *     scene, bên Cocos thanh bar do WorldScrollManager xếp. Không ai khác gọi
 *     hàm này nên phải gọi ở đây.
 *   - onAnyPointerDown(): thay cho việc poll Input trong Update bên Unity.
 *   - Bỏ layerTop: Cocos render theo thứ tự cây, item được đẩy lên trên bằng
 *     ItemGraphic.bringToFront() (reparent sang DragLayer do DreamyInputManager
 *     gán), không có sorting order như Unity.
 *   - Tween của hint phải giữ tham chiếu để stop() — TweenUtil.valueTo chạy trên
 *     object trung gian, killAll(handHint) không chạm tới được (Unity dùng
 *     SetTarget(handHint) + DOKill()).
 */

import { _decorator, Component, Node, Color, Vec3, Tween } from 'cc';
import { ItemController } from '../item/ItemController';
import { ItemGraphic } from '../item/ItemGraphic';
import { HolderSlot } from '../utils/HolderSlot';
import { SeatHandler } from '../utils/SeatHandler';
import { TweenUtil } from '../core/TweenUtil';
import { WorldScrollManager } from './WorldScrollManager';
import { UIManager } from './UIManager';
import { BoxManager } from './BoxManager';

const { ccclass, property } = _decorator;

@ccclass('ItemManager')
export class ItemManager extends Component {

    static instance: ItemManager | null = null;

    // ---------------- Elements ----------------
    @property({ tooltip: 'Lấy item từ cuối danh sách (từ dưới lên trên).' })
    spawnFromLast = false;

    @property({ type: [Node], tooltip: 'Danh sách các item sẽ rớt ra từ trong hộp.' })
    itemList: Node[] = [];

    @property({ type: [Node], tooltip: 'Danh sách các vị trí chờ (Holder) để chứa item trước khi ghép.' })
    holderItemList: Node[] = [];

    private currentItemIndex = 0;

    // ---------------- Item Pop Settings ----------------
    @property({ tooltip: 'Có cho phép tăng scale của item khi lấy ra từ hộp không?' })
    enablePopScale = true;

    @property({ tooltip: 'Lượng scale tăng lên khi lấy ra khỏi hộp (mặc định 1.2).' })
    popScaleAmount = 1.2;

    // ---------------- Item Drag Settings ----------------
    @property({ tooltip: 'Có cho phép tăng scale của item khi đang kéo không?' })
    enableDragScale = true;

    @property({ tooltip: 'Lượng scale của item khi đang kéo (mặc định 1.1).' })
    dragScaleAmount = 1.1;

    // ---------------- First Click Settings ----------------
    @property({ type: [Node], tooltip: 'Các object sẽ được bật lên khi người chơi click lần đầu tiên.' })
    objsToEnableOnFirstClick: Node[] = [];

    private isFirstClicked = false;

    // ---------------- Status ----------------
    /** Item cuối cùng mà người chơi vừa cầm/tương tác. */
    lastInteractedItem: ItemController | null = null;

    @property({ type: [Node], tooltip: 'Hiệu ứng pháo hoa bắn ra khi hoàn thành màn chơi.' })
    WinConfetti: Node[] = [];

    @property({ tooltip: 'Cờ báo hiệu người chơi đã hoàn thành bước hướng dẫn (Tutorial).' })
    finishedTutorial = false;

    // ---------------- Hint Settings ----------------
    private idleTimer = 0;

    @property({ tooltip: 'Thời gian chờ (giây) không thao tác sẽ hiện Hint gợi ý (mặc định 3s).' })
    idleTimeToHint = 3;

    private hasShownHint = false;

    private stuckTimer = 0;

    @property({ tooltip: 'Thời gian chờ (giây) không ghép được item tiếp theo sẽ hiện Hint cố định (mặc định 5s).' })
    stuckTimeToHint = 5;

    /** Cờ báo hiệu đang ở chế độ Hint cố định 5s (chỉ tắt khi ghép xong item đó hoặc click item khác) */
    isStuckHintActive = false;

    /** Item đang được gán hint 5s */
    stuckTargetItem: ItemController | null = null;

    @property({ type: Node, tooltip: 'Object bàn tay chỉ dẫn Hint khi người chơi rảnh rỗi quá lâu.' })
    handHint: Node | null = null;

    /** Trạng thái người chơi đang kéo thả một item. */
    isDragging = false;

    /** Số lượng item đã được ghép đúng vào vị trí đích. */
    arrivedItemCount = 0;

    @property({ tooltip: 'Số item ĐẦU TIÊN được hiện bóng ở đích khi kéo. Chỉ trừ lượt khi item ghép ĐÚNG vào target — cầm lên rồi thả hụt không tốn lượt. Ghép xong đủ N item thì các item sau kéo không còn bóng. 0 = mọi item đều có bóng khi kéo. Không ảnh hưởng cờ Persistent Shadow.' })
    shadowItemCount = 0;

    private currentHolder: Node | null = null;

    /** glue Cocos: số lượt bóng đã dùng — chỉ tăng khi item CÓ bóng snap đúng vào target. */
    private dragShadowUsed = 0;

    // ---------------- Target Graphic Settings ----------------
    @property({ tooltip: 'Màu của bóng/shadow hiển thị tại vị trí đích khi kéo thả.' })
    targetShadowColor: Color = new Color(51, 51, 51, 255);

    @property({ tooltip: 'Màu của đích khi phục hồi (màu bình thường).' })
    targetNormalColor: Color = new Color(255, 255, 255, 255);

    // ---------------- UI & Tutorial ----------------
    @property({ type: Node, tooltip: 'Bàn tay hướng dẫn xuất hiện ở đầu game.' })
    handIntro: Node | null = null;

    /** Cờ báo hiệu đã hiển thị hint kéo thả item lần đầu chưa. */
    showedFirstDragHint = false;

    /** Tween bàn tay hint đang chạy (thay cho .SetTarget(handHint) bên DOTween). */
    private hintTween: Tween<object> | null = null;

    // ======================================================== Unity: Awake
    onLoad() {
        ItemManager.instance = this;

        // glue Cocos: ItemGraphic đọc 2 màu này qua static
        ItemGraphic.targetShadowColor = this.targetShadowColor.clone();
        ItemGraphic.targetNormalColor = this.targetNormalColor.clone();

        this.ensureHolders();
    }

    // ======================================================== Unity: Start
    start() {
        this.ensureHolders();

        if (this.itemList.length > 0) {
            // Bắt đầu với item cuối cùng hoặc item đầu tiên trong danh sách
            this.currentItemIndex = this.spawnFromLast ? this.itemList.length - 1 : 0;
        }

        // glue Cocos: item tick persistentShadow hiện bóng ở đích ngay từ đầu và giữ bóng
        // kể cả khi thả hụt; các item còn lại chỉ hiện bóng lúc ĐANG KÉO, cho tới khi
        // đủ shadowItemCount item có bóng ghép xong (ItemController.onPointerDown).
        this.initTargetShadows();

        // glue Cocos: xếp item vào thanh bar (Unity không có WorldScrollManager)
        this.scheduleOnce(() => {
            const scroll = WorldScrollManager.instance;
            if (scroll && this.itemList.length > 0) scroll.setupItems(this.itemList);
        }, 0.1);
    }

    onDestroy() {
        if (ItemManager.instance === this) ItemManager.instance = null;
    }

    /**
     * glue Cocos:
     *   - persistentShadow (tick tay trong Inspector): bóng hiện NGAY TỪ ĐẦU và giữ mãi,
     *     chỉ tắt khi chính item đó snap vào target.
     *   - shadowItemCount: chỉ N item ĐẦU TIÊN ghép xong mới được hiện bóng lúc kéo
     *     (xem canShowDragShadow / notifyDragShadowPlaced); 0 = không giới hạn.
     * Các item không có persistentShadow thì target bị tắt lúc bắt đầu.
     */
    initTargetShadows(): void {
        const count = this.itemList.length;
        for (let i = 0; i < count; i++) {
            const node = this.itemList[i];
            if (!node || !node.isValid) continue;
            const item = node.getComponent(ItemController);
            if (!item || !item.targetPoint || item.isPlaced) continue;

            if (item.persistentShadow) item.showTargetShadow();
            else item.targetPoint.active = false;
        }
    }

    /**
     * glue Cocos: item này có được hiện bóng ở đích LÚC ĐANG KÉO không.
     *
     * shadowItemCount = số item ĐẦU TIÊN được hiện bóng, tính theo item GHÉP XONG:
     * cầm item nào lên cũng có bóng cho tới khi đủ shadowItemCount item có bóng đã
     * snap đúng target. Cầm lên rồi thả hụt KHÔNG tốn lượt. 0 = không giới hạn.
     */
    canShowDragShadow(_item: ItemController): boolean {
        if (this.shadowItemCount <= 0) return true;              // 0 = mọi item đều có bóng khi kéo
        return this.dragShadowUsed < this.shadowItemCount;
    }

    /**
     * glue Cocos: ItemController gọi khi một item ĐANG CÓ bóng lúc kéo snap đúng target.
     * Đây mới là lúc trừ 1 lượt trong shadowItemCount.
     */
    notifyDragShadowPlaced(): void {
        if (this.shadowItemCount <= 0) return;

        this.dragShadowUsed++;
        console.log('[ItemManager] đã dùng ' + this.dragShadowUsed + '/' + this.shadowItemCount + ' lượt bóng');
    }

    /** glue Cocos: SceneBuilder có thể để holderItemList rỗng -> tự dò trong scene. */
    ensureHolders(): void {
        if (!this.holderItemList || this.holderItemList.length === 0
            || this.holderItemList.some(h => !h || !h.isValid)) {
            const slots = this.node.scene?.getComponentsInChildren(HolderSlot) ?? [];
            if (slots.length > 0) this.holderItemList = slots.map(s => s.node);
        }
    }

    /** glue Cocos: InputManager gọi mỗi lần chạm — thay phần poll Input bên Unity. */
    onAnyPointerDown(): void {
        this.enableFirstClickObjects();
        this.resetIdleTimer();
        if (!this.isStuckHintActive) {
            this.hideHint();
        }
    }

    // ======================================================== Unity: EnableFirstClickObjects
    enableFirstClickObjects(): void {
        if (this.isFirstClicked) return;
        this.isFirstClicked = true;
        for (const obj of this.objsToEnableOnFirstClick) {
            if (obj?.isValid) obj.active = true;
        }
    }

    // ======================================================== Unity: Update
    update(dt: number) {
        if (UIManager.instance?.isGameEnded) return;

        // 1. Đếm thời gian không tương tác (Idle 3s)
        if (!this.isDragging) {
            this.idleTimer += dt;
            if (!this.isStuckHintActive && this.idleTimer >= this.idleTimeToHint && !this.hasShownHint) {
                this.showHint();
                this.hasShownHint = true;
            }
        }

        // 2. Đếm thời gian không chơi được tiếp (Stuck 5s)
        if (!this.isStuckHintActive) {
            this.stuckTimer += dt;
            if (this.stuckTimer >= this.stuckTimeToHint) {
                this.triggerStuckHint();
            }
        }

        // Đổi state của box nếu list = 0
        const isListEmpty = this.spawnFromLast
            ? (this.currentItemIndex < 0)
            : (this.currentItemIndex >= this.itemList.length);
        if (isListEmpty) BoxManager.instance?.handleEmptyItems();
    }

    // ======================================================== item / holder
    /** Unity: GetCurrentItem — lấy item ở vị trí currentItemIndex trong itemList. */
    getCurrentItem(): Node | null {
        if (this.currentItemIndex >= 0 && this.currentItemIndex < this.itemList.length) {
            const indexToReturn = this.currentItemIndex;

            // cập nhật index cho lần lấy tiếp theo
            if (this.spawnFromLast) this.currentItemIndex--;
            else this.currentItemIndex++;

            return this.itemList[indexToReturn];
        }
        return null;
    }

    /** Unity: GetCurrentHolder — holder trống đầu tiên trong holderItemList. */
    getCurrentHolder(): Node | null {
        this.ensureHolders();
        for (const holderNode of this.holderItemList) {
            if (!holderNode || !holderNode.isValid) continue;
            const slot = holderNode.getComponent(HolderSlot);
            if (slot && slot.isEmpty) {
                this.currentHolder = holderNode;
                return this.currentHolder;
            }
        }
        return null;
    }

    /** Unity: HasAvailableHolder */
    hasAvailableHolder(): boolean {
        this.ensureHolders();
        for (const holderNode of this.holderItemList) {
            if (!holderNode || !holderNode.isValid) continue;
            const slot = holderNode.getComponent(HolderSlot);
            if (slot && slot.isEmpty) return true;
        }
        return false;
    }

    /** Unity: GetCurrentHolderInUse */
    getCurrentHolderInUse(): Node | null {
        return this.currentHolder;
    }

    /** Unity: GetFirstItemInHolder — item đầu tiên đang nằm trong holder. */
    getFirstItemInHolder(): ItemController | null {
        for (const holderNode of this.holderItemList) {
            const slot = holderNode?.getComponent(HolderSlot);
            if (slot && !slot.isEmpty && slot.itemInSlot) {
                const item = slot.itemInSlot.getComponent(ItemController);
                if (item && item.targetPoint) return item;
            }
        }
        return null;
    }

    /** Unity: IsAllHolderEmpty */
    isAllHolderEmpty(): boolean {
        for (const holderNode of this.holderItemList) {
            const slot = holderNode?.getComponent(HolderSlot);
            if (slot && !slot.isEmpty) return false;
        }
        return true;
    }

    setLastItem(item: ItemController | null): void {
        this.lastInteractedItem = item;
    }

    getLastItem(): ItemController | null {
        return this.lastInteractedItem;
    }

    /** Unity: ItemArrivedAtTarget */
    itemArrivedAtTarget(): void {
        this.arrivedItemCount++;
        this.onItemCompleted();

        const ui = UIManager.instance;
        if (ui) {
            ui.tuSo++;
            ui.updateText();
        }

        console.log(`[ItemManager] arrivedItemCount = ${this.arrivedItemCount}`);
    }

    // ======================================================== hint
    /** Unity: ResetIdleTimer */
    resetIdleTimer(): void {
        this.idleTimer = 0;
        this.hasShownHint = false;
    }

    /** Reset bộ đếm 5s không chơi được tiếp */
    resetStuckTimer(): void {
        this.stuckTimer = 0;
    }

    /** Kích hoạt trạng thái 5s không chơi được tiếp -> hiện hint cố định cho item */
    triggerStuckHint(): void {
        let item = this.getLastItem();
        if (!this.canUseItemHint(item)) {
            item = this.getValidHintItem();
            if (item) this.setLastItem(item);
        }

        if (!item || !item.targetPoint) return;

        const ui = UIManager.instance;
        if (ui && ui.tuSo >= ui.mauSo) return;

        this.isStuckHintActive = true;
        this.stuckTargetItem = item;
        this.hasShownHint = true;
        if (this.handIntro) this.handIntro.active = false;
        this.runHintTween(item);
    }

    /** Huỷ trạng thái 5s stuck khi người chơi click sang item khác -> chuyển về logic 3s không tương tác */
    cancelStuckHint(): void {
        this.isStuckHintActive = false;
        this.stuckTargetItem = null;
        this.stuckTimer = 0;
        this.idleTimer = 0;
        this.hasShownHint = false;
        this.hideHint();
    }

    /** Hiện lại stuck hint (sau khi người chơi thả trượt item đang bị stuck) */
    showStuckHintAgain(): void {
        if (!this.isStuckHintActive || !this.stuckTargetItem || !this.stuckTargetItem.isValid) return;
        if (this.stuckTargetItem.isPlaced) return;
        this.runHintTween(this.stuckTargetItem);
    }

    /** Hoàn thành ghép item -> tắt hint và reset toàn bộ bộ đếm về trạng thái bình thường */
    onItemCompleted(): void {
        this.isStuckHintActive = false;
        this.stuckTargetItem = null;
        this.stuckTimer = 0;
        this.idleTimer = 0;
        this.hasShownHint = false;
        this.hideHint();
    }

    /** Unity: ShowHint */
    showHint(): void {
        let item = this.getLastItem();

        // item hiện tại không hợp lệ -> tìm item khác
        if (!this.canUseItemHint(item)) {
            item = this.getValidHintItem();
            if (item) this.setLastItem(item);
        }

        // không còn item nào hợp lệ
        if (!item) {
            if (this.handIntro) this.handIntro.active = true;
            this.hideHint();
            return;
        }

        // tắt handIntro nếu có item hợp lệ
        if (this.handIntro) this.handIntro.active = false;

        const ui = UIManager.instance;
        if (item.targetPoint && (!ui || ui.tuSo < ui.mauSo)) {
            this.runHintTween(item);
        }
    }

    /** Unity: ShowFirstDragHint */
    showFirstDragHint(item: ItemController | null): void {
        if (this.showedFirstDragHint) return;
        if (!item || !item.targetPoint) return;

        this.showedFirstDragHint = true;
        this.runHintTween(item);
    }

    /**
     * Bàn tay chạy từ item tới đích, lặp vô hạn.
     * Unity: DOTween.To(...).SetEase(InOutSine).SetLoops(-1, Restart).SetTarget(handHint)
     */
    private runHintTween(item: ItemController): void {
        const hand = this.handHint;
        if (!hand) return;

        this.killHintTween();
        hand.setWorldPosition(item.node.worldPosition.clone());
        hand.active = true;

        const from = new Vec3();
        const to = new Vec3();
        const cur = new Vec3();

        this.hintTween = TweenUtil.valueTo(2, (t) => {
            if (!hand.isValid || !item.isValid || !item.targetPoint) return;
            item.node.getWorldPosition(from);
            item.targetPoint.getWorldPosition(to);
            Vec3.lerp(cur, from, to, t);
            hand.setWorldPosition(cur);
        }, 'sineInOut', true);
    }

    /** Unity: handHint.DOKill() + SetActive(false) */
    private hideHint(): void {
        this.killHintTween();
        if (this.handHint) this.handHint.active = false;
    }

    private killHintTween(): void {
        if (this.hintTween) {
            this.hintTween.stop();
            this.hintTween = null;
        }
        if (this.handHint) TweenUtil.killAll(this.handHint);
    }

    /** Unity: CanUseItemHint */
    private canUseItemHint(item: ItemController | null): boolean {
        if (!item || !item.isValid) return false;
        if (!item.targetPoint) return false;

        const seat = item.getComponent(SeatHandler);

        // không có seat handler -> dùng được luôn; có thì phải pass điều kiện
        return seat ? seat.canPlace() : true;
    }

    /** Unity: GetValidHintItem — duyệt các holder đang giữ item. */
    private getValidHintItem(): ItemController | null {
        for (const holderNode of this.holderItemList) {
            const slot = holderNode?.getComponent(HolderSlot);
            if (!slot) continue;
            if (slot.isEmpty) continue;
            if (!slot.itemInSlot) continue;

            const item = slot.itemInSlot.getComponent(ItemController);
            if (this.canUseItemHint(item)) return item;
        }

        // glue Cocos: mode spawn tất cả ra vùng (BoxController.spawnAllOnFirstClick) không dùng
        // holder -> lấy item đang nằm TRÊN CÙNG (render sau cùng) để người chơi kéo được ngay.
        return this.getTopmostAvailableItem();
    }

    /**
     * Item chưa ghép, đang hiện trong scene và có sibling index cao nhất (vẽ đè lên các item khác).
     * Dùng cho hint ở mode không có holder: chỉ vào item trên cùng để không bị item khác che.
     */
    getTopmostAvailableItem(): ItemController | null {
        let best: ItemController | null = null;
        let bestIndex = -1;
        for (const node of this.itemList) {
            if (!node?.isValid || !node.activeInHierarchy) continue;
            const item = node.getComponent(ItemController);
            if (!item || item.isPlaced || !this.canUseItemHint(item)) continue;
            const idx = node.getSiblingIndex();
            if (idx > bestIndex) { bestIndex = idx; best = item; }
        }
        return best;
    }
}
