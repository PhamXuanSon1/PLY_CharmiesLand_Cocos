/**
 * SeatHandler — port từ Assets/_GAME/Script/Utils/SeatHandler.cs (Unity)
 *
 * Khác bản Unity: dùng cờ `isPlaced` thay vì đo khoảng cách < 0.1.
 * Bản Unity kiểm tra Vector3.Distance(item, targetPoint) < 0.1 nên nếu item
 * vô tình nằm gần đích (chưa ghép) thì vẫn tính là đã đặt — bug #7 mục 10.3.
 */

import { _decorator, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Khai báo kiểu Node chứ không phải ItemController: SeatHandler và ItemController
 * import lẫn nhau, mà @property được đánh giá NGAY LÚC NẠP MODULE — dùng
 * [ItemController] ở đây sẽ nhận undefined nếu module kia chưa nạp xong.
 * Lấy component ở runtime là an toàn.
 */
@ccclass('SeatHandler')
export class SeatHandler extends Component {

    @property({
        type: [Node],
        tooltip: 'Các item bắt buộc phải được ghép xong thì item này mới đặt được.',
    })
    requiredItems: Node[] = [];

    canPlace(): boolean {
        if (!this.requiredItems || this.requiredItems.length === 0) return true;

        for (const node of this.requiredItems) {
            if (!node || !node.isValid) continue;
            // import động để không tạo phụ thuộc vòng lúc nạp module
            const item = node.getComponent('ItemController') as { isPlaced?: boolean; targetPoint?: Node } | null;
            if (!item) continue;
            if (!item.targetPoint) continue;
            if (!item.isPlaced) return false;
        }
        return true;
    }
}
