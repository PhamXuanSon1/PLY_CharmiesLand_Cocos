import { _decorator, Component, Material, Node, SpriteFrame, SpriteRenderer, Texture2D } from 'cc';
import { MainCamera } from 'db://assets/7.Scripts/Manager/MainCamera';
import { World } from 'db://assets/7.Scripts/Manager/World';
const { ccclass, property } = _decorator;


// @ccclass class SpriteFramePair {
//     @property(SpriteFrame)
//     public spriteFrame: SpriteFrame = null;
//     @property(SpriteFrame)
//     public skin: SpriteFrame = null;
// }

@ccclass('SkinManager')
export class SkinManager extends Component {

    static instance: SkinManager = null;

    static get ins(): SkinManager {
        return this.instance;
    }

    @property([Material])
    public materials: Material[] = [];
    @property([Texture2D])
    public matSkins: Texture2D[] = [];

    @property([SpriteFrame])
    public frames: SpriteFrame[] = [];
    @property([SpriteFrame])
    public skins: SpriteFrame[] = [];

    @property([SpriteRenderer])
    public sprites: SpriteRenderer[] = [];


    changeMat() {
        this.materials.forEach((mat, i) => {
            mat.setProperty("emissiveMap", this.matSkins[i])
            mat.setProperty("emissiveScaleMap", this.matSkins[i])
        });
    }

    changeSpriteRenderer(renderer: SpriteRenderer) {
        return this.skins[this.frames.indexOf(renderer.spriteFrame)];
    }

    changeSkin() {
        this.changeMat();
        this.sprites.forEach((sprite, i) => {
            sprite.spriteFrame = this.skins[this.frames.indexOf(sprite.spriteFrame)];
        })
        World.ins.camera.changeColor();
    }

    start() {
        SkinManager.instance = this;
    }

    update(deltaTime: number) {
        
    }
}


