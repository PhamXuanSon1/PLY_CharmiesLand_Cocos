import { _decorator, Component, Node } from 'cc';
import { UI } from './UI';
import { MainCamera } from './MainCamera';
import { GameController } from '../Tool/GameController';
import { Ply_Pool } from '../MyScript/ScriptTemplate/Ply_Pool';
import { Ply_SoundManager } from '../MyScript/ScriptTemplate/Ply_SoundManager';
const { ccclass, property, executeInEditMode } = _decorator;

@ccclass('World')
@executeInEditMode(true)
export class World extends Component {

    static instance: World = null!;
    static get ins() {
        if (!this.instance) {
            this.instance = new World();
        }
        return this.instance;
    }

    @property(UI)
    ui: UI = null!;
    
    @property(GameController)
    openStore: GameController = null; 

    @property(Ply_Pool)
    poolManager: Ply_Pool = null; 

    @property(MainCamera)
    camera: MainCamera = null; 

    @property(Ply_SoundManager)
    soundmanager: Ply_SoundManager = null; 

    get pool(): Ply_Pool | null {
        return this.poolManager || Ply_Pool.Ins;
    }

    get sound(): Ply_SoundManager | null {
        return this.soundmanager || Ply_SoundManager.Ins;
    }

    despawn(node: Node) {
        if (!node || !node.isValid) return;
        node.active = false;
    }
    
    onLoad() {
        World.instance = this;
        if (!this.poolManager && Ply_Pool.Ins) {
            this.poolManager = Ply_Pool.Ins;
        }
        if (!this.soundmanager && Ply_SoundManager.Ins) {
            this.soundmanager = Ply_SoundManager.Ins;
        }
    }  

    start() {
        // PhysicsSystem.instance.maxSubSteps = 1;
        // game.frameRate = 60;
    }

    update(deltaTime: number) {  
    }
}


