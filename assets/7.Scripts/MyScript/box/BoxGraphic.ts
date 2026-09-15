/**
 * BoxGraphic — Điều khiển Spine Skeleton cho chiếc hộp (Box).
 *
 * Chu trình Animation Spine:
 * 1. Mới vào game: Phát `1-ready-Loop` (Loop).
 * 2. Nhận click đầu tiên: Phát `2-OPEN` (1 lần) -> Tự nối tiếp `3-OPEN-loop-break` (Loop).
 * 3. Các lần click sau: Phát `3-OPEN-click` (1 lần) -> Tự nối tiếp `3-OPEN-loop-break` (Loop).
 * 4. Khi hết item (kết thúc): Phát `Setup-A-2`.
 */

import { _decorator, Component, sp } from 'cc';

const { ccclass, property } = _decorator;

export enum BoxState {
    Closed,
    Opened,
    CLickBox,
    FirstOpen,
    OpenLoopBreak,
    ReadyOpen,
}

@ccclass('BoxGraphic')
export class BoxGraphic extends Component {

    // ========================================== COMPONENTS
    @property({ type: sp.Skeleton, tooltip: 'Spine Skeleton điều khiển chiếc hộp (nếu để trống tự tìm trên Box hoặc BoxImage)' })
    boxSkeleton: sp.Skeleton | null = null;

    // ========================================== ANIMATION NAMES
    @property({ tooltip: '1. Anim chờ khi mới vào game (Loop)' })
    animReadyLoop = '1-ready-Loop';

    @property({ tooltip: '2. Anim mở hộp lần đầu tiên khi click (1 lần)' })
    animFirstOpen = '2-OPEN';

    @property({ tooltip: '3. Anim mở chờ các click tiếp theo (Loop)' })
    animOpenedLoop = '3-OPEN-loop-break';

    @property({ tooltip: '4. Anim click nhả item (1 lần)' })
    animClick = '3-OPEN-click';

    @property({ tooltip: '5. Anim khi hết item/đóng hộp kết thúc' })
    animClosed = 'Setup-A-2';

    currentState: BoxState = BoxState.Closed;

    onLoad() {
        this.resolveSkeletonComponent();
    }

    /** Tự động tìm Spine Skeleton nếu chưa kéo vào Inspector */
    private resolveSkeletonComponent(): void {
        if (!this.boxSkeleton) {
            this.boxSkeleton = this.getComponent(sp.Skeleton)
                || this.node.getChildByName('BoxImage')?.getComponent(sp.Skeleton)
                || this.getComponentInChildren(sp.Skeleton);
        }
    }

    /** Hiển thị trạng thái chờ ban đầu (1-ready-Loop). */
    playReady(): void {
        this.currentState = BoxState.ReadyOpen;
        this.resolveSkeletonComponent();
        if (!this.boxSkeleton) return;
        this.boxSkeleton.setAnimation(0, this.animReadyLoop, true);
    }

    /** Mở hộp lần đầu (2-OPEN -> 3-OPEN-loop-break). */
    playFirstOpen(): void {
        this.currentState = BoxState.FirstOpen;
        this.resolveSkeletonComponent();
        if (!this.boxSkeleton) return;
        this.boxSkeleton.setAnimation(0, this.animFirstOpen, false);
        this.boxSkeleton.addAnimation(0, this.animOpenedLoop, true, 0);
    }

    /** Click nhả item (3-OPEN-click). Đang play dở thì ngắt và play lại ngay từ đầu (mixDuration = 0). */
    playItemDispense(loop: boolean = false): void {
        this.currentState = BoxState.CLickBox;
        this.resolveSkeletonComponent();
        if (!this.boxSkeleton) return;
        if (loop) {
            const entry = this.boxSkeleton.setAnimation(0, this.animClick, true);
            if (entry) entry.mixDuration = 0;
        } else {
            const entry = this.boxSkeleton.setAnimation(0, this.animClick, false);
            if (entry) entry.mixDuration = 0;
            this.boxSkeleton.addAnimation(0, this.animOpenedLoop, true, 0);
        }
    }

    /** Bắt đầu lặp liên tục anim click (3-OPEN-click) khi bung nhiều item */
    playClickLoop(): void {
        this.playItemDispense(true);
    }

    /** Dừng lặp anim click, chuyển về trạng thái mở chờ (3-OPEN-loop-break) */
    stopClickLoop(): void {
        this.playOpenedLoop();
    }

    /** Giữ trạng thái mở chờ tương tác tiếp (3-OPEN-loop-break). */
    playOpenedLoop(): void {
        this.currentState = BoxState.Opened;
        this.resolveSkeletonComponent();
        if (!this.boxSkeleton) return;
        this.boxSkeleton.setAnimation(0, this.animOpenedLoop, true);
    }

    /** Hiệu ứng đóng hộp khi hết item (Setup-A-2). */
    playClosing(): void {
        this.currentState = BoxState.Closed;
        this.resolveSkeletonComponent();
        if (!this.boxSkeleton) return;
        this.boxSkeleton.setAnimation(0, this.animClosed, false);
    }

    /** Tương thích hàm changeState cũ */
    changeState(newState: BoxState): void {
        switch (newState) {
            case BoxState.ReadyOpen:
                this.playReady();
                break;
            case BoxState.FirstOpen:
                this.playFirstOpen();
                break;
            case BoxState.CLickBox:
                this.playItemDispense();
                break;
            case BoxState.Opened:
            case BoxState.OpenLoopBreak:
                this.playOpenedLoop();
                break;
            case BoxState.Closed:
                this.playClosing();
                break;
        }
    }

    setAutoOpenEnabled(_enabled: boolean): void {
        // Tương thích chữ ký hàm cũ nếu có nơi gọi
    }
}
