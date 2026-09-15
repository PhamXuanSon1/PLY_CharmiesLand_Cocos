import { _decorator, CCString, Component, MeshRenderer, Node } from 'cc';
import { PoolMember } from '../Pool/PoolMember';
const { ccclass, property } = _decorator;





@ccclass('MeshAsset')
export class MeshAsset {
    @property(MeshRenderer)
    public renderMesh: MeshRenderer = null;
  
    @property(CCString)
    public mesPath: string = "";
  
    @property(CCString)
    public matPath: string = "";
}


@ccclass('MeshLoader')
export class MeshLoader extends PoolMember {

    @property([MeshAsset])
    meshAssets: MeshAsset[] = [];

    bindMeshAndMaterial() {}

    start() {

    }

    update(deltaTime: number) {
        
    }
}

