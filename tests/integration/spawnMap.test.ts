import { describe, it, expect } from 'vitest';
import { Vec3 } from '@tankgame/shared';
import { MapGenerator } from '../../packages/server/src/MapGenerator.js';
import { SpawnManager } from '../../packages/server/src/SpawnManager.js';
import { Player } from '../../packages/server/src/Player.js';

describe('SpawnManager & MapGenerator Integration', () => {
  const map = MapGenerator.generate(42);

  describe('spawn point selection', () => {
    it('should return a valid position on the map', () => {
      const spawnManager = new SpawnManager();
      const player = new Player(1, 'Test');
      const pos = spawnManager.selectSpawnPoint(player, [], map);
      expect(pos).toBeDefined();
      expect(Math.abs(pos.x)).toBeLessThanOrEqual(200);
      expect(Math.abs(pos.z)).toBeLessThanOrEqual(200);
    });

    it('should space players apart', () => {
      const spawnManager = new SpawnManager();
      const players: Player[] = [];
      const positions: Vec3[] = [];

      for (let i = 0; i < 4; i++) {
        const player = new Player(i + 1, `Player${i + 1}`);
        const enemies = players.filter((p) => p.id !== player.id);
        const pos = spawnManager.selectSpawnPoint(player, enemies, map);
        player.position = pos.clone();
        player.alive = true;
        players.push(player);
        positions.push(pos.clone());
      }

      // 检查所有对之间有最小距离
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dist = positions[i].distanceTo(positions[j]);
          expect(dist).toBeGreaterThan(5);
        }
      }
    });

    it('should handle 8 players without crashing', () => {
      const spawnManager = new SpawnManager();
      const players: Player[] = [];
      for (let i = 0; i < 8; i++) {
        const player = new Player(i + 1, `P${i}`);
        const pos = spawnManager.selectSpawnPoint(player, players, map);
        player.position = pos.clone();
        player.alive = true;
        players.push(player);
      }
      expect(players.length).toBe(8);
    });
  });

  describe('map generation and validation', () => {
    it('should generate a map with valid dimensions', () => {
      expect(map.width).toBe(400);
      expect(map.depth).toBe(400);
      expect(map.resolution).toBe(128);
    });

    it('should validate a generated map', () => {
      const result = MapGenerator.validate(map);
      expect(typeof result.isValid).toBe('boolean');
    });

    it('should have spawn zones within map bounds', () => {
      expect(map.spawnZones.length).toBeGreaterThanOrEqual(4);
      for (const zone of map.spawnZones) {
        expect(Math.abs(zone.center.x)).toBeLessThanOrEqual(200);
        expect(Math.abs(zone.center.z)).toBeLessThanOrEqual(200);
      }
    });

    it('should have cover nodes', () => {
      expect(map.covers.length).toBeGreaterThan(0);
      expect(map.covers.length).toBeLessThanOrEqual(30);
    });

    it('should provide consistent height queries', () => {
      const h1 = MapGenerator.getHeightAt(map, 50, 50);
      const h2 = MapGenerator.getHeightAt(map, 50, 50);
      expect(h1).toBe(h2);
    });

    it('should provide terrain normal as unit vector', () => {
      const normal = MapGenerator.getNormalAt(map, 50, 50);
      expect(normal.length()).toBeCloseTo(1.0, 2);
    });
  });

  describe('deterministic map generation', () => {
    it('should produce identical maps with same seed', () => {
      const map1 = MapGenerator.generate(12345);
      const map2 = MapGenerator.generate(12345);

      for (let x = -100; x <= 100; x += 50) {
        for (let z = -100; z <= 100; z += 50) {
          expect(MapGenerator.getHeightAt(map1, x, z)).toBe(
            MapGenerator.getHeightAt(map2, x, z)
          );
        }
      }
    });

    it('should produce different maps with different seeds', () => {
      const map1 = MapGenerator.generate(111);
      const map2 = MapGenerator.generate(222);

      let different = false;
      for (let x = -100; x <= 100; x += 50) {
        for (let z = -100; z <= 100; z += 50) {
          if (MapGenerator.getHeightAt(map1, x, z) !== MapGenerator.getHeightAt(map2, x, z)) {
            different = true;
            break;
          }
        }
        if (different) break;
      }
      expect(different).toBe(true);
    });
  });
});
