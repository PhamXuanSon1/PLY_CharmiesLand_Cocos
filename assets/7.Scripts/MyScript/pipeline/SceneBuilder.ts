/**
 * SceneBuilder — dựng lại scene Unity trong Cocos Creator từ file JSON
 * do Tools/Cocos Export/Scene Exporter (CocosExportWindow.cs) xuất ra.
 *
 * Copy file này vào  assets/scripts/pipeline/SceneBuilder.ts
 * Xem COCOS_MIGRATION_PLAN.md mục 6 để biết schema và công thức.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DÙNG TRONG EDITOR (node nằm thật trong Hierarchy, lưu được cùng scene):
 *   1. Gán component này vào 1 node (vd "Root" dưới Canvas)
 *   2. Kéo file JSON vào ô "sceneJson"
 *   3. Tick "Build Now"  -> node hiện ra ngay trong Hierarchy
 *   4. Ctrl+S để lưu scene
 *   Tick "Clear Built" để xoá sạch và dựng lại.
 *
 * DÙNG LÚC RUNTIME (dựng khi Play):
 *   Bật "buildOnStart". Nếu đã bake node vào scene rồi thì TẮT nó đi,
 *   không thì sẽ dựng chồng lên nhau.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
    _decorator, Component, Node, UITransform, Sprite, SpriteFrame, Color, Vec3,
    JsonAsset, resources, CCClass, js, Size, sp, assetManager, Asset,
} from 'cc';
import { EDITOR } from 'cc/env';
import { MaterialType } from '../item/ItemController';


const { ccclass, property, executeInEditMode, menu } = _decorator;

/** Editor API chỉ tồn tại trong edit mode; truy cập kiểu này để khỏi vướng typing. */
const Ed: any = (globalThis as any).Editor;

// ---------------------------------------------------------------- types
interface SpriteJson {
    key: string; guid: string; ppu: number;
    nativeSize: [number, number];
    pivot: [number, number];
    color: [number, number, number, number];
    sortingOrder: number;
    flipX: boolean; flipY: boolean;
}
interface SpineJson { skeletonData: string | null; defaultAnim: string | null; skin: string | null; loop: boolean; }
interface ComponentJson { type: string; fields: Record<string, unknown>; }
interface NodeJson {
    path: string; parentPath: string | null; active: boolean;
    pos: [number, number, number];
    rot: [number, number, number];
    scale: [number, number, number];
    sprite?: SpriteJson; spine?: SpineJson;
    components?: ComponentJson[];
}
interface SceneJson {
    meta: { K: number; scene: string; exportRoot: string | null; exportInactive: boolean };
    assetMap: Record<string, string>;
    nodes: NodeJson[];
    conflicts: { a: string; rangeA: [number, number]; b: string; rangeB: [number, number] }[];
}

// Không có Units runtime: exporter đã quy đổi mọi khoảng cách sang pixel
// (pos, contentSize, snapDistance...). K chỉ còn dùng lúc dựng, xem buildK.

// ---------------------------------------------------------------- builder
@ccclass('SceneBuilder')
@executeInEditMode(true)
@menu('Pipeline/SceneBuilder')
export class SceneBuilder extends Component {

    @property({ type: JsonAsset, tooltip: 'File JSON do CocosExportWindow xuất ra' })
    sceneJson: JsonAsset | null = null;

    @property({
        type: Asset,
        tooltip: 'Kéo thả trực tiếp Folder chứa Sprite từ panel Assets vào đây (hoặc gõ ở ô Sprite Dir)'
    })
    spriteFolder: Asset | null = null;

    @property({ tooltip: 'Thư mục chứa sprite nếu không kéo folder (vd: 3.Sprites/Sprites2 hoặc art/PLY29_Level34/sprites)' })
    spriteDir = '3.Sprites/Sprites2';


    @property({ tooltip: 'Sắp xếp siblingIndex theo sortingOrder của Unity' })
    applySorting = true;

