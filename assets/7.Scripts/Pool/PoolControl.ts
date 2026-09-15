// Learn TypeScript:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/typescript.html
// Learn Attribute:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/reference/attributes.html
// Learn life-cycle callbacks:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/life-cycle-callbacks.html

import { Component, Node, Prefab, Quat, Vec3, _decorator, instantiate, log, v3 } from "cc"; 
import { PoolMember, PoolType } from "./PoolMember";

import { PoolAmount } from "./PoolManager";

const { ccclass, property, executeInEditMode } = _decorator;


@ccclass('PoolControl')
@executeInEditMode(true)
export default class PoolControl extends Component {

  @property(Node)
  root: Node = null;
  @property([Prefab])
  prefabs: PoolMember[] = [];

  poolAmounts: PoolAmount[] = [];

  preLoad() {
    this.prefabs.forEach((prefab, index) => {
      let poolAmount = new PoolAmount();
      poolAmount.root = this.root;
      poolAmount.prefab = prefab;
      poolAmount.amount = 0;
      this.poolAmounts.push(poolAmount);
    })
  }

  // LIFE-CYCLE CALLBACKS:

  onLoad() {
    this.preLoad();
  }

  start() {
  }

  // update (dt) {}
}