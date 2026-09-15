/** BlinkEffect — Quản lý hiệu ứng sao lấp lánh khi đặt đúng vị trí */

import { _decorator, Component, Node } from 'cc';
import { Ply_GameUnit } from '../ScriptTemplate/Ply_GameUnit';
import { Ply_Pool, PoolType as PlyPoolType } from '../ScriptTemplate/Ply_Pool';
import { ObjectPool, PoolType as DreamyPoolType } from '../core/ObjectPool';

const { ccclass } = _decorator;

@ccclass('BlinkEffect')
export class BlinkEffect extends Ply_GameUnit {

    deSpawnByTime(delay = 2): void {
        this.unscheduleAllCallbacks();
        this.scheduleOnce(() => {
            if (Ply_Pool.Ins) {
                Ply_Pool.Ins.despawn(PlyPoolType.CorrectEffect, this);
            } else if (ObjectPool.instance) {
                ObjectPool.instance.despawn(DreamyPoolType.BlinkFX, this.node);
            } else {
                this.node.active = false;
            }
        }, delay);
    }
}