    @property({ tooltip: 'In cảnh báo chi tiết ra console' })
    verbose = true;

    @property({ tooltip: 'Tự dựng khi Play. TẮT nếu đã bake node vào scene, không thì dựng chồng.' })
    buildOnStart = false;

    // ---- nút bấm trong Inspector (checkbox tự nhả ra) ----

    @property({ tooltip: 'Tick để dựng node ngay trong Editor. Xong nhớ Ctrl+S lưu scene.' })
    get buildNow(): boolean { return false; }
    set buildNow(v: boolean) { if (v) void this.build(); }

    @property({ tooltip: 'Tick để xoá sạch node đã dựng dưới node này.' })
    get clearBuilt(): boolean { return false; }
    set clearBuilt(v: boolean) { if (v) this.clear(); }

    /** path → Node, dùng cho pass 2 và cho code gameplay tra cứu */
    readonly nodeMap = new Map<string, Node>();
    /** K của lần build hiện tại — chỉ dùng để tính contentSize từ nativeSize/ppu. */
    private buildK = 100;
    private frames = new Map<string, SpriteFrame>();
    private orderOf = new Map<Node, number>();

    start() {
        if (!EDITOR && this.buildOnStart) void this.build();
    }

    private getCleanSpriteDir(): string {
        let dir = (this.spriteDir || '').trim().replace(/\\/g, '/');
        dir = dir.replace(/^\/+|\/+$/g, '');
        return dir;
    }

    // ------------------------------------------------------------ main
    async build(): Promise<void> {
        if (!this.sceneJson) { console.error('[SceneBuilder] Chưa gán sceneJson'); return; }
        const data = this.sceneJson.json as SceneJson;

        this.clear();
        this.buildK = data.meta?.K ?? 100;

        await this.loadSpriteFrames();

        for (const n of data.nodes) this.createNode(n);          // pass 1 — cây + sprite
        if (this.applySorting) this.sortSiblings();              // pass 1.5 — siblingIndex
        for (const n of data.nodes) this.attachComponents(n);    // pass 2 — component + @node:
        for (const n of data.nodes) {                            // pass 3 — active
            const node = this.nodeMap.get(n.path);
            if (node) node.active = n.active;
        }

        console.log(`[SceneBuilder] Dựng xong "${data.meta.scene}"`
            + `${data.meta.exportRoot ? ` (nhánh ${data.meta.exportRoot})` : ''}`
            + `: ${this.nodeMap.size} node, K=${this.buildK}`);

        if (data.conflicts?.length) {
            console.warn(`[SceneBuilder] ${data.conflicts.length} cặp xung đột sortingOrder — kiểm tra bằng mắt:`);
            for (const c of data.conflicts.slice(0, 20)) {
                console.warn(`   [${c.rangeA}] ${c.a}\n      x [${c.rangeB}] ${c.b}`);
            }
        }

        if (EDITOR) {
            console.log('[SceneBuilder] Đang ở Editor — nhấn Ctrl+S để lưu node vào scene.');
            try { Ed?.Message?.send('scene', 'snapshot'); } catch { /* để Ctrl+Z được */ }
        }
    }

    /** Xoá sạch node con đã dựng. */
    clear(): void {
        for (const c of [...this.node.children]) c.destroy();
        this.node.removeAllChildren();
        this.nodeMap.clear();
        this.orderOf.clear();
    }

    // ------------------------------------------------------------ nạp SpriteFrame
    private loadSpriteFrames(): Promise<void> {
        return EDITOR ? this.loadFramesFromAssetDb() : this.loadFramesFromResources();
    }

