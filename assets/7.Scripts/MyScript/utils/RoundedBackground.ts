/**
 * RoundedBackground — khung nền bo góc (mặc định trắng) nằm SAU 1 node khác (vd Label).
 *
 * Đặt node này làm ANH EM đứng TRƯỚC target trong cùng cha (con luôn vẽ sau cha,
 * nên không làm con của Label được — sẽ đè lên chữ).
 *
 * 2 chế độ:
 *   WrapTarget : ôm theo contentSize của target + padding, copy position/scale/góc của
 *                target mỗi frame (chạy theo animation).
 *   TopBanner  : dải ngang dính sát MÉP TRÊN màn hình, trải hết 2 mép bên (tính theo
 *                camera đang vẽ node này), đáy = đáy target + paddingY. Chỉ bo 2 góc dưới.
 *                Không chạy theo animation scale của target để dải đứng yên.
 * Chạy cả trong Editor.
 */

import { _decorator, Component, Graphics, Color, Node, UITransform, Size, Enum, Camera, Vec3, view } from 'cc';

const { ccclass, property, executeInEditMode, requireComponent, menu } = _decorator;

export enum RoundedBgMode {
    /** Ôm theo target + padding. */
    WrapTarget = 0,
    /** Dải dính mép trên màn hình, trải hết chiều ngang. */
    TopBanner = 1,
}
Enum(RoundedBgMode);

@ccclass('RoundedBackground')
@executeInEditMode(true)
@requireComponent(Graphics)
@menu('UI/RoundedBackground')
export class RoundedBackground extends Component {

    @property({ type: Enum(RoundedBgMode), tooltip: 'WrapTarget: ôm theo chữ. TopBanner: dính mép trên, trải hết chiều ngang màn hình.' })
    mode: RoundedBgMode = RoundedBgMode.WrapTarget;

    @property({ type: Node, tooltip: 'Node cần làm nền (vd Label). Trống = dùng UITransform của chính node này.' })
    target: Node | null = null;

    @property({
        type: Camera,
        tooltip: 'TopBanner: camera dùng để tính mép màn hình. Trống = tự tìm camera vẽ layer của node này.',
        visible(this: RoundedBackground) { return this.mode === RoundedBgMode.TopBanner; },
    })
    camera: Camera | null = null;

    @property({
        tooltip: 'Copy position / scale / góc xoay của target mỗi frame (để chạy theo animation).',
        visible(this: RoundedBackground) { return this.mode === RoundedBgMode.WrapTarget; },
    })
    followTarget = true;

    @property({
        tooltip: 'Lề ngang mỗi bên (px). Âm = hẹp hơn target.',
        visible(this: RoundedBackground) { return this.mode === RoundedBgMode.WrapTarget; },
    })
    paddingX = 40;

    @property({ tooltip: 'WrapTarget: lề dọc mỗi bên. TopBanner: khoảng cách từ đáy chữ tới đáy dải (px). Âm = sát hơn.' })
    paddingY = -10;

    @property({ tooltip: 'Bo góc (px). -1 = bo tròn hết (viên thuốc). TopBanner chỉ bo 2 góc dưới.' })
    radius = -1;

    @property({ type: Color })
    fillColor = new Color(255, 255, 255, 255);

    @property({ tooltip: 'Độ dày viền (px). 0 = không viền.' })
    strokeWidth = 0;

    @property({ type: Color })
    strokeColor = new Color(0, 0, 0, 255);

    @property({ tooltip: 'Độ lệch bóng xuống dưới (px). 0 = không bóng.' })
    shadowOffset = 8;

    @property({ type: Color })
    shadowColor = new Color(0, 0, 0, 45);

    private lastKey = '';

    onEnable() {
        this.lastKey = '';
        this.lateUpdate();
    }

    lateUpdate() {
        if (this.mode === RoundedBgMode.TopBanner) this.updateBanner();
        else this.updateWrap();
    }

    private styleKey(): string {
        return [this.mode, this.paddingX, this.paddingY, this.radius,
            this.fillColor.toHEX('#rrggbbaa'), this.strokeWidth, this.strokeColor.toHEX('#rrggbbaa'),
            this.shadowOffset, this.shadowColor.toHEX('#rrggbbaa')].join('|');
    }

    // ======================================================== WrapTarget
    private updateWrap(): void {
        const t = this.target && this.target.isValid ? this.target : null;
        if (t && this.followTarget) {
            if (!this.node.position.equals(t.position)) this.node.setPosition(t.position);
            if (!this.node.scale.equals(t.scale)) this.node.setScale(t.scale);
            if (this.node.angle !== t.angle) this.node.angle = t.angle;
        }

        const ut = (t ?? this.node).getComponent(UITransform);
        const size = ut ? ut.contentSize : new Size(0, 0);
        const anchorX = ut ? ut.anchorX : 0.5;
        const anchorY = ut ? ut.anchorY : 0.5;

        const key = [size.width, size.height, anchorX, anchorY, this.styleKey()].join('|');
        if (key === this.lastKey) return;
        this.lastKey = key;

        const w = Math.max(0, size.width + this.paddingX * 2);
        const h = Math.max(0, size.height + this.paddingY * 2);
        // tâm khung = tâm target (tính theo anchor của target)
        const cx = (0.5 - anchorX) * size.width;
        const cy = (0.5 - anchorY) * size.height;
        const r = this.radius < 0 ? Math.min(w, h) / 2 : Math.min(this.radius, w / 2, h / 2);
        this.draw(cx - w / 2, cy - h / 2, w, h, r, r);
    }

