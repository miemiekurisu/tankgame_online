import { describe, it, expect } from 'vitest';
import {
  MessageType,
  GameEventType,
  RoomState,
} from '@tankgame/shared';

describe('Protocol', () => {
  describe('MessageType enum', () => {
    it('should have correct client message types', () => {
      expect(MessageType.JoinRoom).toBe(0x01);
      expect(MessageType.InputCmd).toBe(0x02);
      expect(MessageType.Ping).toBe(0x03);
      expect(MessageType.LeaveRoom).toBe(0x04);
    });

    it('should have correct server message types', () => {
      expect(MessageType.JoinAck).toBe(0x81);
      expect(MessageType.Snapshot).toBe(0x82);
      expect(MessageType.GameEvent).toBe(0x83);
      expect(MessageType.Pong).toBe(0x84);
      expect(MessageType.RoundEnd).toBe(0x85);
    });

    it('should have non-overlapping client and server ranges', () => {
      const clientTypes = [
        MessageType.JoinRoom,
        MessageType.InputCmd,
        MessageType.Ping,
        MessageType.LeaveRoom,
      ];
      const serverTypes = [
        MessageType.JoinAck,
        MessageType.Snapshot,
        MessageType.GameEvent,
        MessageType.Pong,
        MessageType.RoundEnd,
      ];

      for (const ct of clientTypes) {
        for (const st of serverTypes) {
          expect(ct).not.toBe(st);
        }
      }
    });
  });

  describe('GameEventType enum', () => {
    it('should have all event types', () => {
      expect(GameEventType.Fire).toBe('fire');
      expect(GameEventType.Hit).toBe('hit');
      expect(GameEventType.Explode).toBe('explode');
      expect(GameEventType.Death).toBe('death');
      expect(GameEventType.Respawn).toBe('respawn');
      expect(GameEventType.RoundStart).toBe('round_start');
      expect(GameEventType.RoundEnd).toBe('round_end');
    });
  });

  describe('RoomState enum', () => {
    it('should have all states', () => {
      expect(RoomState.Warmup).toBe('warmup');
      expect(RoomState.InRound).toBe('in_round');
      expect(RoomState.RoundEnd).toBe('round_end');
    });
  });
});

describe('Constants', () => {
  it('should export required constants', async () => {
    const constants = await import('@tankgame/shared');
    
    // 物理常量
    expect(constants.GRAVITY).toBe(9.81);
      expect(constants.TANK_MAX_SPEED).toBe(14.59);
      expect(constants.TANK_ACCELERATION).toBe(9.72);
    expect(constants.TANK_TURN_RATE).toBe(1.5);
    expect(constants.TANK_DAMPING).toBe(0.985);

    // 武器常量
    expect(constants.MUZZLE_VELOCITY).toBe(80);
    expect(constants.RELOAD_TIME).toBe(2500);
    expect(constants.PROJECTILE_TTL).toBe(5000);
    expect(constants.SPLASH_RADIUS).toBe(3);
    expect(constants.DIRECT_HIT_DAMAGE).toBe(20);
      expect(constants.TANK_MAX_HP).toBe(100);

    // 房间常量
    expect(constants.MAX_PLAYERS).toBe(10);
    expect(constants.MIN_PLAYERS).toBe(2);
    expect(constants.ROUND_DURATION).toBe(300);
    expect(constants.RESPAWN_DELAY).toBe(4000);

    // 网络常量
    expect(constants.TICK_RATE).toBe(60);
    expect(constants.SNAPSHOT_RATE).toBe(20);
    expect(constants.INPUT_RATE).toBe(30);
    expect(constants.INTERPOLATION_DELAY).toBe(100);
  });

  it('should have consistent derived constants', async () => {
    const constants = await import('@tankgame/shared');
    expect(constants.TICK_INTERVAL).toBeCloseTo(1000 / 60, 2);
    expect(constants.SNAPSHOT_INTERVAL).toBe(60 / 20);
  });
});
