import * as path from 'path';
import * as fs from 'fs-extra';
// @ts-ignore
import AdmZip = require('adm-zip');
import { CHANNEL, CHANNELS_REQUIRING_ZIP, CompressionType, IProductInfo } from './channels';

export const FILE_EXTENSIONS = {
    // .html/.css được đọc & patch riêng (không đóng vào zip asset)
    EXCLUDE: ['.html', '.css'],
    IMAGE: ['.png', '.jpg', '.jpeg'],
    AUDIO: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'],
};

export interface ICompressionOptions {
    type: CompressionType;
    quality: number;
}

export interface IAudioOptions {
    enabled: boolean;
    bitrate: number;
}

interface ICollectedFile {
    path: string;
    data: Buffer;
}

let sharpLib: any = null;
try {
    // sharp là native module: có thể build lệch ABI với Electron của Cocos Creator Editor.
    // Nếu load lỗi, tự động fallback dùng file ảnh gốc (không nén) thay vì làm sập cả build.
    sharpLib = require('sharp');
    console.log('[playable-ads-builder] Đã load "sharp" thành công, sẽ nén ảnh khi build.');
} catch (err) {
    console.warn('[playable-ads-builder] Không load được "sharp", ảnh sẽ giữ nguyên (không nén webp).', err);
}

let ffmpegLib: any = null;
try {
    ffmpegLib = require('fluent-ffmpeg');
    const ffmpegStaticPath = require('ffmpeg-static');
    if (ffmpegStaticPath) {
        ffmpegLib.setFfmpegPath(ffmpegStaticPath);
    }
} catch (err) {
    console.warn('[playable-ads-builder] Không load được "fluent-ffmpeg"/"ffmpeg-static", audio sẽ giữ nguyên (không nén mp3).', err);
}

async function compressImage(filePath: string, compression: ICompressionOptions): Promise<Buffer> {
    const raw = await fs.readFile(filePath);
    if (!sharpLib) {
        console.warn(`[playable-ads-builder] Bỏ qua nén ảnh (sharp chưa load được): ${filePath}`);
        return raw;
    }
    if (compression.type === CompressionType.None) {
        return raw;
    }
    try {
        const options = compression.type === CompressionType.Lossless ? { lossless: true } : { quality: compression.quality };
        const compressed: Buffer = await sharpLib(filePath).webp(options).toBuffer();
        const smaller = compressed.length < raw.length;
        console.log(`[playable-ads-builder] Nén ảnh ${path.basename(filePath)}: ${raw.length} -> ${compressed.length} byte${smaller ? '' : ' (không nhỏ hơn, giữ ảnh gốc)'}`);
        return smaller ? compressed : raw;
    } catch (err) {
        console.warn(`[playable-ads-builder] Nén ảnh thất bại, dùng ảnh gốc: ${filePath}`, err);
        return raw;
    }
}

async function compressAudio(filePath: string, tempDir: string, bitrate: number): Promise<{ relativeExt: string; data: Buffer }> {
    if (!ffmpegLib) {
        return { relativeExt: path.extname(filePath), data: await fs.readFile(filePath) };
    }
    try {
        await fs.ensureDir(tempDir);
        const outFile = path.join(tempDir, `${path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_')}_${Date.now()}_${Math.round(Math.random() * 1e6)}.mp3`);
        await new Promise<void>((resolve, reject) => {
            ffmpegLib(filePath).audioBitrate(bitrate).toFormat('mp3').on('error', reject).on('end', () => resolve()).save(outFile);
        });
        return { relativeExt: '.mp3', data: await fs.readFile(outFile) };
    } catch (err) {
        console.warn(`[playable-ads-builder] Nén audio thất bại, dùng file gốc: ${filePath}`, err);
        return { relativeExt: path.extname(filePath), data: await fs.readFile(filePath) };
    }
}

/** Duyệt đệ quy thư mục web-mobile output, nén ảnh/audio theo cấu hình, trả về danh sách file sẽ đóng vào zip */
async function walk(dir: string, root: string, compression: ICompressionOptions, audio: IAudioOptions, tempDir: string): Promise<ICollectedFile[]> {
    const entries = await fs.readdir(dir);
    const results = await Promise.all(entries.map(async entry => {
        const full = path.join(dir, entry);
        if ((await fs.stat(full)).isDirectory()) {
            return walk(full, root, compression, audio, tempDir);
        }
        const ext = path.extname(full).toLowerCase();
        const relPath = path.relative(root, full).replace(/\\/g, '/');
        if (FILE_EXTENSIONS.EXCLUDE.includes(ext)) {
            return null;
        }
        if (FILE_EXTENSIONS.IMAGE.includes(ext)) {
            return { path: relPath, data: await compressImage(full, compression) };
        }
        if (FILE_EXTENSIONS.AUDIO.includes(ext) && audio.enabled) {
            const { relativeExt, data } = await compressAudio(full, path.join(tempDir, '_audioCompressed'), audio.bitrate);
            const newRelPath = relativeExt === ext ? relPath : `${relPath.slice(0, -ext.length)}${relativeExt}`;
            return { path: newRelPath, data };
        }
        return { path: relPath, data: await fs.readFile(full) };
    }));
    return results.flat().filter((f): f is ICollectedFile => f !== null);
}

