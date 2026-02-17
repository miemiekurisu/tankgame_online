import { describe, it, expect } from 'vitest';
import {
  Vec3,
  Vec2,
  getForwardVector,
  getBarrelDirection,
  getMuzzlePosition,
  updateTankPhysics,
  updateProjectile,
  calculateMuzzleVelocity,
  calculateSplashDamage,
  checkProjectileHit,
  gaussianScore,
  normalizeAngle,
  moveTowardsAngle,
  clamp,
  lerp,
  lerpAngle,
} from '@tankgame/shared';
import type { TankPhysicsState, PhysicsInput } from '@tankgame/shared';

// ==================== Vec3 Tests ====================

describe('Vec3', () => {
  it('should create with default values', () => {
    const v = new Vec3();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it('should create with specified values', () => {
    const v = new Vec3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
  });

  it('should clone correctly', () => {
    const v = new Vec3(1, 2, 3);
    const c = v.clone();
    expect(c.x).toBe(1);
    expect(c.y).toBe(2);
    expect(c.z).toBe(3);
    c.x = 10;
    expect(v.x).toBe(1); // 原始不受影响
  });

  it('should add vectors', () => {
    const a = new Vec3(1, 2, 3);
    const b = new Vec3(4, 5, 6);
    a.add(b);
    expect(a.x).toBe(5);
    expect(a.y).toBe(7);
    expect(a.z).toBe(9);
  });

  it('should subtract vectors', () => {
    const a = new Vec3(5, 7, 9);
    const b = new Vec3(1, 2, 3);
    a.sub(b);
    expect(a.x).toBe(4);
    expect(a.y).toBe(5);
    expect(a.z).toBe(6);
  });

  it('should multiply by scalar', () => {
    const v = new Vec3(2, 3, 4);
    v.multiplyScalar(2);
    expect(v.x).toBe(4);
    expect(v.y).toBe(6);
    expect(v.z).toBe(8);
  });

  it('should calculate length', () => {
    const v = new Vec3(3, 4, 0);
    expect(v.length()).toBe(5);
  });

  it('should calculate lengthSq', () => {
    const v = new Vec3(3, 4, 0);
    expect(v.lengthSq()).toBe(25);
  });

  it('should normalize', () => {
    const v = new Vec3(3, 0, 4);
    v.normalize();
    expect(v.length()).toBeCloseTo(1, 6);
    expect(v.x).toBeCloseTo(0.6, 6);
    expect(v.z).toBeCloseTo(0.8, 6);
  });

  it('should handle zero vector normalize', () => {
    const v = new Vec3(0, 0, 0);
    v.normalize();
    expect(v.length()).toBe(0);
  });

  it('should calculate distanceTo', () => {
    const a = new Vec3(0, 0, 0);
    const b = new Vec3(3, 4, 0);
    expect(a.distanceTo(b)).toBe(5);
  });

  it('should calculate dot product', () => {
    const a = new Vec3(1, 0, 0);
    const b = new Vec3(0, 1, 0);
    expect(a.dot(b)).toBe(0); // 垂直

    const c = new Vec3(1, 0, 0);
    const d = new Vec3(1, 0, 0);
    expect(c.dot(d)).toBe(1); // 同向
  });

  it('should calculate cross product', () => {
    const a = new Vec3(1, 0, 0);
    const b = new Vec3(0, 1, 0);
    const c = a.cross(b);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.z).toBe(1);
  });

  it('should lerp', () => {
    const a = new Vec3(0, 0, 0);
    const b = new Vec3(10, 20, 30);
    a.lerp(b, 0.5);
    expect(a.x).toBe(5);
    expect(a.y).toBe(10);
    expect(a.z).toBe(15);
  });

  it('should check equality with epsilon', () => {
    const a = new Vec3(1, 2, 3);
    const b = new Vec3(1.0000001, 2, 3);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(new Vec3(1.1, 2, 3))).toBe(false);
  });

  it('should convert to/from array', () => {
    const v = new Vec3(1, 2, 3);
    expect(v.toArray()).toEqual([1, 2, 3]);
    const v2 = Vec3.fromArray([4, 5, 6]);
    expect(v2.x).toBe(4);
    expect(v2.y).toBe(5);
    expect(v2.z).toBe(6);
  });

  it('should create static helpers', () => {
    expect(Vec3.zero().length()).toBe(0);
    expect(Vec3.up().y).toBe(1);
    expect(Vec3.forward().z).toBe(-1);
  });
});

