/** HandOfBox — Quản lý bàn tay hướng dẫn theo hộp lúc intro */

import { _decorator, Component } from 'cc';

const { ccclass } = _decorator;

@ccclass('HandOfBox')
export class HandOfBox extends Component {

    moveAfterIntro(_duration?: number): void {
        this.node.active = false;
    }
}

