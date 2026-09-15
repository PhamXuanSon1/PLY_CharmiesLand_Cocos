import { _decorator, Component, Node } from 'cc';
import { PoolType } from './Ply_Types';
import { Ply_Pool } from './Ply_Pool';
const { ccclass, property } = _decorator;

/**
 * Lop co ban cho cac game unit (doi tuong dung trong pool).
 * Tuong duong voi Ply_GameUnit : MonoBehaviour trong Unity.
 * 
 * Trong Unity, `tf` la transform duoc cache.
 * Trong Cocos, moi Component deu co san `this.node` tuong duong.
 */
@ccclass('Ply_GameUnit')
export class Ply_GameUnit extends Component {

    @property({ type: PoolType })
    public poolType: PoolType = PoolType.CorrectEffect;

    /**
     * Tham chieu toi node cua unit nay (tuong duong Transform `tf` trong Unity).
     * Trong Cocos, `this.node` luon co san, nhung ta giu getter nay
     * de tuong thich voi code dung `gameUnit.tf`.
     */
    public get tf(): Node {
        return this.node;
    }

    /** Thu hoi unit ve pool sau thoi gian delay (giay) */
    public deSpawnByTime(delay: number = 2): void {
        this.unscheduleAllCallbacks();
        this.scheduleOnce(() => {
            Ply_Pool.Ins?.despawn(this.poolType, this);
        }, delay);
    }
}
