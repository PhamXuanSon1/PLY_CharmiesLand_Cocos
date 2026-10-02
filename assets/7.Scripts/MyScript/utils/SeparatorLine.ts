/**
 * SeparatorLine — đường viền ngang chia 2 phần màn hình (vd mép trên thanh item).
 *
 * Vẽ bằng Graphics, gốc node = mép TRÊN của đường viền, vẽ xuống dưới:
 *   [highlight] dải sáng mỏng trên cùng
 *   [main]      dải màu chính (có thể có viền răng cưa tròn — scallop — ở đáy)
 *   [shadow]    bóng mờ dưới cùng
 * Chiều ngang: `width` > 0 thì dùng, 0 = lấy theo chiều ngang UITransform của node cha.
 * Chạy cả trong Editor nên chỉnh Inspector là thấy ngay.
 */

import { _decorator, Component, Graphics, Color, UITransform } from 'cc';

const { ccclass, property, executeInEditMode, requireComponent, menu } = _decorator;

@ccclass('SeparatorLine')
@executeInEditMode(true)
@requireComponent(Graphics)
@menu('UI/SeparatorLine')
export class SeparatorLine extends Component {

    @property({ tooltip: 'Chiều ngang (px). 0 = theo UITransform của node cha.' })
    get width() { return this._width; }
    set width(v: number) { this._width = Math.max(0, v); this.redraw(); }
    @property private _width = 0;

    // ---- highlight ----
    @property({ tooltip: 'Độ dày dải sáng trên cùng (px). 0 = tắt.' })
    get highlightThickness() { return this._highlightThickness; }
    set highlightThickness(v: number) { this._highlightThickness = Math.max(0, v); this.redraw(); }
    @property private _highlightThickness = 8;

    @property({ type: Color })
    get highlightColor() { return this._highlightColor; }
    set highlightColor(v: Color) { this._highlightColor = v.clone(); this.redraw(); }
    @property private _highlightColor = new Color(255, 255, 255, 255);

    // ---- main ----
    @property({ tooltip: 'Độ dày dải màu chính (px).' })
    get mainThickness() { return this._mainThickness; }
    set mainThickness(v: number) { this._mainThickness = Math.max(0, v); this.redraw(); }
    @property private _mainThickness = 14;

    @property({ type: Color })
    get mainColor() { return this._mainColor; }
    set mainColor(v: Color) { this._mainColor = v.clone(); this.redraw(); }
    @property private _mainColor = new Color(242, 166, 128, 255);

    @property({ tooltip: 'Bán kính răng cưa tròn ở đáy dải chính (px). 0 = đường thẳng.' })
    get scallopRadius() { return this._scallopRadius; }
    set scallopRadius(v: number) { this._scallopRadius = Math.max(0, v); this.redraw(); }
    @property private _scallopRadius = 12;

    // ---- shadow ----
    @property({ tooltip: 'Độ dày bóng mờ dưới cùng (px). 0 = tắt.' })
    get shadowThickness() { return this._shadowThickness; }
    set shadowThickness(v: number) { this._shadowThickness = Math.max(0, v); this.redraw(); }
    @property private _shadowThickness = 6;

    @property({ type: Color })
    get shadowColor() { return this._shadowColor; }
    set shadowColor(v: Color) { this._shadowColor = v.clone(); this.redraw(); }
    @property private _shadowColor = new Color(214, 128, 92, 90);

    onEnable() {
        this.redraw();
    }

    /** Tổng chiều cao đường viền (không tính phần răng cưa thò xuống). */
    get totalThickness(): number {
        return this._highlightThickness + this._mainThickness + this._shadowThickness;
    }

    redraw(): void {
        const g = this.getComponent(Graphics);
        if (!g) return;
        g.clear();

        const w = this._width > 0
            ? this._width
            : this.node.parent?.getComponent(UITransform)?.width ?? 1080;
        const x0 = -w / 2;
        let y = 0;   // vẽ từ mép trên xuống

        const band = (h: number, c: Color) => {
            if (h <= 0) return;
            g.fillColor = c;
            g.rect(x0, y - h, w, h);
            g.fill();
            y -= h;
        };

        band(this._highlightThickness, this._highlightColor);
        const mainBottom = y - this._mainThickness;
        band(this._mainThickness, this._mainColor);

        // Bóng: vẽ trước răng cưa để răng cưa nằm đè lên bóng
        if (this._shadowThickness > 0) {
            g.fillColor = this._shadowColor;
            g.rect(x0, mainBottom - this._shadowThickness, w, this._shadowThickness);
            g.fill();
        }

        // Răng cưa tròn: nửa hình tròn treo dưới đáy dải chính
        const r = this._scallopRadius;
        if (r > 0 && this._mainThickness > 0) {
            g.fillColor = this._mainColor;
            const n = Math.ceil(w / (r * 2)) + 1;
            for (let i = 0; i < n; i++) {
                g.circle(x0 + r + i * r * 2, mainBottom, r);
            }
            g.fill();
        }
    }
}
