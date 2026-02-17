import { describe, it, expect } from 'vitest';
import {
  Vec3,
  TANK_MAX_SPEED,
  TANK_ACCELERATION,
  TANK_DAMPING,
  TANK_TURN_RATE,
  GRAVITY,
  MUZZLE_VELOCITY,
  GUN_PITCH_MIN,
  GUN_PITCH_MAX,
  updateTankPhysics,
  updateProjectile,
  calculateMuzzleVelocity,
  getForwardVector,
  getBarrelDirection,
  getMuzzlePosition,
  normalizeAngle,
  clamp,
  lerp,
  lerpAngle,
  moveTowardsAngle,
} from '@tankgame/shared';
import type { TankPhysicsState, PhysicsInput } from '@tankgame/shared';

/**
 * Physics Regression Tests
 * Locks down specific physics behavior to prevent unintended changes.
 */
describe('Physics Regression', () => {
  const noInput: PhysicsInput = {
    forward: false, backward: false,
    turnLeft: false, turnRight: false,
    turretYaw: 0, gunPitch: 0,
  };

  function makeTank(): TankPhysicsState {
    return {
      position: Vec3.zero(),
      velocity: Vec3.zero(),
      bodyYaw: 0,
      turretYaw: 0,
      gunPitch: 0,
    };
  }

  describe('speed limit enforcement', () => {
    it('should never exceed TANK_MAX_SPEED (17.16 m/s)', () => {
      const tank = makeTank();
      const input = { ...noInput, forward: true };

      for (let i = 0; i < 1200; i++) {
        updateTankPhysics(tank, input, 1 / 60);
      }

      const speed = tank.velocity.length();
      expect(speed).toBeLessThanOrEqual(TANK_MAX_SPEED + 0.01);
    });

    it('should reach near-max speed after 5 seconds', () => {
      const tank = makeTank();
      const input = { ...noInput, forward: true };

      for (let i = 0; i < 300; i++) { // 5 seconds at 60Hz
        updateTankPhysics(tank, input, 1 / 60);
      }

      const speed = tank.velocity.length();
      expect(speed).toBeGreaterThan(TANK_MAX_SPEED * 0.7);
    });

    it('should enforce speed limit regardless of direction', () => {
      // Test multiple yaw angles
      const angles = [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2];
      for (const yaw of angles) {
        const tank = makeTank();
        tank.bodyYaw = yaw;
        const input = { ...noInput, forward: true };

        for (let i = 0; i < 600; i++) {
          updateTankPhysics(tank, input, 1 / 60);
        }

        const speed = tank.velocity.length();
        expect(speed).toBeLessThanOrEqual(TANK_MAX_SPEED + 0.01);
      }
    });
  });

  describe('damping behavior', () => {
    it('should reduce speed by ~60% in 1 second (TANK_DAMPING=0.985)', () => {
      const tank = makeTank();
      tank.velocity.set(0, 0, -10);

      for (let i = 0; i < 60; i++) {
        updateTankPhysics(tank, noInput, 1 / 60);
      }

      const speed = tank.velocity.length();
      // 0.985^60 ≈ 0.406, so speed should be ~4.06
      expect(speed).toBeCloseTo(10 * Math.pow(TANK_DAMPING, 60), 0.5);
    });

    it('should effectively stop after 5 seconds', () => {
      const tank = makeTank();
      tank.velocity.set(0, 0, -TANK_MAX_SPEED);

      // 5 seconds = 300 frames. TANK_MAX_SPEED * 0.985^300 ≈ 0.17
      for (let i = 0; i < 300; i++) {
        updateTankPhysics(tank, noInput, 1 / 60);
      }

      expect(tank.velocity.length()).toBeLessThan(0.2);
    });
  });

  describe('turning behavior', () => {
    it('should turn at exactly TANK_TURN_RATE rad/s', () => {
      const tank = makeTank();
      const input = { ...noInput, turnLeft: true };

      updateTankPhysics(tank, input, 1.0);
      expect(tank.bodyYaw).toBeCloseTo(TANK_TURN_RATE, 6);
    });

    it('should turn right at negative TANK_TURN_RATE', () => {
      const tank = makeTank();
      const input = { ...noInput, turnRight: true };

      updateTankPhysics(tank, input, 1.0);
      expect(tank.bodyYaw).toBeCloseTo(-TANK_TURN_RATE, 6);
    });

    it('should normalize yaw to [-π, π]', () => {
      const tank = makeTank();
      const input = { ...noInput, turnLeft: true };

      // Turn for many seconds
      for (let i = 0; i < 600; i++) {
        updateTankPhysics(tank, input, 1 / 60);
      }

      expect(tank.bodyYaw).toBeGreaterThanOrEqual(-Math.PI);
      expect(tank.bodyYaw).toBeLessThanOrEqual(Math.PI);
    });
  });

  describe('gun pitch clamping', () => {
    it('should clamp pitch at GUN_PITCH_MIN (-0.15)', () => {
      const tank = makeTank();
      const input = { ...noInput, gunPitch: -1.0 };
      updateTankPhysics(tank, input, 1 / 60);
      expect(tank.gunPitch).toBe(GUN_PITCH_MIN);
    });

    it('should clamp pitch at GUN_PITCH_MAX (0.5)', () => {
      const tank = makeTank();
      const input = { ...noInput, gunPitch: 2.0 };
      updateTankPhysics(tank, input, 1 / 60);
      expect(tank.gunPitch).toBe(GUN_PITCH_MAX);
    });

    it('should pass through in-range values', () => {
      const tank = makeTank();
      const input = { ...noInput, gunPitch: 0.2 };
      updateTankPhysics(tank, input, 1 / 60);
      expect(tank.gunPitch).toBe(0.2);
    });
  });

  describe('projectile trajectory', () => {
    it('should follow parabolic path under gravity', () => {
      const pos = new Vec3(0, 100, 0);
      const vel = new Vec3(80, 0, 0); // Horizontal
      const dt = 0.1;

      const positions: number[] = [];
      for (let i = 0; i < 50; i++) {
        updateProjectile(pos, vel, dt);
        positions.push(pos.y);
      }

      // Y should monotonically decrease (gravity pulling down)
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeLessThan(positions[i - 1]);
      }
    });

    it('should apply gravity at exactly 9.81 m/s²', () => {
      const pos = new Vec3(0, 100, 0);
      const vel = new Vec3(0, 0, 0);

      updateProjectile(pos, vel, 1.0);

      // After 1 second: v = -g*t = -9.81, pos = y0 - 0.5*g*t² (but vel updated first)
      expect(vel.y).toBeCloseTo(-GRAVITY, 4);
    });

    it('should maintain horizontal velocity (no air resistance)', () => {
      const pos = new Vec3(0, 100, 0);
      const vel = new Vec3(80, 0, 0);

      updateProjectile(pos, vel, 1.0);

      expect(vel.x).toBe(80); // No horizontal drag
    });
  });

  describe('muzzle velocity calculation', () => {
    it('should add vehicle velocity to muzzle velocity', () => {
      const tank: TankPhysicsState = {
        position: Vec3.zero(),
        velocity: new Vec3(0, 0, -5), // Moving forward
        bodyYaw: 0,
        turretYaw: 0,
        gunPitch: 0,
      };

      const v = calculateMuzzleVelocity(tank);
      // barrel direction at yaw=0, pitch=0 is (0, 0, -1)
      // muzzle vel = tank.vel(0,0,-5) + dir(0,0,-1)*80 = (0, 0, -85)
      expect(v.z).toBeCloseTo(-85, 0);
    });

    it('should have magnitude close to MUZZLE_VELOCITY for stationary tank', () => {
      const tank: TankPhysicsState = {
        position: Vec3.zero(),
        velocity: Vec3.zero(),
        bodyYaw: 0,
        turretYaw: 0,
        gunPitch: 0,
      };

      const v = calculateMuzzleVelocity(tank);
      expect(v.length()).toBeCloseTo(MUZZLE_VELOCITY, 1);
    });
  });

  describe('direction vectors', () => {
    it('should return (0, 0, -1) for yaw=0', () => {
      const fwd = getForwardVector(0);
      expect(fwd.x).toBeCloseTo(0, 6);
      expect(fwd.y).toBe(0);
      expect(fwd.z).toBeCloseTo(-1, 6);
    });

    it('should return (-1, 0, 0) for yaw=π/2', () => {
      const fwd = getForwardVector(Math.PI / 2);
      expect(fwd.x).toBeCloseTo(-1, 5);
      expect(fwd.z).toBeCloseTo(0, 5);
    });

    it('should return (0, 0, 1) for yaw=π', () => {
      const fwd = getForwardVector(Math.PI);
      expect(fwd.x).toBeCloseTo(0, 5);
      expect(fwd.z).toBeCloseTo(1, 5);
    });

    it('barrel direction should be unit vector for 0 pitch', () => {
      const dir = getBarrelDirection(0, 0, 0);
      expect(dir.length()).toBeCloseTo(1, 5);
    });

    it('barrel direction should have Y component for positive pitch', () => {
      const dir = getBarrelDirection(0, 0, 0.3);
      expect(dir.y).toBeGreaterThan(0);
      expect(dir.length()).toBeCloseTo(1, 5);
    });
  });

  describe('utility function stability', () => {
    it('normalizeAngle should be idempotent for in-range values', () => {
      for (let a = -Math.PI; a <= Math.PI; a += 0.1) {
        expect(normalizeAngle(a)).toBeCloseTo(a, 6);
      }
    });

    it('clamp should be idempotent', () => {
      expect(clamp(clamp(5, 0, 10), 0, 10)).toBe(5);
      expect(clamp(clamp(-5, 0, 10), 0, 10)).toBe(0);
      expect(clamp(clamp(15, 0, 10), 0, 10)).toBe(10);
    });

    it('lerp at endpoints should return exact values', () => {
      expect(lerp(3, 7, 0)).toBe(3);
      expect(lerp(3, 7, 1)).toBe(7);
    });

    it('lerpAngle should handle wrap-around', () => {
      // Lerp from nearly -π to nearly +π should go through ±π, not through 0
      const a = -Math.PI + 0.1;
      const b = Math.PI - 0.1;
      const mid = lerpAngle(a, b, 0.5);
      // The midpoint should be near ±π, not near 0
      expect(Math.abs(mid)).toBeGreaterThan(2);
    });

    it('moveTowardsAngle should reach target exactly', () => {
      expect(moveTowardsAngle(0, 0.05, 0.1)).toBe(0.05);
    });
  });
});
