import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { MapGenerator } from '@tankgame/server/MapGenerator.js';
import type { GameMapData } from '@tankgame/server/MapGenerator.js';
import {
  TANK_MAX_SPEED,
  TANK_ACCELERATION,
  TANK_REVERSE_FACTOR,
  TANK_TURN_RATE,
  TANK_DAMPING,
  TURRET_TURN_RATE,
  TURRET_YAW_MAX,
  GUN_PITCH_MIN,
  GUN_PITCH_MAX,
  MUZZLE_VELOCITY,
  RELOAD_TIME,
  GRAVITY,
  TANK_MAX_HP,
  DIRECT_HIT_DAMAGE,
  TANK_COLLISION_RADIUS,
  PROJECTILE_COLLISION_RADIUS,
  PROJECTILE_TTL,
  TICK_INTERVAL,
  TICK_RATE,
} from '@tankgame/shared';
import { Vec3, calculateSplashDamage } from '@tankgame/shared';

// ==================== 教学阶段定义 ====================

enum TutorialStage {
  /** 移动教学：WASD 控制前进后退转向 */
  Movement = 0,
  /** 射击教学：鼠标瞄准，左键开火，右键瞄准镜 */
  Shooting = 1,
  /** HUD 教学：解说各个 HUD 组件的含义 */
  HUD = 2,
  /** 1v1 实战：击败一个 AI 即可毕业 */
  Battle = 3,
}

interface TutorialPrompt {
  text: string;
  condition: () => boolean;
}

interface LocalProjectile {
  id: number;
  position: Vec3;
  velocity: Vec3;
  ttl: number;
  ownerId: number; // 0 = player, 1 = AI
}

interface LocalTank {
  position: Vec3;
  velocity: Vec3;
  bodyYaw: number;
  turretYaw: number;
  gunPitch: number;
  hp: number;
  alive: boolean;
  reloadRemain: number;
  kills: number;
  deaths: number;
}

/**
 * 纯客户端教学游戏 — 无需服务器连接
 * 重用客户端的渲染器和场景系统，本地模拟物理
 */
export class TutorialGame {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private inputManager: InputManager;
  private onComplete: () => void;

  private running: boolean = false;
  private animFrameId: number = 0;
  private lastTime: number = 0;

  // 教学状态
  private stage: TutorialStage = TutorialStage.Movement;
  private stagePrompts: TutorialPrompt[] = [];
  private promptIndex: number = 0;
  private stageStartTime: number = 0;

  // 本地物理
  private player: LocalTank;
  private aiTank: LocalTank | null = null;
  private projectiles: LocalProjectile[] = [];
  private nextProjectileId: number = 1;
  private mapData: GameMapData | null = null;

  // 教学条件追踪
  private hasMovedForward: boolean = false;
  private hasMovedBackward: boolean = false;
  private hasTurnedLeft: boolean = false;
  private hasTurnedRight: boolean = false;
  private hasFired: boolean = false;
  private hasAimed: boolean = false;
  private hasHitTarget: boolean = false;
  private aiDefeated: boolean = false;

  // 积累距离（用于判断是否充分移动）
  private distanceTraveled: number = 0;
  private turnsCompleted: number = 0;

  // Three.js 对象
  private terrain: THREE.Mesh | null = null;
  private playerMesh: THREE.Group | null = null;
  private aiMesh: THREE.Group | null = null;
  private projectileMeshes: Map<number, THREE.Mesh> = new Map();
  private targetDummy: THREE.Group | null = null;

  // 瞄准镜
  private readonly FOV_NORMAL = 75;
  private readonly FOV_SCOPE = 25;
  private currentFov: number = 75;

  // AI 行为
  private aiFireTimer: number = 0;
  private aiTurnTimer: number = 0;
  private aiMoveDir: number = 1;

