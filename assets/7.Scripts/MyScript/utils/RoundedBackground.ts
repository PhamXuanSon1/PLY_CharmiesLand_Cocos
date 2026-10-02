/**
 * RoundedBackground — khung nền bo góc (mặc định trắng) nằm SAU 1 node khác (vd Label).
 *
 * Đặt node này làm ANH EM đứng TRƯỚC target trong cùng cha (con luôn vẽ sau cha,
 * nên không làm con của Label được — sẽ đè lên chữ).
 * Mỗi frame copy position / scale / angle của target và ôm theo contentSize của target
 * + padding -> đổi chữ hay target có animation scale thì nền vẫn đi theo.
 * Chạy cả trong Editor.
 */

import { _decorator, Component, Graphics, Color, Node, UITransform, Size } from 'cc';

const { ccclass, property, executeInEditMode, requireComponent, menu } = _decorator;

@ccclass('RoundedBackground')
@executeInEditMode(true)
@requireComponent(Graphics)
@menu('UI/RoundedBackground')
export class RoundedBackground extends Component {

    @property({ type: Node, tooltip: 'Node cần làm nền (vd Label). Trống = dùng UITransform của chính node này.' })
    target: Node | null = null;

    @property({ tooltip: 'Copy position / scale / góc xoay của target mỗi frame (để chạy theo animation).' })
    followTarget = true;

    @property({ tooltip: 'Lề ngang mỗi bên (px). Âm = hẹp hơn target.' })
    paddingX = 40;

    @property({ tooltip: 'Lề dọc mỗi bên (px). Âm = thấp hơn target (Label thường cao dư do Line Height).' })
    paddingY = -10;

    @property({ tooltip: 'Bo góc (px). -1 = bo tròn hết (hình viên thuốc).' })
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

        // chỉ vẽ lại khi có gì thay đổi
        const key = [size.width, size.height, anchorX, anchorY, this.paddingX, this.paddingY, this.radius,
            this.fillColor.toHEX('#rrggbbaa'), this.strokeWidth, this.strokeColor.toHEX('#rrggbbaa'),
            this.shadowOffset, this.shadowColor.toHEX('#rrggbbaa')].join('|');
        if (key === this.lastKey) return;
        this.lastKey = key;
        this.redraw(size, anchorX, anchorY);
    }

    private redraw(size: Size, anchorX: number, anchorY: number): void {
        const g = this.getComponent(Graphics);
        if (!g) return;
        g.clear();

        const w = Math.max(0, size.width + this.paddingX * 2);
        const h = Math.max(0, size.height + this.paddingY * 2);
        if (w <= 0 || h <= 0) return;

        // tâm khung = tâm target (tính theo anchor của target)
        const cx = (0.5 - anchorX) * size.width;
        const cy = (0.5 - anchorY) * size.height;
        const x = cx - w / 2;
        const y = cy - h / 2;
        const r = this.radius < 0 ? Math.min(w, h) / 2 : Math.min(this.radius, w / 2, h / 2);

        if (this.shadowOffset !== 0 && this.shadowColor.a > 0) {
            g.fillColor = this.shadowColor;
            g.roundRect(x, y - this.shadowOffset, w, h, r);
            g.fill();
        }

        g.fillColor = this.fillColor;
        g.roundRect(x, y, w, h, r);
        g.fill();

        if (this.strokeWidth > 0) {
            g.lineWidth = this.strokeWidth;
            g.strokeColor = this.strokeColor;
            const s = this.strokeWidth / 2;
            g.roundRect(x + s, y + s, w - s * 2, h - s * 2, Math.max(0, r - s));
            g.stroke();
        }
    }
}
