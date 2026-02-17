import {
  RoomState,
  ROUND_DURATION,
  MIN_PLAYERS,
  MAX_PLAYERS,
  TICK_INTERVAL,
  MessageType,
  AFK_TIMEOUT,
  AFK_CHECK_INTERVAL,
} from '@tankgame/shared';
import type {
  InputCmd,
  GameEvent,
  GameEventMessage,
  PlayerScore,
} from '@tankgame/shared';
import { Player } from './Player.js';
import { GameWorld } from './GameWorld.js';
import { AIPlayer } from './AIPlayer.js';

export interface RoomClient {
  playerId: number;
  send(data: string): void;
}

/**
 * 游戏房间 — 管理单个对战房间的完整生命周期
 */
export class GameRoom {
  readonly id: string;
  state: RoomState = RoomState.Warmup;
  world: GameWorld;
  clients: Map<number, RoomClient> = new Map();

  private roundTimer: number = 0; // 回合已用时间 (ms)
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private nextPlayerId: number = 1;
  private roundDuration: number = ROUND_DURATION * 1000;

  // AI 玩家
  private aiBots: Map<number, AIPlayer> = new Map();
  private aiIdCounter: number = 100; // AI ID 从 100 开始，避免和真人冲突

  // AFK 检测
  private lastInputTime: Map<number, number> = new Map();
  private lastAFKCheck: number = 0;

  /** AFK 踢出回调（由 GameServer 注册，用于清理 WebSocket 映射） */
  onPlayerKicked?: (playerId: number) => void;

  constructor(id: string, mapSeed?: number) {
    this.id = id;
    this.world = new GameWorld(mapSeed ?? Date.now());
    // 用 AI 填充到 MAX_PLAYERS
    this.fillWithAIBots();
  }

  /**
   * 添加玩家
   */
  addPlayer(client: RoomClient, nickname: string): Player | null {
    // 如果满员（含 AI），先移除一个 AI 腾出位置
    if (this.world.players.size >= MAX_PLAYERS) {
      if (this.aiBots.size > 0) {
        const firstBotId = this.aiBots.keys().next().value!;
        this.removeAIBot(firstBotId);
      } else {
        return null;
      }
    }

    const player = new Player(this.nextPlayerId++, nickname);
    this.world.addPlayer(player);
    this.clients.set(player.id, client);
    client.playerId = player.id;

    // 记录最后输入时间（AFK 检测）
    this.lastInputTime.set(player.id, Date.now());

    // 广播新玩家加入通知
    this.broadcastJSON({
      type: MessageType.PlayerJoined,
      playerId: player.id,
      nickname,
      isBot: false,
    });

    // 确保 tick 循环运行（暖场中也需要发送快照让玩家能看到自己）
    this.startTickLoop();

    // 有 AI 时，1 人即可开始；否则需要 MIN_PLAYERS
    const totalPlayers = this.clients.size + this.aiBots.size;
    if (this.state === RoomState.Warmup && totalPlayers >= MIN_PLAYERS) {
      this.startRound();
    }

    return player;
  }

  /**
   * 移除玩家
   */
  removePlayer(playerId: number): void {
    const player = this.world.players.get(playerId);
    const nickname = player?.nickname ?? 'Unknown';

    this.world.removePlayer(playerId);
    this.clients.delete(playerId);
    this.lastInputTime.delete(playerId);

    // 广播玩家离开通知
    this.broadcastJSON({
      type: MessageType.PlayerLeft,
      playerId,
      nickname,
    });

    // 人数不足时回到暖场
    if (this.state === RoomState.InRound && this.clients.size < MIN_PLAYERS) {
      this.state = RoomState.Warmup;
    }

    // 无人时停止 tick 循环
    if (this.clients.size === 0) {
      this.stopTickLoop();
    }

    // 用 AI 补充到 MAX_PLAYERS
    this.fillWithAIBots();
  }

  /**
   * 处理玩家输入
   */
  handleInput(playerId: number, cmd: InputCmd): void {
    const player = this.world.players.get(playerId);
    if (player && player.alive) {
      player.pushInput(cmd);
    }
    // 更新最后输入时间（AFK 检测）
    this.lastInputTime.set(playerId, Date.now());
  }

  /**
   * 开始回合
   */
  startRound(): void {
    this.state = RoomState.InRound;
    this.roundTimer = 0;

    // 重置所有玩家统计
    for (const player of this.world.players.values()) {
      player.resetStats();
    }

    this.startTickLoop();
  }

  /**
   * 启动 Tick 循环
   */
  private startTickLoop(): void {
    if (this.tickTimer) return;

    this.tickTimer = setInterval(() => {
      this.tick();
    }, TICK_INTERVAL);
  }

