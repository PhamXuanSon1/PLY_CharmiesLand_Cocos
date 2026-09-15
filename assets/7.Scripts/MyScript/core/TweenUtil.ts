/**
 * TweenUtil — thay DOTween.
 *
 * Ba thứ Cocos KHÔNG có sẵn mà bản Unity phụ thuộc:
 *   - DOJump              -> jumpTo()      (quỹ đạo parabol)
 *   - DOTween.IsTweening  -> isTweening()  (WorldScrollManager dùng để bỏ qua
 *                                           item đang animate; thiếu là item giật)
 *   - DOTween.To          -> valueTo()
 *
 * Xem COCOS_MIGRATION_PLAN.md mục 4.6.
 */

import { Node, Vec3, tween, Tween, Component } from 'cc';

export class TweenUtil {

    /** Đếm số tween đang chạy trên từng node. */
    private static running = new Map<Node, number>();

    static isTweening(node: Node): boolean {
        return (TweenUtil.running.get(node) ?? 0) > 0;
    }

    private static mark(node: Node): void {
        TweenUtil.running.set(node, (TweenUtil.running.get(node) ?? 0) + 1);
    }

    private static unmark(node: Node): void {
        const n = (TweenUtil.running.get(node) ?? 1) - 1;
        if (n <= 0) TweenUtil.running.delete(node);
        else TweenUtil.running.set(node, n);
    }

    /** Thay transform.DOKill() */
    static killAll(node: Node): void {
        Tween.stopAllByTarget(node);
        TweenUtil.running.delete(node);
    }

    // ---------------------------------------------------------------- move
    static moveTo(node: Node, worldPos: Vec3, duration: number,
                  easing: string = 'quadOut', onComplete?: () => void): void {
        TweenUtil.mark(node);
        tween(node)
            .to(duration, { worldPosition: worldPos.clone() }, { easing: easing as never })
            .call(() => { TweenUtil.unmark(node); onComplete?.(); })
            .start();
    }

    /**
     * Thay DOJump(pos, power, numJumps, duration).
     * Cocos không có sẵn nên tự dựng: X/Y nội suy tuyến tính, cộng thêm parabol theo Y.
     */
    static jumpTo(node: Node, worldPos: Vec3, height: number, jumps: number,
                  duration: number, easing: string = 'backOut', onComplete?: () => void): void {
        const from = node.worldPosition.clone();
        const to = worldPos.clone();
        const state = { t: 0 };

        TweenUtil.mark(node);
        tween(state)
            .to(duration, { t: 1 }, {
                easing: easing as never,
                onUpdate: () => {
                    if (!node.isValid) return;
                    const t = state.t;
                    const x = from.x + (to.x - from.x) * t;
                    const y = from.y + (to.y - from.y) * t;
                    // Parabol 4h * t * (1-t) chuẩn, không bị giật tại t >= 1
                    const clampedT = Math.min(Math.max(t, 0), 1);
                    const n = Math.max(1, jumps);
                    const local = (clampedT * n) % 1;
                    const arc = 4 * height * local * (1 - local);
                    node.setWorldPosition(x, y + arc, from.z);
                },
            })
            .call(() => {
                TweenUtil.unmark(node);
                if (node.isValid) node.setWorldPosition(to);
                onComplete?.();
            })
            .start();
    }

    // ---------------------------------------------------------------- scale / rotate
    static scaleTo(node: Node, scale: Vec3, duration: number,
                   easing: string = 'quadOut', onComplete?: () => void): void {
        TweenUtil.mark(node);
        tween(node)
            .to(duration, { scale: scale.clone() }, { easing: easing as never })
            .call(() => { TweenUtil.unmark(node); onComplete?.(); })
            .start();
    }

    static rotateTo(node: Node, euler: Vec3, duration: number,
                    easing: string = 'quadOut', onComplete?: () => void): void {
        TweenUtil.mark(node);
        tween(node)
            .to(duration, { eulerAngles: euler.clone() }, { easing: easing as never })
            .call(() => { TweenUtil.unmark(node); onComplete?.(); })
            .start();
    }

    // ---------------------------------------------------------------- giá trị / thời gian
    /** Thay DOTween.To(getter, setter, end, dur) — nội suy 0..1 rồi tự xử lý trong onUpdate. */
    static valueTo(duration: number, onUpdate: (t: number) => void,
                   easing: string = 'linear', loop = false, onComplete?: () => void): Tween<object> {
        const state = { t: 0 };
        let tw = tween(state).to(duration, { t: 1 }, {
            easing: easing as never,
            onUpdate: () => onUpdate(state.t),
        });
        if (loop) {
            tw = tween(state).repeatForever(
                tween(state)
                    .set({ t: 0 })
                    .to(duration, { t: 1 }, { easing: easing as never, onUpdate: () => onUpdate(state.t) }),
            );
        } else {
            tw = tw.call(() => onComplete?.());
        }
        tw.start();
        return tw;
    }

    /** Thay DOVirtual.DelayedCall */
    static delayedCall(comp: Component, delay: number, cb: () => void): void {
        comp.scheduleOnce(cb, delay);
    }
}
