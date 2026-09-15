/**
 * ObjectPool — port từ Ply_Pool.cs (Unity)
 *
 * ⚠ MỖI FILE .ts CHỈ ĐƯỢC CÓ ĐÚNG 1 CLASS KẾ THỪA Component.
 *   Vi phạm -> "Each script can have at most one Component" -> module vỡ ->
 *   TOÀN BỘ bundle script mất đăng ký -> mọi component trong scene thành
 *   "missing or invalid". Lỗi rất khó lần vì thông báo nằm ở script này
 *   nhưng hậu quả hiện ra ở mọi script khác.
 *
 * Ply_GameUnit.cs KHÔNG port: nó chỉ là base class giữ `tf`, mà pool ở đây
 * làm việc trực tiếp với Node còn BlinkEffect kế thừa thẳng Component.
 */

import { _decorator, Component, Node, Prefab, instantiate, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/** Unity: PoolType. Level542 chỉ dùng BlinkFX. */
export enum PoolType {
    Bullet, Enemy, VFX_Spark, VFX_Explore, Enemy_Bullet, Booster,
    CorrectEffect, CorrectText1, CorrectText2, CorrectText3, BlinkFX,
}

@ccclass('DreamyPoolAmount')
export class PoolAmount {
    @property({ type: Prefab }) prefab: Prefab | null = null;
    @property({ tooltip: 'Chỉ số của PoolType (BlinkFX = 10)' }) type = PoolType.BlinkFX;
    @property amount = 5;
}

/** Unity: Ply_Pool */
@ccclass('DreamyObjectPool')
export class ObjectPool extends Component {

    static instance: ObjectPool | null = null;

    @property({ type: [PoolAmount] })
    poolAmounts: PoolAmount[] = [];

    @property({ type: Node, tooltip: 'Node chứa object trong pool. Để trống = dùng chính node này.' })
    container: Node | null = null;

    private dict = new Map<PoolType, Node[]>();
    private prefabOf = new Map<PoolType, Prefab>();

    onLoad() {
        ObjectPool.instance = this;
        for (const pa of this.poolAmounts) {
            if (!pa.prefab) continue;
            this.prefabOf.set(pa.type, pa.prefab);
            const q: Node[] = [];
            for (let i = 0; i < pa.amount; i++) {
                const n = instantiate(pa.prefab);
                n.active = false;
                n.setParent(this.container ?? this.node);
                q.push(n);
            }
            this.dict.set(pa.type, q);
        }
    }

    onDestroy() {
        if (ObjectPool.instance === this) ObjectPool.instance = null;
    }

    /** Unity: Spawn(poolType, pos, rot) */
    spawn(type: PoolType, worldPos: Vec3): Node | null {
        const q = this.dict.get(type);
        let n = q && q.length > 0 ? q.pop()! : null;

        if (!n) {
            const prefab = this.prefabOf.get(type);
            if (!prefab) return null;
            n = instantiate(prefab);
            n.setParent(this.container ?? this.node);
        }

        n.layer = this.node.layer;          // xem ghi chú UI_2D ở SceneBuilder
        n.setWorldPosition(worldPos);
        n.active = true;
        return n;
    }

    /** Unity: Despawn */
    despawn(type: PoolType, node: Node): void {
        if (!node || !node.isValid) return;
        node.active = false;
        node.setParent(this.container ?? this.node);
        let q = this.dict.get(type);
        if (!q) { q = []; this.dict.set(type, q); }
        if (q.indexOf(node) < 0) q.push(node);
    }
}
