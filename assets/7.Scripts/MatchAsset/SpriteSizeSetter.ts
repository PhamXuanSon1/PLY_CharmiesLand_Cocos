import { _decorator, Component, Node, Sprite, UITransform, v3 } from 'cc';
import { ui } from 'db://assets/7.Scripts/Manager/UI';
const { ccclass, property } = _decorator;

@ccclass('SpriteSizeSetter')
export class SpriteSizeSetter extends Component {
    start() {

    }

    @property
    set setSize(value: boolean) {
        this._setSize = value;
        if (value) {
            this.setSprite();
        }
    }

    _setSize: boolean = false;

    get setSize() {
        return this._setSize;
    }

    setSprite() {
        let uis = this.node.getComponentsInChildren(Sprite)
        .map(s => s.getComponent(UITransform)).filter(u => u);
        uis.forEach(uit => {
            let scale = uit.node.scale;
            let w = uit.width * scale.x;
            let h = uit.height * scale.y;
            uit.node.scale = v3(1, 1, 1);
            uit.width = w;
            uit.height = h;
        });    
    }

    update(deltaTime: number) {
        
    }
}


