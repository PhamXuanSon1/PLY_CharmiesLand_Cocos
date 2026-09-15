/** BoxManager — port từ Assets/_GAME/Script/Manager/BoxManager.cs (Unity) */

import { _decorator, Component, Node } from 'cc';
import { BoxController } from '../box/BoxController';

const { ccclass, property } = _decorator;

@ccclass('BoxManager')
export class BoxManager extends Component {

    static instance: BoxManager | null = null;

    @property({ type: Node, tooltip: 'Object chiếc hộp trong scene.' })
    box: Node | null = null;

    private boxController: BoxController | null = null;
    /** Đảm bảo flow kết thúc chỉ chạy đúng một lần. */
    private isBoxHandled = false;

    onLoad() {
        BoxManager.instance = this;
        if (this.box) {
            this.boxController = this.box.getComponent(BoxController);
        }
    }

    onDestroy() {
        if (BoxManager.instance === this) BoxManager.instance = null;
    }

    /** ItemManager báo hết item; Manager chỉ điều phối, Controller xử lý Box. */
    handleEmptyItems(): void {
        if (this.isBoxHandled || !this.boxController) return;
        this.isBoxHandled = true;
        this.boxController.closeAndHide();
    }
}
