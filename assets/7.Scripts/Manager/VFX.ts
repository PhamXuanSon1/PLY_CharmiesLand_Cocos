import { _decorator, Component, Node, ParticleSystem2D } from 'cc';
import { PoolMember } from '../Pool/PoolMember';
import { World } from './World';
const { ccclass, property } = _decorator;

@ccclass('VFX')
export class VFX extends PoolMember {
    start() {

    }

    particles: ParticleSystem2D[] = [];

    init() {
        this.particles = this.node.getComponentsInChildren(ParticleSystem2D);
        this.particles.forEach((pt) => {
            pt.resetSystem();
        });
        setTimeout(() => {
            World.ins.despawn(this.node);
        }, 1000);
    }

    update(deltaTime: number) {
        
    }
}