  /**
   * 停止 Tick 循环
   */
  private stopTickLoop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * 单次 Tick
   */
  tick(): void {
    // AI 更新（在世界模拟前注入输入）
    for (const bot of this.aiBots.values()) {
      bot.update(this.world.players, this.world.map.width, this.world.map.depth);
    }

    // 世界模拟
    const events = this.world.update();

    // AFK 检测（每 AFK_CHECK_INTERVAL 检查一次）
    this.lastAFKCheck += TICK_INTERVAL;
    if (this.lastAFKCheck >= AFK_CHECK_INTERVAL) {
      this.lastAFKCheck = 0;
      this.checkAFK();
    }

    // 广播事件
    for (const event of events) {
      this.broadcastEvent(event);
    }

    // 广播快照
    if (this.world.shouldSendSnapshot()) {
      this.world.snapshotId++;
      this.broadcastSnapshots();
    }

    // 更新回合计时
    if (this.state === RoomState.InRound) {
      this.roundTimer += TICK_INTERVAL;
      if (this.roundTimer >= this.roundDuration) {
        this.endRound();
      }
    }
  }

  /**
   * 结束回合
   */
  endRound(): void {
    this.state = RoomState.RoundEnd;
    this.stopTickLoop();

    const scoreboard = this.getScoreboard();
    this.broadcastJSON({
      type: 0x85, // RoundEnd
      scoreboard,
    });

    // 3 秒后重新开始
    setTimeout(() => {
      this.restartRound();
    }, 3000);
  }

  /**
   * 重新开始
   */
  private restartRound(): void {
    this.world.reset(Date.now());

    // 重新添加 AI 玩家到世界
    for (const bot of this.aiBots.values()) {
      if (!this.world.players.has(bot.player.id)) {
        this.world.addPlayer(bot.player);
      }
    }

    if (this.clients.size >= MIN_PLAYERS || this.aiBots.size > 0) {
      this.startRound();
    } else {
      this.state = RoomState.Warmup;
    }
  }

  /**
   * 获取计分板
   */
  getScoreboard(): PlayerScore[] {
    return Array.from(this.world.players.values())
      .map((p) => p.toScore())
      .sort((a, b) => b.kills - a.kills);
  }

  /**
   * 广播快照给所有客户端
   */
  private broadcastSnapshots(): void {
    for (const [playerId, client] of this.clients) {
      const snapshot = this.world.getSnapshot(playerId);
      client.send(JSON.stringify(snapshot));
    }
  }

  /**
   * 广播事件
   */
  private broadcastEvent(event: GameEvent): void {
    this.broadcastJSON({
      type: 0x83, // GameEvent
      event,
      serverTick: this.world.currentTick,
    } as GameEventMessage);
  }

  /**
   * 广播 JSON
   */
  private broadcastJSON(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const client of this.clients.values()) {
      client.send(msg);
    }
  }

  /**
   * 销毁房间
   */
  destroy(): void {
    this.stopTickLoop();
    this.clients.clear();
    this.world.players.clear();
    this.world.projectiles.clear();
  }

  /**
   * 房间是否空闲
   */
  isEmpty(): boolean {
    return this.clients.size === 0;
  }

  /**
   * 房间是否已满（真人玩家 = MAX_PLAYERS，无 AI 可替换）
   */
  isFull(): boolean {
    return this.clients.size >= MAX_PLAYERS;
  }

  // ==================== AI 管理 ====================

  /**
   * 用 AI 填充空位，使总人数达到 MAX_PLAYERS
   */
  fillWithAIBots(): void {
    const totalPlayers = this.world.players.size;
    if (totalPlayers < MAX_PLAYERS) {
      this.addAIBots(MAX_PLAYERS - totalPlayers, 'normal');
    }
  }

  /**
   * 添加多个 AI 玩家
   */
  addAIBots(count: number, difficulty: string = 'normal'): void {
    for (let i = 0; i < count; i++) {
      if (this.world.players.size >= MAX_PLAYERS) break;
      const id = this.aiIdCounter++;
      const { player, ai } = AIPlayer.create(id, difficulty);
      this.world.addPlayer(player);
      this.aiBots.set(id, ai);
    }
  }

  /**
   * 移除一个 AI 玩家
   */
  removeAIBot(botId: number): void {
    this.aiBots.delete(botId);
    this.world.removePlayer(botId);
  }

  /**
   * 移除所有 AI 玩家
   */
  removeAllAIBots(): void {
    for (const id of this.aiBots.keys()) {
      this.world.removePlayer(id);
    }
    this.aiBots.clear();
  }

  /**
   * 获取 AI 数量
   */
  getAICount(): number {
    return this.aiBots.size;
  }

  // ==================== AFK 检测 ====================

  /**
   * 检查 AFK 玩家 — 超过 AFK_TIMEOUT 未操作的真人玩家将被踢出
   */
  private checkAFK(): void {
    const now = Date.now();
    const toKick: number[] = [];

    for (const [playerId, lastTime] of this.lastInputTime) {
      // 只检查真人（在 clients 中的玩家）
      if (!this.clients.has(playerId)) continue;
      if (now - lastTime >= AFK_TIMEOUT) {
        toKick.push(playerId);
      }
    }

    for (const playerId of toKick) {
      this.kickPlayer(playerId, '长时间未操作，已被系统请出房间');
    }
  }

  /**
   * 踢出玩家 — 发送 AFKKick 消息后移除
   */
  kickPlayer(playerId: number, reason: string): void {
    const client = this.clients.get(playerId);
    if (client) {
      client.send(JSON.stringify({
        type: MessageType.AFKKick,
        reason,
      }));
    }
    this.removePlayer(playerId);
    this.onPlayerKicked?.(playerId);
  }
}
