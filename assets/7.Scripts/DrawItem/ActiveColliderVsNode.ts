import { _decorator, Component, Collider2D, Node, Animation } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ActiveColliderVsNode')
export class ActiveColliderVsNode extends Component {

    @property({
        type: Collider2D,
        group: { name: '4. Active Targets Override', id: 'activeTargets' },
        displayName: 'Target Collider',
        tooltip: "Collider2D chỉ định cần Bật/Tắt. Nếu để trống sẽ sử dụng danh sách targetColliders hoặc tự động tìm Collider2D trên Node này."
    })
    public targetCollider: Collider2D | null = null;

    @property({
        type: [Collider2D],
        group: { name: '4. Active Targets Override', id: 'activeTargets' },
        displayName: 'Target Colliders List',
        tooltip: "Danh sách các Collider2D cần Bật/Tắt. Nếu rỗng và targetCollider rỗng, sẽ tự động lấy các Collider2D trên Node hiện tại và các Node con."
    })
    public targetColliders: Collider2D[] = [];

    @property({
        type: Node,
        group: { name: '4. Active Targets Override', id: 'activeTargets' },
        displayName: 'Target Node',
        tooltip: "Node chỉ định cần Bật/Tắt. Nếu để trống sẽ dùng targetNodes hoặc Node đang gắn component này."
    })
    public targetNode: Node | null = null;

    @property({
        type: [Node],
        group: { name: '4. Active Targets Override', id: 'activeTargets' },
        displayName: 'Target Nodes List',
        tooltip: "Danh sách các Node cần Bật/Tắt. Nếu rỗng và targetNode rỗng, sẽ dùng Node đang gắn component này."
    })
    public targetNodes: Node[] = [];

    /**
     * Bật (Active) Collider 2D.
     * Hàm này có thể chọn trực tiếp trong On Complete Event (EventHandler) trên Inspector.
     */
    public activeCollider(customEventData?: string): void {
        this.setColliderEnabled(true);
    }

    /**
     * Tắt (Deactive) Collider 2D.
     * Hàm này có thể chọn trực tiếp trong EventHandler trên Inspector.
     */
    public deactiveCollider(customEventData?: string): void {
        this.setColliderEnabled(false);
    }

    /**
     * Đảo trạng thái Bật/Tắt của Collider 2D.
     */
    public toggleCollider(customEventData?: string): void {
        if (this.targetCollider) {
            this.setColliderEnabled(!this.targetCollider.enabled);
        } else if (this.targetColliders && this.targetColliders.length > 0) {
            const first = this.targetColliders.find(c => c != null);
            if (first) {
                this.setColliderEnabled(!first.enabled);
            }
        } else {
            const col = this.getComponent(Collider2D) || this.getComponentInChildren(Collider2D);
            if (col) {
                this.setColliderEnabled(!col.enabled);
            }
        }
    }

    /**
     * Bật (Active) Node.
     */
    public activeObj(customEventData?: string): void {
        this.setObjectActive(true);
    }

    /**
     * Tắt (Deactive) Node.
     */
    public deactiveObj(customEventData?: string): void {
        this.setObjectActive(false);
    }

    /**
     * Đảo trạng thái Bật/Tắt của Node.
     */
    public toggleObj(customEventData?: string): void {
        if (this.targetNode) {
            this.setObjectActive(!this.targetNode.active);
        } else if (this.targetNodes && this.targetNodes.length > 0) {
            const first = this.targetNodes.find(n => n != null);
            if (first) {
                this.setObjectActive(!first.active);
            }
        } else {
            this.setObjectActive(!this.node.active);
        }
    }