    /** Runtime: resources bundle. */
    private loadFramesFromResources(): Promise<void> {
        return new Promise((resolve) => {
            let dir = this.getCleanSpriteDir();
            if (dir.startsWith('assets/resources/')) dir = dir.substring('assets/resources/'.length);
            else if (dir.startsWith('resources/')) dir = dir.substring('resources/'.length);
            resources.loadDir(dir, SpriteFrame, (err, assets) => {
                if (err) { console.error('[SceneBuilder] Lỗi load sprite:', err); resolve(); return; }
                this.frames.clear();
                for (const sf of assets) this.frames.set(sf.name, sf);
                console.log(`[SceneBuilder] Đã load ${assets.length} SpriteFrame từ resources/${dir}`);
                resolve();
            });
        });
    }

    /**
     * Edit mode: hỏi asset-db của Editor.
     * `resources.loadDir` không đáng tin ở edit mode, nên phải đi đường này.
     */
    private async loadFramesFromAssetDb(): Promise<void> {
        this.frames.clear();
        if (!Ed?.Message?.request) {
            console.error('[SceneBuilder] Không truy cập được Editor API.');
            return;
        }

        let pattern = '';

        // 1. Ưu tiên lấy từ spriteFolder nếu có kéo thả vào ô
        if (this.spriteFolder) {
            const uuid = (this.spriteFolder as any)._uuid || (this.spriteFolder as any).uuid;
            if (uuid) {
                try {
                    const info = await Ed.Message.request('asset-db', 'query-asset-info', { uuid });
                    if (info && (info.url || info.path)) {
                        const url = info.url || info.path;
                        pattern = `${url}/**/*`;
                    }
                } catch (e) {
                    console.warn('[SceneBuilder] Lỗi query-asset-info từ spriteFolder:', e);
                }
            }
        }

        // 2. Nếu không kéo folder, dùng đường dẫn text từ spriteDir
        if (!pattern) {
            let dir = this.getCleanSpriteDir();
            if (dir.startsWith('db://')) {
                pattern = `${dir}/**/*`;
            } else if (dir.startsWith('assets/')) {
                pattern = `db://${dir}/**/*`;
            } else {
                pattern = `db://assets/${dir}/**/*`;
            }
        }

        let infos: any[] = [];
        try {
            infos = await Ed.Message.request('asset-db', 'query-assets',
                { pattern, ccType: 'cc.SpriteFrame' }) ?? [];
        } catch (e) {
            console.error('[SceneBuilder] query-assets lỗi:', e);
            return;
        }

        // Fallback kiểm tra trong db://assets/resources/ nếu query trực tiếp không ra kết quả
        if (infos.length === 0 && !this.spriteFolder) {
            let dir = this.getCleanSpriteDir();
            if (!dir.startsWith('assets/') && !dir.startsWith('resources/')) {
                const fallbackPattern = `db://assets/resources/${dir}/**/*`;
                try {
                    const fallbackInfos = await Ed.Message.request('asset-db', 'query-assets',
                        { pattern: fallbackPattern, ccType: 'cc.SpriteFrame' }) ?? [];
                    if (fallbackInfos.length > 0) {
                        infos = fallbackInfos;
                        pattern = fallbackPattern;
                    }
                } catch (e) {}
            }
        }


        await Promise.all(infos.map((info) => new Promise<void>((resolve) => {
            const key = SceneBuilder.keyFromAssetPath(info.url ?? info.path ?? '');
            assetManager.loadAny({ uuid: info.uuid }, (err: Error | null, asset: SpriteFrame) => {
                if (!err && asset) {
                    if (key) this.frames.set(key, asset);
                    if (asset.name) this.frames.set(asset.name, asset);
                    if (info.name && info.name !== 'spriteFrame') this.frames.set(info.name, asset);
                }
                resolve();
            });
        })));

        console.log(`[SceneBuilder] Đã load ${this.frames.size} SpriteFrame từ asset-db (${pattern})`);
    }

