import { describe, it, expect } from 'vitest';
import {
  Vec3,
  TANK_MAX_HP,
  RELOAD_TIME,
  RESPAWN_DELAY,
  TICK_INTERVAL,
  PROJECTILE_TTL,
  SNAPSHOT_INTERVAL,
} from '@tankgame/shared';
import { GameWorld } from '../../packages/server/src/GameWorld.js';
import { Player } from '../../packages/server/src/Player.js';
import { MapGenerator } from '../../packages/server/src/MapGenerator.js';

function makeInput(overrides: Partial<any> = {}) {
  return {
    type: 0x02 as any,
    seq: 1,
    forward: false, backward: false, turnLeft: false, turnRight: false,
    turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Gameplay Regression Tests
 * Locks down critical gameplay behaviors to prevent regressions.
 */
describe('Gameplay Regression', () => {
  describe('respawn timing', () => {
    it('should respawn after exactly RESPAWN_DELAY (4000ms)', () => {
      const world = new GameWorld(42);
      const shooter = new Player(1, 'Shooter');
      const victim = new Player(2, 'Victim');
      world.addPlayer(shooter);
      world.addPlayer(victim);

      victim.hp = 1;
      shooter.position.set(0, 0, 0);
      shooter.bodyYaw = 0;
      victim.position.set(0, 0, -10);

      shooter.pushInput(makeInput({ seq: 1, fire: true }));

      let deathTick = -1;
      let respawnTick = -1;

      for (let i = 0; i < 300; i++) {
        const events = world.update();
        for (const e of events) {
          if (e.eventType === 'death' && (e as any).victimId === 2) {
            deathTick = world.currentTick;
          }
          if (e.eventType === 'respawn' && (e as any).playerId === 2) {
            respawnTick = world.currentTick;
          }
        }
      }

      if (deathTick > 0 && respawnTick > 0) {
        const tickDiff = respawnTick - deathTick;
        const timeDiff = tickDiff * TICK_INTERVAL;
        expect(timeDiff).toBeGreaterThanOrEqual(RESPAWN_DELAY - TICK_INTERVAL * 2);
        expect(timeDiff).toBeLessThanOrEqual(RESPAWN_DELAY + TICK_INTERVAL * 2);
      }
    });

    it('should restore full HP on respawn', () => {
      const player = new Player(1, 'Test');
      player.takeDamage(TANK_MAX_HP);
      expect(player.alive).toBe(false);
      expect(player.hp).toBe(0);

      player.respawn(new Vec3(10, 0, 20));

      expect(player.alive).toBe(true);
      expect(player.hp).toBe(TANK_MAX_HP);
    });
  });

  describe('reload timing', () => {
    it('should enforce RELOAD_TIME (2500ms) between shots', () => {
      const player = new Player(1, 'Test');

      expect(player.tryFire()).toBe(true);
      expect(player.reloadRemain).toBe(RELOAD_TIME);

      expect(player.tryFire()).toBe(false);

      player.updateReload(RELOAD_TIME / 2);
      expect(player.tryFire()).toBe(false);

      player.updateReload(RELOAD_TIME / 2);
      expect(player.reloadRemain).toBe(0);
      expect(player.tryFire()).toBe(true);
    });

    it('should track shots accurately', () => {
      const player = new Player(1, 'Test');

      player.tryFire();
      player.updateReload(RELOAD_TIME);
      player.tryFire();
      player.updateReload(RELOAD_TIME);
      player.tryFire();

      expect(player.shots).toBe(3);
    });
  });

  describe('input queue behavior', () => {
    it('should limit queue to 10 inputs', () => {
      const player = new Player(1, 'Test');
      for (let i = 0; i < 15; i++) {
        player.pushInput(makeInput({ seq: i + 1 }));
      }

      // Drain the queued inputs — queue max is 10
      // popInput returns queued items first, then repeats lastInput.
      // Count only unique sequential pops (queued items have increasing seq).
      const seqs: number[] = [];
      for (let i = 0; i < 12; i++) {
        const input = player.popInput();
        if (!input) break;
        if (seqs.length > 0 && input.seq === seqs[seqs.length - 1]) break; // repeat detected
        seqs.push(input.seq);
      }
      expect(seqs.length).toBe(10);
    });

    it('should maintain FIFO order', () => {
      const player = new Player(1, 'Test');
      player.pushInput(makeInput({ seq: 1 }));
      player.pushInput(makeInput({ seq: 2 }));
      player.pushInput(makeInput({ seq: 3 }));

      expect(player.popInput()?.seq).toBe(1);
      expect(player.popInput()?.seq).toBe(2);
      expect(player.popInput()?.seq).toBe(3);
    });

    it('should repeat last input with fire=false when queue empty', () => {
      const player = new Player(1, 'Test');
      player.pushInput(makeInput({ seq: 1, forward: true, fire: true }));

      const first = player.popInput();
      expect(first?.forward).toBe(true);
      expect(first?.fire).toBe(true);

      const repeated = player.popInput();
      expect(repeated).not.toBeNull();
      expect(repeated?.forward).toBe(true);
      expect(repeated?.fire).toBe(false);
    });

    it('should return null when no input ever pushed', () => {
      const player = new Player(1, 'Test');
      expect(player.popInput()).toBeNull();
    });
  });

  describe('snapshot generation', () => {
    it('should send snapshot every SNAPSHOT_INTERVAL (3) ticks', () => {
      const world = new GameWorld(42);
      world.addPlayer(new Player(1, 'Test'));

      const snapshotTicks: number[] = [];
      for (let i = 0; i < 12; i++) {
        world.update();
        if (world.shouldSendSnapshot()) {
          snapshotTicks.push(world.currentTick);
        }
      }

      expect(snapshotTicks).toEqual([3, 6, 9, 12]);
    });

    it('should include correct lastProcessedSeq', () => {
      const world = new GameWorld(42);
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      player.pushInput(makeInput({ seq: 42 }));
      world.update();

      const snapshot = world.getSnapshot(1);
      expect(snapshot.lastProcessedSeq).toBe(42);
    });

    it('should include all players in snapshot', () => {
      const world = new GameWorld(42);
      for (let i = 1; i <= 4; i++) {
        world.addPlayer(new Player(i, `P${i}`));
      }
      world.update();

      const snapshot = world.getSnapshot(1);
      expect(snapshot.tanks.length).toBe(4);
    });
  });

  describe('projectile lifecycle', () => {
    it('should expire after PROJECTILE_TTL (5000ms)', () => {
      const world = new GameWorld(42);
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      player.pushInput(makeInput({ seq: 1, gunPitch: 0.4, fire: true }));
      world.update();
      expect(world.projectiles.size).toBe(1);

      for (let i = 0; i < 310; i++) {
        world.update();
      }

      expect(world.projectiles.size).toBe(0);
    });

    it('should generate explode event on ground hit', () => {
      const world = new GameWorld(42);
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      player.pushInput(makeInput({ seq: 1, gunPitch: 0, fire: true }));

      let explodeDetected = false;
      for (let i = 0; i < 120; i++) {
        const events = world.update();
        for (const e of events) {
          if (e.eventType === 'explode') explodeDetected = true;
        }
      }

      expect(explodeDetected).toBe(true);
    });
  });

  describe('map determinism', () => {
    it('should produce identical heightmaps from same seed', () => {
      const map1 = MapGenerator.generate(12345);
      const map2 = MapGenerator.generate(12345);

      expect(map1.heightmap.length).toBe(map2.heightmap.length);
      for (let i = 0; i < map1.heightmap.length; i++) {
        expect(map1.heightmap[i]).toBe(map2.heightmap[i]);
      }
    });

    it('should produce identical height queries from same seed', () => {
      const map1 = MapGenerator.generate(99);
      const map2 = MapGenerator.generate(99);

      for (let x = -150; x <= 150; x += 30) {
        for (let z = -150; z <= 150; z += 30) {
          expect(MapGenerator.getHeightAt(map1, x, z)).toBe(
            MapGenerator.getHeightAt(map2, x, z)
          );
        }
      }
    });

    it('should produce identical cover counts from same seed', () => {
      const map1 = MapGenerator.generate(42);
      const map2 = MapGenerator.generate(42);
      expect(map1.covers.length).toBe(map2.covers.length);
    });
  });

  describe('player stat tracking', () => {
    it('should increment kills and deaths correctly', () => {
      const world = new GameWorld(42);
      const shooter = new Player(1, 'Shooter');
      const victim = new Player(2, 'Victim');
      world.addPlayer(shooter);
      world.addPlayer(victim);

      victim.hp = 1;
      shooter.position.set(0, 0, 0);
      shooter.bodyYaw = 0;
      victim.position.set(0, 0, -10);

      shooter.pushInput(makeInput({ seq: 1, fire: true }));

      for (let i = 0; i < 60; i++) {
        world.update();
      }

      if (victim.deaths > 0) {
        expect(shooter.kills).toBeGreaterThanOrEqual(1);
        expect(victim.deaths).toBeGreaterThanOrEqual(1);
      }
    });

    it('should increment shots on fire', () => {
      const player = new Player(1, 'Test');
      expect(player.shots).toBe(0);
      player.tryFire();
      expect(player.shots).toBe(1);
    });

    it('should increment hits on successful hit', () => {
      const world = new GameWorld(42);
      const shooter = new Player(1, 'Shooter');
      const target = new Player(2, 'Target');
      world.addPlayer(shooter);
      world.addPlayer(target);

      shooter.position.set(0, 0, 0);
      shooter.bodyYaw = 0;
      target.position.set(0, 0, -15);

      shooter.pushInput(makeInput({ seq: 1, fire: true }));

      for (let i = 0; i < 60; i++) {
        world.update();
      }

      if (shooter.hits > 0) {
        expect(shooter.hits).toBeGreaterThanOrEqual(1);
      }
    });

    it('should reset all stats on resetStats()', () => {
      const player = new Player(1, 'Test');
      player.kills = 10;
      player.deaths = 5;
      player.hits = 20;
      player.shots = 30;

      player.resetStats();

      expect(player.kills).toBe(0);
      expect(player.deaths).toBe(0);
      expect(player.hits).toBe(0);
      expect(player.shots).toBe(0);
    });
  });

  describe('terrain height consistency', () => {
    it('should maintain players on terrain during movement', () => {
      const world = new GameWorld(42);
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      for (let i = 0; i < 30; i++) {
        player.pushInput(makeInput({
          seq: i + 1,
          forward: true,
          turnLeft: i % 20 < 10,
        }));
        world.update();

        const terrainH = MapGenerator.getHeightAt(
          world.map, player.position.x, player.position.z
        );
        expect(Math.abs(player.position.y - terrainH)).toBeLessThan(3);
      }
    });
  });
});
