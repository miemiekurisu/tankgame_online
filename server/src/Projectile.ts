import { Vec3 } from '@tankgame/shared';
import type { ProjectileSnapshot } from '@tankgame/shared';
import { updateProjectile } from '@tankgame/shared';

/**
 * 服务器端弹体实体
 */
export class Projectile {
  readonly id: number;
  readonly shooterId: number;
  position: Vec3;
  velocity: Vec3;
  ttl: number; // 剩余存活时间 (ms)
  active: boolean = true;

  constructor(
    id: number,
    shooterId: number,
    position: Vec3,
    velocity: Vec3,
    ttl: number
  ) {
    this.id = id;
    this.shooterId = shooterId;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.ttl = ttl;
  }

  /**
   * 物理更新
   */
  update(dt: number): void {
    if (!this.active) return;

    updateProjectile(this.position, this.velocity, dt);

    this.ttl -= dt * 1000;
    if (this.ttl <= 0) {
      this.active = false;
    }
  }

  /**
   * 检查是否击中地面
   */
  checkGroundHit(getTerrainHeight: (x: number, z: number) => number): boolean {
    if (!this.active) return false;
    const groundY = getTerrainHeight(this.position.x, this.position.z);
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.active = false;
      return true;
    }
    return false;
  }

  /**
   * 获取快照数据
   */
  toSnapshot(): ProjectileSnapshot {
    return {
      projectileId: this.id,
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      ttl: this.ttl,
    };
  }
}