    /** 'db://assets/3.Sprites/Sprites2/pillow_1.png/spriteFrame' hoặc 'f:\\...\\pillow_1.png' → 'pillow_1' */
    private static keyFromAssetPath(p: string): string {
        if (!p) return '';
        let s = p.replace(/\\/g, '/');
        if (s.endsWith('/spriteFrame')) s = s.slice(0, -'/spriteFrame'.length);
        const atIdx = s.indexOf('@');
        if (atIdx >= 0) s = s.substring(0, atIdx);
        const slash = s.lastIndexOf('/');
        if (slash >= 0) s = s.substring(slash + 1);
        const dot = s.lastIndexOf('.');
        return dot > 0 ? s.substring(0, dot) : s;
    }


    // ------------------------------------------------------------ pass 1
    private createNode(n: NodeJson): void {
        const name = n.path.substring(n.path.lastIndexOf('/') + 1);
        const node = new Node(name);

        // ⚠ BẮT BUỘC: new Node() cho ra layer DEFAULT, mà pipeline UI của Cocos
        //   chỉ vẽ node UI_2D -> sprite dựng bằng code sẽ KHÔNG hiện, dù Scene view
        //   vẫn thấy đủ và camera vẫn ghi nhận draw call.
        //   Kế thừa layer của node gắn SceneBuilder (nằm dưới Canvas -> UI_2D).
        node.layer = this.node.layer;

        const parent = n.parentPath ? this.nodeMap.get(n.parentPath) : this.node;
        node.setParent(parent ?? this.node);

        node.setPosition(n.pos[0], n.pos[1], n.pos[2]);
        node.setRotationFromEuler(n.rot[0], n.rot[1], n.rot[2]);
        node.setScale(n.scale[0], n.scale[1], n.scale[2]);

        if (n.sprite) this.setupSprite(node, n.sprite);
        if (n.spine) this.setupSpine(node, n.spine);

        this.nodeMap.set(n.path, node);
    }

    private setupSprite(node: Node, s: SpriteJson): void {
        const ut = node.addComponent(UITransform);

        // ⚠ Hệ số PPU nằm ở contentSize, KHÔNG nằm ở node.scale —
        //   để node con không bị nhân theo hệ số của node cha.
        const f = this.buildK / s.ppu;
        ut.setContentSize(new Size(s.nativeSize[0] * f, s.nativeSize[1] * f));
        ut.setAnchorPoint(s.pivot[0], s.pivot[1]);

        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;

        const sf = this.frames.get(s.key);
        if (sf) sprite.spriteFrame = sf;
        else if (this.verbose) console.warn(`[SceneBuilder] Thiếu SpriteFrame "${s.key}" cho ${node.name}`);

        sprite.color = new Color(s.color[0] * 255, s.color[1] * 255, s.color[2] * 255, s.color[3] * 255);

        if (s.flipX || s.flipY) {
            const sc = node.scale;
            node.setScale(s.flipX ? -sc.x : sc.x, s.flipY ? -sc.y : sc.y, sc.z);
        }

        this.orderOf.set(node, s.sortingOrder);
    }

    private setupSpine(node: Node, s: SpineJson): void {
        // Spine không mang qua được bằng JSON — chỉ tạo component rỗng,
        // skeletonData phải gán tay trong editor (plan mục 6.6).
        const skel = node.addComponent(sp.Skeleton);
        skel.loop = s.loop;
        if (s.defaultAnim) skel.animation = s.defaultAnim;
        if (this.verbose) console.warn(`[SceneBuilder] ${node.name}: cần gán tay skeletonData "${s.skeletonData}"`);
    }

    // ------------------------------------------------------------ pass 1.5
    /** Order thấp = render trước = nằm dưới = siblingIndex nhỏ. */
    private sortSiblings(): void {
        const minOrder = (node: Node): number => {
            let m = this.orderOf.get(node) ?? Number.POSITIVE_INFINITY;
            for (const c of node.children) m = Math.min(m, minOrder(c));
            return m;
        };
        const walk = (node: Node) => {
            const kids = [...node.children];
            if (kids.length > 1) {
                const keyed = kids.map((c, i) => ({ c, o: minOrder(c), i }));
                keyed.sort((a, b) => (a.o - b.o) || (a.i - b.i));   // sort ổn định
                keyed.forEach((e, idx) => e.c.setSiblingIndex(idx));
            }
            for (const c of node.children) walk(c);
        };
        walk(this.node);
    }

