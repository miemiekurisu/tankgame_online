import { Vec3, MessageType } from '@tankgame/shared';
import {
  MUZZLE_VELOCITY,
  GRAVITY,
  GUN_PITCH_MIN,
  GUN_PITCH_MAX,
  TICK_INTERVAL,
  TURRET_YAW_MAX,
} from '@tankgame/shared';
import type { InputCmd } from '@tankgame/shared';
import { Player } from './Player.js';
import { normalizeAngle } from '@tankgame/shared';

/**
 * AI 行为状态
 */
enum AIState {
  Patrol,   // 巡逻：随机移动
  Chase,    // 追击：向目标移动
  Engage,   // 交战：瞄准并开火
  Retreat,  // 撤退：受伤后后退找掩体
}

/**
 * AI 难度配置
 */
export interface AIDifficulty {
  /** 名称 */
  name: string;
  /** 瞄准精度（0-1，1=完美） */
  aimAccuracy: number;
  /** 反应时间 (ms) */
  reactionTime: number;
  /** 瞄准速度 (rad/s) */
  aimSpeed: number;
  /** 开火延迟 (ms)：瞄准好后到扣扳机的时间 */
  fireDelay: number;
  /** 移动随机性 */
  movementRandomness: number;
  /** 最大交战距离 */
  engageRange: number;
}

export const AI_DIFFICULTIES: Record<string, AIDifficulty> = {
  easy: {
    name: 'Easy',
    aimAccuracy: 0.4,
    reactionTime: 800,
    aimSpeed: 1.0,
    fireDelay: 600,
    movementRandomness: 0.3,
    engageRange: 60,
  },
  normal: {
    name: 'Normal',
    aimAccuracy: 0.65,
    reactionTime: 400,
    aimSpeed: 1.8,
    fireDelay: 300,
    movementRandomness: 0.15,
    engageRange: 100,
  },
  hard: {
    name: 'Hard',
    aimAccuracy: 0.85,
    reactionTime: 150,
    aimSpeed: 2.5,
    fireDelay: 100,
    movementRandomness: 0.05,
    engageRange: 150,
  },
};

const AI_NAMES = [
  'Panzer_Bot', 'T34_AI', 'Sherman_Bot', 'Tiger_AI',
  'Abrams_Bot', 'Leopard_AI', 'Merkava_Bot', 'Challenger_AI',
  'Type99_Bot', 'Leclerc_AI', 'Centurion_Bot', 'IS2_AI',
];

/**
 * AI 玩家控制器
 * 每 tick 生成 InputCmd 注入到对应 Player 的输入队列
 */
export class AIPlayer {
  readonly player: Player;
  readonly difficulty: AIDifficulty;

  private state: AIState = AIState.Patrol;
  private seq: number = 0;

  // 瞄准状态
  private currentAimYaw: number = 0;
  private currentAimPitch: number = 0;
  private targetAimYaw: number = 0;
  private targetAimPitch: number = 0;

  // 巡逻
  private patrolTarget: Vec3 | null = null;
  private patrolTimer: number = 0;

  // 交战
  private targetPlayerId: number | null = null;
  private reactionTimer: number = 0;
  private fireDelayTimer: number = 0;
  private aimReady: boolean = false;

  // 杂项
  private stuckTimer: number = 0;
  private lastPosition: Vec3 = Vec3.zero();
  private turnDirection: number = 1;

  private static nameIndex: number = 0;

  constructor(player: Player, difficulty: AIDifficulty) {
    this.player = player;
    this.difficulty = difficulty;
    this.currentAimYaw = player.bodyYaw;
    this.patrolTimer = Math.random() * 3000;
  }

