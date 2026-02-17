import { describe, it, expect } from 'vitest';
import { Vec3 } from '@tankgame/shared';
import { MapGenerator } from '../../packages/server/src/MapGenerator.js';

describe('MapGenerator', () => {
  describe('generate', () => {
    it('should generate a map with valid dimensions', () => {
      const map = MapGenerator.generate(12345);
      expect(map.width).toBe(400);
      expect(map.depth).toBe(400);
      expect(map.resolution).toBe(128);
    });

    it('should generate heightmap with correct size', () => {
      const map = MapGenerator.generate(12345);
      expect(map.heightmap.length).toBe(128 * 128);
    });

    it('should generate spawn zones', () => {
      const map = MapGenerator.generate(12345);
      expect(map.spawnZones.length).toBeGreaterThanOrEqual(4);
      for (const zone of map.spawnZones) {
        expect(zone.radius).toBeGreaterThan(0);
      }
    });

    it('should generate covers', () => {
      const map = MapGenerator.generate(12345);
      expect(map.covers.length).toBeGreaterThan(0);
      for (const cover of map.covers) {
        expect(cover.radius).toBeGreaterThan(0);
        expect(cover.height).toBeGreaterThan(0);
      }
    });

    it('should produce deterministic maps from same seed', () => {
      const map1 = MapGenerator.generate(42);
      const map2 = MapGenerator.generate(42);
      expect(map1.heightmap).toEqual(map2.heightmap);
      expect(map1.covers.length).toBe(map2.covers.length);
    });

    it('should produce different maps from different seeds', () => {
      const map1 = MapGenerator.generate(1);
      const map2 = MapGenerator.generate(2);
      
      let sameCount = 0;
      for (let i = 0; i < map1.heightmap.length; i++) {
        if (map1.heightmap[i] === map2.heightmap[i]) sameCount++;
      }
      // 绝大部分高度值应该不同
      expect(sameCount / map1.heightmap.length).toBeLessThan(0.1);
    });

    it('should store the seed', () => {
      const map = MapGenerator.generate(99999);
      expect(map.seed).toBe(99999);
    });
  });

  describe('getHeightAt', () => {
    it('should return height at center', () => {
      const map = MapGenerator.generate(12345);
      const h = MapGenerator.getHeightAt(map, 0, 0);
      expect(typeof h).toBe('number');
      expect(isFinite(h)).toBe(true);
    });

    it('should return 0 outside bounds', () => {
      const map = MapGenerator.generate(12345);
      const h = MapGenerator.getHeightAt(map, 9999, 9999);
      expect(h).toBe(0);
    });

    it('should interpolate smoothly', () => {
      const map = MapGenerator.generate(12345);
      const h1 = MapGenerator.getHeightAt(map, 10, 10);
      const h2 = MapGenerator.getHeightAt(map, 10.01, 10.01);
      // 相邻点高度差应该很小
      expect(Math.abs(h1 - h2)).toBeLessThan(1);
    });

    it('should handle negative coordinates', () => {
      const map = MapGenerator.generate(12345);
      const h = MapGenerator.getHeightAt(map, -50, -50);
      expect(typeof h).toBe('number');
      expect(isFinite(h)).toBe(true);
    });
  });

  describe('getNormalAt', () => {
    it('should return a unit vector', () => {
      const map = MapGenerator.generate(12345);
      const normal = MapGenerator.getNormalAt(map, 0, 0);
      expect(normal.length()).toBeCloseTo(1, 2);
    });

    it('should point roughly upward on flat areas', () => {
      const map = MapGenerator.generate(12345);
      const normal = MapGenerator.getNormalAt(map, 0, 0);
      expect(normal.y).toBeGreaterThan(0.5); // 大致向上
    });
  });

  describe('validate', () => {
    it('should validate a generated map', () => {
      const map = MapGenerator.generate(12345);
      const result = MapGenerator.validate(map);
      expect(typeof result.isValid).toBe('boolean');
      expect(typeof result.slopeExceedance).toBe('number');
      expect(typeof result.fairness).toBe('number');
      expect(result.slopeExceedance).toBeLessThan(1);
      expect(result.fairness).toBeGreaterThan(0);
    });

    it('should have reasonable slope exceedance', () => {
      const map = MapGenerator.generate(12345);
      const result = MapGenerator.validate(map);
      // 坡度修正后超限面积应该受控
      expect(result.slopeExceedance).toBeLessThan(0.3);
    });
  });
});