    /**
     * Thiết lập trạng thái Bật/Tắt cho các Collider 2D.
     */
    public setColliderEnabled(enabled: boolean): void {
        let hasCustomTarget = false;

        if (this.targetCollider) {
            this.targetCollider.enabled = enabled;
            hasCustomTarget = true;
        }

        if (this.targetColliders && this.targetColliders.length > 0) {
            for (let i = 0; i < this.targetColliders.length; i++) {
                if (this.targetColliders[i]) {
                    this.targetColliders[i].enabled = enabled;
                    hasCustomTarget = true;
                }
            }
        }

        // Nếu chưa kéo thả Target Collider nào trong Inspector, tự động tìm trên Node hiện tại và các Node con
        if (!hasCustomTarget) {
            const colliders = this.getComponents(Collider2D);
            if (colliders && colliders.length > 0) {
                for (let i = 0; i < colliders.length; i++) {
                    colliders[i].enabled = enabled;
                }
            } else {
                const childColliders = this.getComponentsInChildren(Collider2D);
                for (let i = 0; i < childColliders.length; i++) {
                    childColliders[i].enabled = enabled;
                }
            }
        }
    }

    /**
     * Thiết lập trạng thái Bật/Tắt cho các Node.
     */
    public setObjectActive(active: boolean): void {
        let hasCustomTarget = false;

        if (this.targetNode) {
            this.targetNode.active = active;
            hasCustomTarget = true;
        }

        if (this.targetNodes && this.targetNodes.length > 0) {
            for (let i = 0; i < this.targetNodes.length; i++) {
                if (this.targetNodes[i]) {
                    this.targetNodes[i].active = active;
                    hasCustomTarget = true;
                }
            }
        }

        if (!hasCustomTarget) {
            this.node.active = active;
        }
    }

    /**
     * Bật chạy Animation (Play).
     * @param customEventData Tên clip muốn chạy (để trống sẽ chạy defaultClip hoặc clip đầu tiên).
     */
    public playAnim(customEventData?: string): void {
        const anim = (this.targetNode ? this.targetNode.getComponent(Animation) : null) 
            || this.getComponent(Animation) 
            || this.getComponentInChildren(Animation);
        if (!anim) return;

        const clipName = (customEventData && customEventData.trim() !== '') ? customEventData.trim() : '';
        if (clipName) {
            anim.play(clipName);
        } else {
            anim.play();
        }
    }

    /**
     * Dừng Animation.
     * @param customEventData Tên clip muốn dừng (để trống sẽ dừng tất cả animation).
     */
    public stopAnim(customEventData?: string): void {
        const anim = (this.targetNode ? this.targetNode.getComponent(Animation) : null) 
            || this.getComponent(Animation) 
            || this.getComponentInChildren(Animation);
        if (!anim) return;

        const clipName = (customEventData && customEventData.trim() !== '') ? customEventData.trim() : '';
        if (clipName) {
            anim.stop(clipName);
        } else {
            anim.stop();
        }
    }

    /**
     * Dừng Animation và khôi phục lại trạng thái ban đầu (Frame 0).
     * Dùng hàm này trong On Drop Event trên Inspector để khi thả tay ra đồ vật sẽ đóng/trả về dáng ban đầu.
     * @param customEventData Tên clip (để trống sẽ tự động lấy defaultClip hoặc tất cả clips).
     */
    public stopAnimAndReset(customEventData?: string): void {
        const anim = (this.targetNode ? this.targetNode.getComponent(Animation) : null) 
            || this.getComponent(Animation) 
            || this.getComponentInChildren(Animation);
        if (!anim) return;

        anim.stop();

        const clipName = (customEventData && customEventData.trim() !== '') ? customEventData.trim() : '';
        if (clipName) {
            const state = anim.getState(clipName);
            if (state) {
                state.setTime(0);
                state.sample();
            }
        } else {
            const defaultClip = anim.defaultClip;
            if (defaultClip) {
                const state = anim.getState(defaultClip.name);
                if (state) {
                    state.setTime(0);
                    state.sample();
                }
            }
            const clips = anim.clips;
            if (clips && clips.length > 0) {
                for (let i = 0; i < clips.length; i++) {
                    const c = clips[i];
                    if (c) {
                        const state = anim.getState(c.name);
                        if (state) {
                            state.setTime(0);
                            state.sample();
                        }
                    }
                }
            }
        }
    }

    /**
     * Reset Animation về Frame 0 mà không dừng (hoặc để chuẩn bị chạy lại).
     */
    public resetAnim(customEventData?: string): void {
        this.stopAnimAndReset(customEventData);
    }
}
