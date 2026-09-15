import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('NodeOrder')
export class NodeOrder extends Component {
    start() {

    }

    @property
    order: number = 0;
    @property
    index: number = 0;
    @property
    skin: string = "";

    update(deltaTime: number) {
        
    }
}