  // 当前帧输入（每帧只采集一次，避免重复 sample）
  private currentInput: import('@tankgame/shared').InputCmd | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    inputManager: InputManager,
    onComplete: () => void
  ) {
    this.renderer = renderer;
    // 创建独立场景（不影响主游戏场景）
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 100, 350);
    this.scene.background = new THREE.Color(0x87ceeb);
    this.camera = camera;
    this.inputManager = inputManager;
    this.onComplete = onComplete;

    // 初始化玩家坦克
    this.player = {
      position: new Vec3(0, 0, 0),
      velocity: Vec3.zero(),
      bodyYaw: 0,
      turretYaw: 0,
      gunPitch: 0,
      hp: TANK_MAX_HP,
      alive: true,
      reloadRemain: 0,
      kills: 0,
      deaths: 0,
    };
  }

  /**
   * 启动教学模式
   */
  start(): void {
    this.running = true;
    this.lastTime = performance.now();

    // 添加光照
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff5e6, 1.2);
    sun.position.set(80, 150, 60);
    this.scene.add(sun);
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
    this.scene.add(hemi);

    // 生成小地图
    this.mapData = MapGenerator.generate(42);
    this.createTerrain();

    // 放置玩家
    this.player.position = new Vec3(0, MapGenerator.getHeightAt(this.mapData, 0, 0), 0);

    // 创建玩家坦克模型
    this.playerMesh = this.createTankMesh(0x3cb371, 0x2e8b57);
    this.scene.add(this.playerMesh);

    // 设置第1阶段
    this.enterStage(TutorialStage.Movement);

    // 开始循环
    this.gameLoop(performance.now());
  }

  /**
   * 销毁教学模式
   */
  destroy(): void {
    this.running = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
    // 清除场景
    while (this.scene.children.length > 0) {
      const child = this.scene.children[0];
      this.scene.remove(child);
    }
    // 重置 FOV
    this.camera.fov = this.FOV_NORMAL;
    this.camera.updateProjectionMatrix();

    // 重置瞄准镜覆盖层
    const scopeOverlay = document.getElementById('scope-overlay');
    if (scopeOverlay) scopeOverlay.style.opacity = '0';

    // 重置准星显示
    const crosshair = document.querySelector('.crosshair') as HTMLElement;
    if (crosshair) crosshair.style.opacity = '1';

    // 重置瞄准数据面板
    const scopeInfo = document.querySelector('.scope-info') as HTMLElement;
    if (scopeInfo) scopeInfo.style.opacity = '0';
  }

  /**
   * 进入教学阶段
   */
  private enterStage(stage: TutorialStage): void {
    this.stage = stage;
    this.promptIndex = 0;
    this.stageStartTime = performance.now();

    switch (stage) {
      case TutorialStage.Movement:
        this.stagePrompts = [
          { text: '🎮 欢迎来到教学模式！', condition: () => performance.now() - this.stageStartTime > 2000 },
          { text: '按 W 前进', condition: () => this.hasMovedForward },
          { text: '按 S 后退', condition: () => this.hasMovedBackward },
          { text: '按 A 左转', condition: () => this.hasTurnedLeft },
          { text: '按 D 右转', condition: () => this.hasTurnedRight },
          { text: '✅ 移动教学完成！', condition: () => performance.now() - this.stageStartTime > 1000 },
        ];
        break;

      case TutorialStage.Shooting:
        // 创建射击靶子
        this.createTargetDummy();
        this.stagePrompts = [
          { text: '🎯 射击教学', condition: () => performance.now() - this.stageStartTime > 1500 },
          { text: '点击屏幕以锁定鼠标，移动鼠标瞄准', condition: () => performance.now() - this.stageStartTime > 3000 },
          { text: '左键点击 开火！', condition: () => this.hasFired },
          { text: '右键按住 进入瞄准镜模式', condition: () => this.hasAimed },
          { text: '击中前方的靶标坦克！', condition: () => this.hasHitTarget },
          { text: '✅ 射击教学完成！', condition: () => performance.now() - this.stageStartTime > 1000 },
        ];
        break;

      case TutorialStage.HUD:
        this.stagePrompts = [
          { text: '📊 HUD 界面说明', condition: () => performance.now() - this.stageStartTime > 2000 },
          { text: 'SPD = 速度 (km/h)  |  HDG = 车体朝向 (°)', condition: () => performance.now() - this.stageStartTime > 5000 },
          { text: 'HP = 血量  |  底部 = 装填进度', condition: () => performance.now() - this.stageStartTime > 5000 },
          { text: 'K/D = 击坠/死亡  |  PLY = 玩家数', condition: () => performance.now() - this.stageStartTime > 5000 },
          { text: '右下角罗盘：红色扇形=屏幕视野(60°) 蓝色坦克=车身方向 NSEW随视角旋转', condition: () => performance.now() - this.stageStartTime > 5000 },
          { text: '✅ HUD 教学完成！准备进入实战...', condition: () => performance.now() - this.stageStartTime > 2000 },
        ];
        break;

      case TutorialStage.Battle:
        // 创建 AI 坦克
        this.spawnAITank();
        // 玩家满血复位
        this.player.hp = TANK_MAX_HP;
        this.player.alive = true;
        this.stagePrompts = [
          { text: '⚔️ 最终测试：1v1 击败 AI 坦克！', condition: () => performance.now() - this.stageStartTime > 2000 },
          { text: '找到并击毁敌方坦克（灰色）即可通关', condition: () => this.aiDefeated },
          { text: '🎉 恭喜通关！教学完成，即将返回首页...', condition: () => performance.now() - this.stageStartTime > 3000 },
        ];
        break;
    }

    this.updatePromptUI();
    this.updateProgressUI();
  }

  /**
   * 下一阶段
   */
  private advanceStage(): void {
    if (this.stage < TutorialStage.Battle) {
      this.enterStage(this.stage + 1);
    } else {
      // 教学完成
      setTimeout(() => {
        this.onComplete();
      }, 1500);
    }
  }

  /**
   * 游戏主循环
   */
  private gameLoop(timestamp: number): void {
    if (!this.running) return;

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;

    // 采集一次输入，整帧复用
    this.currentInput = this.inputManager.sample();

    // 本地物理更新
    this.updatePlayerPhysics(dt);
    this.updateProjectiles(dt);

    if (this.stage === TutorialStage.Battle && this.aiTank) {
      this.updateAIBehavior(dt);
      this.updateAIPhysics(dt);
    }

    // 碰撞检测
    this.checkCollisions();

    // 输入追踪（用已采集的 currentInput）
    this.trackInput();

    // 教学进度检查
    this.checkPromptProgress();

    // 更新相机
    this.updateCamera();

    // 更新可视化
    this.updateMeshes();

    // 瞄准镜 + 准星 + HUD
    this.updateScope(dt);
    this.updateHUD();

    // 渲染
    this.renderer.render(this.scene, this.camera);

    this.animFrameId = requestAnimationFrame((t) => this.gameLoop(t));
  }

  /**
   * 更新玩家物理
   * 阻尼使用与服务端一致的按 tick 指数衰减: damping^(dt * TICK_RATE)
   */
  private updatePlayerPhysics(dt: number): void {
    if (!this.player.alive) return;

    const input = this.currentInput!;
    const p = this.player;

    // 转向
    if (input.turnLeft) {
      p.bodyYaw += TANK_TURN_RATE * dt;
      this.turnsCompleted++;
    }
    if (input.turnRight) {
      p.bodyYaw -= TANK_TURN_RATE * dt;
      this.turnsCompleted++;
    }

    // 前后加速
    const fwdX = -Math.sin(p.bodyYaw);
    const fwdZ = -Math.cos(p.bodyYaw);
    if (input.forward) {
      p.velocity.x += fwdX * TANK_ACCELERATION * dt;
      p.velocity.z += fwdZ * TANK_ACCELERATION * dt;
    }
    if (input.backward) {
      p.velocity.x -= fwdX * TANK_ACCELERATION * TANK_REVERSE_FACTOR * dt;
      p.velocity.z -= fwdZ * TANK_ACCELERATION * TANK_REVERSE_FACTOR * dt;
    }

    // 阻尼 — 与服务端一致: 每 tick 乘 TANK_DAMPING，换算为帧率无关
    const dampFactor = Math.pow(TANK_DAMPING, dt * TICK_RATE);
    p.velocity.x *= dampFactor;
    p.velocity.z *= dampFactor;

    // 限速
    const speed = Math.sqrt(p.velocity.x ** 2 + p.velocity.z ** 2);
    if (speed > TANK_MAX_SPEED) {
      const scale = TANK_MAX_SPEED / speed;
      p.velocity.x *= scale;
      p.velocity.z *= scale;
    }

    // 位置更新
    const prevPos = p.position.clone();
    p.position.x += p.velocity.x * dt;
    p.position.z += p.velocity.z * dt;

    // 地形高度
    if (this.mapData) {
      p.position.y = MapGenerator.getHeightAt(this.mapData, p.position.x, p.position.z);
    }

    // 掩体碰撞检测（圆柱 vs 圆柱）— 与 GameWorld 一致
    if (this.mapData) {
      for (const cover of this.mapData.covers) {
        const cdx = p.position.x - cover.position.x;
        const cdz = p.position.z - cover.position.z;
        const dist = Math.sqrt(cdx * cdx + cdz * cdz);
        const minDist = TANK_COLLISION_RADIUS + cover.radius;
        if (dist < minDist && dist > 0.001) {
          const pushX = (cdx / dist) * (minDist - dist);
          const pushZ = (cdz / dist) * (minDist - dist);
          p.position.x += pushX;
          p.position.z += pushZ;
          // 消除朝向掩体方向的速度分量
          const nx = cdx / dist;
          const nz = cdz / dist;
          const vDotN = p.velocity.x * nx + p.velocity.z * nz;
          if (vDotN < 0) {
            p.velocity.x -= vDotN * nx;
            p.velocity.z -= vDotN * nz;
          }
        }
      }
    }

    // 距离追踪
    const dx = p.position.x - prevPos.x;
    const dz = p.position.z - prevPos.z;
    this.distanceTraveled += Math.sqrt(dx * dx + dz * dz);

    // 炮塔和炮管
    p.turretYaw = input.turretYaw;
    p.gunPitch = input.gunPitch;

    // 装填
    if (p.reloadRemain > 0) {
      p.reloadRemain = Math.max(0, p.reloadRemain - dt * 1000);
    }

    // 开火
    if (input.fire && p.reloadRemain <= 0) {
      this.playerFire();
      p.reloadRemain = RELOAD_TIME;
      // 单发：清除开火状态，防止按住连射
      this.inputManager.clearFire();
    }

    // 地图边界 — 与 GameWorld 一致：碰到边缘停速 + 推回
    const halfW = this.mapData ? this.mapData.width / 2 : 200;
    const halfD = this.mapData ? this.mapData.depth / 2 : 200;
    if (p.position.x < -halfW) {
      p.position.x = -halfW;
      if (p.velocity.x < 0) p.velocity.x = 0;
    } else if (p.position.x > halfW) {
      p.position.x = halfW;
      if (p.velocity.x > 0) p.velocity.x = 0;
    }
    if (p.position.z < -halfD) {
      p.position.z = -halfD;
      if (p.velocity.z < 0) p.velocity.z = 0;
    } else if (p.position.z > halfD) {
      p.position.z = halfD;
      if (p.velocity.z > 0) p.velocity.z = 0;
    }
  }

  /**
   * 玩家开火
   */
  private playerFire(): void {
    const p = this.player;
    const totalYaw = p.bodyYaw + p.turretYaw;
    const cosPitch = Math.cos(p.gunPitch);
    const sinPitch = Math.sin(p.gunPitch);

    const dirX = -Math.sin(totalYaw) * cosPitch;
    const dirY = sinPitch;
    const dirZ = -Math.cos(totalYaw) * cosPitch;

    const muzzleOffset = 4;
    const proj: LocalProjectile = {
      id: this.nextProjectileId++,
      position: new Vec3(
        p.position.x + dirX * muzzleOffset,
        p.position.y + 2.0 + dirY * muzzleOffset,
        p.position.z + dirZ * muzzleOffset,
      ),
      velocity: new Vec3(
        dirX * MUZZLE_VELOCITY,
        dirY * MUZZLE_VELOCITY,
        dirZ * MUZZLE_VELOCITY,
      ),
      ttl: PROJECTILE_TTL,
      ownerId: 0,
    };
    this.projectiles.push(proj);
    this.hasFired = true;
  }

  /**
   * AI 开火
   */
  private aiFire(): void {
    if (!this.aiTank || !this.aiTank.alive) return;

    const ai = this.aiTank;
    const totalYaw = ai.bodyYaw + ai.turretYaw;
    const cosPitch = Math.cos(ai.gunPitch);
    const sinPitch = Math.sin(ai.gunPitch);

    const dirX = -Math.sin(totalYaw) * cosPitch;
    const dirY = sinPitch;
    const dirZ = -Math.cos(totalYaw) * cosPitch;

    const muzzleOffset = 4;
    const proj: LocalProjectile = {
      id: this.nextProjectileId++,
      position: new Vec3(
        ai.position.x + dirX * muzzleOffset,
        ai.position.y + 2.0 + dirY * muzzleOffset,
        ai.position.z + dirZ * muzzleOffset,
      ),
      velocity: new Vec3(
        dirX * MUZZLE_VELOCITY * 0.7, // AI 弹速略低
        dirY * MUZZLE_VELOCITY * 0.7,
        dirZ * MUZZLE_VELOCITY * 0.7,
      ),
      ttl: PROJECTILE_TTL,
      ownerId: 1,
    };
    this.projectiles.push(proj);
  }

  /**
   * 更新弹体物理
   */
  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      const prevX = proj.position.x;
      const prevY = proj.position.y;
      const prevZ = proj.position.z;

      proj.position.x += proj.velocity.x * dt;
      proj.position.y += proj.velocity.y * dt;
      proj.position.z += proj.velocity.z * dt;
      proj.velocity.y -= GRAVITY * dt;
      proj.ttl -= dt * 1000;

      // 掩体碰撞（扫掠射线 vs 圆柱）— 与 GameWorld 一致
      if (this.mapData && this.checkProjectileCoverCollision(proj, prevX, prevY, prevZ)) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // 地面碰撞
      if (this.mapData) {
        const groundY = MapGenerator.getHeightAt(this.mapData, proj.position.x, proj.position.z);
        if (proj.position.y < groundY) {
          this.handleProjectileExplode(proj);
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      if (proj.ttl <= 0) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  /**
   * 检测弹体与掩体碰撞（扫掠射线 vs 圆柱，防高速穿透）— 复制自 GameWorld
   */
  private checkProjectileCoverCollision(
    proj: LocalProjectile,
    prevX: number,
    prevY: number,
    prevZ: number
  ): boolean {
    if (!this.mapData) return false;

    const curX = proj.position.x;
    const curY = proj.position.y;
    const curZ = proj.position.z;

    for (const cover of this.mapData.covers) {
      const groundY = MapGenerator.getHeightAt(this.mapData, cover.position.x, cover.position.z);
      const coverTop = groundY + cover.height;
      const coverBottom = groundY - 0.5;
      const totalRadius = cover.radius + PROJECTILE_COLLISION_RADIUS;

      // 射线段 XZ 平面投影
      const dx = curX - prevX;
      const dz = curZ - prevZ;
      const ox = prevX - cover.position.x;
      const oz = prevZ - cover.position.z;

      // 二次方程 a*t^2 + b*t + c = 0
      const a = dx * dx + dz * dz;
      const b = 2 * (ox * dx + oz * dz);
      const c = ox * ox + oz * oz - totalRadius * totalRadius;

      // 快速检测：当前位置在圆柱内
      const distSq = (curX - cover.position.x) ** 2 + (curZ - cover.position.z) ** 2;
      if (distSq < totalRadius * totalRadius && curY < coverTop && curY > coverBottom) {
        this.handleProjectileExplode(proj);
        return true;
      }

      // 扫掠检测
      if (a < 0.0001) continue;
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) continue;

      const sqrtD = Math.sqrt(discriminant);
      const t1 = (-b - sqrtD) / (2 * a);
      const t2 = (-b + sqrtD) / (2 * a);

      for (const t of [t1, t2]) {
        if (t < 0 || t > 1) continue;
        const hitY = prevY + t * (curY - prevY);
        if (hitY >= coverBottom && hitY <= coverTop) {
          proj.position.x = prevX + t * dx;
          proj.position.y = hitY;
          proj.position.z = prevZ + t * dz;
          this.handleProjectileExplode(proj);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 碰撞检测
   */
  private checkCollisions(): void {
    const colRadius = TANK_COLLISION_RADIUS + PROJECTILE_COLLISION_RADIUS;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];

      // 检查靶子碰撞（射击教学阶段）
      if (proj.ownerId === 0 && this.targetDummy) {
        const targetPos = this.targetDummy.position;
        const dx = proj.position.x - targetPos.x;
        const dy = proj.position.y - targetPos.y - 1;
        const dz = proj.position.z - targetPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < colRadius) {
          this.hasHitTarget = true;
          this.handleProjectileExplode(proj);
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      // 检查 AI 坦克碰撞
      if (proj.ownerId === 0 && this.aiTank && this.aiTank.alive) {
        const dx = proj.position.x - this.aiTank.position.x;
        const dy = proj.position.y - this.aiTank.position.y - 1;
        const dz = proj.position.z - this.aiTank.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < colRadius) {
          this.aiTank.hp -= DIRECT_HIT_DAMAGE;
          // 溅射伤害（检查玩家是否在范围内）
          this.handleProjectileExplode(proj, this.aiTank);
          this.projectiles.splice(i, 1);
          if (this.aiTank.hp <= 0) {
            this.aiTank.alive = false;
            this.aiDefeated = true;
            this.player.kills++;
            this.spawnDeathExplosion(this.aiTank.position);
          }
          continue;
        }
      }

      // 检查玩家被 AI 击中
      if (proj.ownerId === 1 && this.player.alive) {
        const dx = proj.position.x - this.player.position.x;
        const dy = proj.position.y - this.player.position.y - 1;
        const dz = proj.position.z - this.player.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < colRadius) {
          this.player.hp -= DIRECT_HIT_DAMAGE;
          // 溅射伤害（检查 AI 是否在范围内）
          this.handleProjectileExplode(proj, this.player);
          this.projectiles.splice(i, 1);
          if (this.player.hp <= 0) {
            this.player.hp = TANK_MAX_HP; // 教学模式不死亡，回满血
          }
          continue;
        }
      }
    }
  }

  /**
   * 处理弹体爆炸（视觉特效 + 溅射伤害）— 与 GameWorld 一致
   */
  private handleProjectileExplode(proj: LocalProjectile, directHitTarget?: LocalTank): void {
    this.spawnImpactEffect(proj.position);

    // 溅射伤害检查
    const targets: { tank: LocalTank; isPlayer: boolean }[] = [];
    targets.push({ tank: this.player, isPlayer: true });
    if (this.aiTank && this.aiTank.alive) {
      targets.push({ tank: this.aiTank, isPlayer: false });
    }

    for (const { tank, isPlayer } of targets) {
      // 跳过发射者自身和已被直击的目标
      if (isPlayer && proj.ownerId === 0) continue;
      if (!isPlayer && proj.ownerId === 1) continue;
      if (tank === directHitTarget) continue;

      const splashDamage = calculateSplashDamage(proj.position, tank.position);
      if (splashDamage > 0) {
        tank.hp -= splashDamage;
        if (isPlayer && tank.hp <= 0) {
          tank.hp = TANK_MAX_HP; // 教学模式不死亡
        }
        if (!isPlayer && tank.hp <= 0 && tank.alive) {
          tank.alive = false;
          this.aiDefeated = true;
          this.player.kills++;
          this.spawnDeathExplosion(tank.position);
        }
      }
    }
  }

  /**
   * 追踪教学输入条件（使用当前帧已采集的 currentInput）
   */
  private trackInput(): void {
    const input = this.currentInput!;
    if (input.forward && this.distanceTraveled > 5) this.hasMovedForward = true;
    if (input.backward && this.distanceTraveled > 3) this.hasMovedBackward = true;
    if (input.turnLeft && this.turnsCompleted > 30) this.hasTurnedLeft = true;
    if (input.turnRight && this.turnsCompleted > 60) this.hasTurnedRight = true;
    if (this.inputManager.isAiming()) this.hasAimed = true;
  }

  /**
   * 检查教学提示进度
   */
  private checkPromptProgress(): void {
    if (this.promptIndex >= this.stagePrompts.length) return;

    const prompt = this.stagePrompts[this.promptIndex];
    if (prompt.condition()) {
      this.promptIndex++;
      this.stageStartTime = performance.now(); // 重置时间条件

      if (this.promptIndex >= this.stagePrompts.length) {
        // 阶段完成
        setTimeout(() => this.advanceStage(), 500);
      } else {
        this.updatePromptUI();
      }
    }
  }

  /**
   * 更新教学提示 UI
   */
  private updatePromptUI(): void {
    const el = document.getElementById('tutorial-prompt');
    if (!el) return;
    if (this.promptIndex < this.stagePrompts.length) {
      el.textContent = this.stagePrompts[this.promptIndex].text;
    }
  }

  /**
   * 更新进度显示
   */
  private updateProgressUI(): void {
    const el = document.getElementById('tutorial-progress');
    if (!el) return;
    const stageNames = ['移动', '射击', 'HUD', '实战'];
    const parts = stageNames.map((name, idx) => {
      if (idx < this.stage) return `✅ ${name}`;
      if (idx === this.stage) return `▶ ${name}`;
      return `○ ${name}`;
    });
    el.textContent = parts.join('  │  ');
  }

  // ==================== 相机 ====================

  private updateCamera(): void {
    const p = this.player;
    const localTurretYaw = this.inputManager.getTurretYaw();
    const localGunPitch = this.inputManager.getGunPitch();
    const totalYaw = p.bodyYaw + localTurretYaw;

    this.inputManager.setBodyYaw(p.bodyYaw);

    const cosPitch = Math.cos(localGunPitch);
    const sinPitch = Math.sin(localGunPitch);
    const dirX = -Math.sin(totalYaw) * cosPitch;
    const dirY = sinPitch;
    const dirZ = -Math.cos(totalYaw) * cosPitch;

    const sightHeight = 2.2;
    const sightX = p.position.x;
    const sightY = p.position.y + sightHeight;
    const sightZ = p.position.z;

    const aiming = this.inputManager.isAiming();

    if (aiming) {
      this.camera.position.set(sightX, sightY, sightZ);
      this.camera.rotation.set(localGunPitch, totalYaw, 0, 'YXZ');
    } else {
      const camOffsetBack = 1.5;
      const camHeight = 3.8;
      const camX = p.position.x - Math.sin(totalYaw) * camOffsetBack;
      const camY = p.position.y + camHeight;
      const camZ = p.position.z - Math.cos(totalYaw) * camOffsetBack;
      this.camera.position.set(camX, camY, camZ);

      const convergeDist = 200;
      const muzzleFwd = 4;
      const muzzleX = sightX + dirX * muzzleFwd;
      const muzzleY = sightY + dirY * muzzleFwd;
      const muzzleZ = sightZ + dirZ * muzzleFwd;
      const targetX = muzzleX + dirX * convergeDist;
      const targetY = muzzleY + dirY * convergeDist;
      const targetZ = muzzleZ + dirZ * convergeDist;

      const lookDx = targetX - camX;
      const lookDy = targetY - camY;
      const lookDz = targetZ - camZ;
      const lookLen = Math.sqrt(lookDx * lookDx + lookDy * lookDy + lookDz * lookDz);
      const correctedPitch = Math.asin(lookDy / lookLen);
      const correctedYaw = Math.atan2(-lookDx, -lookDz);
      this.camera.rotation.set(correctedPitch, correctedYaw, 0, 'YXZ');
    }
  }

  private updateScope(dt: number): void {
    const aiming = this.inputManager.isAiming();
    const targetFov = aiming ? this.FOV_SCOPE : this.FOV_NORMAL;
    const lerpSpeed = 12;
    this.currentFov += (targetFov - this.currentFov) * Math.min(1, lerpSpeed * dt);
    if (Math.abs(this.currentFov - targetFov) < 0.3) this.currentFov = targetFov;
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();

    const isScoped = this.currentFov < 40;

    // 控制瞄准镜覆盖层（与主游戏共用 DOM 元素）
    const scopeOverlay = document.getElementById('scope-overlay');
    if (scopeOverlay) {
      scopeOverlay.style.opacity = isScoped ? '1' : '0';
    }

    // 准星：瞄准镜模式下隐藏普通准星
    const crosshair = document.querySelector('.crosshair') as HTMLElement;
    if (crosshair) {
      crosshair.style.opacity = isScoped ? '0' : '1';
    }

    // 瞄准镜 HUD 信息
    const scopeInfo = document.querySelector('.scope-info') as HTMLElement;
    if (scopeInfo) {
      if (isScoped) {
        const alt = Math.round(this.player.position.y * 10) / 10;
        // 计算到 AI 坦克的距离
        let distStr = '---';
        if (this.aiTank && this.aiTank.alive) {
          const dx = this.aiTank.position.x - this.player.position.x;
          const dz = this.aiTank.position.z - this.player.position.z;
          distStr = `${Math.round(Math.sqrt(dx * dx + dz * dz))}m`;
        }
        scopeInfo.textContent = `RNG ${distStr}  ALT ${alt.toFixed(1)}m`;
        scopeInfo.style.opacity = '1';
      } else {
        scopeInfo.style.opacity = '0';
      }
    }
  }

  /**
   * 更新 HUD — 与主游戏保持一致的 SPD/HDG/HP/装填/K·D/罗盘
   */
  private updateHUD(): void {
    const p = this.player;
    const speed = Math.sqrt(p.velocity.x ** 2 + p.velocity.z ** 2);
    const heading = Math.round(((p.bodyYaw * 180 / Math.PI) % 360 + 360) % 360);

    const speedEl = document.querySelector('.speed');
    const headingEl = document.querySelector('.heading');
    const hpEl = document.querySelector('.hp-bar');
    const reloadEl = document.querySelector('.reload-bar');
    const kdEl = document.querySelector('.kd-stat');
    const playerCountEl = document.querySelector('.player-count');

    if (speedEl) speedEl.textContent = `SPD  ${Math.round(speed * 3.6)}`;
    if (headingEl) headingEl.textContent = `HDG  ${heading}`;
    if (hpEl) {
      const hp = Math.max(0, p.hp);
      const bars = Math.round(hp / TANK_MAX_HP * 12);
      hpEl.textContent = `HP ${'█'.repeat(bars)}${'░'.repeat(12 - bars)} ${hp}`;
    }
    if (reloadEl) {
      if (p.reloadRemain <= 0) {
        reloadEl.textContent = '▓▓▓▓▓▓▓▓▓▓▓▓ READY';
      } else {
        const progress = Math.round((1 - p.reloadRemain / RELOAD_TIME) * 12);
        reloadEl.textContent = `${'▓'.repeat(progress)}${'░'.repeat(12 - progress)} RELOAD`;
      }
    }
    if (kdEl) {
      kdEl.textContent = `K ${p.kills} / D ${p.deaths}`;
    }
    if (playerCountEl) {
      const totalPlayers = this.aiTank ? 2 : 1;
      playerCountEl.textContent = `PLY 1+${totalPlayers - 1}AI / ${totalPlayers}`;
    }

    // 瞄准数据面板
    const aimInfo = document.querySelector('.aim-info') as HTMLElement;
    if (aimInfo) {
      const speedKmh = Math.round(speed * 3.6);
      const localGunPitch = this.inputManager.getGunPitch();
      const localTurretYaw = this.inputManager.getTurretYaw();
      const elevDeg = (localGunPitch * 180 / Math.PI).toFixed(1);
      const turretDeg = (localTurretYaw * 180 / Math.PI).toFixed(1);
      const elevSign = localGunPitch >= 0 ? '+' : '';
      const turretSign = localTurretYaw >= 0 ? '+' : '';
      aimInfo.innerHTML =
        `SPD ${speedKmh}<br>ELV ${elevSign}${elevDeg}°<br>TRT ${turretSign}${turretDeg}°`;
    }

    // 罗盘
    this.updateCompass();
  }

  /**
   * 罗盘 — 与主游戏一致：红色60°扇形（屏幕视野）永远朝上 + 蓝色车身相对旋转 + 旋转 NSEW
   */
  private updateCompass(): void {
    const canvas = document.getElementById('compass-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const p = this.player;
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 12;

    ctx.clearRect(0, 0, size, size);

    // 背景圆
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fill();
    ctx.strokeStyle = '#ff6a0060';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 炮塔世界朝向
    const localTurretYaw = this.inputManager.getTurretYaw();
    const turretWorldYaw = p.bodyYaw + localTurretYaw;

    // ===== 旋转罗盘刻度环：以炮塔世界朝向为参考 =====
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-turretWorldYaw);

    ctx.fillStyle = '#ff6a00';
    ctx.font = 'bold 10px "Courier New"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelR = r - 8;
    ctx.fillText('N', 0, -labelR);
    ctx.fillText('S', 0, labelR);
    ctx.fillText('E', labelR, 0);
    ctx.fillText('W', -labelR, 0);

    // 小刻度线（每 30°）
    ctx.strokeStyle = '#ff6a0040';
    ctx.lineWidth = 1;
    for (let deg = 0; deg < 360; deg += 30) {
      if (deg % 90 === 0) continue;
      const rad = deg * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(Math.sin(rad) * (r - 3), -Math.cos(rad) * (r - 3));
      ctx.lineTo(Math.sin(rad) * (r - 10), -Math.cos(rad) * (r - 10));
      ctx.stroke();
    }
    ctx.restore();

    // ===== 红色60°半透明视野扇形 — 永远朝上（玩家屏幕视角） =====
    ctx.save();
    ctx.translate(cx, cy);
    const sectorAngle = (60 / 2) * Math.PI / 180; // 30°
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r - 14, -Math.PI / 2 - sectorAngle, -Math.PI / 2 + sectorAngle);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 50, 50, 0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // ===== 半透明蓝色坦克车身：相对于炮塔旋转 =====
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(localTurretYaw); // 车体相对炮塔偏差

    const tankScale = r * 0.4;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#4488cc';

    const bw = tankScale * 0.55;
    const bh = tankScale * 0.8;
    ctx.beginPath();
    ctx.moveTo(-bw, -bh + 3);
    ctx.lineTo(-bw, bh - 3);
    ctx.quadraticCurveTo(-bw, bh, -bw + 3, bh);
    ctx.lineTo(bw - 3, bh);
    ctx.quadraticCurveTo(bw, bh, bw, bh - 3);
    ctx.lineTo(bw, -bh + 3);
    ctx.quadraticCurveTo(bw, -bh, bw - 3, -bh);
    ctx.lineTo(-bw + 3, -bh);
    ctx.quadraticCurveTo(-bw, -bh, -bw, -bh + 3);
    ctx.closePath();
    ctx.fill();

    // 履带
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#336699';
    const tw = bw * 0.28;
    ctx.fillRect(-bw - tw * 0.3, -bh + 4, tw, bh * 2 - 8);
    ctx.fillRect(bw - tw * 0.7, -bh + 4, tw, bh * 2 - 8);

    // 车头方向三角
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#66aadd';
    ctx.beginPath();
    ctx.moveTo(0, -bh - 5);
    ctx.lineTo(-bw * 0.4, -bh + 2);
    ctx.lineTo(bw * 0.4, -bh + 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.restore();

    // 中心圆点
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3333';
    ctx.fill();

    // 炮塔偏转角度
    const relDeg = Math.round(localTurretYaw * 180 / Math.PI);
    const relSign = relDeg >= 0 ? '+' : '';
    ctx.fillStyle = '#ff6a00';
    ctx.font = '10px "Courier New"';
    ctx.textAlign = 'center';
    ctx.fillText(`${relSign}${relDeg}°`, cx, cy + r + 10);
  }

  // ==================== 可视化 ====================

  private updateMeshes(): void {
    // 玩家坦克
    if (this.playerMesh) {
      this.playerMesh.position.set(
        this.player.position.x,
        this.player.position.y,
        this.player.position.z
      );
      this.playerMesh.rotation.y = this.player.bodyYaw;
      this.playerMesh.visible = false; // FPS 视角隐藏自身

      const turretPivot = this.playerMesh.getObjectByName('turretPivot');
      if (turretPivot) turretPivot.rotation.y = this.player.turretYaw;
      const barrelPivot = this.playerMesh.getObjectByName('barrelPivot');
      if (barrelPivot) barrelPivot.rotation.x = this.player.gunPitch;
    }

    // AI 坦克
    if (this.aiMesh && this.aiTank) {
      this.aiMesh.visible = this.aiTank.alive;
      this.aiMesh.position.set(
        this.aiTank.position.x,
        this.aiTank.position.y,
        this.aiTank.position.z
      );
      this.aiMesh.rotation.y = this.aiTank.bodyYaw;

      const turretPivot = this.aiMesh.getObjectByName('turretPivot');
      if (turretPivot) turretPivot.rotation.y = this.aiTank.turretYaw;
      const barrelPivot = this.aiMesh.getObjectByName('barrelPivot');
      if (barrelPivot) barrelPivot.rotation.x = this.aiTank.gunPitch;
    }

    // 弹体
    const activeIds = new Set<number>();
    for (const proj of this.projectiles) {
      activeIds.add(proj.id);
      let mesh = this.projectileMeshes.get(proj.id);
      if (!mesh) {
        const geo = new THREE.SphereGeometry(0.3, 6, 4);
        const mat = new THREE.MeshBasicMaterial({ color: proj.ownerId === 0 ? 0xffaa00 : 0xff4444 });
        mesh = new THREE.Mesh(geo, mat);
        this.scene.add(mesh);
        this.projectileMeshes.set(proj.id, mesh);
      }
      mesh.position.set(proj.position.x, proj.position.y, proj.position.z);
    }
    for (const [id, mesh] of this.projectileMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }

    // 更新教学 HUD
    this.updateTutorialHUD();
  }

  /**
   * 更新教学提示文本（HUD 由 updateHUD 统一处理）
   */
  private updateTutorialHUD(): void {
    const promptEl = document.getElementById('tutorial-prompt');
    if (promptEl && this.promptIndex < this.stagePrompts.length) {
      promptEl.textContent = this.stagePrompts[this.promptIndex].text;
    }
  }

  // ==================== AI 行为 ====================

  private spawnAITank(): void {
    const dist = 40 + Math.random() * 20;
    const angle = Math.random() * Math.PI * 2;
    const x = this.player.position.x + Math.sin(angle) * dist;
    const z = this.player.position.z + Math.cos(angle) * dist;
    const y = this.mapData ? MapGenerator.getHeightAt(this.mapData, x, z) : 0;

    this.aiTank = {
      position: new Vec3(x, y, z),
      velocity: Vec3.zero(),
      bodyYaw: angle + Math.PI,
      turretYaw: 0,
      gunPitch: 0,
      hp: TANK_MAX_HP,
      alive: true,
      reloadRemain: 0,
      kills: 0,
      deaths: 0,
    };

    this.aiMesh = this.createTankMesh(0x708090, 0x556b7a);
    // 天线标记
    const antGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4);
    const antMat = new THREE.MeshLambertMaterial({ color: 0x888888, flatShading: true });
    const antenna = new THREE.Mesh(antGeo, antMat);
    antenna.position.set(0.3, 3.2, 0.6);
    this.aiMesh.add(antenna);
    const tipGeo = new THREE.SphereGeometry(0.1, 6, 4);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0x4488ff });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(0.3, 3.9, 0.6);
    this.aiMesh.add(tip);

    this.scene.add(this.aiMesh);
  }

  private updateAIBehavior(dt: number): void {
    if (!this.aiTank || !this.aiTank.alive) return;

    const ai = this.aiTank;
    const p = this.player;

    // 朝向玩家
    const dx = p.position.x - ai.position.x;
    const dz = p.position.z - ai.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const targetYaw = Math.atan2(-dx, -dz);

    // 慢速转向
    let yawDiff = targetYaw - ai.bodyYaw;
    while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
    while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;
    ai.bodyYaw += Math.sign(yawDiff) * Math.min(Math.abs(yawDiff), TANK_TURN_RATE * 0.5 * dt);

    // 炮塔对准玩家
    let turretTarget = targetYaw - ai.bodyYaw;
    while (turretTarget > Math.PI) turretTarget -= 2 * Math.PI;
    while (turretTarget < -Math.PI) turretTarget += 2 * Math.PI;
    turretTarget = Math.max(-TURRET_YAW_MAX, Math.min(TURRET_YAW_MAX, turretTarget));
    const turretDiff = turretTarget - ai.turretYaw;
    ai.turretYaw += Math.sign(turretDiff) * Math.min(Math.abs(turretDiff), TURRET_TURN_RATE * 0.5 * dt);

    // 简单移动
    this.aiTurnTimer += dt;
    if (this.aiTurnTimer > 3) {
      this.aiTurnTimer = 0;
      this.aiMoveDir = Math.random() > 0.5 ? 1 : -1;
    }

    if (dist > 15) {
      const fwdX = -Math.sin(ai.bodyYaw);
      const fwdZ = -Math.cos(ai.bodyYaw);
      ai.velocity.x += fwdX * TANK_ACCELERATION * 0.3 * dt;
      ai.velocity.z += fwdZ * TANK_ACCELERATION * 0.3 * dt;
    }

    // 开火（装填完成且朝向大致对准）
    if (ai.reloadRemain > 0) {
      ai.reloadRemain = Math.max(0, ai.reloadRemain - dt * 1000);
    }
    this.aiFireTimer += dt;
    if (ai.reloadRemain <= 0 && Math.abs(turretDiff) < 0.2 && dist < 80 && this.aiFireTimer > 3) {
      this.aiFire();
      ai.reloadRemain = RELOAD_TIME;
      this.aiFireTimer = 0;
    }
  }

  private updateAIPhysics(dt: number): void {
    if (!this.aiTank || !this.aiTank.alive) return;

    const ai = this.aiTank;
    // 阻尼 — 与玩家一致的帧率无关计算
    const dampFactor = Math.pow(TANK_DAMPING, dt * TICK_RATE);
    ai.velocity.x *= dampFactor;
    ai.velocity.z *= dampFactor;

    const speed = Math.sqrt(ai.velocity.x ** 2 + ai.velocity.z ** 2);
    if (speed > TANK_MAX_SPEED * 0.5) {
      const scale = (TANK_MAX_SPEED * 0.5) / speed;
      ai.velocity.x *= scale;
      ai.velocity.z *= scale;
    }

    ai.position.x += ai.velocity.x * dt;
    ai.position.z += ai.velocity.z * dt;

    if (this.mapData) {
      ai.position.y = MapGenerator.getHeightAt(this.mapData, ai.position.x, ai.position.z);
    }

    // 掩体碰撞检测 — 与 GameWorld 一致
    if (this.mapData) {
      for (const cover of this.mapData.covers) {
        const cdx = ai.position.x - cover.position.x;
        const cdz = ai.position.z - cover.position.z;
        const dist = Math.sqrt(cdx * cdx + cdz * cdz);
        const minDist = TANK_COLLISION_RADIUS + cover.radius;
        if (dist < minDist && dist > 0.001) {
          const pushX = (cdx / dist) * (minDist - dist);
          const pushZ = (cdz / dist) * (minDist - dist);
          ai.position.x += pushX;
          ai.position.z += pushZ;
          const nx = cdx / dist;
          const nz = cdz / dist;
          const vDotN = ai.velocity.x * nx + ai.velocity.z * nz;
          if (vDotN < 0) {
            ai.velocity.x -= vDotN * nx;
            ai.velocity.z -= vDotN * nz;
          }
        }
      }
    }

    // 地图边界 — 与 GameWorld 一致
    const halfW = this.mapData ? this.mapData.width / 2 : 200;
    const halfD = this.mapData ? this.mapData.depth / 2 : 200;
    if (ai.position.x < -halfW) {
      ai.position.x = -halfW;
      if (ai.velocity.x < 0) ai.velocity.x = 0;
    } else if (ai.position.x > halfW) {
      ai.position.x = halfW;
      if (ai.velocity.x > 0) ai.velocity.x = 0;
    }
    if (ai.position.z < -halfD) {
      ai.position.z = -halfD;
      if (ai.velocity.z < 0) ai.velocity.z = 0;
    } else if (ai.position.z > halfD) {
      ai.position.z = halfD;
      if (ai.velocity.z > 0) ai.velocity.z = 0;
    }
  }

  // ==================== 三维对象创建 ====================

  private createTerrain(): void {
    if (!this.mapData) return;

    const map = this.mapData;
    const res = map.resolution;
    const geometry = new THREE.PlaneGeometry(map.width, map.depth, res - 1, res - 1);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const ix = i % res;
      const iz = Math.floor(i / res);
      positions.setY(i, map.heightmap[iz * res + ix]);
    }
    geometry.computeVertexNormals();

    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const t = Math.max(0, Math.min(1, (y + 5) / 15));
      colors[i * 3] = 0.25 + t * 0.35;
      colors[i * 3 + 1] = 0.45 + t * 0.2;
      colors[i * 3 + 2] = 0.15 + t * 0.15;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.terrain = new THREE.Mesh(geometry, material);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    // 掩体
    for (const cover of map.covers) {
      const size = cover.radius * 2;
      const coverGeo = new THREE.BoxGeometry(size, cover.height, size);
      const coverMat = new THREE.MeshLambertMaterial({ color: 0x8b7355, flatShading: true });
      const coverMesh = new THREE.Mesh(coverGeo, coverMat);
      const groundY = MapGenerator.getHeightAt(map, cover.position.x, cover.position.z);
      coverMesh.position.set(cover.position.x, groundY + cover.height / 2, cover.position.z);
      this.scene.add(coverMesh);
    }
  }

  private createTankMesh(bodyColor: number, darkColor: number): THREE.Group {
    const group = new THREE.Group();
    const trackColor = 0x3a3a3a;
    const barrelColor = 0x555555;

    const bodyGeo = new THREE.BoxGeometry(3.6, 1.2, 5.5);
    const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    group.add(body);

    const frontGeo = new THREE.BoxGeometry(3.6, 0.8, 1.2);
    const frontMat = new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true });
    const frontPlate = new THREE.Mesh(frontGeo, frontMat);
    frontPlate.position.set(0, 1.2, -3.0);
    frontPlate.rotation.x = -0.3;
    group.add(frontPlate);

    const trackGeo = new THREE.BoxGeometry(0.7, 0.9, 6.0);
    const trackMat = new THREE.MeshLambertMaterial({ color: trackColor, flatShading: true });
    const leftTrack = new THREE.Mesh(trackGeo, trackMat);
    leftTrack.position.set(-2.15, 0.55, 0);
    group.add(leftTrack);
    const rightTrack = new THREE.Mesh(trackGeo.clone(), trackMat);
    rightTrack.position.set(2.15, 0.55, 0);
    group.add(rightTrack);

    // 炮塔旋转枢纽
    const turretPivot = new THREE.Object3D();
    turretPivot.name = 'turretPivot';
    group.add(turretPivot);

    const turretGeo = new THREE.BoxGeometry(2.4, 0.9, 2.8);
    const turretMat = new THREE.MeshLambertMaterial({ color: darkColor, flatShading: true });
    const turret = new THREE.Mesh(turretGeo, turretMat);
    turret.position.y = 1.85;
    turretPivot.add(turret);

    const cupolaGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.35, 8);
    const cupolaMat = new THREE.MeshLambertMaterial({ color: darkColor, flatShading: true });
    const cupola = new THREE.Mesh(cupolaGeo, cupolaMat);
    cupola.position.set(0, 2.5, 0.6);
    turretPivot.add(cupola);

    // 炮管俯仰枢纽
    const barrelPivot = new THREE.Object3D();
    barrelPivot.name = 'barrelPivot';
    barrelPivot.position.set(0, 2.0, -1.4);
    turretPivot.add(barrelPivot);

    const barrelGeo = new THREE.CylinderGeometry(0.15, 0.18, 4, 6);
    barrelGeo.rotateX(Math.PI / 2);
    barrelGeo.translate(0, 0, -2);
    const barrelMat = new THREE.MeshLambertMaterial({ color: barrelColor, flatShading: true });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrelPivot.add(barrel);

    const muzzleGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.3, 6);
    muzzleGeo.rotateX(Math.PI / 2);
    muzzleGeo.translate(0, 0, -4.0);
    const muzzleMat = new THREE.MeshLambertMaterial({ color: 0x444444, flatShading: true });
    const muzzle = new THREE.Mesh(muzzleGeo, muzzleMat);
    barrelPivot.add(muzzle);

    return group;
  }

  /**
   * 创建射击靶标（静止的灰色坦克造型）
   */
  private createTargetDummy(): void {
    // 在玩家前方 30m 放一个靶标
    const fwdX = -Math.sin(this.player.bodyYaw);
    const fwdZ = -Math.cos(this.player.bodyYaw);
    const x = this.player.position.x + fwdX * 30;
    const z = this.player.position.z + fwdZ * 30;
    const y = this.mapData ? MapGenerator.getHeightAt(this.mapData, x, z) : 0;

    this.targetDummy = this.createTankMesh(0xcc4444, 0xaa2222);

    // 在靶标上方加一个浮动标记
    const markerGeo = new THREE.SphereGeometry(0.5, 8, 6);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(0, 4.5, 0);
    this.targetDummy.add(marker);

    this.targetDummy.position.set(x, y, z);
    this.targetDummy.rotation.y = this.player.bodyYaw + Math.PI; // 面对玩家
    this.scene.add(this.targetDummy);
  }

  /**
   * 弹体撞击特效
   */
  private spawnImpactEffect(pos: Vec3): void {
    const flash = new THREE.PointLight(0xff6600, 5, 20);
    flash.position.set(pos.x, pos.y + 0.5, pos.z);
    this.scene.add(flash);

    const fireGeo = new THREE.SphereGeometry(0.5, 8, 6);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 1.0 });
    const fireMesh = new THREE.Mesh(fireGeo, fireMat);
    fireMesh.position.set(pos.x, pos.y + 0.5, pos.z);
    this.scene.add(fireMesh);

    const startTime = performance.now();
    const animate = () => {
      const t = Math.min(1, (performance.now() - startTime) / 400);
      fireMesh.scale.setScalar(1 + t * 3);
      fireMat.opacity = Math.max(0, 1 - t * 2);
      flash.intensity = 5 * Math.max(0, 1 - t * 4);
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(flash, fireMesh);
        fireGeo.dispose();
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * 击毁爆炸特效
   */
  private spawnDeathExplosion(pos: Vec3): void {
    const px = pos.x, py = pos.y + 1.5, pz = pos.z;

    const fireballGeo = new THREE.SphereGeometry(1, 12, 8);
    const fireballMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 1.0 });
    const fireball = new THREE.Mesh(fireballGeo, fireballMat);
    fireball.position.set(px, py, pz);
    this.scene.add(fireball);

    const flash = new THREE.PointLight(0xff6600, 8, 40);
    flash.position.set(px, py + 2, pz);
    this.scene.add(flash);

    const startTime = performance.now();
    const animate = () => {
      const t = Math.min(1, (performance.now() - startTime) / 1500);
      fireball.scale.setScalar(1 + t * 6);
      fireballMat.opacity = Math.max(0, 1 - t * 1.5);
      flash.intensity = 8 * Math.max(0, 1 - t * 3);
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(fireball, flash);
        fireballGeo.dispose();
      }
    };
    requestAnimationFrame(animate);
  }
}
