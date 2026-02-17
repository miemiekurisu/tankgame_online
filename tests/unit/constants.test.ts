import { describe, it, expect } from 'vitest';
import {
  // Physics constants
  GRAVITY,
  TANK_MAX_SPEED,
  TANK_ACCELERATION,
  TANK_REVERSE_FACTOR,
  TANK_TURN_RATE,
  TANK_DAMPING,
  TURRET_TURN_RATE,
  GUN_PITCH_MIN,
  GUN_PITCH_MAX,

  // Weapon constants
  MUZZLE_VELOCITY,
  RELOAD_TIME,
  PROJECTILE_TTL,
  SPLASH_RADIUS,
  SPLASH_DAMAGE_FACTOR,
  DIRECT_HIT_DAMAGE,
  TANK_MAX_HP,
  PROJECTILE_COLLISION_RADIUS,
  TANK_COLLISION_RADIUS,

  // Room constants
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROUND_DURATION,
  RESPAWN_DELAY,
  WARMUP_DURATION,

  // Network constants
  TICK_RATE,
  TICK_INTERVAL,
  SNAPSHOT_RATE,
  SNAPSHOT_INTERVAL,
  INPUT_RATE,
  INTERPOLATION_DELAY,
  SNAPSHOT_BUFFER_SIZE,

  // Map constants
  MAP_WIDTH,
  MAP_DEPTH,
  HEIGHTMAP_RESOLUTION,
  MAX_SLOPE,
  PERTURBATION_AMPLITUDE,

  // Spawn constants
  SPAWN_CANDIDATE_COUNT,
  SPAWN_TOP_K,
  IDEAL_SPAWN_DISTANCE,
  SPAWN_DISTANCE_SIGMA,
  COVER_SEARCH_RADIUS,
  SPAWN_COOLDOWN_RADIUS,
  SPAWN_WEIGHTS,

  // Server config
  DEFAULT_PORT,
  MAX_ROOMS,
  KEYFRAME_INTERVAL,
} from '@tankgame/shared';

