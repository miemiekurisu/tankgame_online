import { Vec3 } from '@tankgame/shared';
import {
  TANK_MAX_HP,
  RELOAD_TIME,
} from '@tankgame/shared';
import type { InputCmd, TankSnapshot, PlayerScore } from '@tankgame/shared';
import type { TankPhysicsState } from '@tankgame/shared';

/**
 * 服务器端玩家实体
 */
export class Player {
  /** 玩家 ID */
  readonly id: number;
  /** 昵称 */
  readonly nickname: string;

  // 物理状态
  position: Vec3 = Vec3.zero();
  velocity: Vec3 = Vec3.zero();
  bodyYaw: number = 0;
  turretYaw: number = 0;
  gunPitch: number = 0;

  // 生存状态
  hp: number = TANK_MAX_HP;
  alive: boolean = true;
  respawnTimer: number = 0;

  // 武器状态
  reloadRemain: number = 0;

  // 输入队列
  inputQueue: InputCmd[] = [];
  lastProcessedSeq: number = 0;

  // 上一次的输入状态（用于无新输入时持续物理模拟）
  lastInput: InputCmd | null = null;

  // 统计
  kills: number = 0;
  deaths: number = 0;
  hits: number = 0;
  shots: number = 0;

  // 最近出生位置（用于出生冷却）
  lastSpawnPositions: Vec3[] = [];

  /** 是否为 AI 机器人 */
  isBot: boolean = false;

  constructor(id: number, nickname: string) {
    this.id = id;
    this.nickname = nickname;
  }

  /**
   * 获取物理状态（用于共享物理计算）
   */
  getPhysicsState(): TankPhysicsState {
    return {
      position: this.position,
      velocity: this.velocity,
      bodyYaw: this.bodyYaw,
      turretYaw: this.turretYaw,
      gunPitch: this.gunPitch,
    };
  }

  /**
   * 获取快照数据
   */
  toSnapshot(): TankSnapshot {
    return {
      entityId: this.id,
      position: this.position.clone(),
      bodyYaw: this.bodyYaw,
      turretYaw: this.turretYaw,
      gunPitch: this.gunPitch,
      velocity: this.velocity.clone(),
      hp: this.hp,
      alive: this.alive,
      reloadRemain: this.reloadRemain,
      kills: this.kills,
      deaths: this.deaths,
      nickname: this.nickname,
      isBot: this.isBot,
    };
  }

  /**
   * 获取得分数据
   */
  toScore(): PlayerScore {
    return {
      playerId: this.id,
      nickname: this.nickname,
      kills: this.kills,
      deaths: this.deaths,
      hits: this.hits,
      shots: this.shots,
    };
  }

  /**
   * 入队输入命令
   */
  pushInput(cmd: InputCmd): void {
    // 限制输入队列长度，防止泛洪
    if (this.inputQueue.length < 10) {
      this.inputQueue.push(cmd);
    }
  }

  /**
   * 取出本 tick 的输入命令，若无新命令则返回上次输入（保持移动连续性）
   */
  popInput(): InputCmd | null {
    const cmd = this.inputQueue.shift();
    if (cmd) {
      this.lastInput = cmd;
      return cmd;
    }
    // 无新输入时返回上次输入（清除开火以免连射）
    if (this.lastInput) {
      return { ...this.lastInput, fire: false };
    }
    return null;
  }

  /**
   * 受到伤害
   */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
      // 清空输入队列和速度，阻止死亡后的所有操作
      this.inputQueue.length = 0;
      this.lastInput = null;
      this.velocity = Vec3.zero();
      return true; // 已死亡
    }
    return false;
  }

  /**
   * 复活
   */
  respawn(position: Vec3): void {
    this.position = position.clone();
    this.velocity = Vec3.zero();
    this.bodyYaw = Math.random() * Math.PI * 2 - Math.PI;
    this.turretYaw = 0;
    this.gunPitch = 0;
    this.hp = TANK_MAX_HP;
    this.alive = true;
    this.reloadRemain = 0;
    this.respawnTimer = 0;

    // 记录出生位置
    this.lastSpawnPositions.push(position.clone());
    if (this.lastSpawnPositions.length > 5) {
      this.lastSpawnPositions.shift();
    }
  }

  /**
   * 尝试开火
   */
  tryFire(): boolean {
    if (!this.alive || this.reloadRemain > 0) return false;
    this.reloadRemain = RELOAD_TIME;
    this.shots++;
    return true;
  }

  /**
   * 更新装填冷却
   */
  updateReload(dtMs: number): void {
    if (this.reloadRemain > 0) {
      this.reloadRemain = Math.max(0, this.reloadRemain - dtMs);
    }
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.kills = 0;
    this.deaths = 0;
    this.hits = 0;
    this.shots = 0;
  }
}
