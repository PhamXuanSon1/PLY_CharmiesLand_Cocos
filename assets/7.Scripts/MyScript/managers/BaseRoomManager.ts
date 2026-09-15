import { _decorator, Component, Node, Vec3 } from 'cc';
import { BaseRoom } from '../utils/BaseRoom';
import { TweenUtil } from '../core/TweenUtil';

const { ccclass, property } = _decorator;

@ccclass('BaseRoomManager')
export class BaseRoomManager extends Component {

    static instance: BaseRoomManager | null = null;

    @property({ type: Node, tooltip: 'Node căn phòng chính.' })
    BaseRoom: Node | null = null;

    @property({ type: Node, tooltip: 'Vị trí phòng lúc mới vào game (hiệu ứng intro).' })
    baseRoomStartPos: Node | null = null;

    @property({ type: Node, tooltip: 'Vị trí phòng sau khi intro xong.' })
    baseRoomEndPos: Node | null = null;

    @property({ tooltip: 'Tỉ lệ thu nhỏ ban đầu của phòng.' })
    startScaleMultiplier = 0.352941;

    @property({ tooltip: 'Thời gian chuyển động phóng to và di chuyển BaseRoom khi mở hộp (giây).' })
    introDuration = 1.2;

    private baseRoomOriginalScale = new Vec3(1, 1, 1);
    private baseRoomOriginalWorldPos = new Vec3(0, 0, 0);

    onLoad() {
        BaseRoomManager.instance = this;

        if (this.BaseRoom) {
            this.baseRoomOriginalScale = this.BaseRoom.scale.clone();
            this.baseRoomOriginalWorldPos = this.BaseRoom.worldPosition.clone();

            const room = this.BaseRoom.getComponent(BaseRoom);
            if (room) {
                room.initializeOriginalScale(this.baseRoomOriginalScale);
            }

            // 1. Thu nhỏ BaseRoom khi bắt đầu game theo startScaleMultiplier
            const startScale = new Vec3(
                this.baseRoomOriginalScale.x * this.startScaleMultiplier,
                this.baseRoomOriginalScale.y * this.startScaleMultiplier,
                this.baseRoomOriginalScale.z * this.startScaleMultiplier,
            );
            this.BaseRoom.setScale(startScale);

            // 2. Đặt BaseRoom tại baseRoomStartPos nếu có
            if (this.baseRoomStartPos) {
                this.BaseRoom.setWorldPosition(this.baseRoomStartPos.worldPosition.clone());
            }
        }
    }

    onDestroy() {
        if (BaseRoomManager.instance === this) BaseRoomManager.instance = null;
    }

    /** Unity: PlayIntroAnimation — Phóng to BaseRoom về scale gốc và di chuyển về baseRoomEndPos khi mở hộp. */
    playIntroAnimation(onComplete?: () => void): void {
        if (!this.BaseRoom) {
            onComplete?.();
            return;
        }

        // 1. Phóng to BaseRoom về lại kích thước bình thường
        TweenUtil.scaleTo(this.BaseRoom, this.baseRoomOriginalScale, this.introDuration, 'linear');

        // 2. Di chuyển BaseRoom tới baseRoomEndPos
        const targetWorldPos = this.baseRoomEndPos
            ? this.baseRoomEndPos.worldPosition.clone()
            : this.baseRoomOriginalWorldPos.clone();

        TweenUtil.moveTo(this.BaseRoom, targetWorldPos, this.introDuration, 'linear', () => {
            const room = this.BaseRoom?.getComponent(BaseRoom);
            if (room) {
                room.initializeOriginalScale(this.baseRoomOriginalScale);
                room.enableInteraction();
            }
            onComplete?.();
        });
    }
}
