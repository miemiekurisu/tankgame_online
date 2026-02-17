import { describe, it, expect } from 'vitest';
import {
  Vec3,
  DIRECT_HIT_DAMAGE,
  SPLASH_RADIUS,
  SPLASH_DAMAGE_FACTOR,
  TANK_MAX_HP,
  calculateSplashDamage,
  checkProjectileHit,
  PROJECTILE_COLLISION_RADIUS,
  TANK_COLLISION_RADIUS,
} from '@tankgame/shared';
import { Player } from '../../packages/server/src/Player.js';

/**
 * Damage Regression Tests
 * Ensure damage calculations remain consistent and match expected values.
 * These tests lock down specific numerical results to catch unintended changes.
 */
describe('Damage Regression', () => {
  describe('direct hit damage', () => {
    it('should deal exactly 20 damage on direct hit', () => {
      expect(DIRECT_HIT_DAMAGE).toBe(20);
    });

    it('should require exactly 5 direct hits to kill from full HP', () => {
      const player = new Player(1, 'Test');
      expect(player.hp).toBe(TANK_MAX_HP);

      for (let i = 0; i < 4; i++) {
        player.takeDamage(DIRECT_HIT_DAMAGE);
        expect(player.alive).toBe(true);
      }

      player.takeDamage(DIRECT_HIT_DAMAGE);
      expect(player.hp).toBe(0);
      expect(player.alive).toBe(false);
    });

    it('should not overkill (HP stays at 0)', () => {
      const player = new Player(1, 'Test');
      player.takeDamage(TANK_MAX_HP + 100);
      expect(player.hp).toBe(0);
    });

    it('should ignore damage to dead player', () => {
      const player = new Player(1, 'Test');
      player.takeDamage(TANK_MAX_HP);
      expect(player.alive).toBe(false);

      const result = player.takeDamage(50);
      expect(result).toBe(false);
      expect(player.hp).toBe(0);
    });
  });

  describe('splash damage values', () => {
    it('should deal 10 damage at zero distance (max splash)', () => {
      const hit = new Vec3(0, 0, 0);
      const target = new Vec3(0, 0, 0);
      const damage = calculateSplashDamage(hit, target);
      expect(damage).toBe(DIRECT_HIT_DAMAGE * 1.0 * SPLASH_DAMAGE_FACTOR);
      expect(damage).toBe(10);
    });

    it('should deal 0 damage beyond splash radius (3m)', () => {
      const hit = new Vec3(0, 0, 0);
      const target = new Vec3(SPLASH_RADIUS + 0.01, 0, 0);
      expect(calculateSplashDamage(hit, target)).toBe(0);
    });

    it('should deal ~5 damage at half splash radius (1.5m)', () => {
      const hit = new Vec3(0, 0, 0);
      const target = new Vec3(1.5, 0, 0);
      const damage = calculateSplashDamage(hit, target);
      expect(damage).toBeCloseTo(5, 1);
    });

    it('should deal ~3.33 damage at 2/3 splash radius (2m)', () => {
      const hit = new Vec3(0, 0, 0);
      const target = new Vec3(2, 0, 0);
      const damage = calculateSplashDamage(hit, target);
      const expectedFalloff = 1 - 2 / SPLASH_RADIUS;
      expect(damage).toBeCloseTo(DIRECT_HIT_DAMAGE * expectedFalloff * SPLASH_DAMAGE_FACTOR, 1);
    });

    it('should deal exactly 0 at exactly splash radius', () => {
      const hit = new Vec3(0, 0, 0);
      const target = new Vec3(SPLASH_RADIUS, 0, 0);
      const damage = calculateSplashDamage(hit, target);
      expect(damage).toBe(0);
    });

    it('should be symmetric in all directions', () => {
      const hit = new Vec3(0, 0, 0);
      const d1 = calculateSplashDamage(hit, new Vec3(1, 0, 0));
      const d2 = calculateSplashDamage(hit, new Vec3(0, 1, 0));
      const d3 = calculateSplashDamage(hit, new Vec3(0, 0, 1));
      const d4 = calculateSplashDamage(hit, new Vec3(-1, 0, 0));
      expect(d1).toBeCloseTo(d2, 6);
      expect(d2).toBeCloseTo(d3, 6);
      expect(d3).toBeCloseTo(d4, 6);
    });

    it('should consider 3D distance for splash', () => {
      const hit = new Vec3(0, 0, 0);
      // Diagonal 3D distance = sqrt(1+1+1) ≈ 1.73m
      const damage = calculateSplashDamage(hit, new Vec3(1, 1, 1));
      const dist = Math.sqrt(3);
      const expectedFalloff = 1 - dist / SPLASH_RADIUS;
      expect(damage).toBeCloseTo(DIRECT_HIT_DAMAGE * expectedFalloff * SPLASH_DAMAGE_FACTOR, 1);
    });
  });

  describe('collision detection values', () => {
    it('should use projectile radius = 0.5', () => {
      expect(PROJECTILE_COLLISION_RADIUS).toBe(0.5);
    });

    it('should use tank radius = 2.5', () => {
      expect(TANK_COLLISION_RADIUS).toBe(2.5);
    });

    it('should detect collision at combined radius (3.0m)', () => {
      const proj = new Vec3(0, 0, 0);
      const target = new Vec3(3.0, 0, 0);
      expect(checkProjectileHit(proj, target, 0.5, 2.5)).toBe(true);
    });

    it('should miss just beyond combined radius', () => {
      const proj = new Vec3(0, 0, 0);
      const target = new Vec3(3.01, 0, 0);
      expect(checkProjectileHit(proj, target, 0.5, 2.5)).toBe(false);
    });
  });

  describe('HP boundary conditions', () => {
    it('should handle 1 HP correctly', () => {
      const p = new Player(1, 'Test');
      p.hp = 1;
      expect(p.takeDamage(1)).toBe(true);
      expect(p.hp).toBe(0);
      expect(p.alive).toBe(false);
    });

    it('should handle fractional damage', () => {
      const p = new Player(1, 'Test');
      p.takeDamage(0.5);
      expect(p.hp).toBe(TANK_MAX_HP - 0.5);
      expect(p.alive).toBe(true);
    });

    it('should handle very small damage', () => {
      const p = new Player(1, 'Test');
      p.takeDamage(0.001);
      expect(p.hp).toBeCloseTo(TANK_MAX_HP - 0.001, 3);
    });

    it('should handle exact max HP damage', () => {
      const p = new Player(1, 'Test');
      expect(p.takeDamage(TANK_MAX_HP)).toBe(true);
      expect(p.hp).toBe(0);
      expect(p.alive).toBe(false);
    });
  });
});
