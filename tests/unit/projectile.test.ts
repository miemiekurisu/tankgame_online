import { describe, it, expect, beforeEach } from 'vitest';
import { Vec3, PROJECTILE_TTL } from '@tankgame/shared';
import { Projectile } from '../../packages/server/src/Projectile.js';

describe('Projectile', () => {
  let proj: Projectile;

  beforeEach(() => {
    proj = new Projectile(
      1,            // id
      100,          // shooterId
      new Vec3(0, 10, 0), // position
      new Vec3(0, 10, 80), // velocity
      PROJECTILE_TTL     // ttl
    );
  });

  describe('creation', () => {
    it('should initialize with correct values', () => {
      expect(proj.id).toBe(1);
      expect(proj.shooterId).toBe(100);
      expect(proj.active).toBe(true);
      expect(proj.ttl).toBe(PROJECTILE_TTL);
    });

    it('should clone position and velocity', () => {
      const pos = new Vec3(5, 5, 5);
      const vel = new Vec3(0, 0, 80);
      const p = new Projectile(2, 1, pos, vel, 5000);
      pos.x = 99;
      vel.z = 99;
      expect(p.position.x).toBe(5);
      expect(p.velocity.z).toBe(80);
    });
  });

  describe('update', () => {
    it('should move position', () => {
      const startZ = proj.position.z;
      proj.update(1 / 60);
      expect(proj.position.z).toBeGreaterThan(startZ);
    });

    it('should apply gravity', () => {
      const startVelY = proj.velocity.y;
      proj.update(1 / 60);
      expect(proj.velocity.y).toBeLessThan(startVelY);
    });

    it('should decrease ttl', () => {
      proj.update(1 / 60);
      expect(proj.ttl).toBeLessThan(PROJECTILE_TTL);
    });

    it('should deactivate when ttl expires', () => {
      proj.ttl = 10; // almost expired
      proj.update(1); // 1 second
      expect(proj.active).toBe(false);
    });

    it('should not update when inactive', () => {
      proj.active = false;
      const pos = proj.position.clone();
      proj.update(1);
      expect(proj.position.x).toBe(pos.x);
      expect(proj.position.y).toBe(pos.y);
      expect(proj.position.z).toBe(pos.z);
    });
  });

  describe('checkGroundHit', () => {
    it('should detect ground collision', () => {
      proj.position.y = 0.5;
      const hit = proj.checkGroundHit(() => 1); // terrain at y=1
      expect(hit).toBe(true);
      expect(proj.active).toBe(false);
      expect(proj.position.y).toBe(1);
    });

    it('should not trigger above ground', () => {
      proj.position.y = 10;
      const hit = proj.checkGroundHit(() => 0);
      expect(hit).toBe(false);
      expect(proj.active).toBe(true);
    });

    it('should not trigger when inactive', () => {
      proj.active = false;
      proj.position.y = -10;
      expect(proj.checkGroundHit(() => 0)).toBe(false);
    });
  });

  describe('toSnapshot', () => {
    it('should return snapshot data', () => {
      const snap = proj.toSnapshot();
      expect(snap.projectileId).toBe(1);
      expect(snap.position.x).toBe(proj.position.x);
      expect(snap.ttl).toBe(proj.ttl);
    });

    it('should clone data', () => {
      const snap = proj.toSnapshot();
      proj.position.x = 999;
      expect(snap.position.x).not.toBe(999);
    });
  });
});