export async function collectWebMobileFiles(webMobileDir: string, compression: ICompressionOptions, audio: IAudioOptions, tempDir: string): Promise<ICollectedFile[]> {
    return walk(webMobileDir, webMobileDir, compression, audio, tempDir);
}

// --- base122: mã hoá gọn cho các kênh nhúng zip.js trực tiếp vào <script> inline (không zip riêng) ---
const BASE122_ILLEGAL_BYTES = [0, 10, 13, 34, 38, 92, 60];
function base122Encode(input: Buffer): Buffer {
    let byteIndex = 0;
    let bitOffset = 0;
    const out: number[] = [];
    function nextSeptet(): number | false {
        if (byteIndex >= input.length) {
            return false;
        }
        let value = (254 >>> bitOffset & input[byteIndex]) << bitOffset;
        value >>= 1;
        bitOffset += 7;
        if (bitOffset < 8) {
            return value;
        }
        bitOffset -= 8;
        byteIndex++;
        if (byteIndex >= input.length) {
            return value;
        }
        let extra = 65280 >>> bitOffset & input[byteIndex] & 255;
        extra >>= 8 - bitOffset;
        return value | extra;
    }
    while (true) {
        const septet = nextSeptet();
        if (septet === false) {
            break;
        }
        const illegalIndex = BASE122_ILLEGAL_BYTES.indexOf(septet);
        if (illegalIndex !== -1) {
            let next = nextSeptet();
            let lead = 194;
            if (next === false) {
                lead |= 28;
                next = septet;
            } else {
                lead |= (illegalIndex & 7) << 2;
            }
            lead |= (next & 64) > 0 ? 1 : 0;
            const trail = next & 63 | 128;
            out.push(lead);
            out.push(trail);
        } else {
            out.push(septet);
        }
    }
    return Buffer.from(out);
}

export function getPlayableEnginePath(): string {
    return path.join(__dirname, '..', 'playable-engine');
}

async function getChannelSdkScript(channel: CHANNEL, product: IProductInfo): Promise<string> {
    if (!Object.values(CHANNEL).includes(channel)) {
        throw new Error(`Kênh "${channel}" không hợp lệ.`);
    }
    const sdkPath = path.join(getPlayableEnginePath(), 'channels', `${channel}.js`);
    let content = await fs.readFile(sdkPath, 'utf-8');
    // Format thật trong channels/*.js là `google_url: "",` (key không nháy, value nháy kép),
    // KHÔNG phải `'google_url':''` như code gốc PlayableBuilder giả định - regex cũ không bao
    // giờ khớp nên link luôn bị để trống dù đã điền trong panel Build. Dùng hàm thay thế (không
    // phải chuỗi template trực tiếp) để tránh URL chứa ký tự "$" bị hiểu nhầm thành pattern đặc
    // biệt của String.replace.
    content = content.replace(/google_url:\s*""/, () => `google_url: "${product.googleUrl}"`);
    content = content.replace(/apple_url:\s*""/, () => `apple_url: "${product.appleUrl}"`);
    return content;
}

export type OnZipProgress = (current: number, total: number) => void;

/**
 * Với mỗi channel: đóng gói asset đã nén + BingoEngine.js + PlayableSDK.js (adapter riêng kênh)
 * thành 1 zip, encode base64/base122, ghi ra `${channel}.zip.js` trong `tempDir`.
 */
export async function generateChannelZipJs(files: ICollectedFile[], channels: CHANNEL[], product: IProductInfo, tempDir: string, onProgress?: OnZipProgress) {
    await fs.ensureDir(tempDir);
    const bingoEngineContent = await fs.readFile(path.join(getPlayableEnginePath(), 'BingoEngine.js'), 'utf-8');
    let done = 0;
    for (const channel of channels) {
        const zip = new AdmZip();
        for (const f of files) {
            zip.addFile(f.path, f.data);
        }
        zip.addFile('BingoEngine.js', Buffer.from(bingoEngineContent, 'utf-8'));
        const sdkScript = await getChannelSdkScript(channel, product);
        zip.addFile('PlayableSDK.js', Buffer.from(sdkScript, 'utf-8'));
        const zipBuffer: Buffer = zip.toBuffer();
        const useBase64 = CHANNELS_REQUIRING_ZIP.includes(channel);
        const encoded = useBase64 ? zipBuffer.toString('base64') : base122Encode(zipBuffer).toString('utf-8');
        const jsContent = useBase64
            ? `window.__zipEncoding="base64";window.__zip=${JSON.stringify(encoded)};`
            : `window.__zipEncoding="base122";window.__zip="${encoded}";`;
        await fs.writeFile(path.join(tempDir, `${channel}.zip.js`), jsContent, 'utf-8');
        done++;
        onProgress?.(done, channels.length);
    }
}
