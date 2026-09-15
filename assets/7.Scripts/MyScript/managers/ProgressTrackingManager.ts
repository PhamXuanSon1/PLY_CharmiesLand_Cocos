

import { _decorator, Component } from 'cc';
import { UIManager } from './UIManager';
import { ItemManager } from './ItemManager';

const { ccclass, property } = _decorator;

@ccclass('ProgressTrackingManager')
export class ProgressTrackingManager extends Component {

    static instance: ProgressTrackingManager | null = null;

    @property({ tooltip: 'Tổng số điểm tối đa. Tự suy ra nếu để 0.' })
    maxScore = 0;

    private currentScore = 0;
    private currentPercent = 0;
    private isStarted = false;
    private pass25 = false;
    private pass50 = false;
    private pass75 = false;
    private pass100 = false;

    get CurrentScore(): number { return this.currentScore; }
    get CurrentPercent(): number { return this.currentPercent; }

    onLoad() {
        if (ProgressTrackingManager.instance && ProgressTrackingManager.instance !== this) {
            this.node.destroy();
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

    /** Unity: StartChallenge — gọi ở lần chạm đầu tiên. */
    startChallenge(): void {
        if (this.isStarted) return;
        this.isStarted = true;
    }

    resetProgress(): void {
        this.currentScore = 0;
        this.currentPercent = 0;
        this.isStarted = false;
        this.pass25 = this.pass50 = this.pass75 = this.pass100 = false;
    }

    addProgress(amount = 1): void {
        this.updateGameProgress(this.currentScore + amount);
    }

    /** Unity: UpdateGameProgress */
    updateGameProgress(score: number): void {
        if (this.maxScore <= 0) this.maxScore = this.getDynamicMaxScore();
        if (this.maxScore <= 0) {
            console.warn('[ProgressTrackingManager] maxScore chưa được thiết lập.');
            return;
        }

        this.currentScore = Math.max(0, Math.min(score, this.maxScore));
        if (!this.isStarted && this.currentScore > 0) this.isStarted = true;

        const pct = Math.floor((this.currentScore * 100) / this.maxScore);
        this.currentPercent = pct;

        if (pct >= 25 && !this.pass25)  {}
        if (pct >= 50 && !this.pass50)  {}
        if (pct >= 75 && !this.pass75) {}
        if (pct >= 100 && !this.pass100)  {}
    }

    private getDynamicMaxScore(): number {
        const ui = UIManager.instance;
        if (ui && ui.endGameCount > 0) return ui.endGameCount;

        const im = ItemManager.instance;
        if (im && im.itemList && im.itemList.length > 0) return im.itemList.length;

        if (ui && ui.mauSo > 0) return ui.mauSo;
        return this.maxScore;
    }
}
