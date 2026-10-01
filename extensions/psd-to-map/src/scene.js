'use strict';
/**
 * Scene process: build the node tree described by a psd2map / Unity-export
 * JSON directly into the open scene (no SceneBuilder component needed).
 *
 * Pass 1   create nodes + UITransform + Sprite
 * Pass 1.5 siblingIndex by sortingOrder
 * Pass 2   custom components + "@node:" references
 * Pass 3   active flags
 *
 * The user still presses Ctrl+S to save.
 */

const { join } = require('path');
module.paths.push(join(Editor.App.path, 'node_modules'));

function findByUuid(root, uuid) {
    if (root.uuid === uuid) {
        return root;
    }
    for (const c of root.children) {
        const hit = findByUuid(c, uuid);
        if (hit) {
            return hit;
        }
    }
    return null;
}

function loadAny(uuid) {
    const { assetManager } = require('cc');
    return new Promise((resolve) => {
        assetManager.loadAny({ uuid }, (err, asset) => resolve(err ? null : asset));
    });
}

function uniqueName(parent, name) {
    const taken = new Set(parent.children.map((c) => c.name));
    if (!taken.has(name)) {
        return name;
    }
    let i = 2;
    while (taken.has(name + '_' + i)) {
        i++;
    }
    return name + '_' + i;
}

class Builder {
    constructor(opts) {
        const cc = require('cc');
        this.cc = cc;
        this.o = opts;
        this.data = opts.data;
        this.K = (this.data.meta && this.data.meta.K) || 100;
        this.nodeMap = new Map();
        this.orderOf = new Map();
        this.frames = new Map();
        this.warnings = [];
        this.missing = [];
    }

    warn(msg) {
        this.warnings.push(msg);
        console.warn('[psd-to-map] ' + msg);
    }

    async loadFrames() {
        const entries = Object.entries(this.o.frames || {});
        await Promise.all(entries.map(async ([key, uuid]) => {
            const sf = await loadAny(uuid);
            if (sf) {
                this.frames.set(key, sf);
            }
        }));
    }

    // ---------------------------------------------------------- pass 1
    createNode(n, root) {
        const { Node } = this.cc;
        const parent = (n.parentPath ? this.nodeMap.get(n.parentPath) : root) || root;
        const fallback = n.path.substring(n.path.lastIndexOf('/') + 1);
        const name = uniqueName(parent, (typeof n.name === 'string' && n.name.trim()) || fallback);

        const node = new Node(name);
        // new Node() is on layer DEFAULT; the UI pipeline only draws UI_2D.
        node.layer = root.layer;
        node.setParent(parent);
        node.setPosition(n.pos[0], n.pos[1], n.pos[2]);
        node.setRotationFromEuler(n.rot[0], n.rot[1], n.rot[2]);
        node.setScale(n.scale[0], n.scale[1], n.scale[2]);

        if (n.sprite) {
            this.setupSprite(node, n.sprite);
        }
        if (n.spine) {
            this.setupSpine(node, n.spine);
        }
        this.nodeMap.set(n.path, node);
    }

    setupSprite(node, s) {
        const { Node, UITransform, Sprite, Color, Size } = this.cc;
        // PPU factor lives in contentSize, not scale, so children are not multiplied.
        const f = this.K / (s.ppu || this.K);
        const size = new Size(s.nativeSize[0] * f, s.nativeSize[1] * f);

        const ut = node.addComponent(UITransform);
        ut.setContentSize(size);
        ut.setAnchorPoint(s.pivot[0], s.pivot[1]);

        let host = node;
        if (this.o.spriteInChild) {
            host = new Node(node.name + (this.o.imageSuffix || 'Image'));
            host.layer = node.layer;
            host.setParent(node);
            const hut = host.addComponent(UITransform);
            hut.setContentSize(size);
            hut.setAnchorPoint(s.pivot[0], s.pivot[1]);
        }

        const sprite = host.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        const sf = this.frames.get(s.key);
        if (sf) {
            sprite.spriteFrame = sf;
        } else {
            this.missing.push(s.key);
            this.warn('Thiếu SpriteFrame "' + s.key + '" cho ' + node.name);
        }
        const c = s.color || [1, 1, 1, 1];
        sprite.color = new Color(c[0] * 255, c[1] * 255, c[2] * 255, c[3] * 255);

        if (s.flipX || s.flipY) {
            const sc = node.scale;
            node.setScale(s.flipX ? -sc.x : sc.x, s.flipY ? -sc.y : sc.y, sc.z);
        }
        this.orderOf.set(node, s.sortingOrder || 0);
    }

    setupSpine(node, s) {
        const { sp } = this.cc;
        const skel = node.addComponent(sp.Skeleton);
        skel.loop = s.loop;
        if (s.defaultAnim) {
            skel.animation = s.defaultAnim;
        }
        this.warn(node.name + ': cần gán tay skeletonData "' + s.skeletonData + '"');
    }

    // ---------------------------------------------------------- pass 1.5
    /** Lower order = drawn first = smaller siblingIndex. */
    sortSiblings(root) {
        const minOrder = (node) => {
            let m = this.orderOf.has(node) ? this.orderOf.get(node) : Number.POSITIVE_INFINITY;
            for (const c of node.children) {
                m = Math.min(m, minOrder(c));
            }
            return m;
        };
        const walk = (node) => {
            const kids = node.children.slice();
            if (kids.length > 1) {
                const keyed = kids.map((c, i) => ({ c, o: minOrder(c), i }));
                keyed.sort((a, b) => (a.o - b.o) || (a.i - b.i));
                keyed.forEach((e, idx) => e.c.setSiblingIndex(idx));
            }
            for (const c of node.children) {
                walk(c);
            }
        };
        walk(root);
    }

