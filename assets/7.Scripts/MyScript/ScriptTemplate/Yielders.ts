/**
 * Tien ich Yielders - ho tro cho/cho doi trong Cocos Creator.
 * 
 * Chuyen doi tu class Yielders static cua Unity (dung de cache doi tuong WaitForSeconds).
 * 
 * Trong Unity, Yielders cache WaitForSeconds/WaitForEndOfFrame/WaitForFixedUpdate
 * de tranh cap phat bo nho (GC) trong coroutines.
 * 
 * Trong Cocos Creator khong co coroutine voi yield. Thay vao do, ta cung cap
 * cac tien ich cho doi dua tren Promise va cac ham ho tro schedule.
 * 
 * Cach dung:
 *   await Yielders.wait(1.5);           // Cho 1.5 giay
 *   await Yielders.waitFrame();         // Cho den frame tiep theo
 *   await Yielders.waitFrames(5);       // Cho 5 frame
 *   
 *   // Hoac dung voi schedule cua Component:
 *   this.scheduleOnce(() => { ... }, Yielders.getSeconds(1.5));
 */
export class Yielders {

    /**
     * Tra ve mot Promise hoan thanh sau so giay truyen vao.
     * Tuong duong voi `yield return new WaitForSeconds(seconds)` trong Unity.
     * @param seconds - Thoi gian cho (giay)
     */
    public static wait(seconds: number): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(() => resolve(), seconds * 1000);
        });
    }

    /**
     * Tra ve mot Promise hoan thanh vao frame tiep theo.
     * Tuong duong voi `yield return null` hoac `yield return new WaitForEndOfFrame()` trong Unity.
     */
    public static waitFrame(): Promise<void> {
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    }

    /**
     * Tra ve mot Promise hoan thanh sau mot so frame nhat dinh.
     * @param frameCount - So frame can cho
     */
    public static waitFrames(frameCount: number): Promise<void> {
        return new Promise<void>((resolve) => {
            let count = 0;
            const step = () => {
                count++;
                if (count >= frameCount) {
                    resolve();
                } else {
                    requestAnimationFrame(step);
                }
            };
            requestAnimationFrame(step);
        });
    }

    /**
     * Lay gia tri giay (ham giu nguyen de tuong thich API).
     * Trong Unity, ham nay tra ve doi tuong WaitForSeconds duoc cache.
     * Trong Cocos, chi can dung truc tiep so giay voi schedule/scheduleOnce.
     * @param seconds - Thoi gian tinh bang giay
     * @returns Chinh gia tri giay do
     */
    public static getSeconds(seconds: number): number {
        return seconds;
    }
}
