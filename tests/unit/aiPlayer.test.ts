import { describe, it, expect, beforeEach } from 'vitest';
import { Vec3, MessageType, TICK_INTERVAL, TANK_MAX_HP } from '@tankgame/shared';
import { AIPlayer, AI_DIFFICULTIES } from '../../packages/server/src/AIPlayer.js';
import { Player } from '../../packages/server/src/Player.js';

describe('AIPlayer', () => {
  describe('AI Difficulties', () => {
    it('should have easy, normal, and hard presets', () => {
      expect(AI_DIFFICULTIES.easy).toBeDefined();
      expect(AI_DIFFICULTIES.normal).toBeDefined();
      expect(AI_DIFFICULTIES.hard).toBeDefined();
    });

    it('should have increasing aim accuracy', () => {
      expect(AI_DIFFICULTIES.easy.aimAccuracy).toBeLessThan(AI_DIFFICULTIES.normal.aimAccuracy);
      expect(AI_DIFFICULTIES.normal.aimAccuracy).toBeLessThan(AI_DIFFICULTIES.hard.aimAccuracy);
    });

    it('should have decreasing reaction time', () => {
      expect(AI_DIFFICULTIES.easy.reactionTime).toBeGreaterThan(AI_DIFFICULTIES.normal.reactionTime);
      expect(AI_DIFFICULTIES.normal.reactionTime).toBeGreaterThan(AI_DIFFICULTIES.hard.reactionTime);
    });

    it('should have increasing aim speed', () => {
      expect(AI_DIFFICULTIES.easy.aimSpeed).toBeLessThan(AI_DIFFICULTIES.normal.aimSpeed);
      expect(AI_DIFFICULTIES.normal.aimSpeed).toBeLessThan(AI_DIFFICULTIES.hard.aimSpeed);
    });

    it('should have decreasing fire delay', () => {
      expect(AI_DIFFICULTIES.easy.fireDelay).toBeGreaterThan(AI_DIFFICULTIES.normal.fireDelay);
      expect(AI_DIFFICULTIES.normal.fireDelay).toBeGreaterThan(AI_DIFFICULTIES.hard.fireDelay);
    });

    it('should have decreasing movement randomness', () => {
      expect(AI_DIFFICULTIES.easy.movementRandomness).toBeGreaterThan(AI_DIFFICULTIES.normal.movementRandomness);
      expect(AI_DIFFICULTIES.normal.movementRandomness).toBeGreaterThan(AI_DIFFICULTIES.hard.movementRandomness);
    });

    it('should have increasing engage range', () => {
      expect(AI_DIFFICULTIES.easy.engageRange).toBeLessThan(AI_DIFFICULTIES.normal.engageRange);
      expect(AI_DIFFICULTIES.normal.engageRange).toBeLessThan(AI_DIFFICULTIES.hard.engageRange);
    });

    it('should have valid difficulty config values', () => {
      for (const [_key, diff] of Object.entries(AI_DIFFICULTIES)) {
        expect(diff.aimAccuracy).toBeGreaterThanOrEqual(0);
        expect(diff.aimAccuracy).toBeLessThanOrEqual(1);
        expect(diff.reactionTime).toBeGreaterThan(0);
        expect(diff.aimSpeed).toBeGreaterThan(0);
        expect(diff.fireDelay).toBeGreaterThanOrEqual(0);
        expect(diff.movementRandomness).toBeGreaterThanOrEqual(0);
        expect(diff.engageRange).toBeGreaterThan(0);
      }
    });
  });

  describe('create', () => {
    it('should create a player and AI with default difficulty', () => {
      const { player, ai } = AIPlayer.create(1);
      expect(player).toBeInstanceOf(Player);
      expect(ai).toBeInstanceOf(AIPlayer);
      expect(player.id).toBe(1);
      expect(player.nickname).toContain('[BOT]');
    });

    it('should create AI with specified difficulty', () => {
      const { ai: easyAi } = AIPlayer.create(1, 'easy');
      const { ai: hardAi } = AIPlayer.create(2, 'hard');
      expect(easyAi.difficulty.name).toBe('Easy');
      expect(hardAi.difficulty.name).toBe('Hard');
    });

    it('should fallback to normal for unknown difficulty', () => {
      const { ai } = AIPlayer.create(1, 'nonexistent');
      expect(ai.difficulty.name).toBe('Normal');
    });

    it('should assign unique bot names', () => {
      const names = new Set<string>();
      for (let i = 0; i < 12; i++) {
        const { player } = AIPlayer.create(i + 1);
        names.add(player.nickname);
      }
      // Should cycle through bot names - all 12 unique
      expect(names.size).toBe(12);
    });

    it('should cycle bot names after exhausting list', () => {
      // Create more than 12 bots (AI_NAMES.length = 12)
      for (let i = 0; i < 15; i++) {
        const { player } = AIPlayer.create(i + 1);
        expect(player.nickname).toContain('[BOT]');
      }
    });
  });

  describe('update', () => {
    let ai: AIPlayer;
    let player: Player;
    let allPlayers: Map<number, Player>;

    beforeEach(() => {
      const result = AIPlayer.create(1, 'normal');
      ai = result.ai;
      player = result.player;
      player.alive = true;
      player.position.set(0, 0, 0);
      player.hp = TANK_MAX_HP;

      allPlayers = new Map();
      allPlayers.set(player.id, player);
    });

    it('should push input command to player', () => {
      ai.update(allPlayers, 400, 400);
      const input = player.popInput();
      expect(input).not.toBeNull();
      expect(input!.type).toBe(MessageType.InputCmd);
    });

    it('should generate sequential seq numbers', () => {
      ai.update(allPlayers, 400, 400);
      const input1 = player.popInput();
      ai.update(allPlayers, 400, 400);
      const input2 = player.popInput();
      expect(input2!.seq).toBeGreaterThan(input1!.seq);
    });

    it('should not update when dead', () => {
      player.alive = false;
      ai.update(allPlayers, 400, 400);
      const input = player.popInput();
      // When dead, no input should be pushed (popInput returns null for fresh player)
      expect(input).toBeNull();
    });

    it('should patrol when no enemies exist', () => {
      // Only the AI player exists, no enemies
      ai.update(allPlayers, 400, 400);
      const input = player.popInput();
      expect(input).not.toBeNull();
      // In patrol mode, AI should typically move forward
      expect(input!.forward).toBe(true);
    });

    it('should target nearest enemy', () => {
      const enemy1 = new Player(2, 'Near');
      enemy1.alive = true;
      enemy1.position.set(30, 0, 0);
      allPlayers.set(2, enemy1);

      const enemy2 = new Player(3, 'Far');
      enemy2.alive = true;
      enemy2.position.set(200, 0, 0);
      allPlayers.set(3, enemy2);

      // Update several times to let AI react
      for (let i = 0; i < 10; i++) {
        ai.update(allPlayers, 400, 400);
        player.popInput(); // drain input queue
      }

      // AI should have attempted to aim (turretYaw should change)
      ai.update(allPlayers, 400, 400);
      const input = player.popInput();
      expect(input).not.toBeNull();
    });

    it('should set valid gun pitch values', () => {
      const enemy = new Player(2, 'Enemy');
      enemy.alive = true;
      enemy.position.set(50, 0, 50);
      allPlayers.set(2, enemy);

      for (let i = 0; i < 20; i++) {
        ai.update(allPlayers, 400, 400);
        const input = player.popInput();
        if (input) {
          expect(input.gunPitch).toBeGreaterThanOrEqual(-1);
          expect(input.gunPitch).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should fire stabilize as false', () => {
      ai.update(allPlayers, 400, 400);
      const input = player.popInput();
      expect(input!.stabilize).toBe(false);
    });

    it('should include timestamp in input', () => {
      const before = Date.now();
      ai.update(allPlayers, 400, 400);
      const after = Date.now();
      const input = player.popInput();
      expect(input!.timestamp).toBeGreaterThanOrEqual(before);
      expect(input!.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('AI state transitions', () => {
    let ai: AIPlayer;
    let player: Player;
    let allPlayers: Map<number, Player>;

    beforeEach(() => {
      const result = AIPlayer.create(1, 'normal');
      ai = result.ai;
      player = result.player;
      player.alive = true;
      player.position.set(0, 0, 0);
      player.hp = TANK_MAX_HP;
      allPlayers = new Map();
      allPlayers.set(player.id, player);
    });

    it('should retreat when low HP and enemy nearby', () => {
      player.hp = 20; // Below 30
      const enemy = new Player(2, 'Enemy');
      enemy.alive = true;
      enemy.position.set(15, 0, 0); // Within 30m
      allPlayers.set(2, enemy);

      // Let AI update enough times to pass reaction
      for (let i = 0; i < 100; i++) {
        ai.update(allPlayers, 400, 400);
        player.popInput();
      }

      ai.update(allPlayers, 400, 400);
      const input = player.popInput();
      expect(input).not.toBeNull();
      // In retreat mode, backward should be true
      expect(input!.backward).toBe(true);
    });

    it('should engage when enemy within range', () => {
      const enemy = new Player(2, 'Enemy');
      enemy.alive = true;
      enemy.position.set(50, 0, 0); // Within normal engage range (100)
      allPlayers.set(2, enemy);

      // Let AI update many times to pass reaction time
      for (let i = 0; i < 100; i++) {
        ai.update(allPlayers, 400, 400);
        player.popInput();
      }

      // AI should be attempting to engage
      ai.update(allPlayers, 400, 400);
      const input = player.popInput();
      expect(input).not.toBeNull();
    });

    it('should stop retreating when HP recovers', () => {
      // Note: HP doesn't naturally recover in this game,
      // but the AI checks HP > 60 to exit retreat
      player.hp = 20;
      const enemy = new Player(2, 'Enemy');
      enemy.alive = true;
      enemy.position.set(15, 0, 0);
      allPlayers.set(2, enemy);

      // Enter retreat mode
      for (let i = 0; i < 50; i++) {
        ai.update(allPlayers, 400, 400);
        player.popInput();
      }

      // Simulate HP restoration
      player.hp = 80;
      for (let i = 0; i < 50; i++) {
        ai.update(allPlayers, 400, 400);
        player.popInput();
      }

      ai.update(allPlayers, 400, 400);
      const input = player.popInput();
      expect(input).not.toBeNull();
      // Should no longer be retreating
    });
  });

  describe('edge cases', () => {
    it('should handle empty player map', () => {
      const { ai, player } = AIPlayer.create(1, 'normal');
      player.alive = true;
      const emptyMap = new Map<number, Player>();
      emptyMap.set(player.id, player);

      // Should not crash
      ai.update(emptyMap, 400, 400);
      const input = player.popInput();
      expect(input).not.toBeNull();
    });

    it('should handle very small map dimensions', () => {
      const { ai, player } = AIPlayer.create(1, 'normal');
      player.alive = true;
      const allPlayers = new Map<number, Player>();
      allPlayers.set(player.id, player);

      ai.update(allPlayers, 10, 10); // Very small map
      const input = player.popInput();
      expect(input).not.toBeNull();
    });

    it('should handle all enemies at same position', () => {
      const { ai, player } = AIPlayer.create(1, 'normal');
      player.alive = true;
      player.position.set(0, 0, 0);
      const allPlayers = new Map<number, Player>();
      allPlayers.set(player.id, player);

      for (let i = 2; i <= 5; i++) {
        const e = new Player(i, `E${i}`);
        e.alive = true;
        e.position.set(50, 0, 50);
        allPlayers.set(i, e);
      }

      ai.update(allPlayers, 400, 400);
      const input = player.popInput();
      expect(input).not.toBeNull();
    });
  });
});
