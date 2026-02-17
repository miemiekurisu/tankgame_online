import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RoomState, MessageType, MAX_PLAYERS } from '@tankgame/shared';
import { GameRoom } from '../../packages/server/src/GameRoom.js';
import type { RoomClient } from '../../packages/server/src/GameRoom.js';

function createMockClient(): RoomClient & { send: ReturnType<typeof vi.fn> } {
  return {
    playerId: 0,
    send: vi.fn(),
  };
}

describe('GameRoom Integration', () => {
  let room: GameRoom;

  beforeEach(() => {
    vi.useFakeTimers();
    room = new GameRoom('test-room', 42);
  });

  afterEach(() => {
    room.destroy();
    vi.useRealTimers();
  });

  describe('room lifecycle', () => {
    it('should start in Warmup state', () => {
      expect(room.state).toBe(RoomState.Warmup);
    });

    it('should transition to InRound when min players join', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      // addPlayer auto-calls startRound when >= MIN_PLAYERS
      expect(room.state).toBe(RoomState.InRound);
    });

    it('should allow single player in warmup', () => {
      // Remove default AI bots to test warmup with only 1 human
      for (const [id] of (room as any).aiBots) {
        room.world.removePlayer(id);
      }
      (room as any).aiBots.clear();

      const c1 = createMockClient();
      room.addPlayer(c1, 'Alice');

      expect(room.state).toBe(RoomState.Warmup);
      expect(room.clients.size).toBe(1);
    });

    it('should broadcast messages to connected players', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');
      // Now in InRound

      c1.send.mockClear();
      c2.send.mockClear();

      // Run enough ticks for snapshot (SNAPSHOT_INTERVAL = 3)
      for (let i = 0; i < 3; i++) {
        room.tick();
      }

      expect(c1.send).toHaveBeenCalled();
      expect(c2.send).toHaveBeenCalled();
    });

    it('should handle player disconnect', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      const p1 = room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      room.removePlayer(p1!.id);
      expect(room.clients.size).toBe(1);
    });

    it('should transition to RoundEnd when timer expires', () => {
      // Shorten round duration to avoid 18000+ timer callbacks at 60Hz
      (room as any).roundDuration = 1000; // 1 second

      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');
      expect(room.state).toBe(RoomState.InRound);

      // Advance past shortened round duration (1s + buffer)
      vi.advanceTimersByTime(2000);

      expect(room.state).toBe(RoomState.RoundEnd);
    });
  });

  describe('game loop tick', () => {
    it('should increment tick on manual tick()', () => {
      const c1 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.tick();
      expect(room.world.currentTick).toBeGreaterThan(0);
    });

    it('should process player input', () => {
      const c1 = createMockClient();
      const p1 = room.addPlayer(c1, 'Alice');

      room.handleInput(p1!.id, {
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

      room.tick();

      const player = room.world.players.get(p1!.id);
      expect(player).toBeDefined();
    });
  });

  describe('scoreboard', () => {
    it('should track player scores', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      const scoreboard = room.getScoreboard();
      // 2 humans + 3 default AI bots = 5 total
      expect(scoreboard.length).toBe(2 + (room as any).aiBots.size);
      expect(scoreboard[0].nickname).toBeDefined();
    });
  });

  describe('empty room detection', () => {
    it('should be empty when no players', () => {
      expect(room.isEmpty()).toBe(true);
    });

    it('should not be empty with players', () => {
      const c1 = createMockClient();
      room.addPlayer(c1, 'Alice');
      expect(room.isEmpty()).toBe(false);
    });

    it('should become empty after all players leave', () => {
      const c1 = createMockClient();
      const p1 = room.addPlayer(c1, 'Alice');
      room.removePlayer(p1!.id);
      expect(room.isEmpty()).toBe(true);
    });
  });

  describe('full room detection', () => {
    it('should reject players when full', () => {
      for (let i = 0; i < MAX_PLAYERS; i++) {
        const c = createMockClient();
        room.addPlayer(c, `Player${i}`);
      }
      expect(room.isFull()).toBe(true);

      const extra = createMockClient();
      const result = room.addPlayer(extra, 'Extra');
      expect(result).toBeNull();
    });
  });
});
