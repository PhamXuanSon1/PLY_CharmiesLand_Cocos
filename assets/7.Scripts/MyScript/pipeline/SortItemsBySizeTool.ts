/**
 * SortItemsBySizeTool — port từ SortHierarchyByColliderTool.cs (Unity Editor).
 *
 * Cocos không có EditorWindow, nên tool là component chạy trong Editor:
 * gắn vào 1 node bất kỳ -> kéo node cha vào ô `parentNode` -> tick nút -> Ctrl+S.
 * Tool sắp xếp siblingIndex của các node con theo DIỆN TÍCH collider.
 *
 * Kích thước đo theo thứ tự ưu tiên (giống Collider.bounds bên Unity):
 *   1. Collider2D trên node con (Box / Circle / Polygon), gộp cả collider ở cháu.
 *   2. Không có collider -> UITransform (contentSize).
 *   3. Không có gì -> size = 0, bị đẩy xuống cuối kèm cảnh báo.
 * Luôn nhân với world scale để so đúng kích thước hiển thị.
 */

import { _decorator, Component, Node, Collider2D, BoxCollider2D, CircleCollider2D,
         PolygonCollider2D, UITransform, Vec3, Rect } from 'cc';
import { EDITOR } from 'cc/env';

const { ccclass, property, executeInEditMode, menu } = _decorator;

const Ed: any = (globalThis as any).Editor;

@ccclass('SortItemsBySizeTool')
@executeInEditMode(true)
@menu('Pipeline/SortItemsBySizeTool')
export class SortItemsBySizeTool extends Component {

    /**
     * ⚠ KHÔNG đặt tên field này là `parent`: Node của Cocos có setter `parent`
     *   gọi thẳng vào setParent(), editor dump/apply property trùng tên sẽ ném
     *   "e.setParent is not a function".
     */
    @property({
        type: Node,
        tooltip: 'Node cha chứa các item cần sắp xếp. BẮT BUỘC phải kéo vào.',
    })
    parentNode: Node | null = null;

    // ---- Nút bấm trong Inspector (tick checkbox để thực thi) ----

    @property({ tooltip: 'Unity: SORT SMALL -> BIG. Nhỏ lên trên, to xuống dưới.' })
    get sortSmallToBig(): boolean { return false; }
    set sortSmallToBig(v: boolean) { if (v) this.sort(true); }

    @property({ tooltip: 'Unity: SORT BIG -> SMALL. To lên trên, nhỏ xuống dưới.' })
    get sortBigToSmall(): boolean { return false; }
    set sortBigToSmall(v: boolean) { if (v) this.sort(false); }

    @property({ tooltip: 'Tick để IN thứ tự + kích thước hiện tại ra Console (không sửa gì).' })
    get preview(): boolean { return false; }
    set preview(v: boolean) { if (v) this.doPreview(); }

    // ======================================================== Methods

    /** In thứ tự hiện tại kèm diện tích đo được. */
    doPreview(): void {
        const children = this.resolveChildren();
        if (!children) return;

        console.log(`[SortBySize] ${children.length} node con của "${this.parentNode!.name}":`);
        children.forEach((node, i) => {
            const s = this.measure(node);
            console.log(`   ${i}. "${node.name}" -> ${s.w.toFixed(1)} x ${s.h.toFixed(1)} = ${(s.w * s.h).toFixed(1)}`);
        });
    }

    /** Unity: SortHierarchy — sắp xếp siblingIndex theo diện tích collider. */
    sort(smallToBig: boolean): void {
        const children = this.resolveChildren();
        if (!children) return;

        // Đo trước 1 lần rồi mới sort — tránh gọi measure() nhiều lần trong comparator
        const areaOf = new Map<Node, number>();
        let noSizeCount = 0;
        for (const node of children) {
            const s = this.measure(node);
            const area = s.w * s.h;
            if (area <= 0) {
                noSizeCount++;
                console.warn(`[SortBySize] Không đo được kích thước: "${node.name}"`);
            }
            areaOf.set(node, area);
        }

        const sorted = children.slice().sort((a, b) => {
            const va = areaOf.get(a) ?? 0;
            const vb = areaOf.get(b) ?? 0;
            if (va === vb) return a.name.localeCompare(b.name);   // giữ thứ tự ổn định
            return smallToBig ? va - vb : vb - va;
        });

        sorted.forEach((node, i) => node.setSiblingIndex(i));

        console.log(`[SortBySize] DONE! Đã sắp xếp ${sorted.length} node `
            + `(${smallToBig ? 'SMALL -> BIG' : 'BIG -> SMALL'}):`);
        sorted.forEach((node, i) => {
            console.log(`   ${i}. "${node.name}" = ${(areaOf.get(node) ?? 0).toFixed(1)}`);
        });
        if (noSizeCount > 0) {
            console.warn(`[SortBySize] ${noSizeCount} node không đo được -> nằm ở đầu/cuối danh sách.`);
        }

        this.saveSnapshot();
    }

    // ======================================================== Helpers

    private resolveParent(): Node | null {
        if (this.parentNode && this.parentNode.isValid) return this.parentNode;
        console.error('[SortBySize] Chưa gán "Parent Node"! '
            + 'Kéo node cha chứa các item vào ô Parent Node trong Inspector.');
        return null;
    }

    private resolveChildren(): Node[] | null {
        const p = this.resolveParent();
        if (!p) return null;

        const children = p.children.filter(n => n && n.isValid);
        if (children.length === 0) {
            console.error(`[SortBySize] "${p.name}" không có node con nào để sắp xếp!`);
            return null;
        }
        return children;
    }

    /** Đo kích thước hiển thị (đã nhân world scale) của 1 node. */
    private measure(node: Node): { w: number; h: number } {
        let box: Rect | null = null;

        for (const col of node.getComponentsInChildren(Collider2D)) {
            const r = this.colliderRect(col);
            if (!r) continue;
            box = box ? box.union(box, r) : r;
        }

        // Không có collider -> đo bằng UITransform
        if (!box) {
            for (const ut of node.getComponentsInChildren(UITransform)) {
                const size = ut.contentSize;
                if (size.width <= 0 && size.height <= 0) continue;
                const r = new Rect(-size.width * ut.anchorX, -size.height * ut.anchorY,
                                   size.width, size.height);
                box = box ? box.union(box, r) : r;
            }
        }

        if (!box) return { w: 0, h: 0 };

        const s = new Vec3();
        node.getWorldScale(s);
        return { w: box.width * Math.abs(s.x), h: box.height * Math.abs(s.y) };
    }

    /** Rect (theo hệ toạ độ của node chứa collider) của 1 Collider2D. */
    private colliderRect(col: Collider2D): Rect | null {
        if (col instanceof BoxCollider2D) {
            return new Rect(col.offset.x - col.size.width / 2, col.offset.y - col.size.height / 2,
                            col.size.width, col.size.height);
        }

        if (col instanceof CircleCollider2D) {
            const d = col.radius * 2;
            return new Rect(col.offset.x - col.radius, col.offset.y - col.radius, d, d);
        }

        if (col instanceof PolygonCollider2D) {
            const pts = col.points;
            if (!pts || pts.length === 0) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of pts) {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            return new Rect(minX + col.offset.x, minY + col.offset.y, maxX - minX, maxY - minY);
        }

        return null;
    }

    private saveSnapshot(): void {
        if (!EDITOR) return;
        try {
            Ed?.Message?.send('scene', 'snapshot');
            console.log('[SortBySize] Nhấn Ctrl+S để lưu scene.');
        } catch (e) {
            /* không có editor thì thôi */
        }
    }
}
