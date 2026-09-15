/**
 * SmokeEffect — hiệu ứng khói/lấp lánh khi đặt đúng item, dùng qua Ply_Pool (PoolType.CorrectEffect).
 * Thay cho BlinkEffect.
 *
 * Lý do particle KHÔNG phát lại khi lấy từ pool:
 *   - Ply_Pool.despawn chỉ set node.active = false; ParticleSystem2D lúc đó đang ở trạng thái
 *     "stopped" (hết duration) và khi active lại nó KHÔNG tự chạy nữa.
 *   - Nếu prefab tick autoRemoveOnFinish, particle tự huỷ node -> pool giữ node đã chết.
 * -> play(): tắt autoRemoveOnFinish, resetSystem() cho MỌI ParticleSystem2D trong prefab
 *    sau khi node đã active; stop(): stopSystem() trước khi trả về pool.
 */

import { _decorator, ParticleSystem2D, Animation } from 'cc';
import { Ply_GameUnit } from '../ScriptTemplate/Ply_GameUnit';
import { Ply_Pool, PoolType } from '../ScriptTemplate/Ply_Pool';

const { ccclass, property } = _decorator;

@ccclass('SmokeEffect')
export class SmokeEffect extends Ply_GameUnit {

    @property({ tooltip: 'Thời gian tồn tại trước khi trả về pool (giây). 0 = tự tính theo duration + life của particle.' })
    lifetime = 0;

    private particles: ParticleSystem2D[] = [];

    onLoad() {
        this.poolType = PoolType.CorrectEffect;
        this.particles = this.getComponentsInChildren(ParticleSystem2D);
        for (const ps of this.particles) ps.autoRemoveOnFinish = false;   // pool giữ node, không cho tự huỷ
    }

    onEnable() {
        // Ply_Pool.spawn set active = true -> tự phát
        this.play();
    }

    /** Phát lại từ đầu mọi particle + animation trong prefab, rồi hẹn giờ trả về pool. */
    play(): void {
        if (this.particles.length === 0) this.particles = this.getComponentsInChildren(ParticleSystem2D);

        let maxLife = 0;
        for (const ps of this.particles) {
            if (!ps.isValid) continue;
            ps.enabled = true;
            ps.autoRemoveOnFinish = false;
            ps.resetSystem();
            const dur = ps.duration < 0 ? 0 : ps.duration;   // -1 = loop
            maxLife = Math.max(maxLife, dur + ps.life + ps.lifeVar);
        }

        this.getComponent(Animation)?.play();

        const t = this.lifetime > 0 ? this.lifetime : (maxLife > 0 ? maxLife : 2);
        this.deSpawnByTime(t);
    }

    /** Dừng phát hạt (gọi trước khi về pool). */
    stop(): void {
        for (const ps of this.particles) if (ps.isValid) ps.stopSystem();
    }

    deSpawnByTime(delay = 2): void {
        this.unscheduleAllCallbacks();
        this.scheduleOnce(() => {
            this.stop();
            if (Ply_Pool.Ins) Ply_Pool.Ins.despawn(this.poolType, this);
            else this.node.active = false;
        }, delay);
    }

    onDisable() {
        this.unscheduleAllCallbacks();
    }
}