  /**
   * 创建 AI 玩家（工厂方法）
   */
  static create(playerId: number, difficulty: string = 'normal'): { player: Player; ai: AIPlayer } {
    const name = AI_NAMES[AIPlayer.nameIndex % AI_NAMES.length];
    AIPlayer.nameIndex++;
    const diffConfig = AI_DIFFICULTIES[difficulty] ?? AI_DIFFICULTIES.normal;
    const player = new Player(playerId, `[BOT] ${name}`);
    player.isBot = true;
    const ai = new AIPlayer(player, diffConfig);
    return { player, ai };
  }

  /**
   * 每 tick 更新 AI 逻辑，生成并注入输入命令
   */
  update(allPlayers: Map<number, Player>, mapWidth: number, mapDepth: number): void {
    if (!this.player.alive) return;

    const dt = TICK_INTERVAL;

    // 找到最近的活着的敌人
    const target = this.findNearestEnemy(allPlayers);
    const targetDist = target
      ? this.horizontalDist(this.player.position, target.position)
      : Infinity;

    // 状态机转换
    this.updateState(target, targetDist);

    // 更新反应计时器
    if (this.reactionTimer > 0) {
      this.reactionTimer -= dt;
    }

    // 根据状态生成输入
    let forward = false;
    let backward = false;
    let turnLeft = false;
    let turnRight = false;
    let fire = false;

    switch (this.state) {
      case AIState.Patrol:
        ({ forward, turnLeft, turnRight } = this.doPatrol(dt, mapWidth, mapDepth));
        break;

      case AIState.Chase:
        if (target) {
          ({ forward, backward, turnLeft, turnRight } = this.doChase(target));
        }
        break;

      case AIState.Engage:
        if (target) {
          ({ forward, backward, turnLeft, turnRight, fire } = this.doEngage(target, targetDist, dt));
        }
        break;

      case AIState.Retreat:
        backward = true;
        if (target) {
          // 面向敌人后退
          this.updateAimAt(target, dt);
        }
        if (this.player.hp > 60) {
          this.state = AIState.Patrol;
        }
        break;
    }

    // 卡住检测
    this.detectStuck(dt);

    // 平滑瞄准过渡
    if (target && this.state !== AIState.Patrol) {
      this.updateAimAt(target, dt);
    }

    // 添加瞄准散布（根据精度）
    const spread = (1 - this.difficulty.aimAccuracy) * 0.08;
    const aimYawWithSpread = this.currentAimYaw + (Math.random() - 0.5) * spread;
    const aimPitchWithSpread = this.currentAimPitch + (Math.random() - 0.5) * spread * 0.5;

    // 限幅炮塔偏转角到 ±TURRET_YAW_MAX
    const clampedTurretYaw = Math.max(-TURRET_YAW_MAX, Math.min(TURRET_YAW_MAX, aimYawWithSpread));

    // 生成输入命令
    const cmd: InputCmd = {
      type: MessageType.InputCmd,
      seq: ++this.seq,
      forward,
      backward,
      turnLeft,
      turnRight,
      turretYaw: clampedTurretYaw,
      gunPitch: aimPitchWithSpread,
      fire,
      stabilize: false,
      timestamp: Date.now(),
    };

    this.player.pushInput(cmd);
  }

  /**
   * 状态机转换
   */
  private updateState(target: Player | null, dist: number): void {
    if (!target) {
      this.state = AIState.Patrol;
      this.targetPlayerId = null;
      return;
    }

    // 受伤严重时撤退
    if (this.player.hp < 30 && dist < 30) {
      this.state = AIState.Retreat;
      return;
    }

    // 新目标 → 触发反应时间
    if (this.targetPlayerId !== target.id) {
      this.targetPlayerId = target.id;
      this.reactionTimer = this.difficulty.reactionTime;
      this.aimReady = false;
      this.fireDelayTimer = 0;
    }

    // 反应中 → 巡逻/追击
    if (this.reactionTimer > 0) {
      this.state = dist > this.difficulty.engageRange ? AIState.Patrol : AIState.Chase;
      return;
    }

    if (dist > this.difficulty.engageRange) {
      this.state = AIState.Chase;
    } else {
      this.state = AIState.Engage;
    }
  }

