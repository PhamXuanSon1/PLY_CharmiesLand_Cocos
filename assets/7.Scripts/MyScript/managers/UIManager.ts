/**
 * UIManager — port từ Assets/_GAME/Script/Manager/UIManager.cs (Unity)
 *
 * BỎ so với bản Unity (theo yêu cầu):
 *   - AppLovinAnalytics.Track(...) và ALEvent
 *   - LifeCycle.GameEnded() / Playable.InstallFullGame()  -> mở URL store
 *   - ProgressTrackingManager
 *   - SetupUIPosition() và toàn bộ phần cân màn theo orientation
 *     (bên Cocos dùng Widget của Canvas, không tính tay)
 *   - Physics.Raycast bắt layer "Download" -> dùng Button/handler tử tế
 */

import { _decorator, Component, Node, Label, Sprite, EventTouch, Vec3, sys } from 'cc';
import { DreamyInputManager, InputPriority, IPointerHandler } from '../core/DreamyInputManager';
import { ItemManager } from './ItemManager';
import { BallFollowFill } from '../utils/BallFollowFill';
import { TweenUtil } from '../core/TweenUtil';
import { GameController } from '../../Tool/GameController';

const { ccclass, property } = _decorator;

@ccclass('UIManager')
export class UIManager extends Component implements IPointerHandler {

    static instance: UIManager | null = null;

    // ---------------- UI ----------------
    @property({ type: Label, tooltip: 'Chữ tiến trình, vd 1/12.' })
    textNumber: Label | null = null;

    @property({ type: Sprite, tooltip: 'Thanh tiến trình. Type phải để FILLED.' })
    progressBar: Sprite | null = null;

    @property({ type: BallFollowFill, tooltip: 'Icon chạy theo thanh tiến trình.' })
    ballFollowFill: BallFollowFill | null = null;

    // ---------------- Progress ----------------
    @property({ tooltip: 'Tử số — số item đã ghép.' })
    tuSo = 0;

    @property({ tooltip: 'Mẫu số — tổng số item. Start() sẽ lấy từ ItemManager.itemList.' })
    mauSo = 12;

    @property({ tooltip: 'Số item hoàn thành để mở màn End Game.' })
    endGameCount = 12;

    isGameEnded = false;

    // ---------------- Chơi tiếp sau End Game ----------------
    @property({ tooltip: 'Số item được chơi thêm sau End Game: chạm đầu tiên mở store rồi mở lại gameplay cho chơi thêm N item. 0 = tắt. Chỉ áp dụng 1 lần.' })
    continueItemCount = 3;

    /** Đã dùng lượt chơi tiếp chưa (chỉ cho 1 lần). */
    private continueUsed = false;

    // ---------------- Canvas ----------------
    @property({ type: Node, tooltip: 'Canvas UI trong lúc chơi.' })
    GameUICanvas: Node | null = null;

    @property({ type: Node, tooltip: 'Canvas màn hình thắng.' })
    EndUICanvas: Node | null = null;

    @property({ tooltip: 'URL store mở khi bấm CTA. Thay cho Playable.InstallFullGame().' })
    storeUrl = '';

    @property({ type: Node, tooltip: 'Node hoặc Component GameController để gọi redirectToStore().' })
    gameController: Node | GameController | null = null;

    readonly inputPriority = InputPriority.UI;

    // ======================================================== lifecycle
    onLoad() {
        UIManager.instance = this;
    }

    onEnable() {
        DreamyInputManager.register(this);
    }

    onDisable() {
        DreamyInputManager.unregister(this);
    }

    onDestroy() {
        if (UIManager.instance === this) UIManager.instance = null;
    }

    start() {
        this.tuSo = 0;

        const im = ItemManager.instance;
        if (im && im.itemList.length > 0) this.mauSo = im.itemList.length;

        // BallFollowFill cố ý không import ItemManager (tránh phụ thuộc vòng)
        if (this.ballFollowFill) this.ballFollowFill.total = this.mauSo;

        this.updateText();

        // Unity: DOTween.To(() => tuSo, x => {tuSo = x; UpdateText();}, 0, 2f)
        // Đếm về 0 trong 2 giây — giữ nguyên để khớp nhịp intro.
        TweenUtil.valueTo(2, () => this.updateText(), 'linear');
    }