describe('Vec2', () => {
  it('should calculate distanceTo', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(3, 4);
    expect(a.distanceTo(b)).toBe(5);
  });

  it('should clone', () => {
    const a = new Vec2(1, 2);
    const b = a.clone();
    b.x = 10;
    expect(a.x).toBe(1);
  });
});

// ==================== Physics Utility Tests ====================

describe('normalizeAngle', () => {
  it('should normalize positive angle', () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
  });

  it('should normalize negative angle', () => {
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 6);
  });

  it('should leave in-range angle unchanged', () => {
    expect(normalizeAngle(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe('clamp', () => {
  it('should clamp below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('should clamp above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('should leave in-range values unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('lerp', () => {
  it('should interpolate at t=0', () => {
    expect(lerp(0, 10, 0)).toBe(0);
  });

  it('should interpolate at t=1', () => {
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it('should interpolate at t=0.5', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe('lerpAngle', () => {
  it('should take shortest path', () => {
    // 从 -170° 到 170° 应该走过 0° (最短路径经过 ±180°)
    const a = (-170 / 180) * Math.PI;
    const b = (170 / 180) * Math.PI;
    const result = lerpAngle(a, b, 0.5);
    expect(Math.abs(result)).toBeCloseTo(Math.PI, 1);
  });
});

describe('moveTowardsAngle', () => {
  it('should reach target when within step', () => {
    expect(moveTowardsAngle(0, 0.01, 0.1)).toBe(0.01);
  });

  it('should step towards target', () => {
    const result = moveTowardsAngle(0, 1, 0.1);
    expect(result).toBeCloseTo(0.1, 6);
  });
});

describe('gaussianScore', () => {
  it('should return 1 at mean', () => {
    expect(gaussianScore(50, 50, 10)).toBe(1);
  });

  it('should return ~0.6 at 1 sigma', () => {
    expect(gaussianScore(60, 50, 10)).toBeCloseTo(Math.exp(-0.5), 4);
  });

  it('should be symmetric', () => {
    expect(gaussianScore(40, 50, 10)).toBeCloseTo(gaussianScore(60, 50, 10), 6);
  });
});

// ==================== Physics Function Tests ====================

describe('getForwardVector', () => {
  it('should return forward for yaw=0', () => {
    const fwd = getForwardVector(0);
    expect(fwd.x).toBeCloseTo(0, 6);
    expect(fwd.y).toBe(0);
    expect(fwd.z).toBeCloseTo(-1, 6); // Three.js: yaw=0 → -Z
  });

  it('should return left for yaw=π/2', () => {
    const fwd = getForwardVector(Math.PI / 2);
    expect(fwd.x).toBeCloseTo(-1, 6); // Three.js: yaw=π/2 → -X
    expect(fwd.z).toBeCloseTo(0, 5);
  });
});

describe('getBarrelDirection', () => {
  it('should return forward when all angles are 0', () => {
    const dir = getBarrelDirection(0, 0, 0);
    expect(dir.x).toBeCloseTo(0, 5);
    expect(dir.y).toBeCloseTo(0, 5);
    expect(dir.z).toBeCloseTo(-1, 5); // Three.js: -Z forward
  });

  it('should apply turret yaw', () => {
    const dir = getBarrelDirection(0, Math.PI / 2, 0);
    expect(dir.x).toBeCloseTo(-1, 5); // Three.js: yaw=π/2 → -X
    expect(dir.z).toBeCloseTo(0, 5);
  });

  it('should apply gun pitch', () => {
    const dir = getBarrelDirection(0, 0, Math.PI / 4);
    expect(dir.y).toBeCloseTo(Math.sin(Math.PI / 4), 5);
    expect(dir.z).toBeCloseTo(-Math.cos(Math.PI / 4), 5); // 注意取负
  });
});

describe('getMuzzlePosition', () => {
  it('should offset from tank position', () => {
    const tank: TankPhysicsState = {
      position: new Vec3(10, 5, 20),
      velocity: Vec3.zero(),
      bodyYaw: 0,
      turretYaw: 0,
      gunPitch: 0,
    };
    const muzzle = getMuzzlePosition(tank);
    expect(muzzle.y).toBeGreaterThan(tank.position.y); // 高于车体
    expect(muzzle.distanceTo(tank.position)).toBeGreaterThan(0);
  });
});

describe('updateTankPhysics', () => {
  function makeTank(): TankPhysicsState {
    return {
      position: Vec3.zero(),
      velocity: Vec3.zero(),
      bodyYaw: 0,
      turretYaw: 0,
      gunPitch: 0,
    };
  }

  const noInput: PhysicsInput = {
    forward: false,
    backward: false,
    turnLeft: false,
    turnRight: false,
    turretYaw: 0,
    gunPitch: 0,
  };

  it('should not move without input', () => {
    const tank = makeTank();
    updateTankPhysics(tank, noInput, 1 / 60);
    expect(tank.position.x).toBeCloseTo(0, 4);
    expect(tank.position.z).toBeCloseTo(0, 4);
  });

  it('should accelerate forward', () => {
    const tank = makeTank();
    const input = { ...noInput, forward: true };
    
    // 多步推进
    for (let i = 0; i < 60; i++) {
      updateTankPhysics(tank, input, 1 / 60);
    }
    
    expect(tank.velocity.length()).toBeGreaterThan(0);
    expect(tank.position.z).toBeLessThan(0); // yaw=0 → forward = -Z (Three.js)
  });

  it('should accelerate backward', () => {
    const tank = makeTank();
    const input = { ...noInput, backward: true };
    
    for (let i = 0; i < 60; i++) {
      updateTankPhysics(tank, input, 1 / 60);
    }
    
    expect(tank.position.z).toBeGreaterThan(0); // backward = +Z
  });

  it('should turn left', () => {
    const tank = makeTank();
    const input = { ...noInput, turnLeft: true };
    updateTankPhysics(tank, input, 1);
    expect(tank.bodyYaw).toBeGreaterThan(0);
  });

  it('should turn right', () => {
    const tank = makeTank();
    const input = { ...noInput, turnRight: true };
    updateTankPhysics(tank, input, 1);
    expect(tank.bodyYaw).toBeLessThan(0);
  });

  it('should apply speed limit', () => {
    const tank = makeTank();
    const input = { ...noInput, forward: true };
    
    // 推进很长时间
    for (let i = 0; i < 600; i++) {
      updateTankPhysics(tank, input, 1 / 60);
    }
    
    expect(tank.velocity.length()).toBeLessThanOrEqual(17.17); // TANK_MAX_SPEED + 容差
  });

  it('should apply damping when no input', () => {
    const tank = makeTank();
    tank.velocity.set(0, 0, 10);
    
    for (let i = 0; i < 60; i++) {
      updateTankPhysics(tank, noInput, 1 / 60);
    }
    
    expect(tank.velocity.length()).toBeLessThan(5); // 显著衰减（但 0.985^60 ≈ 0.40，10*0.40=4）
  });

  it('should apply terrain height', () => {
    const tank = makeTank();
    const input = { ...noInput, forward: true };
    const getHeight = (_x: number, _z: number) => 5;
    
    updateTankPhysics(tank, input, 1 / 60, getHeight);
    expect(tank.position.y).toBe(5);
  });

  it('should clamp gun pitch', () => {
    const tank = makeTank();
    const input = { ...noInput, gunPitch: 2 }; // 超出范围
    updateTankPhysics(tank, input, 1 / 60);
    expect(tank.gunPitch).toBeLessThanOrEqual(0.5); // GUN_PITCH_MAX
  });
});

describe('updateProjectile', () => {
  it('should apply gravity', () => {
    const pos = new Vec3(0, 100, 0);
    const vel = new Vec3(0, 0, 80); // 水平飞行
    
    updateProjectile(pos, vel, 1);
    
    expect(vel.y).toBeLessThan(0); // 重力向下
    expect(pos.z).toBeCloseTo(80, 0); // 水平前进
  });

  it('should follow projectile motion', () => {
    const pos = new Vec3(0, 0, 0);
    const vel = new Vec3(0, 50, 50);
    const dt = 0.1;
    
    let maxHeight = 0;
    for (let i = 0; i < 200; i++) {
      updateProjectile(pos, vel, dt);
      if (pos.y > maxHeight) maxHeight = pos.y;
    }
    
    // 应该先升后降
    expect(maxHeight).toBeGreaterThan(50);
    expect(pos.y).toBeLessThan(0); // 最终落到地面以下
  });
});

describe('calculateMuzzleVelocity', () => {
  it('should include vehicle velocity', () => {
    const tank: TankPhysicsState = {
      position: Vec3.zero(),
      velocity: new Vec3(0, 0, 5), // 前进中
      bodyYaw: 0,
      turretYaw: 0,
      gunPitch: 0,
    };
    
    const v = calculateMuzzleVelocity(tank);
    // 炮弹速度 = 载具速度(0,0,5) + 炮管方向(0,0,-1) * 80 = (0,0,-75)
    expect(v.z).toBeLessThanOrEqual(-75); // 叠加了载具速度（方向为 -Z）
  });

  it('should have opposite effect when firing backward', () => {
    const tankForward: TankPhysicsState = {
      position: Vec3.zero(),
      velocity: new Vec3(0, 0, 10),
      bodyYaw: 0,
      turretYaw: 0,
      gunPitch: 0,
    };
    
    const tankBackward: TankPhysicsState = {
      position: Vec3.zero(),
      velocity: new Vec3(0, 0, 10),
      bodyYaw: 0,
      turretYaw: Math.PI, // 炮塔向后
      gunPitch: 0,
    };
    
    const vf = calculateMuzzleVelocity(tankForward);
    const vb = calculateMuzzleVelocity(tankBackward);
    
    expect(vf.z).toBeLessThan(vb.z); // -Z 方向前进时 vf.z 更小（更负）
  });
});

// ==================== Collision Tests ====================

describe('checkProjectileHit', () => {
  it('should detect collision', () => {
    const proj = new Vec3(0, 0, 0);
    const target = new Vec3(1, 0, 0);
    expect(checkProjectileHit(proj, target, 0.5, 2.5)).toBe(true);
  });

  it('should detect miss', () => {
    const proj = new Vec3(0, 0, 0);
    const target = new Vec3(10, 0, 0);
    expect(checkProjectileHit(proj, target, 0.5, 2.5)).toBe(false);
  });

  it('should detect edge collision', () => {
    const proj = new Vec3(0, 0, 0);
    const target = new Vec3(3, 0, 0); // projR=0.5 + targetR=2.5 = 3 → 恰好碰撞
    expect(checkProjectileHit(proj, target, 0.5, 2.5)).toBe(true);
  });
});

describe('calculateSplashDamage', () => {
  it('should return max splash at zero distance', () => {
    const hit = new Vec3(0, 0, 0);
    const target = new Vec3(0, 0, 0);
    const damage = calculateSplashDamage(hit, target);
      expect(damage).toBe(20 * 1 * 0.5); // DIRECT_HIT_DAMAGE * falloff(0) * SPLASH_FACTOR
  });

  it('should return 0 beyond splash radius', () => {
    const hit = new Vec3(0, 0, 0);
    const target = new Vec3(10, 0, 0); // 超出 SPLASH_RADIUS=3
    expect(calculateSplashDamage(hit, target)).toBe(0);
  });

  it('should have linear falloff', () => {
    const hit = new Vec3(0, 0, 0);
    const target = new Vec3(1.5, 0, 0); // half radius
    const damage = calculateSplashDamage(hit, target);
      expect(damage).toBeCloseTo(20 * 0.5 * 0.5, 1); // half falloff
  });
});
