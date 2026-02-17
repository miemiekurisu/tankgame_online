import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameRoom } from '../../packages/server/src/GameRoom.js';
import { AFK_TIMEOUT, AFK_CHECK_INTERVAL, MessageType, MAX_PLAYERS } from '@tankgame/shared';
import type { InputCmd } from '@tankgame/shared';

function createMockClient() {
  return {
    playerId: 0,
    send: vi.fn(),
  };
}

function createInputCmd(overrides: Partial<InputCmd> = {}): InputCmd {
  return {
    type: MessageType.InputCmd,
    seq: 1,
    forward: false,
    backward: false,
    turnLeft: false,
    turnRight: false,
    turretYaw: 0,
    gunPitch: 0,
    fire: false,
    stabilize: false,
    timestamp: performance.now(),
    ...overrides,
  };
}

describe('AFK Detection', () => {
  let room: GameRoom;
  let originalDateNow: () => number;
  let currentTime: number;

  beforeEach(() => {
    currentTime = Date.now();
    originalDateNow = Date.now;
    Date.now = () => currentTime;
    room = new GameRoom('test-afk', 42);
  });

  afterEach(() => {
    Date.now = originalDateNow;
    room.destroy();
  });

  it('should have AFK_TIMEOUT constant = 180000ms (3 minutes)', () => {
    expect(AFK_TIMEOUT).toBe(180_000);
  });

  it('should have AFK_CHECK_INTERVAL constant = 10000ms', () => {
    expect(AFK_CHECK_INTERVAL).toBe(10_000);
  });

  it('should not kick player who sends input regularly', () => {
    const client = createMockClient();
    const player = room.addPlayer(client, 'Active');
    expect(player).not.toBeNull();

    const kicked = vi.fn();
    room.onPlayerKicked = kicked;

    // 发送输入
    room.handleInput(player!.id, createInputCmd());

    // 前进 2 分钟（低于 3 分钟 AFK 阈值）
    currentTime += 120_000;

    // 运行多个 tick 以触发 AFK 检查（需要足够的 tick 覆盖 AFK_CHECK_INTERVAL）
    for (let i = 0; i < 1000; i++) {
      room.tick();
    }

    expect(kicked).not.toHaveBeenCalled();
  });

  it('should kick player after AFK_TIMEOUT without input', () => {
    const client = createMockClient();
    const player = room.addPlayer(client, 'AFK');
    expect(player).not.toBeNull();

    const kicked = vi.fn();
    room.onPlayerKicked = kicked;

    // 前进超过 AFK_TIMEOUT
    currentTime += AFK_TIMEOUT + 1000;

    // 运行足够多的 tick 覆盖 AFK_CHECK_INTERVAL
    for (let i = 0; i < 1000; i++) {
      room.tick();
    }

    expect(kicked).toHaveBeenCalledWith(player!.id);
  });

  it('should send AFKKick message before kicking', () => {
    const client = createMockClient();
    const player = room.addPlayer(client, 'AFK-msg');
    expect(player).not.toBeNull();

    // 前进超过 AFK_TIMEOUT
    currentTime += AFK_TIMEOUT + 1000;

    for (let i = 0; i < 1000; i++) {
      room.tick();
    }

    // 检查发送了 AFKKick 消息
    const sends = client.send.mock.calls;
    const afkMessages = sends
      .map((call: [string]) => {
        try { return JSON.parse(call[0]); } catch { return null; }
      })
      .filter((msg: { type: number } | null) => msg && msg.type === MessageType.AFKKick);

    expect(afkMessages.length).toBeGreaterThan(0);
    expect(afkMessages[0].reason).toBeTruthy();
  });

  it('should not kick AI bots', () => {
    // 创建房间时已自动添加 AI
    const aiCount = room.getAICount();
    expect(aiCount).toBeGreaterThan(0);

    // 前进超过 AFK_TIMEOUT — AI 不应被踢
    currentTime += AFK_TIMEOUT + 1000;

    for (let i = 0; i < 1000; i++) {
      room.tick();
    }

    // AI 应该仍在
    expect(room.getAICount()).toBe(aiCount);
  });

  it('should reset AFK timer when input is received', () => {
    const client = createMockClient();
    const player = room.addPlayer(client, 'Semi-active');
    expect(player).not.toBeNull();

    const kicked = vi.fn();
    room.onPlayerKicked = kicked;

    // 前进到接近 AFK_TIMEOUT
    currentTime += AFK_TIMEOUT - 10_000;

    for (let i = 0; i < 500; i++) {
      room.tick();
    }

    // 发送一次输入，重置 AFK 计时
    room.handleInput(player!.id, createInputCmd());

    // 再前进一小段时间（但不超过 AFK_TIMEOUT 从最后输入算起）
    currentTime += AFK_TIMEOUT - 10_000;

    for (let i = 0; i < 500; i++) {
      room.tick();
    }

    // 不应被踢（因为输入重置了计时器）
    expect(kicked).not.toHaveBeenCalled();
  });

  it('kickPlayer should call onPlayerKicked callback', () => {
    const client = createMockClient();
    const player = room.addPlayer(client, 'Manual-kick');
    expect(player).not.toBeNull();

    const kicked = vi.fn();
    room.onPlayerKicked = kicked;

    room.kickPlayer(player!.id, 'test reason');

    expect(kicked).toHaveBeenCalledWith(player!.id);
  });
});

describe('AFKKick Message Type', () => {
  it('should have AFKKick = 0x89', () => {
    expect(MessageType.AFKKick).toBe(0x89);
  });

  it('should not conflict with other server message types', () => {
    const serverTypes = [
      MessageType.JoinAck,
      MessageType.Snapshot,
      MessageType.GameEvent,
      MessageType.Pong,
      MessageType.RoundEnd,
      MessageType.PlayerJoined,
      MessageType.PlayerLeft,
      MessageType.RoomState,
      MessageType.AFKKick,
    ];
    const unique = new Set(serverTypes);
    expect(unique.size).toBe(serverTypes.length);
  });
});
