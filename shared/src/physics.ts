import { Vec3 } from './types.js';
import {
  GRAVITY,
  TANK_MAX_SPEED,
  TANK_ACCELERATION,
  TANK_REVERSE_FACTOR,
  TANK_TURN_RATE,
  TANK_DAMPING,
  TURRET_TURN_RATE,
  TURRET_YAW_MAX,
  GUN_PITCH_MIN,
  GUN_PITCH_MAX,
  MUZZLE_VELOCITY,
  SPLASH_RADIUS,
  SPLASH_DAMAGE_FACTOR,
  DIRECT_HIT_DAMAGE,
} from './constants.js';

/**
 * 坦克实体状态（物理模拟用）
 */
export interface TankPhysicsState {
  position: Vec3;
  velocity: Vec3;
  bodyYaw: number;
  turretYaw: number;
  gunPitch: number;
}

/**
 * 输入指令（物理计算用简化版）
 */
export interface PhysicsInput {
  forward: boolean;
  backward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  turretYaw: number;
  gunPitch: number;
}

/**
 * 获取车体前方方向向量（Three.js 约定：yaw=0 朝 -Z）
 */
export function getForwardVector(yaw: number): Vec3 {
  return new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/**
 * 获取炮管方向（考虑车体姿态、炮塔偏转、火炮俯仰）
 */
export function getBarrelDirection(
  bodyYaw: number,
  turretYaw: number,
  gunPitch: number,
  bodyPitch: number = 0,
  _bodyRoll: number = 0
): Vec3 {
  // Three.js 约定：yaw=0 朝 -Z
  const totalYaw = bodyYaw + turretYaw;
  const cosPitch = Math.cos(gunPitch + bodyPitch);
  const sinPitch = Math.sin(gunPitch + bodyPitch);

  return new Vec3(
    -Math.sin(totalYaw) * cosPitch,
    sinPitch,
    -Math.cos(totalYaw) * cosPitch
  );
}

/**
 * 获取炮口位置（相对于坦克位置的偏移）
 */
export function getMuzzlePosition(tank: TankPhysicsState, barrelLength: number = 4): Vec3 {
  const dir = getBarrelDirection(tank.bodyYaw, tank.turretYaw, tank.gunPitch);
  return tank.position.clone().add(
    new Vec3(0, 2.2, 0) // 炮镜高度（与客户端 sightHeight 对齐）
  ).add(
    dir.clone().multiplyScalar(barrelLength)
  );
}

/**
 * 更新坦克物理状态（单步）
 * 服务器和客户端预测共用此函数
 */
export function updateTankPhysics(
  tank: TankPhysicsState,
  input: PhysicsInput,
  dt: number,
  getTerrainHeight?: (x: number, z: number) => number,
  _getTerrainNormal?: (x: number, z: number) => Vec3
): void {
  // 1. 转向
  if (input.turnLeft) {
    tank.bodyYaw += TANK_TURN_RATE * dt;
  }
  if (input.turnRight) {
    tank.bodyYaw -= TANK_TURN_RATE * dt;
  }

  // 规范化 yaw 到 [-π, π]
  tank.bodyYaw = normalizeAngle(tank.bodyYaw);

  // 2. 炮塔旋转（增量旋转，限速 + 角度限制 ±TURRET_YAW_MAX）
  {
    const targetTurretYaw = clamp(input.turretYaw, -TURRET_YAW_MAX, TURRET_YAW_MAX);
    const diff = normalizeAngle(targetTurretYaw - tank.turretYaw);
    const maxStep = TURRET_TURN_RATE * dt;
    if (Math.abs(diff) <= maxStep) {
      tank.turretYaw = targetTurretYaw;
    } else {
      tank.turretYaw += Math.sign(diff) * maxStep;
    }
    tank.turretYaw = clamp(tank.turretYaw, -TURRET_YAW_MAX, TURRET_YAW_MAX);
  }

  // 3. 火炮俯仰
  tank.gunPitch = clamp(input.gunPitch, GUN_PITCH_MIN, GUN_PITCH_MAX);

  // 4. 加速/减速（坦克风格：沿车体前进方向移动，不跟随炮塔）
  const forward = getForwardVector(tank.bodyYaw);
  if (input.forward) {
    tank.velocity.add(forward.clone().multiplyScalar(TANK_ACCELERATION * dt));
  }
  if (input.backward) {
    tank.velocity.add(
      forward.clone().multiplyScalar(-TANK_ACCELERATION * TANK_REVERSE_FACTOR * dt)
    );
  }

  // 5. 阻尼（帧率无关）
  tank.velocity.multiplyScalar(Math.pow(TANK_DAMPING, dt * 60));

  // 6. 速度限制
  const speed = tank.velocity.length();
  if (speed > TANK_MAX_SPEED) {
    tank.velocity.normalize().multiplyScalar(TANK_MAX_SPEED);
  }

  // 7. 位置更新
  tank.position.add(tank.velocity.clone().multiplyScalar(dt));

  // 8. 地形适配
  if (getTerrainHeight) {
    tank.position.y = getTerrainHeight(tank.position.x, tank.position.z);
  }
}

/**
 * 更新弹体物理状态（单步）
 */
export function updateProjectile(
  position: Vec3,
  velocity: Vec3,
  dt: number
): void {
  // 重力
  velocity.y -= GRAVITY * dt;

  // 位置更新
  position.add(velocity.clone().multiplyScalar(dt));
}

/**
 * 计算炮弹初速度（含载具惯性）
 */
export function calculateMuzzleVelocity(tank: TankPhysicsState): Vec3 {
  const barrelDir = getBarrelDirection(tank.bodyYaw, tank.turretYaw, tank.gunPitch);
  return tank.velocity.clone().add(
    barrelDir.multiplyScalar(MUZZLE_VELOCITY)
  );
}

/**
 * 计算溅射伤害
 */
export function calculateSplashDamage(hitPos: Vec3, targetPos: Vec3): number {
  const dist = hitPos.distanceTo(targetPos);
  if (dist > SPLASH_RADIUS) return 0;

  const falloff = 1 - dist / SPLASH_RADIUS;
  return DIRECT_HIT_DAMAGE * falloff * SPLASH_DAMAGE_FACTOR;
}

/**
 * 检测弹体与目标的碰撞（球体相交）
 */
export function checkProjectileHit(
  projPos: Vec3,
  targetPos: Vec3,
  projRadius: number,
  targetRadius: number
): boolean {
  const distSq = projPos.distanceToSq(targetPos);
  const combinedRadius = projRadius + targetRadius;
  return distSq <= combinedRadius * combinedRadius;
}

/**
 * 高斯评分函数 — 用于出生点距离评分
 */
export function gaussianScore(value: number, mean: number, sigma: number): number {
  const diff = value - mean;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

// ==================== 工具函数 ====================

/**
 * 角度规范化到 [-π, π]
 */
export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * 角度趋近（带最大步长）
 */
export function moveTowardsAngle(current: number, target: number, maxStep: number): number {
  let diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

/**
 * 数值限制
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 线性插值
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 角度线性插值（最短路径）
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = normalizeAngle(b - a);
  return a + diff * t;
}
