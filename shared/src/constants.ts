/**
 * 游戏常量与可配置参数
 */

// ==================== 物理常量 ====================

/** 重力加速度 (m/s²) */
export const GRAVITY = 9.81;

/** 坦克最大速度 (m/s) */
export const TANK_MAX_SPEED = 14.59;

/** 坦克加速度 (m/s²) */
export const TANK_ACCELERATION = 9.72;

/** 坦克倒车加速度系数 */
export const TANK_REVERSE_FACTOR = 0.6;

/** 坦克转向角速度 (rad/s) */
export const TANK_TURN_RATE = 1.5;

/** 坦克阻尼系数 (每 tick 乘，0.985^60 ≈ 0.40/s，平衡速度 ≈ 8.7 m/s) */
export const TANK_DAMPING = 0.985;

/** 炮塔旋转速度 (rad/s) */
export const TURRET_TURN_RATE = 2.0;

/** 炮塔最大偏转角 (rad) — 左右各135°，总行程270° */
export const TURRET_YAW_MAX = Math.PI * 0.75;  // 135° = 2.356 rad

/** 火炮最小俯角 (rad) */
export const GUN_PITCH_MIN = -0.15;

/** 火炮最大仰角 (rad) */
export const GUN_PITCH_MAX = 0.5;

// ==================== 武器常量 ====================

/** 炮口初速 (m/s) */
export const MUZZLE_VELOCITY = 80;

/** 装填时间 (ms) */
export const RELOAD_TIME = 2500;

/** 弹体存活时间 (ms) */
export const PROJECTILE_TTL = 5000;

/** 溅射半径 (m) */
export const SPLASH_RADIUS = 3;

/** 溅射伤害衰减因子 */
export const SPLASH_DAMAGE_FACTOR = 0.5;

/** 直接命中伤害 */
export const DIRECT_HIT_DAMAGE = 20;

/** 击毁所需直击次数 */
export const HITS_TO_DESTROY = 5;

/** 坦克最大 HP */
export const TANK_MAX_HP = 100;

/** 弹体碰撞半径 (m) */
export const PROJECTILE_COLLISION_RADIUS = 0.5;

/** 坦克碰撞半径 (m) */
export const TANK_COLLISION_RADIUS = 2.5;

// ==================== 房间常量 ====================

/** 最大玩家数 */
export const MAX_PLAYERS = 10;

/** 最小开战人数 */
export const MIN_PLAYERS = 2;

/** 回合时长 (秒) */
export const ROUND_DURATION = 300;

/** 复活延迟 (ms) */
export const RESPAWN_DELAY = 4000;

/** 暖场最大时长 (秒) */
export const WARMUP_DURATION = 60;

// ==================== 网络常量 ====================

/** 服务器 Tick 频率 (Hz) */
export const TICK_RATE = 60;

/** Tick 间隔 (ms) */
export const TICK_INTERVAL = 1000 / TICK_RATE;

/** 快照发送频率 (Hz) */
export const SNAPSHOT_RATE = 20;

/** 快照发送间隔 (ticks) */
export const SNAPSHOT_INTERVAL = TICK_RATE / SNAPSHOT_RATE;

/** 客户端输入发送频率 (Hz) */
export const INPUT_RATE = 30;

/** 客户端插值延迟 (ms) */
export const INTERPOLATION_DELAY = 100;

/** 快照缓冲区大小 */
export const SNAPSHOT_BUFFER_SIZE = 30;

// ==================== 地图常量 ====================

/** 默认地图宽度 (m) */
export const MAP_WIDTH = 400;

/** 默认地图深度 (m) */
export const MAP_DEPTH = 400;

/** 高度图分辨率 (每轴网格数) */
export const HEIGHTMAP_RESOLUTION = 128;

/** 最大坡度 (rad) */
export const MAX_SLOPE = 0.6;

/** 微扰动最大幅度 (m) */
export const PERTURBATION_AMPLITUDE = 5;

// ==================== 出生常量 ====================

/** 出生候选点采样数 */
export const SPAWN_CANDIDATE_COUNT = 20;

/** Top-K 候选取随机 */
export const SPAWN_TOP_K = 5;

/** 理想出生距敌距离 (m) */
export const IDEAL_SPAWN_DISTANCE = 60;

/** 出生距敌距离标准差 */
export const SPAWN_DISTANCE_SIGMA = 20;

/** 掩体搜索半径 (m) */
export const COVER_SEARCH_RADIUS = 15;

/** 出生冷却半径 (m) */
export const SPAWN_COOLDOWN_RADIUS = 20;

/** 出生评分权重 */
export const SPAWN_WEIGHTS = {
  distance: 1.0,
  los: 2.0,
  cover: 0.8,
  flow: 0.5,
  recent: 1.5,
} as const;

// ==================== AFK 常量 ====================

/** AFK 超时时间 (ms) — 3分钟无操作踢出 */
export const AFK_TIMEOUT = 180_000;

/** AFK 检测间隔 (ms) */
export const AFK_CHECK_INTERVAL = 10_000;

// ==================== 服务器配置 ====================

/** 默认服务器端口 */
export const DEFAULT_PORT = 3000;

/** 最大房间数 */
export const MAX_ROOMS = 50;

/** 事件日志关键帧间隔 (ticks) */
export const KEYFRAME_INTERVAL = 300;
