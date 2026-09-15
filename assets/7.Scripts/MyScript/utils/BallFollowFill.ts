/** BallFollowFill — port từ Assets/_GAME/Script/Utils/BallFollowFill.cs (Unity) */

import { _decorator, Component, Node, Vec3, math } from 'cc';
import { TweenUtil } from '../core/TweenUtil';

const { ccclass, property } = _decorator;

@ccclass('BallFollowFill')
export class BallFollowFill extends Component {

    @property({ type: Node, tooltip: 'Icon tròn chạy theo thanh tiến trình.' })
    ballIcon: Node | null = null;

    @property({ type: Node, tooltip: 'Mốc trái của thanh (0%).' })
    leftPoint: Node | null = null;

    @property({ type: Node, tooltip: 'Mốc phải của thanh (100%).' })
    rightPoint: Node | null = null;

    isIntroMoving = true;

    /**
     * Tổng số item. UIManager gán trong start().
     * KHÔNG import ItemManager ở đây: UIManager -> BallFollowFill -> ItemManager
     * -> UIManager là vòng, mà @property của UIManager cần BallFollowFill ngay
     * lúc nạp module.
     */
    total = 0;

    start() {
        if (this.ballIcon && this.leftPoint) {
            this.ballIcon.setWorldPosition(this.leftPoint.worldPosition.clone());
        }
        this.introMove();
    }

    /** Unity: IntroMove — chạy 2 giây rồi mở khoá updateBall */
    introMove(): void {
        if (!this.ballIcon || !this.leftPoint || !this.rightPoint) {
            this.isIntroMoving = false;
            return;
        }

        const p = this.ballIcon.worldPosition;
        const targetX = math.lerp(this.leftPoint.worldPosition.x, this.rightPoint.worldPosition.x, 0);

        TweenUtil.moveTo(
            this.ballIcon,
            new Vec3(targetX, p.y, p.z),
            2, 'linear',
            () => { this.isIntroMoving = false; },
        );
    }

    /** Unity: UpdateBall */
    updateBall(tuSo: number): void {
        if (!this.ballIcon || !this.leftPoint || !this.rightPoint) return;
        if (this.total <= 0) return;

        const t = math.clamp01(tuSo / this.total);
        const targetX = math.lerp(this.leftPoint.worldPosition.x, this.rightPoint.worldPosition.x, t);
        const p = this.ballIcon.worldPosition;
        this.ballIcon.setWorldPosition(targetX, p.y, p.z);
    }
}