describe('Constants Validation', () => {
  describe('physics constants', () => {
    it('should have positive gravity', () => {
      expect(GRAVITY).toBeGreaterThan(0);
      expect(GRAVITY).toBe(9.81);
    });

    it('should have positive tank speed limits', () => {
      expect(TANK_MAX_SPEED).toBeGreaterThan(0);
      expect(TANK_ACCELERATION).toBeGreaterThan(0);
    });

    it('should have reverse factor between 0 and 1', () => {
      expect(TANK_REVERSE_FACTOR).toBeGreaterThan(0);
      expect(TANK_REVERSE_FACTOR).toBeLessThan(1);
    });

    it('should have positive turn rate', () => {
      expect(TANK_TURN_RATE).toBeGreaterThan(0);
    });

    it('should have damping between 0 and 1', () => {
      expect(TANK_DAMPING).toBeGreaterThan(0);
      expect(TANK_DAMPING).toBeLessThan(1);
    });

    it('should have positive turret turn rate', () => {
      expect(TURRET_TURN_RATE).toBeGreaterThan(0);
    });

    it('should have valid gun pitch range', () => {
      expect(GUN_PITCH_MIN).toBeLessThan(0);
      expect(GUN_PITCH_MAX).toBeGreaterThan(0);
      expect(GUN_PITCH_MIN).toBeLessThan(GUN_PITCH_MAX);
    });
  });

  describe('weapon constants', () => {
    it('should have positive muzzle velocity', () => {
      expect(MUZZLE_VELOCITY).toBeGreaterThan(0);
    });

    it('should have positive reload time', () => {
      expect(RELOAD_TIME).toBeGreaterThan(0);
    });

    it('should have positive projectile TTL', () => {
      expect(PROJECTILE_TTL).toBeGreaterThan(0);
    });

    it('should have positive splash radius', () => {
      expect(SPLASH_RADIUS).toBeGreaterThan(0);
    });

    it('should have splash damage factor between 0 and 1', () => {
      expect(SPLASH_DAMAGE_FACTOR).toBeGreaterThan(0);
      expect(SPLASH_DAMAGE_FACTOR).toBeLessThanOrEqual(1);
    });

    it('should have positive direct hit damage', () => {
      expect(DIRECT_HIT_DAMAGE).toBeGreaterThan(0);
    });

    it('should have max HP >= direct hit damage for multi-hit kill', () => {
      expect(TANK_MAX_HP).toBeGreaterThanOrEqual(DIRECT_HIT_DAMAGE);
    });

    it('should have positive collision radii', () => {
      expect(PROJECTILE_COLLISION_RADIUS).toBeGreaterThan(0);
      expect(TANK_COLLISION_RADIUS).toBeGreaterThan(0);
    });

    it('should have tank radius > projectile radius', () => {
      expect(TANK_COLLISION_RADIUS).toBeGreaterThan(PROJECTILE_COLLISION_RADIUS);
    });
  });

  describe('room constants', () => {
    it('should have valid player limits', () => {
      expect(MAX_PLAYERS).toBeGreaterThanOrEqual(MIN_PLAYERS);
      expect(MIN_PLAYERS).toBeGreaterThanOrEqual(1);
    });

    it('should have positive round duration', () => {
      expect(ROUND_DURATION).toBeGreaterThan(0);
    });

    it('should have positive respawn delay', () => {
      expect(RESPAWN_DELAY).toBeGreaterThan(0);
    });

    it('should have positive warmup duration', () => {
      expect(WARMUP_DURATION).toBeGreaterThan(0);
    });
  });

  describe('network constants', () => {
    it('should have positive tick rate', () => {
      expect(TICK_RATE).toBeGreaterThan(0);
    });

    it('should have consistent tick interval', () => {
      expect(TICK_INTERVAL).toBeCloseTo(1000 / TICK_RATE, 2);
    });

    it('should have snapshot rate <= tick rate', () => {
      expect(SNAPSHOT_RATE).toBeLessThanOrEqual(TICK_RATE);
      expect(SNAPSHOT_RATE).toBeGreaterThan(0);
    });

    it('should have consistent snapshot interval', () => {
      expect(SNAPSHOT_INTERVAL).toBe(TICK_RATE / SNAPSHOT_RATE);
    });

    it('should have positive input rate', () => {
      expect(INPUT_RATE).toBeGreaterThan(0);
    });

    it('should have positive interpolation delay', () => {
      expect(INTERPOLATION_DELAY).toBeGreaterThan(0);
    });

    it('should have positive snapshot buffer size', () => {
      expect(SNAPSHOT_BUFFER_SIZE).toBeGreaterThan(0);
    });
  });

  describe('map constants', () => {
    it('should have positive map dimensions', () => {
      expect(MAP_WIDTH).toBeGreaterThan(0);
      expect(MAP_DEPTH).toBeGreaterThan(0);
    });

    it('should have positive heightmap resolution', () => {
      expect(HEIGHTMAP_RESOLUTION).toBeGreaterThan(0);
      // Should be a power of 2 or at least reasonable
      expect(HEIGHTMAP_RESOLUTION).toBeGreaterThanOrEqual(16);
    });

    it('should have valid max slope', () => {
      expect(MAX_SLOPE).toBeGreaterThan(0);
      expect(MAX_SLOPE).toBeLessThan(Math.PI / 2);
    });

    it('should have positive perturbation amplitude', () => {
      expect(PERTURBATION_AMPLITUDE).toBeGreaterThan(0);
    });
  });

  describe('spawn constants', () => {
    it('should have positive spawn candidate count', () => {
      expect(SPAWN_CANDIDATE_COUNT).toBeGreaterThan(0);
    });

    it('should have top-K <= candidate count', () => {
      expect(SPAWN_TOP_K).toBeLessThanOrEqual(SPAWN_CANDIDATE_COUNT);
      expect(SPAWN_TOP_K).toBeGreaterThan(0);
    });

    it('should have positive ideal spawn distance', () => {
      expect(IDEAL_SPAWN_DISTANCE).toBeGreaterThan(0);
    });

    it('should have positive spawn distance sigma', () => {
      expect(SPAWN_DISTANCE_SIGMA).toBeGreaterThan(0);
    });

    it('should have positive search/cooldown radii', () => {
      expect(COVER_SEARCH_RADIUS).toBeGreaterThan(0);
      expect(SPAWN_COOLDOWN_RADIUS).toBeGreaterThan(0);
    });

    it('should have valid spawn weights', () => {
      expect(SPAWN_WEIGHTS.distance).toBeGreaterThan(0);
      expect(SPAWN_WEIGHTS.los).toBeGreaterThan(0);
      expect(SPAWN_WEIGHTS.cover).toBeGreaterThan(0);
      expect(SPAWN_WEIGHTS.flow).toBeGreaterThan(0);
      expect(SPAWN_WEIGHTS.recent).toBeGreaterThan(0);
    });
  });

  describe('server config constants', () => {
    it('should have valid port', () => {
      expect(DEFAULT_PORT).toBeGreaterThan(0);
      expect(DEFAULT_PORT).toBeLessThanOrEqual(65535);
    });

    it('should have positive max rooms', () => {
      expect(MAX_ROOMS).toBeGreaterThan(0);
    });

    it('should have positive keyframe interval', () => {
      expect(KEYFRAME_INTERVAL).toBeGreaterThan(0);
    });
  });

  describe('gameplay balance', () => {
    it('should require at least 5 shots to kill at full HP', () => {
      expect(TANK_MAX_HP).toBeGreaterThanOrEqual(DIRECT_HIT_DAMAGE * 5);
    });

    it('should have max splash damage less than direct hit', () => {
      const maxSplash = DIRECT_HIT_DAMAGE * SPLASH_DAMAGE_FACTOR;
      expect(maxSplash).toBeLessThan(DIRECT_HIT_DAMAGE);
    });

    it('should have reasonable projectile travel time', () => {
      // Projectile should be able to cross the map within TTL
      const mapDiag = Math.sqrt(MAP_WIDTH ** 2 + MAP_DEPTH ** 2);
      const maxTravelDist = MUZZLE_VELOCITY * (PROJECTILE_TTL / 1000);
      expect(maxTravelDist).toBeGreaterThan(mapDiag * 0.5);
    });

    it('should have reload time longer than TTL tick interval', () => {
      expect(RELOAD_TIME).toBeGreaterThan(TICK_INTERVAL);
    });

    it('should have respawn delay longer than reload time', () => {
      expect(RESPAWN_DELAY).toBeGreaterThan(RELOAD_TIME);
    });
  });
});
