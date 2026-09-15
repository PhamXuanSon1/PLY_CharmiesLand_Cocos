import { _decorator, Component, Node } from 'cc';
import { MeshLoader } from './MeshLoader';
import { AssetsManagerCustom } from '../Manager/AssetsManagerCustom';
const { ccclass, property } = _decorator;

@ccclass('Tooth')
export class Tooth extends MeshLoader {

    static instances: Tooth[] = [];


    bindMeshAndMaterial() {
        this.meshAssets[0].renderMesh.mesh = AssetsManagerCustom.ins.assetInfos.get(this.meshAssets[0].mesPath)!;
        this.meshAssets[0].renderMesh.material = AssetsManagerCustom.ins.assetInfos.get(this.meshAssets[0].matPath)!;
    }


    start() {
        Tooth.instances.push(this);
    }

    update(deltaTime: number) {
        
    }
}

