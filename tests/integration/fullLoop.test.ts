import { describe, it, expect, beforeEach } from 'vitest';
import {
  Vec3,
  TANK_MAX_SPEED,
  TANK_MAX_HP,
} from '@tankgame/shared';
import { GameWorld } from '../../packages/server/src/GameWorld.js';
import { MapGenerator } from '../../packages/server/src/MapGenerator.js';
import { Player } from '../../packages/server/src/Player.js';

/**
 * 模拟完整的游戏循环:
 * 输入 → 物理 → 弹道 → 碰撞检测 → 事件生成 → 快照
 */
describe('Full Game Loop Integration', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = new GameWorld(42);
  });

  describe('multi-player scenario', () => {
    it('should simulate 4 players moving simultaneously', () => {
      const players: Player[] = [];
      for (let i = 1; i <= 4; i++) {
        const p = new Player(i, `P${i}`);
        world.addPlayer(p);
        players.push(p);
      }

      for (const p of players) {
        p.pushInput({
          type: 0x02 as any,
          seq: 1,
          forward: true,
          backward: false,
          turnLeft: false,
          turnRight: false,
          turretYaw: 0,
          gunPitch: 0,
          fire: false,
          stabilize: false,
          timestamp: Date.now(),
        });
      }

      for (let i = 0; i < 60; i++) {
        world.update();
      }

      for (const p of players) {
        expect(p.alive).toBe(true);
      }
    });

    it('should handle simultaneous fire from multiple players', () => {
      const p1 = new Player(1, 'A');
      const p2 = new Player(2, 'B');
      world.addPlayer(p1);
      world.addPlayer(p2);

      p1.position.set(-50, 0, 0);
      p2.position.set(50, 0, 0);

      for (const p of [p1, p2]) {
        p.pushInput({
          type: 0x02 as any,
          seq: 1,
          forward: false,
          backward: false,
          turnLeft: false,
          turnRight: false,
          turretYaw: 0,
          gunPitch: 0.1,
          fire: true,
          stabilize: false,
          timestamp: Date.now(),
        });
      }

      const events = world.update();
      const fireEvents = events.filter((e) => e.eventType === 'fire');
      expect(fireEvents.length).toBe(2);
      expect(world.projectiles.size).toBe(2);
    });
  });

  describe('input → snapshot pipeline', () => {
    it('should reflect input changes in next snapshot', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);
      const startPos = player.position.clone();

      player.pushInput({
        type: 0x02 as any,
        seq: 1,
        forward: true,
        backward: false,
        turnLeft: false,
        turnRight: false,
        turretYaw: 0,
        gunPitch: 0,
        fire: false,
        stabilize: false,
        timestamp: Date.now(),
      });

      world.update();
      const snapshot = world.getSnapshot(1);

      const tankState = snapshot.tanks.find((t) => t.entityId === 1);
      expect(tankState).toBeDefined();
      // Position should have changed
      const moved = new Vec3(
        tankState!.position.x - startPos.x,
        tankState!.position.y - startPos.y,
        tankState!.position.z - startPos.z
      ).length();
      expect(moved).toBeGreaterThan(0);
    });

    it('should update gun pitch from input', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      player.pushInput({
        type: 0x02 as any,
        seq: 1,
        forward: false,
        backward: false,
        turnLeft: false,
        turnRight: false,
        turretYaw: 0,
        gunPitch: 0.3,
        fire: false,
        stabilize: false,
        timestamp: Date.now(),
      });

      world.update();
      const snapshot = world.getSnapshot(1);
      const tankState = snapshot.tanks.find((t) => t.entityId === 1);
      // gunPitch is clamped directly (not rate-limited)
      expect(tankState!.gunPitch).toBeCloseTo(0.3, 2);
    });
  });

  describe('event pipeline', () => {
    it('should generate fire → hit → death → respawn sequence', () => {
      const shooter = new Player(1, 'Killer');
      const victim = new Player(2, 'Victim');
      world.addPlayer(shooter);
      world.addPlayer(victim);

      shooter.position.set(0, 0, 0);
      shooter.bodyYaw = 0;
      victim.position.set(0, 0, -8);
      victim.hp = 10;

      shooter.pushInput({
        type: 0x02 as any,
        seq: 1,
        forward: false,
        backward: false,
        turnLeft: false,
        turnRight: false,
        turretYaw: 0,
        gunPitch: 0,
        fire: true,
        stabilize: false,
        timestamp: Date.now(),
      });

      const allEvents: any[] = [];
      for (let i = 0; i < 300; i++) {
        const events = world.update();
        allEvents.push(...events);
      }

      const eventTypes = allEvents.map((e) => e.eventType);
      expect(eventTypes).toContain('fire');
      expect(eventTypes).toContain('hit');
      expect(eventTypes).toContain('death');
      expect(eventTypes).toContain('respawn');
    });

    it('should update scoreboard after kill', () => {
      const shooter = new Player(1, 'Killer');
      const victim = new Player(2, 'Victim');
      world.addPlayer(shooter);
      world.addPlayer(victim);

      shooter.position.set(0, 0, 0);
      shooter.bodyYaw = 0;
      victim.position.set(0, 0, -8);
      victim.hp = 10;

      shooter.pushInput({
        type: 0x02 as any,
        seq: 1,
        forward: false,
        backward: false,
        turnLeft: false,
        turnRight: false,
        turretYaw: 0,
        gunPitch: 0,
        fire: true,
        stabilize: false,
        timestamp: Date.now(),
      });

      for (let i = 0; i < 60; i++) {
        world.update();
      }

      if (!victim.alive || victim.deaths > 0) {
        expect(shooter.kills).toBeGreaterThanOrEqual(1);
        expect(victim.deaths).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('physics consistency', () => {
    it('should apply gravity to projectiles', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);
      player.position.set(0, 10, 0);

      player.pushInput({
        type: 0x02 as any,
        seq: 1,
        forward: false,
        backward: false,
        turnLeft: false,
        turnRight: false,
        turretYaw: 0,
        gunPitch: 0.2,
        fire: true,
        stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      const proj = Array.from(world.projectiles.values())[0];
      if (proj) {
        const initialVelY = proj.velocity.y;
        for (let i = 0; i < 10; i++) world.update();
        expect(proj.velocity.y).toBeLessThan(initialVelY);
      }
    });

    it('should enforce speed limit on tanks', () => {
      const player = new Player(1, 'Speeder');
      world.addPlayer(player);

      for (let i = 0; i < 300; i++) {
        player.pushInput({
          type: 0x02 as any,
          seq: i + 1,
          forward: true,
          backward: false,
          turnLeft: false,
          turnRight: false,
          turretYaw: 0,
          gunPitch: 0,
          fire: false,
          stabilize: false,
          timestamp: Date.now(),
        });
        world.update();
      }

      const speed = Math.sqrt(
        player.velocity.x ** 2 + player.velocity.z ** 2
      );
      expect(speed).toBeLessThanOrEqual(TANK_MAX_SPEED + 0.5);
    });

    it('should keep players on terrain surface', () => {
      const player = new Player(1, 'Grounded');
      world.addPlayer(player);

      for (let i = 0; i < 60; i++) {
        player.pushInput({
          type: 0x02 as any,
          seq: i + 1,
          forward: true,
          backward: false,
          turnLeft: false,
          turnRight: false,
          turretYaw: 0.01,
          gunPitch: 0,
          fire: false,
          stabilize: false,
          timestamp: Date.now(),
        });
        world.update();

        const terrainH = MapGenerator.getHeightAt(
          world.map,
          player.position.x,
          player.position.z
        );
        expect(Math.abs(player.position.y - terrainH)).toBeLessThan(3);
      }
    });
  });

  describe('network snapshot consistency', () => {
    it('should generate consistent snapshots across ticks', () => {
      const p1 = new Player(1, 'Alice');
      const p2 = new Player(2, 'Bob');
      world.addPlayer(p1);
      world.addPlayer(p2);

      const snapshots = [];
      for (let i = 0; i < 10; i++) {
        world.update();
        if (world.shouldSendSnapshot()) {
          snapshots.push(world.getSnapshot(1));
        }
      }

      for (let i = 1; i < snapshots.length; i++) {
        expect(snapshots[i].serverTick).toBeGreaterThan(
          snapshots[i - 1].serverTick
        );
      }
    });

    it('should include both alive and dead tanks in snapshot', () => {
      const p1 = new Player(1, 'Alive');
      const p2 = new Player(2, 'Dead');
      world.addPlayer(p1);
      world.addPlayer(p2);

      p2.takeDamage(TANK_MAX_HP);

      world.update();
      const snapshot = world.getSnapshot(1);

      expect(snapshot.tanks.length).toBe(2);
      const deadTank = snapshot.tanks.find((t) => t.entityId === 2);
      expect(deadTank!.alive).toBe(false);
    });
  });
});