    // ------------------------------------------------------------ pass 2
    private attachComponents(n: NodeJson): void {
        if (!n.components?.length) return;
        const node = this.nodeMap.get(n.path);
        if (!node) return;

        for (const cj of n.components) {
            const cls = js.getClassByName(cj.type) as unknown as (typeof Component) | undefined;
            if (!cls) {
                if (this.verbose) console.warn(`[SceneBuilder] Chưa có class "${cj.type}" — bỏ qua (${n.path})`);
                continue;
            }

            const comp = node.addComponent(cls as never) as unknown as Record<string, unknown>;
            const attrs = CCClass.Attr.getClassAttrs(cls) as Record<string, unknown>;

            for (const [key, raw] of Object.entries(cj.fields)) {
                try {
                    const declared = attrs[`${key}$_$type`] as (new () => unknown) | undefined;
                    comp[key] = this.convert(raw, declared, comp[key]);
                } catch (e) {
                    if (this.verbose) console.warn(`[SceneBuilder] ${cj.type}.${key} gán lỗi:`, e);
                }
            }
        }
    }

    /** Đổi giá trị JSON sang kiểu Cocos, dựa vào kiểu khai báo @property hoặc giá trị mặc định. */
    private convert(raw: unknown, declared?: new () => unknown, current?: unknown): unknown {
        // ⚠ null trong scene Unity thường nghĩa là "gán lúc runtime trong Awake/Start"
        //   (itemGraphic, itemMovement, col, currentHolderSlot...). Ghi đè bằng null
        //   sẽ xoá mất giá trị component vừa tự tính -> giữ nguyên giá trị hiện có.
        if (raw === null || raw === undefined) return current ?? null;

        if (typeof raw === 'string' && raw.startsWith('@node:')) {
            const target = this.nodeMap.get(raw.substring(6));
            if (!target) {
                if (this.verbose) console.warn(`[SceneBuilder] Không tìm thấy node "${raw.substring(6)}"`);
                return null;
            }
            if (declared && declared !== (Node as unknown as new () => unknown)
                && (declared as unknown as typeof Component).prototype instanceof Component) {
                return target.getComponent(declared as unknown as typeof Component);
            }
            return target;
        }

        // asset / prefab — phải gán tay
        if (typeof raw === 'string' && (raw.startsWith('@asset:') || raw.startsWith('@prefab:'))) {
            return current ?? null;
        }

        if (Array.isArray(raw)) {
            const allNum = raw.every((x) => typeof x === 'number');
            if (allNum && declared === (Vec3 as unknown as new () => unknown)) {
                return new Vec3(raw[0] as number, raw[1] as number, raw[2] as number);
            }
            if (allNum && declared === (Color as unknown as new () => unknown)) {
                const [r, g, b, a] = raw as number[];
                return new Color(r * 255, g * 255, b * 255, (a ?? 1) * 255);
            }
            if (allNum && current instanceof Vec3 && raw.length >= 3) {
                return new Vec3(raw[0] as number, raw[1] as number, raw[2] as number);
            }
            if (allNum && current instanceof Color) {
                const [r, g, b, a] = raw as number[];
                return new Color(r * 255, g * 255, b * 255, (a ?? 1) * 255);
            }
            return raw.map((x) => this.convert(x, declared));
        }

        if (typeof raw === 'string') {
            if (typeof current === 'number') {
                const enumVal = (MaterialType as any)[raw];
                if (typeof enumVal === 'number') return enumVal;
            }
            return raw;
        }

        return raw;
    }

}
