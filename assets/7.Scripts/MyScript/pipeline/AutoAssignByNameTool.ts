import { _decorator, Component, Node } from 'cc';
import { EDITOR } from 'cc/env';
import { ItemController } from '../item/ItemController';

const { ccclass, property, executeInEditMode, menu } = _decorator;

const Ed: any = (globalThis as any).Editor;

@ccclass('AutoAssignByNameTool')
@executeInEditMode(true)
@menu('Pipeline/AutoAssignByNameTool')
export class AutoAssignByNameTool extends Component {

    @property({
        type: Node,
        tooltip: 'Node cha chứa danh sách Items (vd: ITEMS/Dynamic).'
    })
    itemParent: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Node cha chứa các Target Points (vd: TargetPosOfItem).'
    })
    targetParent: Node | null = null;

    @property({ tooltip: 'Tiền tố tên target (nếu có, vd: "target_")' })
    prefix = '';

    @property({ tooltip: 'Hậu tố tên target (nếu có, vd: "Place", "_target")' })
    suffix = '';

    @property({ tooltip: 'Tìm kiếm đệ quy cả các node con bên trong targetParent' })
    recursive = true;

    // ---- Nút bấm trong Inspector (tick checkbox để thực thi) ----

    @property({ tooltip: 'Tick để tự động gán Target Point cho tất cả Item theo tên' })
    get autoAssign(): boolean { return false; }
    set autoAssign(v: boolean) { if (v) this.assignTarget(); }

    @property({ tooltip: 'Tick để kiểm tra các Item chưa được gán Target Point' })
    get checkMissingTarget(): boolean { return false; }
    set checkMissingTarget(v: boolean) { if (v) this.doCheckMissingTarget(); }

    @property({ tooltip: 'Tick để kiểm tra các Item bị trùng tên' })
    get checkDuplicateName(): boolean { return false; }
    set checkDuplicateName(v: boolean) { if (v) this.doCheckDuplicateNames(); }

    // ======================================================== Methods

    /** Tự động gán targetPoint cho các ItemController */
    assignTarget(): void {
        if (!this.itemParent || !this.targetParent) {
            console.error('[AutoAssignTool] Thiếu Item Parent hoặc Target Parent!');
            return;
        }

        // Tạo map danh sách Target theo tên
        const targetDict = new Map<string, Node>();
        const collectTargets = (parent: Node) => {
            for (const child of parent.children) {
                if (!targetDict.has(child.name)) {
                    targetDict.set(child.name, child);
                }
                if (this.recursive && child.children.length > 0) {
                    collectTargets(child);
                }
            }
        };
        collectTargets(this.targetParent);

        let assignedCount = 0;
        let notFoundCount = 0;

        const processItems = (parent: Node) => {
            for (const item of parent.children) {
                const itemController = item.getComponent(ItemController);
                if (itemController) {
                    const targetName = `${this.prefix}${item.name}${this.suffix}`;
                    const target = targetDict.get(targetName);

                    if (target) {
                        itemController.targetPoint = target;
                        assignedCount++;
                        console.log(`[AutoAssignTool] Assign: "${item.name}" -> "${target.name}"`);
                    } else {
                        notFoundCount++;
                        console.warn(`[AutoAssignTool] Không tìm thấy target cho item: "${item.name}" (Target Name mong muốn: "${targetName}")`);
                    }
                }

                if (this.recursive && item.children.length > 0) {
                    processItems(item);
                }
            }
        };
        processItems(this.itemParent);

        console.log(`[AutoAssignTool] DONE! Đã gán thành công ${assignedCount} items.${notFoundCount > 0 ? ` (${notFoundCount} items không tìm thấy target)` : ''}`);

        if (EDITOR) {
            try {
                Ed?.Message?.send('scene', 'snapshot');
                console.log('[AutoAssignTool] Nhấn Ctrl+S để lưu scene.');
            } catch (e) {
                /* Snapshot editor */
            }
        }
    }

    /** Kiểm tra xem item nào chưa có targetPoint */
    doCheckMissingTarget(): void {
        if (!this.itemParent) {
            console.error('[AutoAssignTool] Thiếu Item Parent!');
            return;
        }

        let missingCount = 0;
        let totalCount = 0;

        const checkItems = (parent: Node) => {
            for (const item of parent.children) {
                const itemController = item.getComponent(ItemController);
                if (itemController) {
                    totalCount++;
                    if (!itemController.targetPoint) {
                        missingCount++;
                        console.warn(`[AutoAssignTool] Item chưa có targetPoint: "${item.name}"`);
                    }
                }
                if (this.recursive && item.children.length > 0) {
                    checkItems(item);
                }
            }
        };
        checkItems(this.itemParent);

        if (missingCount === 0) {
            console.log(`[AutoAssignTool] Tất cả ${totalCount} items đều ĐÃ CÓ targetPoint!`);
        } else {
            console.warn(`[AutoAssignTool] Có ${missingCount}/${totalCount} item CHƯA CÓ targetPoint!`);
        }
    }

    /** Kiểm tra xem có item nào bị trùng tên không */
    doCheckDuplicateNames(): void {
        if (!this.itemParent) {
            console.error('[AutoAssignTool] Thiếu Item Parent!');
            return;
        }

        const nameDict = new Map<string, Node[]>();

        const collectNames = (parent: Node) => {
            for (const item of parent.children) {
                const itemController = item.getComponent(ItemController);
                if (itemController) {
                    const list = nameDict.get(item.name) ?? [];
                    list.push(item);
                    nameDict.set(item.name, list);
                }
                if (this.recursive && item.children.length > 0) {
                    collectNames(item);
                }
            }
        };
        collectNames(this.itemParent);

        let duplicateCount = 0;
        for (const [name, list] of nameDict.entries()) {
            if (list.length > 1) {
                duplicateCount++;
                console.warn(`[AutoAssignTool] Trùng tên item: "${name}" (Số lượng: ${list.length})`);
            }
        }

        if (duplicateCount === 0) {
            console.log('[AutoAssignTool] Không có item nào bị trùng tên!');
        } else {
            console.warn(`[AutoAssignTool] Có ${duplicateCount} tên item bị trùng nhau!`);
        }
    }
}
