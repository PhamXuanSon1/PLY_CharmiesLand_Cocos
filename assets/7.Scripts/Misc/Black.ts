import { _decorator, Component, Graphics, lerp, Mask, Node, Size, Sprite, UITransform, v2, v3, Vec2, Vec3 } from 'cc';
import { PoolMember } from '../Pool/PoolMember';
import { World } from 'db://assets/7.Scripts/Manager/World';
import Ulis from './Ulis';
const { ccclass, property, executeInEditMode } = _decorator;

@ccclass('Black')
// @executeInEditMode(true)
export class Black extends PoolMember {

    @property(Mask)
    mask: Mask = null!;
    stencil: Graphics = null!;


    despawn() {
        this.init();
        World.ins?.despawn(this.node);
    }

    @property([Vec3])
    points: Vec3[] = [];
    setMask(points: Vec3[] = null) {
        if(points.length == 0) return;

        if(this.isRevert) {
            this.mask.inverted = true;
            if(this.fill > 0.5) {
                let dF = 1 - this.fill;
                let d = 1 - 2 * dF;
                this.sprite.node.position = v3(0, this.diagonal*d, 0);
            } else {
                let dF = 1 - this.fill;
                let d = this.fill - dF;
                this.sprite.node.position = v3(0, this.diagonal*d, 0);
            }
        }
        
        let mask: any = this.mask;
        this.stencil = mask._graphics;
        this.stencil.clear();
        this.stencil.moveTo(points[0].x, points[0].y);
        points.forEach((point, i) => {
            // if( i == points.length / 2 ) {
            //     let c = v3(points[i - 1].x + point.x, points[i - 1].y + point.y, 0).multiplyScalar(0.5);
            //     this.stencil.quadraticCurveTo(c.x, c.y - 10, point.x, point.y);
            // } else {
            //     this.stencil.lineTo(point.x, point.y);
            // }
            this.stencil.lineTo(point.x, point.y);
        })
        this.stencil.lineTo(points[0].x, points[0].y);
        this.stencil.fill();
        this.points = points;
    }

    init() {
        let mask: any = this.mask;
        this.stencil = mask._graphics;
        this.stencil.clear();
        let stencil: any = this.stencil;
        stencil._isDrawing = true;
        
    }

    @property(Sprite)
    sprite: Sprite = null!;

    isRevert: boolean = false;

    @property(Size)
    size: Size = new Size(100, 100);

    diagonal: number = 0;

    addSprite(sprite: Sprite = this.sprite, rotation: number = this.rotation) {
        this.sprite = sprite;
        const dRot = sprite.node.worldRotation.clone();
        this.node.eulerAngles = v3(0, 0, rotation);     
        Ulis.addToParent(sprite.node, this.mask.node);
        sprite.node.worldRotation = dRot;
        sprite.node.scale = v3(1, 1, 1);
        this.size = sprite.node.getComponent(UITransform).contentSize;
        this.map.set("rotation", rotation);
        this.rotation = rotation;     
        
    }

    setFill(begin: number = this.begin, end: number = this.end, ratio: number = this.fill) {
        this.begin = begin;
        this.end = end;
        this.fill = ratio;
        let r = lerp(begin, end, ratio);
        let bl = v2(-1, -1);
        let br = v2(1, -1);
        let tr = v2(1, 1);
        let tl = v2(-1, 1);
        let leftLerp = Vec2.lerp(v2(), bl, tl, r);
        let rightLerp = Vec2.lerp(v2(), br, tr, r);
        let p: Vec2[]  = [bl, br, rightLerp, leftLerp];
        this.diagonal = Vec2.distance(v2(), v2(this.size.x, this.size.y));
        this.diagonal *= this.sprite.node.scale.x;
        let points = p.map((pt) => {
            return v3(pt.x * this.diagonal/2, pt.y * this.diagonal/2, 0);
        })
        // if(this.isRevert) 
        {
            let bl3 = v3(points[0].x, points[0].y - this.diagonal, 0);
            let br3 = v3(points[1].x, points[1].y - this.diagonal, 0);
            points[0] = bl3;
            points[1] = br3;
        }
        this.setMask(points);
        this.map.set("fill", r);
    }

    @property({slide: true, range: [0, 360, 1]})
    rotation: number = 45;

    @property({slide: true, range: [0, 1, 0.01]})
    fill: number = 0.5;
    @property({slide: true, range: [0, 1, 0.01]})
    begin: number = 0.5;
    @property({slide: true, range: [0, 1, 0.01]})
    end: number = 0.5;


    start() {        
        // this.init();
        // this.addSprite();
        // this.setFill(0, 1, this.fill);
    }

    map: Map<string, number> = new Map();
    update(deltaTime: number) {
        this.map.forEach((value, key) => {            
            if(this[key] != value) {
                this.map.set(key, this[key]);
                if(key == "fill") {
                    this.setFill(this.begin, this.end, this.fill);
                }
                if(key == "rotation") {
                    this.addSprite(this.sprite, this.rotation);
                }
            }
        })
    }
}
