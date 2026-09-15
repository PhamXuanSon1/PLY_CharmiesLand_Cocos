import { _decorator, Component, instantiate, JsonAsset, Node, sp, Sprite, UITransform, v3 } from 'cc';
import { NodeOrder } from './NodeOrder';
const { ccclass, property } = _decorator;

@ccclass('MatchSprite')
export class MatchSprite extends Component {

    
    @property(Node)
    thingNode: Node = null
    @property(JsonAsset)
    json: JsonAsset = null
    @property({slide: true, range: [0, 1000], step: 1})
    _mul: number = 25;

    get mul() {
        return this._mul;
    }
    @property({slide: true, range: [0, 1000], step: 1})
    set mul(value: number) {
        this._mul = value;
        this.matchSprite();
    }
    @property
    set match(value: boolean) {
        this._match = false;
        this.setScale();
    }

    _match: boolean = false
    get match() {
        return this._match
    }
    setScale() {
        let sprites = this.thingNode.getComponentsInChildren(Sprite);
        sprites.forEach((sprite) => {
            let sc = sprite.node.scale.clone();
            let ux = sc.x > 0 ? 1 : -1;
            let uy = sc.y > 0 ? 1 : -1;
            sprite.node.scale = v3(ux, uy, 1);
            let ui = sprite.getComponent(UITransform);
            let size = ui.contentSize.clone();
            size.width *= Math.abs(sc.x);
            size.height *= Math.abs(sc.y);
            ui.contentSize = size;

        })
    }


    start() {
    }

    setSpine() {        
        let spines = this.thingNode.getComponentsInChildren(sp.Skeleton);
        spines.forEach((s, i) => {

            let skins: any[] = s.skeletonData.skeletonJson["skins"];
            if (skins.some(sk => sk.name == s.node.name)) s.setSkin(s.node.name);
        });
    }

    matchSpine() {
        const wposType = [
            {x: 0, y: 0, z: 0, order: 0, skin: ""},
            {x: 0, y: 0, z: 0, order: 0, skin: ""},
        ]
        let nodeOrders: NodeOrder[] = [];
        let spines = this.thingNode.getComponentsInChildren(NodeOrder);
        let things = this.json.json;
        let keys = Object.keys(things);
        for(let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let thing: typeof wposType = things[key];
            let sps = spines.filter(s => s.node.name == key);
            thing.forEach((t, i) => {
                if(!sps[i]) {
                    sps[i] = instantiate(sps[i-1].node).getComponent(NodeOrder);
                    sps[i].node.parent = this.thingNode;
                }
                sps[i].node.position = v3(t.x, t.y, t.z).multiplyScalar(this._mul);
                sps[i].order = t.order;
                sps[i].skin = t.skin;
                nodeOrders.push(sps[i]);
            })
        }
        nodeOrders.sort((a, b) => a.order - b.order);
        nodeOrders.forEach((no, i) => {
            no.node.setSiblingIndex(i);
            no.index = i;
            let t = no.getComponent(sp.Skeleton);
            let skins: any[] = t.skeletonData.skeletonJson["skins"];
            if (skins.some(s => s.name == no.skin)) t.setSkin(no.skin);
        })
    }

    matchSprite() {
        const wposType = [
            {x: 0, y: 0, z: 0, order: 0},
            {x: 0, y: 0, z: 0, order: 0},
        ]
        let nodeOrders: NodeOrder[] = [];
        let sprites = this.thingNode.getComponentsInChildren(NodeOrder);
        let things = this.json.json;
        let keys = Object.keys(things);
        for(let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let thing: typeof wposType = things[key];
            if(thing[0]["isSpine"] == true) {
                key = key.split("_SkeletonData")[0];
            }
            let sps = sprites.filter(s => s.node.name == key);
            thing.forEach((t, i) => {
                if(!sps[i]) {
                    
                    // return;
                    try {
                        sps[i] = instantiate(sps[i-1].node).getComponent(NodeOrder);
                        sps[i].node.parent = this.thingNode;
                        
                    } catch (error) {
                        console.log(key);
                        
                        return;
                    }
                }
                sps[i].node.position = v3(t.x, t.y, t.z).multiplyScalar(this._mul);
                sps[i].order = t.order;
                nodeOrders.push(sps[i]);
            })
        }
        nodeOrders.sort((a, b) => a.order - b.order);
        nodeOrders.forEach((no, i) => {
            no.node.setSiblingIndex(i);
            no.index = i;
        })
    }

    buildNodeRecursive (
        data: JsonNode,
        parent: Node
    ) {
        // tạo node theo tên
        const node = new Node(data.name);
        node.parent = parent;

        // ⭐ wpos luôn có, bất kể có sprite hay không
        node.setWorldPosition(
            v3(data.wpos.x, data.wpos.y, data.wpos.z).multiplyScalar(100)
        );

        // nếu có sprite thì add
        if (data.sprite) {
            const sprite = node.addComponent(Sprite);
            let sprites = this.thingNode.getComponentsInChildren(Sprite);
            sprite.spriteFrame = sprites.find(s => s.node.name === data.sprite.spriteName)?.spriteFrame;
        }

        // duyệt children theo đúng thứ tự trong JSON
        if (data.children && data.children.length > 0) {
            data.children.forEach(child => {
                this.buildNodeRecursive(child, node);
            });
        }
    }

    update(deltaTime: number) {
        
    }
}


interface JsonNode {
    name: string;
    wpos: { x: number; y: number; z: number };
    sprite?: {
        spriteName: string;
        orderInLayer: number;
    } | null;
    children: JsonNode[];
}