    // ======================================================== TopBanner
    private updateBanner(): void {
        const myUt = this.node.getComponent(UITransform);
        const rect = this.screenWorldRect();
        if (!myUt || !rect) return;

        // Dải đứng yên: không ăn theo scale/góc animation của target
        if (!this.node.scale.equals(Vec3.ONE)) this.node.setScale(Vec3.ONE);
        if (this.node.angle !== 0) this.node.angle = 0;

        // Đáy chữ tính theo position + contentSize của target (bỏ qua scale riêng của target
        // để animation phóng to/thu nhỏ chữ không làm dải nhấp nhô)
        let bottomWorldY = rect.bottom + (rect.top - rect.bottom) * 0.9;
        const t = this.target && this.target.isValid ? this.target : null;
        const tUt = t?.getComponent(UITransform);
        if (t && tUt && t.parent) {
            const localBottom = new Vec3(t.position.x, t.position.y - tUt.anchorY * tUt.height, 0);
            bottomWorldY = Vec3.transformMat4(new Vec3(), localBottom, t.parent.worldMatrix).y;
        }

        const tl = myUt.convertToNodeSpaceAR(new Vec3(rect.left, rect.top, 0));
        const br = myUt.convertToNodeSpaceAR(new Vec3(rect.right, bottomWorldY, 0));
        const x = Math.min(tl.x, br.x);
        const w = Math.abs(br.x - tl.x);
        const bottom = br.y - this.paddingY;
        const h = Math.max(0, tl.y - bottom);

        const key = [x.toFixed(1), w.toFixed(1), bottom.toFixed(1), h.toFixed(1), this.styleKey()].join('|');
        if (key === this.lastKey) return;
        this.lastKey = key;

        const r = this.radius < 0 ? Math.min(w, h) / 2 : Math.min(this.radius, w / 2, h);
        this.draw(x, bottom, w, h, 0, r);
    }

    /** Khung màn hình (world) mà camera vẽ node này đang thấy. */
    private screenWorldRect(): { left: number; right: number; top: number; bottom: number } | null {
        const cam = this.findCamera();
        if (!cam) return null;
        const halfH = cam.orthoHeight;
        let aspect = 0;
        const rc = cam.camera;
        if (rc && rc.width > 0 && rc.height > 0) aspect = rc.width / rc.height;
        if (!(aspect > 0)) {
            const vs = view.getVisibleSize();
            aspect = vs.height > 0 ? vs.width / vs.height : 1080 / 2350;
        }
        const halfW = halfH * aspect;
        const c = cam.node.worldPosition;
        return { left: c.x - halfW, right: c.x + halfW, top: c.y + halfH, bottom: c.y - halfH };
    }

    private findCamera(): Camera | null {
        if (this.camera && this.camera.isValid) return this.camera;
        const layer = this.node.layer;
        for (let p: Node | null = this.node.parent; p; p = p.parent) {
            const cams = p.getComponentsInChildren(Camera);
            const hit = cams.find((c) => (c.visibility & layer) !== 0 && c.projection === Camera.ProjectionType.ORTHO);
            if (hit) return hit;
        }
        return null;
    }

    // ======================================================== draw
    /** Khung (x, y) = góc dưới-trái. rTop / rBottom: bo 2 góc trên / 2 góc dưới. */
    private draw(x: number, y: number, w: number, h: number, rTop: number, rBottom: number): void {
        const g = this.getComponent(Graphics);
        if (!g) return;
        g.clear();
        if (w <= 0 || h <= 0) return;

        if (this.shadowOffset !== 0 && this.shadowColor.a > 0) {
            g.fillColor = this.shadowColor;
            this.shape(g, x, y - this.shadowOffset, w, h, rTop, rBottom);
            g.fill();
        }

        g.fillColor = this.fillColor;
        this.shape(g, x, y, w, h, rTop, rBottom);
        g.fill();

        if (this.strokeWidth > 0) {
            const s = this.strokeWidth / 2;
            g.lineWidth = this.strokeWidth;
            g.strokeColor = this.strokeColor;
            this.shape(g, x + s, y + s, w - s * 2, h - s * 2, Math.max(0, rTop - s), Math.max(0, rBottom - s));
            g.stroke();
        }
    }

    private shape(g: Graphics, x: number, y: number, w: number, h: number, rTop: number, rBottom: number): void {
        if (rTop === rBottom) {
            g.roundRect(x, y, w, h, rTop);
            return;
        }
        const rt = Math.min(rTop, w / 2, h / 2);
        const rb = Math.min(rBottom, w / 2, h - rt);
        const top = y + h;
        g.moveTo(x + rt, top);
        g.lineTo(x + w - rt, top);
        if (rt > 0) g.quadraticCurveTo(x + w, top, x + w, top - rt);
        g.lineTo(x + w, y + rb);
        if (rb > 0) g.quadraticCurveTo(x + w, y, x + w - rb, y);
        g.lineTo(x + rb, y);
        if (rb > 0) g.quadraticCurveTo(x, y, x, y + rb);
        g.lineTo(x, top - rt);
        if (rt > 0) g.quadraticCurveTo(x, top, x + rt, top);
        g.close();
    }
}
