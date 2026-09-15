import { _decorator, Color, color, ImageAsset, SpriteFrame, Texture2D } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Get the color of a pixel from a sprite frame.
 * @param {SpriteFrame} spriteFrame - The sprite frame.
 * @param {number} px - The x position of the pixel, normalized between 0 and 1.
 * @param {number} py - The y position of the pixel, normalized between 0 and 1.
 * @returns {Color} The color of the pixel.
 */
export function getColorFromImage(spriteFrame: SpriteFrame, px: number, py: number) {
    let sr = spriteFrame.texture as Texture2D;
    let h = sr.height;
    let w = sr.width;
    let image = sr.image;
    let refData = readImagePixels(image);
    let x = (px*w) | 0;
    let y = (py*h) | 0;
    return getPixel(x, y, w, refData);
}


export function getPixel(x: number, y: number, width: number, refData: Uint8ClampedArray) {
    let i = (y * width + x) * 4;
    return color(refData[i], refData[i + 1], refData[i + 2], refData[i + 3]);
}


export function readImagePixels(image: ImageAsset): Uint8ClampedArray | null {
    if (image.isCompressed) return null;

    const src = image.data;

    if (!src) return null;

    if (src instanceof Uint8Array || src instanceof Uint8ClampedArray) {
        return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src as any, 0, 0);

    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}


export function findNearestColor(
    target: Color,
    palette: Color[]
): { color: Color; index: number; distance: number } {

    let bestIndex = -1;
    let bestDist = Infinity;

    for (let i = 0; i < palette.length; i++) {
        const c = palette[i];

        const dr = target.r - c.r;
        const dg = target.g - c.g;
        const db = target.b - c.b;

        const dist = dr * dr + dg * dg + db * db;

        if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
        }
    }

    return {
        color: palette[bestIndex],
        index: bestIndex,
        distance: Math.sqrt(bestDist),
    };
}