    // ======================================================== input
    /** Sau khi end game, chạm bất kỳ đâu -> mở store. */
    hitTest(_worldPos: Vec3): boolean {
        return this.isGameEnded;
    }

    onPointerDown(_worldPos: Vec3, _ev: EventTouch): boolean {
        if (!this.isGameEnded) return false;
        this.gotoStore();
        return true;   // nuốt sự kiện
    }

    // ======================================================== progress
    /** Unity: UpdateText */
    updateText(): void {
        if (this.textNumber) this.textNumber.string = `${this.tuSo}/${this.mauSo}`;

        const percent = this.mauSo > 0 ? this.tuSo / this.mauSo : 0;
        if (this.progressBar) this.progressBar.fillRange = percent;

        if (this.ballFollowFill && !this.ballFollowFill.isIntroMoving) {
            this.ballFollowFill.updateBall(this.tuSo);
        }

        this.checkEndGame();
    }

    private checkEndGame(): void {
        if (this.isGameEnded) return;

        const im = ItemManager.instance;
        const arrived = im?.arrivedItemCount ?? this.tuSo;

        if (this.tuSo >= this.mauSo || arrived >= this.endGameCount) {
            this.isGameEnded = true;
            DreamyInputManager.canInput = false;

            if (this.GameUICanvas) this.GameUICanvas.active = false;
            if (this.EndUICanvas) this.EndUICanvas.active = true;

            if (im) {
                for (const c of im.WinConfetti) if (c?.isValid) c.active = true;
            }

            // Cho phép chạm để mở store
            DreamyInputManager.canInput = true;
        }
    }

    // ======================================================== chơi tiếp sau end game
    /**
     * Mở lại gameplay sau End Game, cho chơi thêm continueItemCount item rồi End Game lại.
     * Chỉ dùng được 1 lần; lần End Game sau chạm chỉ mở store.
     */
    resumeAfterEndGame(): void {
        if (!this.isGameEnded || this.continueUsed || this.continueItemCount <= 0) return;

        const im = ItemManager.instance;
        const arrived = im?.arrivedItemCount ?? this.tuSo;
        if (arrived >= this.mauSo) return;   // hết sạch item thì không còn gì để chơi thêm

        this.continueUsed = true;
        this.endGameCount = Math.min(arrived + this.continueItemCount, this.mauSo);
        this.isGameEnded = false;
        DreamyInputManager.canInput = true;

        if (this.EndUICanvas) this.EndUICanvas.active = false;
        if (this.GameUICanvas) this.GameUICanvas.active = true;

        if (im) {
            for (const c of im.WinConfetti) if (c?.isValid) c.active = false;
            im.resetIdleTimer();
            im.resetStuckTimer();
        }

        console.log(`[UIManager] Chơi tiếp: endGameCount -> ${this.endGameCount}`);
        this.updateText();
    }

    gotoStore(): void {
        console.log("Test: goToStore");

        // Còn lượt chơi tiếp -> mở store xong thì mở lại gameplay luôn,
        // để khi người chơi quay lại (hoặc chạm tiếp) là chơi được ngay.
        const canContinue = this.isGameEnded && !this.continueUsed && this.continueItemCount > 0;
        if (canContinue) this.scheduleOnce(() => this.resumeAfterEndGame(), 0);
        if (this.gameController) {
            if (this.gameController instanceof GameController) {
                this.gameController.redirectToStore();
                return;
            } else if (this.gameController instanceof Node) {
                const gc = this.gameController.getComponent(GameController);
                if (gc) {
                    gc.redirectToStore();
                    return;
                }
            } else if ((this.gameController as any).redirectToStore) {
                (this.gameController as any).redirectToStore();
                return;
            }
        }

        const gc = this.node.scene?.getComponentInChildren(GameController);
        if (gc) {
            gc.redirectToStore();
        } else {
            console.warn("[UIManager] Không tìm thấy GameController để redirectToStore!");
        }
    }
}
