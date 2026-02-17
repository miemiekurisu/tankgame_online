import { describe, it, expect, beforeEach } from 'vitest';
import { Vec3, TANK_MAX_HP } from '@tankgame/shared';
import { Player } from '../../packages/server/src/Player.js';

describe('Player', () => {
  let player: Player;

  beforeEach(() => {
    player = new Player(1, 'TestPlayer');
  });

  describe('creation', () => {
    it('should initialize with correct id and nickname', () => {
      expect(player.id).toBe(1);
      expect(player.nickname).toBe('TestPlayer');
    });

    it('should start with full HP', () => {
      expect(player.hp).toBe(TANK_MAX_HP);
      expect(player.alive).toBe(true);
    });

    it('should start with zero stats', () => {
      expect(player.kills).toBe(0);
      expect(player.deaths).toBe(0);
      expect(player.hits).toBe(0);
      expect(player.shots).toBe(0);
    });

    it('should start at origin', () => {
      expect(player.position.x).toBe(0);
      expect(player.position.y).toBe(0);
      expect(player.position.z).toBe(0);
    });
  });

  describe('takeDamage', () => {
    it('should reduce HP', () => {
      player.takeDamage(30);
      expect(player.hp).toBe(TANK_MAX_HP - 30);
    });

    it('should not go below 0', () => {
      player.takeDamage(TANK_MAX_HP + 50);
      expect(player.hp).toBe(0);
    });

    it('should return true when lethal', () => {
      expect(player.takeDamage(TANK_MAX_HP)).toBe(true);
      expect(player.alive).toBe(false);
    });

    it('should return false when not lethal', () => {
      expect(player.takeDamage(50)).toBe(false);
      expect(player.alive).toBe(true);
    });

    it('should ignore damage when dead', () => {
      player.takeDamage(TANK_MAX_HP);
      expect(player.takeDamage(50)).toBe(false);
    });
  });

  describe('respawn', () => {
    it('should reset HP and position', () => {
      player.takeDamage(TANK_MAX_HP);
      const spawnPos = new Vec3(10, 5, 20);
      player.respawn(spawnPos);

      expect(player.alive).toBe(true);
      expect(player.hp).toBe(TANK_MAX_HP);
      expect(player.position.x).toBe(10);
      expect(player.position.y).toBe(5);
      expect(player.position.z).toBe(20);
    });

    it('should reset velocity', () => {
      player.velocity.set(5, 0, 5);
      player.respawn(new Vec3(0, 0, 0));
      expect(player.velocity.length()).toBe(0);
    });

    it('should record spawn position', () => {
      player.respawn(new Vec3(10, 0, 20));
      expect(player.lastSpawnPositions.length).toBe(1);
      expect(player.lastSpawnPositions[0].x).toBe(10);
    });

    it('should limit spawn history to 5', () => {
      for (let i = 0; i < 10; i++) {
        player.respawn(new Vec3(i, 0, 0));
      }
      expect(player.lastSpawnPositions.length).toBe(5);
    });
  });

  describe('tryFire', () => {
    it('should succeed with no reload', () => {
      expect(player.tryFire()).toBe(true);
      expect(player.shots).toBe(1);
      expect(player.reloadRemain).toBe(2500);
    });

    it('should fail during reload', () => {
      player.tryFire();
      expect(player.tryFire()).toBe(false);
      expect(player.shots).toBe(1);
    });

    it('should fail when dead', () => {
      player.takeDamage(TANK_MAX_HP);
      expect(player.tryFire()).toBe(false);
    });

    it('should succeed after reload completes', () => {
      player.tryFire();
      player.updateReload(2500);
      expect(player.tryFire()).toBe(true);
      expect(player.shots).toBe(2);
    });
  });

  describe('updateReload', () => {
    it('should decrease reload timer', () => {
      player.reloadRemain = 2500;
      player.updateReload(1000);
      expect(player.reloadRemain).toBe(1500);
    });

    it('should not go below 0', () => {
      player.reloadRemain = 500;
      player.updateReload(1000);
      expect(player.reloadRemain).toBe(0);
    });

    it('should do nothing when no reload', () => {
      player.reloadRemain = 0;
      player.updateReload(1000);
      expect(player.reloadRemain).toBe(0);
    });
  });

  describe('input queue', () => {
    it('should push and pop inputs', () => {
      const cmd = { seq: 1, forward: true } as any;
      player.pushInput(cmd);
      const popped = player.popInput();
      expect(popped?.seq).toBe(1);
    });

    it('should return null when empty and no lastInput', () => {
      expect(player.popInput()).toBeNull();
    });

    it('should repeat lastInput with fire=false when queue empty', () => {
      player.pushInput({ seq: 1, forward: true, fire: true } as any);
      const first = player.popInput();
      expect(first?.fire).toBe(true);
      // Queue empty but lastInput exists
      const repeated = player.popInput();
      expect(repeated).not.toBeNull();
      expect(repeated?.forward).toBe(true);
      expect(repeated?.fire).toBe(false);
    });

    it('should limit queue size to 10', () => {
      for (let i = 0; i < 15; i++) {
        player.pushInput({ seq: i } as any);
      }
      // Only the first 10 should be queued (pushInput ignores when >= 10)
      const seqs: number[] = [];
      for (let i = 0; i < 10; i++) {
        seqs.push(player.popInput()!.seq);
      }
      expect(seqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should maintain FIFO order', () => {
      player.pushInput({ seq: 1 } as any);
      player.pushInput({ seq: 2 } as any);
      player.pushInput({ seq: 3 } as any);
      expect(player.popInput()?.seq).toBe(1);
      expect(player.popInput()?.seq).toBe(2);
      expect(player.popInput()?.seq).toBe(3);
    });
  });

  describe('toSnapshot', () => {
    it('should return correct snapshot data', () => {
      player.position.set(10, 5, 20);
      player.bodyYaw = 1.5;
      player.hp = 80;
      player.kills = 3;
      player.deaths = 1;

      const snapshot = player.toSnapshot();
      expect(snapshot.entityId).toBe(1);
      expect(snapshot.position.x).toBe(10);
      expect(snapshot.hp).toBe(80);
      expect(snapshot.bodyYaw).toBe(1.5);
      expect(snapshot.alive).toBe(true);
      expect(snapshot.kills).toBe(3);
      expect(snapshot.deaths).toBe(1);
    });

    it('should clone position (independent)', () => {
      player.position.set(10, 0, 0);
      const snapshot = player.toSnapshot();
      player.position.x = 99;
      expect(snapshot.position.x).toBe(10);
    });
  });

  describe('toScore', () => {
    it('should return correct score data', () => {
      player.kills = 5;
      player.deaths = 2;
      player.hits = 10;
      player.shots = 20;

      const score = player.toScore();
      expect(score.playerId).toBe(1);
      expect(score.nickname).toBe('TestPlayer');
      expect(score.kills).toBe(5);
      expect(score.deaths).toBe(2);
      expect(score.hits).toBe(10);
      expect(score.shots).toBe(20);
    });
  });

  describe('resetStats', () => {
    it('should reset all stats to 0', () => {
      player.kills = 10;
      player.deaths = 5;
      player.hits = 20;
      player.shots = 40;
      player.resetStats();

      expect(player.kills).toBe(0);
      expect(player.deaths).toBe(0);
      expect(player.hits).toBe(0);
      expect(player.shots).toBe(0);
    });
  });

  describe('getPhysicsState', () => {
    it('should return references to physics state', () => {
      player.position.set(1, 2, 3);
      player.bodyYaw = 0.5;
      const state = player.getPhysicsState();
      expect(state.position).toBe(player.position); // 同一引用
      expect(state.bodyYaw).toBe(0.5);
    });
  });
});
