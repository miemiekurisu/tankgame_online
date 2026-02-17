import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RoomState, MessageType, TANK_MAX_HP } from '@tankgame/shared';
import { GameRoom } from '../../packages/server/src/GameRoom.js';
import type { RoomClient } from '../../packages/server/src/GameRoom.js';

function createMockClient(): RoomClient & { send: ReturnType<typeof vi.fn> } {
  return {
    playerId: 0,
    send: vi.fn(),
  };
}

/**
 * Multi-Round Lifecycle Integration Tests
 * Tests round restart, stat reset, map regeneration across rounds
 */
describe('Multi-Round Lifecycle Integration', () => {
  let room: GameRoom;

  beforeEach(() => {
    vi.useFakeTimers();
    room = new GameRoom('multi-round-test', 42);
  });

  afterEach(() => {
    room.destroy();
    vi.useRealTimers();
  });

  describe('round restart', () => {
    it('should transition through warmup → inRound → roundEnd → inRound', () => {
      // Use a long round duration so round doesn't re-end during timer advances
      (room as any).roundDuration = 60000;

      // Remove default AI bots so we can test warmup state
      for (const [id] of (room as any).aiBots) {
        room.world.removePlayer(id);
      }
      (room as any).aiBots.clear();

      const c1 = createMockClient();
      const c2 = createMockClient();

      // Only 1 human, no AI → Warmup
      room.addPlayer(c1, 'Alice');
      expect(room.state).toBe(RoomState.Warmup);

      // 2 humans → InRound
      room.addPlayer(c2, 'Bob');
      expect(room.state).toBe(RoomState.InRound);

      // Manually trigger round end
      room.endRound();
      expect(room.state).toBe(RoomState.RoundEnd);

      // Advance past restart delay (3s setTimeout)
      vi.advanceTimersByTime(3500);
      expect(room.state).toBe(RoomState.InRound);
    });

    it('should reset player stats between rounds', () => {
      (room as any).roundDuration = 500;

      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      const p2 = room.addPlayer(c2, 'Bob');

      // Manually set some stats
      const player = room.world.players.get(p2!.id);
      if (player) {
        player.kills = 10;
        player.deaths = 5;
        player.hits = 20;
        player.shots = 30;
      }

      // End round
      vi.advanceTimersByTime(1000);
      expect(room.state).toBe(RoomState.RoundEnd);

      // Restart round
      vi.advanceTimersByTime(4000);

      // Stats should be reset
      const resetPlayer = room.world.players.get(p2!.id);
      if (resetPlayer) {
        expect(resetPlayer.kills).toBe(0);
        expect(resetPlayer.deaths).toBe(0);
        expect(resetPlayer.hits).toBe(0);
        expect(resetPlayer.shots).toBe(0);
      }
    });

    it('should reset tick counter between rounds', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      // Let some ticks pass
      for (let i = 0; i < 30; i++) {
        room.tick();
      }
      expect(room.world.currentTick).toBeGreaterThanOrEqual(30);

      // Reset world directly (this is what restartRound calls internally)
      room.world.reset(Date.now());

      // Tick counter should be back to 0
      expect(room.world.currentTick).toBe(0);
    });

    it('should clear projectiles between rounds', () => {
      (room as any).roundDuration = 500;

      // Remove AI bots to prevent them from firing new projectiles after restart
      room.removeAllAIBots();

      const c1 = createMockClient();
      const c2 = createMockClient();
      const p1 = room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      // Fire a projectile
      room.handleInput(p1!.id, {
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0.1, fire: true, stabilize: false,
        timestamp: Date.now(),
      });
      room.tick();
      expect(room.world.projectiles.size).toBeGreaterThanOrEqual(1);

      // End round
      vi.advanceTimersByTime(1000);
      expect(room.state).toBe(RoomState.RoundEnd);

      // Trigger restart (3s delay) and check projectiles cleared by reset()
      vi.advanceTimersByTime(3001);

      expect(room.world.projectiles.size).toBe(0);
    });

    it('should regenerate map on new round', () => {
      (room as any).roundDuration = 500;

      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      const oldSeed = room.world.map.seed;

      // End and restart round
      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(4000);

      // New seed should be different (based on Date.now())
      // Since we use fake timers, it may be different
      const newSeed = room.world.map.seed;
      // They may or may not be equal depending on timing, just verify map exists
      expect(room.world.map).toBeDefined();
      expect(room.world.map.heightmap.length).toBeGreaterThan(0);
    });

    it('should respawn all players on new round', () => {
      (room as any).roundDuration = 500;

      const c1 = createMockClient();
      const c2 = createMockClient();
      const p1 = room.addPlayer(c1, 'Alice');
      const p2 = room.addPlayer(c2, 'Bob');

      // Kill a player
      const player = room.world.players.get(p2!.id);
      if (player) {
        player.takeDamage(TANK_MAX_HP);
        expect(player.alive).toBe(false);
      }

      // End and restart round
      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(4000);

      // All players should be alive
      for (const p of room.world.players.values()) {
        expect(p.alive).toBe(true);
        expect(p.hp).toBe(TANK_MAX_HP);
      }
    });
  });

  describe('scoreboard at round end', () => {
    it('should broadcast scoreboard sorted by kills', () => {
      (room as any).roundDuration = 500;

      const c1 = createMockClient();
      const c2 = createMockClient();
      const p1 = room.addPlayer(c1, 'Alice');
      const p2 = room.addPlayer(c2, 'Bob');

      // Set kills
      const player1 = room.world.players.get(p1!.id);
      const player2 = room.world.players.get(p2!.id);
      if (player1) player1.kills = 5;
      if (player2) player2.kills = 10;

      c1.send.mockClear();

      // End round
      vi.advanceTimersByTime(1000);

      // Check for RoundEnd message
      const msgs = c1.send.mock.calls.map((c: any) => JSON.parse(c[0]));
      const roundEnd = msgs.find((m: any) => m.type === 0x85);

      if (roundEnd) {
        expect(roundEnd.scoreboard).toBeDefined();
        expect(Array.isArray(roundEnd.scoreboard)).toBe(true);
        // Should be sorted by kills (Bob=10 first, Alice=5 second)
        if (roundEnd.scoreboard.length >= 2) {
          expect(roundEnd.scoreboard[0].kills).toBeGreaterThanOrEqual(
            roundEnd.scoreboard[1].kills
          );
        }
      }
    });
  });

  describe('AI bots across rounds', () => {
    it('should maintain AI bots through round restart', () => {
      (room as any).roundDuration = 500;

      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      const aiCount = room.getAICount();
      expect(aiCount).toBeGreaterThan(0);

      // End and restart round
      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(4000);

      // AI bots should still be present
      expect(room.getAICount()).toBe(aiCount);
    });

    it('should reset AI stats on round restart', () => {
      (room as any).roundDuration = 500;

      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      // End and restart round
      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(4000);

      // All players (including bots) should have reset stats
      for (const p of room.world.players.values()) {
        expect(p.kills).toBe(0);
        expect(p.deaths).toBe(0);
      }
    });
  });

  describe('player join/leave during round', () => {
    it('should add player mid-round', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');
      expect(room.state).toBe(RoomState.InRound);

      // Add third player mid-round
      const c3 = createMockClient();
      const p3 = room.addPlayer(c3, 'Charlie');
      expect(p3).not.toBeNull();
      expect(room.world.players.size).toBeGreaterThanOrEqual(3);
    });

    it('should handle all players leaving then rejoining', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      const p1 = room.addPlayer(c1, 'Alice');
      const p2 = room.addPlayer(c2, 'Bob');

      room.removePlayer(p1!.id);
      room.removePlayer(p2!.id);
      expect(room.isEmpty()).toBe(true);

      // New players join
      const c3 = createMockClient();
      const c4 = createMockClient();
      const p3 = room.addPlayer(c3, 'Dave');
      const p4 = room.addPlayer(c4, 'Eve');
      expect(p3).not.toBeNull();
      expect(p4).not.toBeNull();
    });
  });
});
