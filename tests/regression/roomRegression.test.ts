import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MAX_PLAYERS,
  ROUND_DURATION,
  RoomState,
} from '@tankgame/shared';
import { GameRoom } from '../../packages/server/src/GameRoom.js';
import type { RoomClient } from '../../packages/server/src/GameRoom.js';

function createMockClient(): RoomClient & { send: ReturnType<typeof vi.fn> } {
  return { playerId: 0, send: vi.fn() };
}

/**
 * Room-related Regression Tests
 * Locks down room capacity and round duration behaviors.
 */
describe('Room Regression', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('room capacity', () => {
    it('should enforce MAX_PLAYERS (10) limit', () => {
      const room = new GameRoom('test', 42);

      const clients: (RoomClient & { send: ReturnType<typeof vi.fn> })[] = [];
      for (let i = 0; i < MAX_PLAYERS; i++) {
        const c = createMockClient();
        const p = room.addPlayer(c, `P${i}`);
        expect(p).not.toBeNull();
        clients.push(c);
      }

      // 11th player should be rejected
      const extra = createMockClient();
      expect(room.addPlayer(extra, 'Extra')).toBeNull();

      room.destroy();
    });

    it('should allow new player after someone leaves', () => {
      const room = new GameRoom('test', 42);

      const clients: any[] = [];
      const players: any[] = [];
      for (let i = 0; i < MAX_PLAYERS; i++) {
        const c = createMockClient();
        const p = room.addPlayer(c, `P${i}`);
        clients.push(c);
        players.push(p);
      }

      // Remove one player
      room.removePlayer(players[0].id);

      // Now a new player should be able to join
      const newC = createMockClient();
      expect(room.addPlayer(newC, 'New')).not.toBeNull();

      room.destroy();
    });
  });

  describe('round duration', () => {
    it('should end round after configured duration', () => {
      const room = new GameRoom('test', 42);
      // Use a short duration to avoid tick overhead
      (room as any).roundDuration = 2000;

      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');
      expect(room.state).toBe(RoomState.InRound);

      // Advance just under duration
      vi.advanceTimersByTime(1500);
      expect(room.state).toBe(RoomState.InRound);

      // Advance past round duration
      vi.advanceTimersByTime(1000);
      expect(room.state).toBe(RoomState.RoundEnd);

      room.destroy();
    });

    it('should use ROUND_DURATION constant for duration', () => {
      const room = new GameRoom('test', 42);
      expect((room as any).roundDuration).toBe(ROUND_DURATION * 1000);
      room.destroy();
    });
  });
});
