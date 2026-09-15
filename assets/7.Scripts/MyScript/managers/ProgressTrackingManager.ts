/**
 * ProgressTrackingManager — theo dõi tiến độ màn chơi và bắn event AppLovin
 * (assets/7.Scripts/Tool/AppLovinAnalytics.ts):
 *
 *   LOADING / LOADED / DISPLAYED : AppLovinAnalytics tự bắn khi module được nạp
 *                                  (import ở đây để chắc chắn module có mặt trong bundle).
 *   CHALLENGE_STARTED            : lần chạm đầu tiên (InputManager.fisrtTap -> startChallenge).
 *   CHALLENGE_PASS_25/50/75      : % item ghép đúng / maxScore (ItemManager.itemArrivedAtTarget -> addProgress).
 *   CHALLENGE_SOLVED             : đạt 100% (= endGameCount).
 *   CTA_CLICKED                  : GameController.redirectToStore -> ctaClicked (mỗi click 1 lần).
 *
 * Các mốc tiến độ chỉ bắn đúng 1 lần; CTA_CLICKED bắn theo số lần click.
 */

import { _decorator, Component } from 'cc';
import { UIManager } from './UIManager';
import { ItemManager } from './ItemManager';
import { AppLovinAnalytics } from '../../Tool/AppLovinAnalytics';

const { ccclass, property } = _decorator;

@ccclass('ProgressTrackingManager')
export class ProgressTrackingManager extends Component {

    static instance: ProgressTrackingManager | null = null;

    @property({ tooltip: 'Tổng số điểm tối đa (= số item cần ghép để SOLVED). Tự suy ra từ UIManager.endGameCount nếu để 0.' })
    maxScore = 0;

    @property({ tooltip: 'In event ra console.' })
    verbose = true;

    private currentScore = 0;
    private currentPercent = 0;
    private isStarted = false;
    private pass25 = false;
    private pass50 = false;
    private pass75 = false;
    private pass100 = false;
    private ctaClickCount = 0;

    get CurrentScore(): number { return this.currentScore; }
    get CurrentPercent(): number { return this.currentPercent; }

    onLoad() {
        if (ProgressTrackingManager.instance && ProgressTrackingManager.instance !== this) {
            // chỉ huỷ COMPONENT trùng, không huỷ node (scene có thể gắn nhầm lên SoundManager...)
            console.warn(`[ProgressTrackingManager] Trùng component trên "${this.node.name}" — đã bỏ bản này.`);
            this.destroy();
            return;
        }
        ProgressTrackingManager.instance = this;
    }

    start() {
        this.resetProgress();
        const dyn = this.getDynamicMaxScore();
        if (dyn > 0) this.maxScore = dyn;
    }

    onDestroy() {
        if (ProgressTrackingManager.instance === this) ProgressTrackingManager.instance = null;
    }

    // ======================================================== events
    /** CHALLENGE_STARTED — gọi ở lần chạm đầu tiên. */
    startChallenge(): void {
        if (this.isStarted) return;
        this.isStarted = true;
        this.log('CHALLENGE_STARTED');
        AppLovinAnalytics.challengeStarted();
    }

    /** CTA_CLICKED — gọi mỗi lần redirectToStore (KHÔNG chặn trùng: click bao nhiêu lần bắn bấy nhiêu). */
    trackCtaClicked(): void {
        this.ctaClickCount++;
        this.log(`CTA_CLICKED #${this.ctaClickCount}`);
        AppLovinAnalytics.ctaClicked();
    }

    resetProgress(): void {
        this.currentScore = 0;
        this.currentPercent = 0;
        this.isStarted = false;
        this.pass25 = this.pass50 = this.pass75 = this.pass100 = false;
    }

    /** +1 mỗi item ghép đúng. */
    addProgress(amount = 1): void {
        this.updateGameProgress(this.currentScore + amount);
    }

    /** Cập nhật điểm và bắn mốc 25/50/75/100 (mỗi mốc 1 lần). */
    updateGameProgress(score: number): void {
        if (this.maxScore <= 0) this.maxScore = this.getDynamicMaxScore();
        if (this.maxScore <= 0) {
            console.warn('[ProgressTrackingManager] maxScore chưa được thiết lập.');
            return;
        }

        this.currentScore = Math.max(0, Math.min(score, this.maxScore));
        if (!this.isStarted && this.currentScore > 0) this.startChallenge();

        const pct = Math.floor((this.currentScore * 100) / this.maxScore);
        this.currentPercent = pct;

        if (pct >= 25 && !this.pass25) {
            this.pass25 = true;
            this.log('CHALLENGE_PASS_25');
            AppLovinAnalytics.challenge25();
        }
        if (pct >= 50 && !this.pass50) {
            this.pass50 = true;
            this.log('CHALLENGE_PASS_50');
            AppLovinAnalytics.challenge50();
        }
        if (pct >= 75 && !this.pass75) {
            this.pass75 = true;
            this.log('CHALLENGE_PASS_75');
            AppLovinAnalytics.challenge75();
        }
        if (pct >= 100 && !this.pass100) {
            this.pass100 = true;
            this.log('CHALLENGE_SOLVED');
            AppLovinAnalytics.challengeSolved();
        }
    }

    private getDynamicMaxScore(): number {
        const ui = UIManager.instance;
        if (ui && ui.endGameCount > 0) return ui.endGameCount;

        const im = ItemManager.instance;
        if (im && im.itemList && im.itemList.length > 0) return im.itemList.length;

        if (ui && ui.mauSo > 0) return ui.mauSo;
        return this.maxScore;
    }

    private log(evt: string): void {
        if (this.verbose) console.log(`[ProgressTracking] ${evt} (${this.currentScore}/${this.maxScore} = ${this.currentPercent}%)`);
    }
}
