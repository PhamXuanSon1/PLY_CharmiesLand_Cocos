/**
 * ColliderDebugVisualizer — Hiển thị khung hình ảnh của tất cả Collider2D khi chạy trên Chrome / Web / Preview.
 *
 * Tính năng:
 * 1. Bật hệ thống DebugDraw mặc định của Cocos PhysicsSystem2D.
 * 2. Tự động vẽ khung đồ hoạ (Graphics) trực quan với màu sắc tuỳ chỉnh (xanh lá/đỏ) cho tất cả BoxCollider2D, CircleCollider2D, PolygonCollider2D.
 * 3. Hỗ trợ xoay, scale, di chuyển theo thời gian thực (realtime update).
 * 4. Bật / tắt dễ dàng trên Inspector.
 */

import { _decorator, Component, Node, Graphics, Color, Vec3, BoxCollider2D, CircleCollider2D, PolygonCollider2D, Collider2D, UITransform, director, PhysicsSystem2D, EPhysics2DDrawFlags, v3, color } from 'cc';

const { ccclass, property, menu } = _decorator;

@ccclass('ColliderDebugVisualizer')
@menu('Tool/ColliderDebugVisualizer')
export class ColliderDebugVisualizer extends Component {

    @property({ tooltip: 'Bật / tắt hiển thị khung Collider khi chạy game.' })
    showColliders = true;

    @property({ tooltip: 'Đồng thời kích hoạt Cocos PhysicsSystem2D DebugDraw.' })
    enablePhysicsSystemDebug = true;

    @property({ tooltip: 'Tô màu mờ bên trong vùng Collider.' })
    fillCollider = true;

    @property({ tooltip: 'Độ dày đường viền (pixels).' })
    lineWidth = 3;

    @property({ tooltip: 'Màu viền của Collider.' })
    strokeColor: Color = color(0, 255, 100, 230);

    @property({ tooltip: 'Màu nền mờ của Collider.' })
    fillColor: Color = color(0, 255, 100, 50);

    private graphics: Graphics | null = null;
    private targetRoot: Node | null = null;
    private tempVec3 = v3();

    onLoad() {
        if (this.enablePhysicsSystemDebug && PhysicsSystem2D.instance) {
            PhysicsSystem2D.instance.enable = true;
            PhysicsSystem2D.instance.debugDrawFlags = EPhysics2DDrawFlags.Shape | EPhysics2DDrawFlags.Aabb;
        }

        this.initGraphics();
    }

    private initGraphics(): void {
        let gNode = this.node.getChildByName('__ColliderDebugGraphics__');
        if (!gNode) {
            gNode = new Node('__ColliderDebugGraphics__');
            this.node.addChild(gNode);
        }

        this.graphics = gNode.getComponent(Graphics) || gNode.addComponent(Graphics);
        this.targetRoot = director.getScene();
    }

    lateUpdate() {
        if (!this.showColliders || !this.graphics) {
            this.graphics?.clear();
            return;
        }

        this.drawAllColliders();
    }

    private drawAllColliders(): void {
        if (!this.graphics) return;
        this.graphics.clear();

        const scene = this.targetRoot || director.getScene();
        if (!scene) return;

        const colliders = scene.getComponentsInChildren(Collider2D);
        if (!colliders || colliders.length === 0) return;

        this.graphics.lineWidth = this.lineWidth;
        this.graphics.strokeColor = this.strokeColor;
        this.graphics.fillColor = this.fillColor;

        const gTransform = this.graphics.node.getComponent(UITransform) || this.node.getComponent(UITransform);

        for (const col of colliders) {
            if (!col.node || !col.node.isValid || !col.node.activeInHierarchy || !col.enabled) continue;

            if (col instanceof BoxCollider2D) {
                this.drawBoxCollider(col, gTransform);
            } else if (col instanceof CircleCollider2D) {
                this.drawCircleCollider(col, gTransform);
            } else if (col instanceof PolygonCollider2D) {
                this.drawPolygonCollider(col, gTransform);
            }
        }
    }

    private drawBoxCollider(box: BoxCollider2D, gTransform: UITransform | null): void {
        const points = box.worldPoints;
        if (!points || points.length < 4 || !this.graphics) return;

        this.drawPolygonPoints(points, gTransform);
    }

    private drawPolygonCollider(poly: PolygonCollider2D, gTransform: UITransform | null): void {
        const points = poly.worldPoints;
        if (!points || points.length < 3 || !this.graphics) return;

        this.drawPolygonPoints(points, gTransform);
    }

    private drawPolygonPoints(points: Array<{ x: number; y: number }>, gTransform: UITransform | null): void {
        if (!this.graphics || points.length === 0) return;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            this.tempVec3.set(p.x, p.y, 0);

            if (gTransform) {
                gTransform.convertToNodeSpaceAR(this.tempVec3, this.tempVec3);
            }

            if (i === 0) {
                this.graphics.moveTo(this.tempVec3.x, this.tempVec3.y);
            } else {
                this.graphics.lineTo(this.tempVec3.x, this.tempVec3.y);
            }
        }

        this.graphics.close();
        if (this.fillCollider) {
            this.graphics.fill();
        }
        this.graphics.stroke();
    }

    private drawCircleCollider(circle: CircleCollider2D, gTransform: UITransform | null): void {
        if (!this.graphics) return;

        const wp = circle.worldPosition;
        this.tempVec3.set(wp.x, wp.y, 0);
        if (gTransform) {
            gTransform.convertToNodeSpaceAR(this.tempVec3, this.tempVec3);
        }

        this.graphics.circle(this.tempVec3.x, this.tempVec3.y, circle.worldRadius);
        if (this.fillCollider) {
            this.graphics.fill();
        }
        this.graphics.stroke();
    }
}
