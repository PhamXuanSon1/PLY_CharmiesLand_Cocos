import { Component, Node } from 'cc';

/**
 * Tien ich cache component.
 * Chuyen doi tu static generic ComponentCache<T> cua Unity.
 * 
 * Trong Unity, lop nay cache cac component qua Transform de tranh goi GetComponent nhieu lan.
 * Trong Cocos Creator, getComponent() cung kha ton chi phi, nen viec cache van rat co ich.
 * 
 * Cach dung:
 *   const cache = new ComponentCache<MyComponent>(MyComponent);
 *   const comp = cache.get(someNode);
 *   cache.clearCache();
 * 
 * Luu y: Vi TypeScript khong ho tro static generic giong C#,
 * lop nay duoc cai dat duoi dang mot class generic co the khoi tao (instance) cho moi loai component.
 */
export class ComponentCache<T extends Component> {

    private cache: Map<Node, T | null> = new Map();
    private componentType: new (...args: any[]) => T;

    constructor(componentType: new (...args: any[]) => T) {
        this.componentType = componentType;
    }

    /**
     * Lay component tu cache, hoac tim va luu vao cache neu chua co.
     * @param node - Node can lay component
     * @returns Component duoc cache, hoac null neu khong tim thay
     */
    public get(node: Node): T | null {
        if (!this.cache.has(node)) {
            const component = node.getComponent(this.componentType);
            this.cache.set(node, component);
        }
        return this.cache.get(node) ?? null;
    }

    /**
     * Xoa toan bo du lieu trong cache.
     */
    public clearCache() {
        this.cache.clear();
    }
}