    // ---------------------------------------------------------- pass 2
    attachComponents(n) {
        if (!n.components || !n.components.length) {
            return;
        }
        const { js, CCClass } = this.cc;
        const node = this.nodeMap.get(n.path);
        if (!node) {
            return;
        }
        for (const cj of n.components) {
            const cls = js.getClassByName(cj.type);
            if (!cls) {
                this.warn('Chưa có class "' + cj.type + '" — bỏ qua (' + n.path + ')');
                continue;
            }
            const comp = node.addComponent(cls);
            const attrs = CCClass.Attr.getClassAttrs(cls) || {};
            for (const key of Object.keys(cj.fields || {})) {
                try {
                    comp[key] = this.convert(cj.fields[key], attrs[key + '$_$type'], comp[key], attrs[key + '$_$enumList']);
                } catch (e) {
                    this.warn(cj.type + '.' + key + ' gán lỗi: ' + e.message);
                }
            }
        }
    }

    convert(raw, declared, current, enumList) {
        const { Node, Component, Vec3, Color } = this.cc;
        // null in Unity usually means "assigned in Awake/Start": keep the component's own value.
        if (raw === null || raw === undefined) {
            return current === undefined ? null : current;
        }
        if (typeof raw === 'string' && raw.startsWith('@node:')) {
            const target = this.nodeMap.get(raw.substring(6));
            if (!target) {
                this.warn('Không tìm thấy node "' + raw.substring(6) + '"');
                return null;
            }
            if (declared && declared !== Node && declared.prototype instanceof Component) {
                return target.getComponent(declared);
            }
            return target;
        }
        if (typeof raw === 'string' && (raw.startsWith('@asset:') || raw.startsWith('@prefab:'))) {
            return current === undefined ? null : current;
        }
        if (Array.isArray(raw)) {
            const allNum = raw.every((x) => typeof x === 'number');
            const toColor = () => new Color(raw[0] * 255, raw[1] * 255, raw[2] * 255, (raw[3] === undefined ? 1 : raw[3]) * 255);
            if (allNum && (declared === Vec3 || (current instanceof Vec3 && raw.length >= 3))) {
                return new Vec3(raw[0], raw[1], raw[2]);
            }
            if (allNum && (declared === Color || current instanceof Color)) {
                return toColor();
            }
            return raw.map((x) => this.convert(x, declared));
        }
        if (typeof raw === 'string' && typeof current === 'number') {
            const hit = (enumList || []).find((e) => e.name === raw);
            if (hit) {
                return hit.value;
            }
        }
        return raw;
    }

    // ---------------------------------------------------------- run
    async run(parent) {
        const { Node, UITransform } = this.cc;
        await this.loadFrames();

        const root = new Node(uniqueName(parent, this.o.nodeName || 'Map'));
        root.layer = parent.layer;
        root.setParent(parent);
        const ab = this.data.meta && this.data.meta.artboardSize;
        const rut = root.addComponent(UITransform);
        if (ab) {
            rut.setContentSize(ab[0], ab[1]);
        }

        const nodes = this.data.nodes || [];
        for (const n of nodes) {
            this.createNode(n, root);
        }
        if (this.o.applySorting !== false) {
            this.sortSiblings(root);
        }
        for (const n of nodes) {
            this.attachComponents(n);
        }
        for (const n of nodes) {
            const node = this.nodeMap.get(n.path);
            if (node) {
                node.active = n.active !== false;
            }
        }
        for (const c of (this.data.conflicts || []).slice(0, 20)) {
            this.warn('Xung đột sortingOrder: ' + c.a + ' x ' + c.b);
        }
        return root;
    }
}

exports.methods = {
    async build(opts) {
        const { director, Canvas } = require('cc');
        const o = opts || {};
        const scene = director.getScene();
        if (!scene) {
            return { ok: false, error: 'Chưa mở scene nào.' };
        }
        if (!o.data || !Array.isArray(o.data.nodes)) {
            return { ok: false, error: 'JSON không đúng định dạng (thiếu "nodes").' };
        }

        let parent = o.parentUuid ? findByUuid(scene, o.parentUuid) : null;
        if (!parent) {
            const canvas = scene.getComponentInChildren(Canvas);
            parent = canvas ? canvas.node : null;
        }
        if (!parent) {
            return { ok: false, error: 'Scene không có Canvas. Map phải nằm dưới Canvas (layer UI_2D) thì sprite mới hiện.' };
        }

        let replaced = 0;
        if (o.replace) {
            for (const c of parent.children.slice()) {
                if (c.name === o.nodeName) {
                    c.destroy();
                    c.removeFromParent();
                    replaced++;
                }
            }
        }

        const b = new Builder(o);
        const root = await b.run(parent);

        try {
            Editor.Message.send('scene', 'snapshot');
        } catch (e) {
            /* undo only */
        }
        console.log('[psd-to-map] Dựng xong "' + parent.name + '/' + root.name + '": ' + b.nodeMap.size + ' node, '
            + b.frames.size + ' SpriteFrame. Nhấn Ctrl+S để lưu scene.');
        return {
            ok: true,
            node: parent.name + '/' + root.name,
            nodes: b.nodeMap.size,
            frames: b.frames.size,
            missing: b.missing.length,
            missingKeys: b.missing.slice(0, 20),
            warnings: b.warnings.length,
            replaced,
            uiLayer: (parent.layer & (1 << 25)) !== 0,
        };
    },
};

exports.load = function () {};
exports.unload = function () {};
