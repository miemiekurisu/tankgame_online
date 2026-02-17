import { Vec3 } from './types.js';

/**
 * 网络消息类型枚举
 */
export enum MessageType {
  // 客户端 → 服务器
  JoinRoom = 0x01,
  InputCmd = 0x02,
  Ping = 0x03,
  LeaveRoom = 0x04,

  // 服务器 → 客户端
  JoinAck = 0x81,
  Snapshot = 0x82,
  GameEvent = 0x83,
  Pong = 0x84,
  RoundEnd = 0x85,
  PlayerJoined = 0x86,
  PlayerLeft = 0x87,
  RoomState = 0x88,
  AFKKick = 0x89,
}

/**
 * 游戏事件类型
 */
export enum GameEventType {
  Fire = 'fire',
  Hit = 'hit',
  Explode = 'explode',
  Death = 'death',
  Respawn = 'respawn',
  RoundStart = 'round_start',
  RoundEnd = 'round_end',
}

/**
 * 房间状态
 */
export enum RoomState {
  Warmup = 'warmup',
  InRound = 'in_round',
  RoundEnd = 'round_end',
}

// ==================== 客户端 → 服务器消息 ====================

/**
 * 加入房间请求
 */
export interface JoinRoomMessage {
  type: MessageType.JoinRoom;
  nickname: string;
  /** 浏览器唯一标识（用于数据统计） */
  clientId?: string;
}

/**
 * 输入命令 — 客户端以固定频率发送
 */
export interface InputCmd {
  type: MessageType.InputCmd;
  /** 序列号（用于预测/纠偏） */
  seq: number;
  /** 前进 */
  forward: boolean;
  /** 后退 */
  backward: boolean;
  /** 左转 */
  turnLeft: boolean;
  /** 右转 */
  turnRight: boolean;
  /** 炮塔目标偏航角 */
  turretYaw: number;
  /** 火炮目标俯仰角 */
  gunPitch: number;
  /** 开火 */
  fire: boolean;
  /** 稳定瞄准 */
  stabilize: boolean;
  /** 客户端时间戳 */
  timestamp: number;
}

/**
 * 延迟测量请求
 */
export interface PingMessage {
  type: MessageType.Ping;
  clientTime: number;
}

// ==================== 服务器 → 客户端消息 ====================

/**
 * 坦克状态（快照内嵌）
 */
export interface TankSnapshot {
  entityId: number;
  position: Vec3;
  bodyYaw: number;
  turretYaw: number;
  gunPitch: number;
  velocity: Vec3;
  hp: number;
  alive: boolean;
  reloadRemain: number;
  kills: number;
  deaths: number;
  /** 玩家昵称 */
  nickname: string;
  /** 是否为 AI 机器人 */
  isBot: boolean;
}

/**
 * 弹体状态（快照内嵌）
 */
export interface ProjectileSnapshot {
  projectileId: number;
  position: Vec3;
  velocity: Vec3;
  ttl: number;
}

/**
 * 玩家得分
 */
export interface PlayerScore {
  playerId: number;
  nickname: string;
  kills: number;
  deaths: number;
  hits: number;
  shots: number;
}

/**
 * 状态快照 — 服务器定期广播
 */
export interface SnapshotMessage {
  type: MessageType.Snapshot;
  serverTick: number;
  snapshotId: number;
  timestamp: number;
  lastProcessedSeq: number;
  tanks: TankSnapshot[];
  projectiles: ProjectileSnapshot[];
  /** 房间内总玩家数（含 AI） */
  playerCount: number;
  /** 房间内真人玩家数 */
  humanCount: number;
}

/**
 * 加入确认
 */
export interface JoinAckMessage {
  type: MessageType.JoinAck;
  playerId: number;
  roomId: string;
  roomState: RoomState;
  mapSeed: number;
  config: GameConfigSnapshot;
}

/**
 * 延迟响应
 */
export interface PongMessage {
  type: MessageType.Pong;
  clientTime: number;
  serverTime: number;
}

/**
 * 游戏配置快照（发给客户端）
 */
export interface GameConfigSnapshot {
  tickRate: number;
  snapshotRate: number;
  tankMaxSpeed: number;
  tankAcceleration: number;
  tankTurnRate: number;
  muzzleVelocity: number;
  reloadTime: number;
  gravity: number;
  splashRadius: number;
  roundDuration: number;
  respawnDelay: number;
}

// ==================== 游戏事件消息 ====================

export interface FireEvent {
  eventType: GameEventType.Fire;
  shooterId: number;
  muzzlePos: Vec3;
  muzzleDir: Vec3;
  projectileId: number;
  serverTick: number;
}

export interface HitEvent {
  eventType: GameEventType.Hit;
  projectileId: number;
  targetId: number;
  hitPos: Vec3;
  damage: number;
}

export interface ExplodeEvent {
  eventType: GameEventType.Explode;
  projectileId: number;
  pos: Vec3;
  radius: number;
}

export interface DeathEvent {
  eventType: GameEventType.Death;
  victimId: number;
  killerId: number;
  reason: string;
  pos: Vec3;
}

export interface RespawnEvent {
  eventType: GameEventType.Respawn;
  playerId: number;
  spawnPos: Vec3;
}

export interface RoundEndEvent {
  eventType: GameEventType.RoundEnd;
  scoreboard: PlayerScore[];
}

export type GameEvent =
  | FireEvent
  | HitEvent
  | ExplodeEvent
  | DeathEvent
  | RespawnEvent
  | RoundEndEvent;

export interface GameEventMessage {
  type: MessageType.GameEvent;
  event: GameEvent;
  serverTick: number;
}

/**
 * 玩家加入通知
 */
export interface PlayerJoinedMessage {
  type: MessageType.PlayerJoined;
  playerId: number;
  nickname: string;
  isBot: boolean;
}

/**
 * 玩家离开通知
 */
export interface PlayerLeftMessage {
  type: MessageType.PlayerLeft;
  playerId: number;
  nickname: string;
}

/**
 * AFK 踢出通知
 */
export interface AFKKickMessage {
  type: MessageType.AFKKick;
  reason: string;
}

// ==================== 消息联合类型 ====================

export type ClientMessage =
  | JoinRoomMessage
  | InputCmd
  | PingMessage;

export type ServerMessage =
  | JoinAckMessage
  | SnapshotMessage
  | GameEventMessage
  | PongMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | AFKKickMessage;
