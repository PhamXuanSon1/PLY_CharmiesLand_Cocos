import { _decorator, Component, Node, ParticleSystem2D, tween, v3, Vec3 } from 'cc';
import { PoolMember } from '../Pool/PoolMember';
import { World } from '../Manager/World';
const { ccclass, property } = _decorator;

@ccclass('Cloud')
export class Cloud extends PoolMember {

    target: Node = null;

    start() {

    }


    pts: ParticleSystem2D[] = [];
    init() {
        this.pts = this.node.getComponentsInChildren(ParticleSystem2D);
        this.pts.forEach((pt) => {
            pt.node.position = v3();
            pt.resetSystem();
        });
    }

    moveTo(pos: Vec3, callback: Function) {
        this.pts.forEach((pt) => {
            pt.resetSystem();
        });
        let dir = pos.clone().subtract(this.pts[1].node.worldPosition);
        let time = dir.length() / 2000;
        tween(this.pts[1].node).to(time, {worldPosition: pos})
        .call(() => {
            callback && callback();
            this.despawn();
        })
        .start();
    }

    despawn() {
        this.pts.forEach((pt) => {
            pt.resetSystem();
            pt.stopSystem();
        });
        this.node.active = false;
    }

    update(deltaTime: number) {
        if (!this.target) return;
        try {
            this.node.worldPosition = this.target.worldPosition.clone();
        } catch (error) {
            this.target = null;
            this.despawn();
        }
    }
}


