/** TurnOnSpine — port từ Assets/_GAME/Script/Utils/TurnOnSpine.cs (Unity) */

import { _decorator, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('TurnOnSpine')
export class TurnOnSpine extends Component {

    @property({ type: Node, tooltip: 'Object chứa Spine sẽ được bật lên.' })
    spineObject: Node | null = null;

    activateSpine(): void {
        if (this.spineObject) this.spineObject.active = true;
    }
}