  /**
   * 巡逻行为
   */
  private doPatrol(
    dt: number,
    mapW: number,
    mapD: number
  ): { forward: boolean; turnLeft: boolean; turnRight: boolean } {
    this.patrolTimer -= dt;

    // 选择新巡逻点
    if (!this.patrolTarget || this.patrolTimer <= 0 || this.reachedTarget(this.patrolTarget, 15)) {
      const hw = mapW / 2 * 0.7;
      const hd = mapD / 2 * 0.7;
      this.patrolTarget = new Vec3(
        (Math.random() - 0.5) * hw * 2,
        0,
        (Math.random() - 0.5) * hd * 2
      );
      this.patrolTimer = 5000 + Math.random() * 5000;
    }

    return this.moveToward(this.patrolTarget);
  }

  /**
   * 追击行为
   */
  private doChase(target: Player): { forward: boolean; backward: boolean; turnLeft: boolean; turnRight: boolean } {
    const result = this.moveToward(target.position);
    return { ...result, backward: false };
  }

  /**
   * 交战行为 — 瞄准并开火，必要时转动车体使目标在炮塔行程内
   */
  private doEngage(
    target: Player,
    dist: number,
    dt: number
  ): { forward: boolean; backward: boolean; turnLeft: boolean; turnRight: boolean; fire: boolean } {
    let forward = false;
    let backward = false;
    let turnLeft = false;
    let turnRight = false;
    let fire = false;

    // 保持适当距离 (30-60m)
    if (dist < 20) {
      backward = true;
    } else if (dist > this.difficulty.engageRange * 0.8) {
      forward = true;
    }

    // 如果目标超出炮塔行程范围，转动车体
    const dx = target.position.x - this.player.position.x;
    const dz = target.position.z - this.player.position.z;
    const targetWorldYaw = Math.atan2(-dx, -dz);
    const targetRelYaw = normalizeAngle(targetWorldYaw - this.player.bodyYaw);
    const turretMargin = TURRET_YAW_MAX * 0.85; // 留15%余量
    if (Math.abs(targetRelYaw) > turretMargin) {
      // 需要转动车体使目标回到炮塔行程内
      if (targetRelYaw > 0) turnLeft = true;
      else turnRight = true;
    }

    // 检测瞄准是否就绪
    const aimError = this.getAimError(target);
    if (aimError < 0.05) { // ~3 度
      if (!this.aimReady) {
        this.aimReady = true;
        this.fireDelayTimer = this.difficulty.fireDelay;
      }
    } else {
      this.aimReady = false;
      this.fireDelayTimer = 0;
    }

    // 开火延迟
    if (this.aimReady) {
      this.fireDelayTimer -= dt;
      if (this.fireDelayTimer <= 0 && this.player.reloadRemain <= 0) {
        fire = true;
      }
    }

    return { forward, backward, turnLeft, turnRight, fire };
  }

