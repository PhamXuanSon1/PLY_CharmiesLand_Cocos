import { _decorator, Camera, Color, Component, Node, v3, Vec2, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('MainCamera')
export class MainCamera extends Component {
    
    @property(Camera)
    camera: Camera = null!;

    @property(Node)
    target: Node = null!;

    @property(Node)
    door: Node = null!;
    
   moveTo(node: Node, dt: number) {
        if(!node) return;
        let pos = node.worldPosition;
        let target = this.node.worldPosition;
        // console.log(pos, target);
        
        let diff = pos.clone().subtract(target);
        diff = v3(diff.x, 0, diff.z);
        let dir = diff.clone().normalize();
        let distance = diff.length();
        this.node.worldPosition = this.node.worldPosition.add(dir.multiplyScalar(3 * dt));
        if(this.door === this.target) {
            if(distance < 0.1) {
                this.door = null;
                return;
            }

        }
        
        if(distance < 0.1) {
            console.log('door');
            
            this.door = this.target;
        }
    }

    zoom(inOut: boolean) {
        this.camera.fov =(inOut ? 45 : 55);
    }

    changeColor() {
        this.camera.clearColor = new Color().fromHEX('#4E141F');
    }


    onLoad() {
    }

    start() {
    }

    update(deltaTime: number) {
    }
}


