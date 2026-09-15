/**
 * PsdMapExporter — chạy tools/psd2map.py ngay trong Editor: PSD -> PNG từng layer + JSON.
 *
 * CÁCH DÙNG:
 *   1. Gán component này vào 1 node bất kỳ
 *   2. Kéo file .psd (trong assets) vào ô "psd"
 *   3. Tick "Export"  -> xuất ra <outDir>/sprites/*.png và <outDir>/<tên psd>.json, refresh asset-db
 *
 * Yêu cầu máy có python + `pip install psd-tools pillow`.
 * Chỉ chạy được trong Editor (dùng child_process của Electron).
 */

import { _decorator, Component, Asset } from 'cc';
import { EDITOR } from 'cc/env';

const { ccclass, property, executeInEditMode, menu } = _decorator;

const Ed: any = (globalThis as any).Editor;
/** require của Node/Electron trong tiến trình scene; không có ở runtime. */
const nodeRequire: any = (globalThis as any).require ?? (globalThis as any).__non_webpack_require__;

@ccclass('PsdMapExporter')
@executeInEditMode(true)
@menu('Pipeline/PsdMapExporter')
export class PsdMapExporter extends Component {

    @property({ type: Asset, tooltip: 'File .psd nằm trong assets (kéo từ panel Assets)' })
    psd: Asset | null = null;

    @property({ tooltip: 'Lệnh python (python / py / python3 / đường dẫn đầy đủ)' })
    pythonCmd = 'python';

    @property({ tooltip: 'Đường dẫn script, tương đối từ thư mục project' })
    scriptPath = 'tools/psd2map.py';

    @property({ tooltip: 'Tên artboard cần xuất. Để trống = artboard đầu tiên' })
    artboard = '';

    @property({ tooltip: 'Regex tên layer bỏ qua (vd: ^Curves|^Hue). Để trống = xuất hết' })
    skipRegex = '^Curves|^Hue';

    @property({ tooltip: 'Thư mục xuất (tương đối từ project). Để trống = assets/3.Sprites/<tên psd>' })
    outDir = '';

    @property({ tooltip: 'Xuất cả layer đang ẩn' })
    includeHidden = false;

    // ---- nút bấm ----
    @property({ tooltip: 'Tick để xuất PSD -> PNG/JSON' })
    get exportNow(): boolean { return false; }
    set exportNow(v: boolean) { if (v) void this.run(); }

    private busy = false;

    async run(): Promise<void> {
        if (!EDITOR) { console.error('[PsdMapExporter] Chỉ chạy trong Editor.'); return; }
        if (this.busy) { console.warn('[PsdMapExporter] Đang chạy, đợi xong đã.'); return; }
        if (!this.psd) { console.error('[PsdMapExporter] Chưa gán file psd.'); return; }
        if (!nodeRequire) { console.error('[PsdMapExporter] Không truy cập được require của Node trong Editor.'); return; }

        this.busy = true;
        try {
            // kéo nhầm sub-asset (texture/spriteFrame) thì uuid có đuôi "@xxxx" -> lấy asset gốc
            const psdUuid = String((this.psd as any)._uuid || (this.psd as any).uuid || '').split('@')[0];
            const info = await Ed.Message.request('asset-db', 'query-asset-info', psdUuid);
            const psdFile: string = info?.file;
            if (!psdFile) { console.error('[PsdMapExporter] Không lấy được đường dẫn file psd.'); return; }

            const projectRoot: string = Ed.Project.path;
            const path = nodeRequire('path');
            const stem = path.basename(psdFile, path.extname(psdFile));
            const outDir = this.outDir.trim() || `assets/3.Sprites/${stem}`;

            const args = [path.join(projectRoot, this.scriptPath), psdFile, '--out', path.join(projectRoot, outDir), '-q'];
            if (this.artboard.trim()) args.push('--artboard', this.artboard.trim());
            if (this.skipRegex.trim()) args.push('--skip', this.skipRegex.trim());
            if (this.includeHidden) args.push('--hidden');

            console.log(`[PsdMapExporter] ${this.pythonCmd} ${args.map((a) => `"${a}"`).join(' ')}`);
            const { code, stdout, stderr } = await this.spawn(this.pythonCmd, args, projectRoot);
            if (stdout.trim()) console.log('[psd2map]\n' + stdout.trim());
            if (code !== 0) {
                console.error(`[PsdMapExporter] python thoát mã ${code}\n${stderr}`);
                return;
            }

            // Cocos nhận file mới
            const dbUrl = `db://${outDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}`;
            await Ed.Message.request('asset-db', 'refresh-asset', dbUrl);
            console.log(`[PsdMapExporter] Đã refresh ${dbUrl}`);

        } catch (e) {
            console.error('[PsdMapExporter] Lỗi:', e);
        } finally {
            this.busy = false;
        }
    }

    private spawn(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
        return new Promise((resolve) => {
            const cp = nodeRequire('child_process');
            const p = cp.spawn(cmd, args, { cwd, windowsHide: true });
            let stdout = '', stderr = '';
            p.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
            p.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
            p.on('error', (err: Error) => resolve({ code: -1, stdout, stderr: String(err) }));
            p.on('close', (code: number) => resolve({ code, stdout, stderr }));
        });
    }
}