  /**
   * 更新瞄准方向（朝向目标，带弹道补偿）
   */
  private updateAimAt(target: Player, dt: number): void {
    const dx = target.position.x - this.player.position.x;
    const dz = target.position.z - this.player.position.z;
    const dy = target.position.y - this.player.position.y;
    const hDist = Math.sqrt(dx * dx + dz * dz);

    // 目标 yaw（相对于世界，与相机/运动方向一致）
    this.targetAimYaw = Math.atan2(-dx, -dz);

    // 弹道补偿：计算需要的仰角来命中目标
    // 简化弹道公式：gunPitch = atan2(dy, hDist) + 重力补偿
    const flightTime = hDist / MUZZLE_VELOCITY;
    const gravDrop = 0.5 * GRAVITY * flightTime * flightTime;
    this.targetAimPitch = Math.atan2(dy + gravDrop, hDist);

    // 限制到合法范围
    this.targetAimPitch = Math.max(GUN_PITCH_MIN, Math.min(GUN_PITCH_MAX, this.targetAimPitch));

    // 平滑旋转（受 aimSpeed 限制）
    const maxStep = this.difficulty.aimSpeed * (dt / 1000);

    // Yaw：由于 turretYaw 是相对于 bodyYaw 的，需要计算差值
    // 目标 turretYaw = targetAimYaw - bodyYaw
    const targetTurretYaw = normalizeAngle(this.targetAimYaw - this.player.bodyYaw);
    // 限幅到合法范围
    const clampedTarget = Math.max(-TURRET_YAW_MAX, Math.min(TURRET_YAW_MAX, targetTurretYaw));
    const yawDiff = normalizeAngle(clampedTarget - this.currentAimYaw);
    if (Math.abs(yawDiff) <= maxStep) {
      this.currentAimYaw = clampedTarget;
    } else {
      this.currentAimYaw = normalizeAngle(
        this.currentAimYaw + Math.sign(yawDiff) * maxStep
      );
    }
    // 确保最终值在限幅范围内
    this.currentAimYaw = Math.max(-TURRET_YAW_MAX, Math.min(TURRET_YAW_MAX, this.currentAimYaw));

    // Pitch
    const pitchDiff = this.targetAimPitch - this.currentAimPitch;
    if (Math.abs(pitchDiff) <= maxStep) {
      this.currentAimPitch = this.targetAimPitch;
    } else {
      this.currentAimPitch += Math.sign(pitchDiff) * maxStep;
    }
  }

  /**
   * 向目标点移动（转向 + 前进）— 移动方向跟随车体朝向
   */
  private moveToward(target: Vec3): { forward: boolean; turnLeft: boolean; turnRight: boolean } {
    const dx = target.x - this.player.position.x;
    const dz = target.z - this.player.position.z;

    // 移动方向使用 bodyYaw（坦克风格：前进方向 = 车体朝向）
    const targetYaw = Math.atan2(-dx, -dz);
    const diff = normalizeAngle(targetYaw - this.player.bodyYaw);

    let turnLeft = false;
    let turnRight = false;

    // 使用车体转向来调整方向（A/D 键）
    if (Math.abs(diff) > 0.15) {
      if (diff > 0) turnLeft = true;
      else turnRight = true;
    }

    return { forward: true, turnLeft, turnRight };
  }

  /**
   * 找到最近的活着的敌人
   */
  private findNearestEnemy(allPlayers: Map<number, Player>): Player | null {
    let nearest: Player | null = null;
    let minDist = Infinity;

    for (const p of allPlayers.values()) {
      if (p.id === this.player.id || !p.alive) continue;
      const d = this.horizontalDist(this.player.position, p.position);
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    return nearest;
  }

  /**
   * 瞄准误差
   */
  private getAimError(target: Player): number {
    const dx = target.position.x - this.player.position.x;
    const dz = target.position.z - this.player.position.z;
    const targetYaw = Math.atan2(-dx, -dz);
    const currentWorldYaw = normalizeAngle(this.player.bodyYaw + this.currentAimYaw);
    return Math.abs(normalizeAngle(targetYaw - currentWorldYaw));
  }

  /**
   * 是否到达目标附近
   */
  private reachedTarget(pos: Vec3, threshold: number): boolean {
    return this.horizontalDist(this.player.position, pos) < threshold;
  }

  /**
   * 水平距离
   */
  private horizontalDist(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * 卡住检测 — 转向脱困
   */
  private detectStuck(dt: number): void {
    const moved = this.horizontalDist(this.player.position, this.lastPosition);
    if (moved < 0.1 && this.state !== AIState.Engage) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1500) {
        // 卡住了，换个巡逻点
        this.patrolTarget = null;
        this.patrolTimer = 0;
        this.turnDirection *= -1;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastPosition = this.player.position.clone();
  }
}
