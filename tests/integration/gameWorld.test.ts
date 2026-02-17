import { describe, it, expect, beforeEach } from 'vitest';
import { Vec3, TANK_MAX_HP } from '@tankgame/shared';
import { GameWorld } from '../../packages/server/src/GameWorld.js';
import { Player } from '../../packages/server/src/Player.js';

describe('GameWorld Integration', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = new GameWorld(42); // 固定种子
  });

  describe('player lifecycle', () => {
    it('should add and spawn a player', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);

      expect(world.players.size).toBe(1);
      expect(player.alive).toBe(true);
      expect(player.hp).toBe(TANK_MAX_HP);
      // 出生点应该在地图范围内
      expect(Math.abs(player.position.x)).toBeLessThanOrEqual(200);
      expect(Math.abs(player.position.z)).toBeLessThanOrEqual(200);
    });

    it('should add multiple players', () => {
      for (let i = 1; i <= 4; i++) {
        world.addPlayer(new Player(i, `Player${i}`));
      }
      expect(world.players.size).toBe(4);
    });

    it('should remove a player', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);
      world.removePlayer(1);
      expect(world.players.size).toBe(0);
    });
  });

  describe('tick simulation', () => {
    it('should increment tick counter', () => {
      expect(world.currentTick).toBe(0);
      world.update();
      expect(world.currentTick).toBe(1);
    });

    it('should process input and move player', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);
      const startPos = player.position.clone();

      // 添加前进输入
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

      // 玩家应该移动了
      const moved = player.position.distanceTo(startPos);
      expect(moved).toBeGreaterThan(0);
    });

    it('should handle fire and create projectile', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);

      player.pushInput({
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

      const events = world.update();

      // 应该产生 Fire 事件
      const fireEvents = events.filter((e) => e.eventType === 'fire');
      expect(fireEvents.length).toBe(1);
      expect(world.projectiles.size).toBeGreaterThanOrEqual(1);
    });

    it('should not allow firing during reload', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);

      // 第一发
      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: true, stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      // 立即第二发
      player.pushInput({
        type: 0x02 as any, seq: 2,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: true, stabilize: false,
        timestamp: Date.now(),
      });
      const events2 = world.update();

      const fireEvents2 = events2.filter((e) => e.eventType === 'fire');
      expect(fireEvents2.length).toBe(0);
    });
  });

  describe('projectile simulation', () => {
    it('should update projectile positions each tick', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);

      // 开火
      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0.1, fire: true, stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      expect(world.projectiles.size).toBe(1);
      const proj = Array.from(world.projectiles.values())[0];
      const startPos = proj.position.clone();

      // 再更新几次
      for (let i = 0; i < 10; i++) {
        world.update();
      }

      // 弹体应该移动了
      const moved = proj.position.distanceTo(startPos);
      expect(moved).toBeGreaterThan(0);
    });

    it('should remove expired projectiles', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);

      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0.3, fire: true, stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      // 快进足够多 tick 让弹体过期 (5000ms / 16.67ms ≈ 300 ticks)
      for (let i = 0; i < 350; i++) {
        world.update();
      }

      expect(world.projectiles.size).toBe(0);
    });
  });

  describe('combat: hit and death', () => {
    it('should detect hit when projectile reaches target', () => {
      const shooter = new Player(1, 'Shooter');
      const target = new Player(2, 'Target');
      world.addPlayer(shooter);
      world.addPlayer(target);

      // 手动将目标放在射手正前方
      shooter.position.set(0, 0, 0);
      shooter.bodyYaw = 0;
      target.position.set(0, 0, -20); // 正前方 -Z 方向 20m

      // 开火
      shooter.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: true, stabilize: false,
        timestamp: Date.now(),
      });

      let hitDetected = false;
      let deathDetected = false;

      // 模拟足够多 tick
      for (let i = 0; i < 60; i++) {
        const events = world.update();
        for (const e of events) {
          if (e.eventType === 'hit') hitDetected = true;
          if (e.eventType === 'death') deathDetected = true;
        }
      }

      // 在这个距离(20m)、初速(80m/s)下应该能命中
      expect(hitDetected).toBe(true);
    });

    it('should generate death event when HP reaches 0', () => {
      const shooter = new Player(1, 'Shooter');
      const target = new Player(2, 'Target');
      world.addPlayer(shooter);
      world.addPlayer(target);

      // 设置目标 HP 为较低（低于 DIRECT_HIT_DAMAGE=20 即可一击致命）
      target.hp = 15;
      shooter.position.set(0, 0, 0);
      shooter.bodyYaw = 0;
      target.position.set(0, 0, -10);

      shooter.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: true, stabilize: false,
        timestamp: Date.now(),
      });

      let deathDetected = false;
      for (let i = 0; i < 30; i++) {
        const events = world.update();
        for (const e of events) {
          if (e.eventType === 'death') {
            deathDetected = true;
            expect((e as any).victimId).toBe(2);
            expect((e as any).killerId).toBe(1);
          }
        }
      }

      expect(deathDetected).toBe(true);
    });

    it('should respawn dead players after delay', () => {
      const shooter = new Player(1, 'Shooter');
      const target = new Player(2, 'Target');
      world.addPlayer(shooter);
      world.addPlayer(target);

      target.hp = 1;
      shooter.position.set(0, 0, 0);
      shooter.bodyYaw = 0;
      target.position.set(0, 0, -10);

      shooter.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: true, stabilize: false,
        timestamp: Date.now(),
      });

      // 模拟足够 tick 让死亡和复活发生 (4s respawn = ~240 ticks)
      let respawnDetected = false;
      for (let i = 0; i < 300; i++) {
        const events = world.update();
        for (const e of events) {
          if (e.eventType === 'respawn' && (e as any).playerId === 2) {
            respawnDetected = true;
          }
        }
      }

      expect(respawnDetected).toBe(true);
      expect(target.alive).toBe(true);
      expect(target.hp).toBe(TANK_MAX_HP);
    });
  });

  describe('snapshot generation', () => {
    it('should generate snapshot with all players', () => {
      world.addPlayer(new Player(1, 'Alice'));
      world.addPlayer(new Player(2, 'Bob'));
      world.update();

      const snapshot = world.getSnapshot(1);
      expect(snapshot.tanks.length).toBe(2);
      expect(snapshot.serverTick).toBe(1);
    });

    it('should include active projectiles', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);

      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0.1, fire: true, stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      const snapshot = world.getSnapshot(1);
      expect(snapshot.projectiles.length).toBeGreaterThan(0);
    });

    it('should track lastProcessedSeq per player', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);

      player.pushInput({
        type: 0x02 as any, seq: 42,
        forward: true, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      const snapshot = world.getSnapshot(1);
      expect(snapshot.lastProcessedSeq).toBe(42);
    });

    it('shouldSendSnapshot should respect SNAPSHOT_INTERVAL', () => {
      // SNAPSHOT_INTERVAL = TICK_RATE / SNAPSHOT_RATE = 60 / 20 = 3
      world.update(); // tick 1
      expect(world.shouldSendSnapshot()).toBe(false);
      world.update(); // tick 2
      expect(world.shouldSendSnapshot()).toBe(false);
      world.update(); // tick 3
      expect(world.shouldSendSnapshot()).toBe(true);
    });
  });

  describe('world reset', () => {
    it('should reset tick counter and projectiles', () => {
      const player = new Player(1, 'Alice');
      world.addPlayer(player);

      // 模拟一些 tick
      for (let i = 0; i < 10; i++) world.update();
      expect(world.currentTick).toBe(10);

      world.reset(999);
      expect(world.currentTick).toBe(0);
      expect(world.projectiles.size).toBe(0);
    });

    it('should re-spawn all players', () => {
      const p1 = new Player(1, 'Alice');
      const p2 = new Player(2, 'Bob');
      world.addPlayer(p1);
      world.addPlayer(p2);

      p1.kills = 10;
      p2.deaths = 5;

      world.reset(999);

      expect(p1.kills).toBe(0);
      expect(p2.deaths).toBe(0);
      expect(p1.alive).toBe(true);
      expect(p2.alive).toBe(true);
    });
  });

  describe('boundary enforcement', () => {
    it('should keep players within map bounds', () => {
      const player = new Player(1, 'Runner');
      world.addPlayer(player);

      // 强制位移到边界外
      player.position.set(999, 0, 999);
      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: true, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      expect(Math.abs(player.position.x)).toBeLessThanOrEqual(200);
      expect(Math.abs(player.position.z)).toBeLessThanOrEqual(200);
    });
  });
});
