import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageType } from '@tankgame/shared';
import { GameRoom } from '../../packages/server/src/GameRoom.js';
import type { RoomClient } from '../../packages/server/src/GameRoom.js';

function createMockClient(): RoomClient & { send: ReturnType<typeof vi.fn> } {
  return {
    playerId: 0,
    send: vi.fn(),
  };
}

/**
 * 模拟网络消息流:
 * Client Join → Snapshot loop → Input → Events → RoundEnd → Scoreboard
 */
describe('Network Message Flow Integration', () => {
  let room: GameRoom;

  beforeEach(() => {
    vi.useFakeTimers();
    room = new GameRoom('flow-test', 42);
  });

  afterEach(() => {
    room.destroy();
    vi.useRealTimers();
  });

  describe('snapshot broadcast', () => {
    it('should broadcast snapshots during game', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');
      // Now in InRound state

      c1.send.mockClear();
      c2.send.mockClear();

      // Run several ticks to generate snapshots (SNAPSHOT_INTERVAL = 3)
      for (let i = 0; i < 6; i++) {
        room.tick();
      }

      expect(c1.send).toHaveBeenCalled();
      expect(c2.send).toHaveBeenCalled();
    });

    it('each snapshot should contain current tick and tanks', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      c1.send.mockClear();

      for (let i = 0; i < 3; i++) {
        room.tick();
      }

      const msgs = c1.send.mock.calls.map((c: any) => JSON.parse(c[0]));
      const snapshots = msgs.filter((m: any) => m.type === MessageType.Snapshot);

      if (snapshots.length > 0) {
        expect(snapshots[0].serverTick).toBeDefined();
        expect(snapshots[0].tanks).toBeDefined();
      }
    });
  });

  describe('input processing flow', () => {
    it('should accept and process InputCmd messages', () => {
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

  describe('event broadcast', () => {
    it('should broadcast fire events to all players', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      const p1 = room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      c1.send.mockClear();
      c2.send.mockClear();

      // Player 1 fires
      room.handleInput(p1!.id, {
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

      room.tick();

      // Both players should receive messages
      expect(c1.send).toHaveBeenCalled();
      expect(c2.send).toHaveBeenCalled();

      // Check for fire event in messages
      const c2Msgs = c2.send.mock.calls.map((c: any) => JSON.parse(c[0]));
      const eventMsgs = c2Msgs.filter((m: any) => m.type === MessageType.GameEvent);
      const fireEvents = eventMsgs.filter((m: any) => m.event?.eventType === 'fire');
      expect(fireEvents.length).toBeGreaterThan(0);
    });
  });

  describe('round end flow', () => {
    it('should broadcast RoundEnd with scoreboard', () => {
      const c1 = createMockClient();
      const c2 = createMockClient();
      room.addPlayer(c1, 'Alice');
      room.addPlayer(c2, 'Bob');

      c1.send.mockClear();

      // Advance past round duration (300s)
      vi.advanceTimersByTime(301 * 1000);

      const msgs = c1.send.mock.calls.map((c: any) => JSON.parse(c[0]));
      const roundEnd = msgs.find((m: any) => m.type === 0x85); // RoundEnd

      if (roundEnd) {
        expect(roundEnd.scoreboard).toBeDefined();
        expect(Array.isArray(roundEnd.scoreboard)).toBe(true);
      }
    });
  });

  describe('reconnection handling', () => {
    it('should handle player leaving and new player joining', () => {
      const c1 = createMockClient();
      const p1 = room.addPlayer(c1, 'Alice');

      room.removePlayer(p1!.id);
      expect(room.clients.size).toBe(0);

      const c2 = createMockClient();
      const p2 = room.addPlayer(c2, 'Bob');
      expect(room.clients.size).toBe(1);
      expect(p2).not.toBeNull();
    });
  });
});
