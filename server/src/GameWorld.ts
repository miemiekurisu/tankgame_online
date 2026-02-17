import {
  updateTankPhysics,
  calculateMuzzleVelocity,
  getMuzzlePosition,
  getBarrelDirection,
  checkProjectileHit,
  calculateSplashDamage,
  TICK_INTERVAL,
  PROJECTILE_TTL,
  PROJECTILE_COLLISION_RADIUS,
  TANK_COLLISION_RADIUS,
  DIRECT_HIT_DAMAGE,
  SPLASH_RADIUS,
  RESPAWN_DELAY,
  SNAPSHOT_INTERVAL,
  MessageType,
} from '@tankgame/shared';
import type {
  InputCmd,
  SnapshotMessage,
  GameEvent,
  FireEvent,
  HitEvent,
  ExplodeEvent,
  DeathEvent,
  RespawnEvent,
  GameEventType,
} from '@tankgame/shared';
import { Player } from './Player.js';
import { Projectile } from './Projectile.js';
import { MapGenerator } from './MapGenerator.js';
import type { GameMapData } from './MapGenerator.js';
import { SpawnManager } from './SpawnManager.js';

/**
 * 游戏世界 — 权威物理模拟
 */
export class GameWorld {
  currentTick: number = 0;
  snapshotId: number = 0;

  players: Map<number, Player> = new Map();
  projectiles: Map<number, Projectile> = new Map();

  map: GameMapData;
  spawnManager: SpawnManager;

  private nextProjectileId: number = 1;
  private pendingEvents: GameEvent[] = [];
  private respawnQueue: Array<{ player: Player; timer: number }> = [];

  constructor(mapSeed: number) {
    this.map = MapGenerator.generate(mapSeed);
    this.spawnManager = new SpawnManager();
  }

  /**
   * 固定 Tick 更新 — 核心模拟循环
   */
  update(): GameEvent[] {
    const dt = TICK_INTERVAL / 1000;
    this.pendingEvents = [];
    this.currentTick++;

    // 1. 处理输入 & 物理更新（每tick都执行物理模拟，保证运动流畅）
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      const input = player.popInput();
      if (input) {
        this.applyInput(player, input, dt);
      }
    }

    // 1.5 坦克间碰撞检测（对称推开）
    this.resolveTankTankCollisions();

    // 2. 更新弹体
    for (const proj of this.projectiles.values()) {
      if (!proj.active) continue;

      // 记录移动前位置（用于扫掠碰撞检测，防止高速穿透）
      const prevX = proj.position.x;
      const prevY = proj.position.y;
      const prevZ = proj.position.z;

      proj.update(dt);

      // 检查地面碰撞
      if (
        proj.checkGroundHit((x, z) => MapGenerator.getHeightAt(this.map, x, z))
      ) {
        this.handleProjectileExplode(proj);
        continue;
      }

      // 检查掩体碰撞（扫掠射线 vs 圆柱，处理高速穿透）
      if (this.checkProjectileCoverCollision(proj, prevX, prevY, prevZ)) {
        continue;
      }
    }

    // 3. 弹体命中检测
    this.checkAllCollisions();

    // 4. 清理失效弹体
    for (const [id, proj] of this.projectiles) {
      if (!proj.active) {
        this.projectiles.delete(id);
      }
    }

    // 5. 更新复活队列
    this.updateRespawnQueue(TICK_INTERVAL);

    // 6. 更新装填
    for (const player of this.players.values()) {
      player.updateReload(TICK_INTERVAL);
    }

    return this.pendingEvents;
  }

  /**
   * 应用玩家输入
   */
  private applyInput(player: Player, input: InputCmd, dt: number): void {
    // 更新物理
    const state = player.getPhysicsState();
    updateTankPhysics(
      state,
      input,
      dt,
      (x, z) => MapGenerator.getHeightAt(this.map, x, z)
    );

    // 回写
    player.position = state.position;
    player.velocity = state.velocity;
    player.bodyYaw = state.bodyYaw;
    player.turretYaw = state.turretYaw;
    player.gunPitch = state.gunPitch;
    player.lastProcessedSeq = input.seq;

    // 掩体碰撞检测（圆柱 vs 圆柱）
    for (const cover of this.map.covers) {
      const dx = player.position.x - cover.position.x;
      const dz = player.position.z - cover.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = TANK_COLLISION_RADIUS + cover.radius;
      if (dist < minDist && dist > 0.001) {
        // 将坦克推出掩体
        const pushX = (dx / dist) * (minDist - dist);
        const pushZ = (dz / dist) * (minDist - dist);
        player.position.x += pushX;
        player.position.z += pushZ;
        // 消除朝向掩体方向的速度分量
        const nx = dx / dist;
        const nz = dz / dist;
        const vDotN = player.velocity.x * nx + player.velocity.z * nz;
        if (vDotN < 0) {
          player.velocity.x -= vDotN * nx;
          player.velocity.z -= vDotN * nz;
        }
        // 推开后重新采样地形高度，防止坦克悬空或嵌入地下
        player.position.y = MapGenerator.getHeightAt(this.map, player.position.x, player.position.z);
      }
    }

    // 地图边界限制 — 碰到边缘停速 + 推回
    const halfW = this.map.width / 2;
    const halfD = this.map.depth / 2;
    if (player.position.x < -halfW) {
      player.position.x = -halfW;
      if (player.velocity.x < 0) player.velocity.x = 0;
    } else if (player.position.x > halfW) {
      player.position.x = halfW;
      if (player.velocity.x > 0) player.velocity.x = 0;
    }
    if (player.position.z < -halfD) {
      player.position.z = -halfD;
      if (player.velocity.z < 0) player.velocity.z = 0;
    } else if (player.position.z > halfD) {
      player.position.z = halfD;
      if (player.velocity.z > 0) player.velocity.z = 0;
    }

    // 边界/掩体推挤后重新采样地形高度
    player.position.y = MapGenerator.getHeightAt(this.map, player.position.x, player.position.z);

    // 开火
    if (input.fire && player.tryFire()) {
      this.spawnProjectile(player);
    }
  }

  /**
   * 坦克间碰撞检测 — 对称推开 & 速度分离
   */
  private resolveTankTankCollisions(): void {
    const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);
    const minDist = TANK_COLLISION_RADIUS * 2;
    for (let i = 0; i < alivePlayers.length; i++) {
      for (let j = i + 1; j < alivePlayers.length; j++) {
        const a = alivePlayers[i];
        const b = alivePlayers[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < minDist && dist > 0.001) {
          // 法线方向（a→b）
          const nx = dx / dist;
          const nz = dz / dist;
          // 推开量各承担一半
          const overlap = (minDist - dist) / 2;
          a.position.x -= nx * overlap;
          a.position.z -= nz * overlap;
          b.position.x += nx * overlap;
          b.position.z += nz * overlap;
          // 分离速度：消除各自朝向对方的速度分量
          const vDotA = a.velocity.x * nx + a.velocity.z * nz;
          if (vDotA > 0) {
            a.velocity.x -= vDotA * nx;
            a.velocity.z -= vDotA * nz;
          }
          const vDotB = b.velocity.x * nx + b.velocity.z * nz;
          if (vDotB < 0) {
            b.velocity.x -= vDotB * nx;
            b.velocity.z -= vDotB * nz;
          }

          // 推开后重新采样地形高度，防止坦克在起伏地形上悬空或嵌地
          a.position.y = MapGenerator.getHeightAt(this.map, a.position.x, a.position.z);
          b.position.y = MapGenerator.getHeightAt(this.map, b.position.x, b.position.z);
        }
      }
    }
  }

  /**
   * 发射弹体
   */
  private spawnProjectile(player: Player): void {
    const state = player.getPhysicsState();
    const velocity = calculateMuzzleVelocity(state);
    const muzzlePos = getMuzzlePosition(state);
    const barrelDir = getBarrelDirection(
      player.bodyYaw,
      player.turretYaw,
      player.gunPitch
    );

    const proj = new Projectile(
      this.nextProjectileId++,
      player.id,
      muzzlePos,
      velocity,
      PROJECTILE_TTL
    );

    this.projectiles.set(proj.id, proj);

    this.pendingEvents.push({
      eventType: 'fire' as GameEventType,
      shooterId: player.id,
      muzzlePos: muzzlePos.clone(),
      muzzleDir: barrelDir.clone(),
      projectileId: proj.id,
      serverTick: this.currentTick,
    } as FireEvent);
  }

  /**
   * 检测弹体与掩体碰撞（扫掠射线 vs 圆柱，防止高速穿透）
   */
  private checkProjectileCoverCollision(
    proj: Projectile,
    prevX: number,
    prevY: number,
    prevZ: number
  ): boolean {
    const curX = proj.position.x;
    const curY = proj.position.y;
    const curZ = proj.position.z;

    for (const cover of this.map.covers) {
      const groundY = MapGenerator.getHeightAt(this.map, cover.position.x, cover.position.z);
      const coverTop = groundY + cover.height;
      const coverBottom = groundY - 0.5;
      const totalRadius = cover.radius + PROJECTILE_COLLISION_RADIUS;

      // 射线段：from prev to cur，在 XZ 平面投影
      // 参数化 t ∈ [0,1]: P(t) = prev + t * (cur - prev)
      // 找到与圆柱（无限高）的交点 t，检查 Y 范围
      const dx = curX - prevX;
      const dz = curZ - prevZ;
      const ox = prevX - cover.position.x;
      const oz = prevZ - cover.position.z;

      // 二次方程 a*t^2 + b*t + c = 0
      const a = dx * dx + dz * dz;
      const b = 2 * (ox * dx + oz * dz);
      const c = ox * ox + oz * oz - totalRadius * totalRadius;

      // 先做快速检测：当前位置在圆柱内
      const distSq = (curX - cover.position.x) ** 2 + (curZ - cover.position.z) ** 2;
      if (distSq < totalRadius * totalRadius && curY < coverTop && curY > coverBottom) {
        proj.active = false;
        proj.position.set(curX, curY, curZ);
        this.handleProjectileExplode(proj);
        return true;
      }

      // 扫掠检测
      if (a < 0.0001) continue; // 几乎没移动
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) continue;

      const sqrtD = Math.sqrt(discriminant);
      const t1 = (-b - sqrtD) / (2 * a);
      const t2 = (-b + sqrtD) / (2 * a);

      // 找 [0,1] 范围内最早交点
      for (const t of [t1, t2]) {
        if (t < 0 || t > 1) continue;
        const hitY = prevY + t * (curY - prevY);
        if (hitY >= coverBottom && hitY <= coverTop) {
          // 命中！将弹体放到碰撞点
          proj.position.x = prevX + t * dx;
          proj.position.y = hitY;
          proj.position.z = prevZ + t * dz;
          proj.active = false;
          this.handleProjectileExplode(proj);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 检测所有弹体碰撞
   */
  private checkAllCollisions(): void {
    for (const proj of this.projectiles.values()) {
      if (!proj.active) continue;

      for (const player of this.players.values()) {
        if (!player.alive) continue;
        if (player.id === proj.shooterId) continue; // 不打自己

        if (
          checkProjectileHit(
            proj.position,
            player.position,
            PROJECTILE_COLLISION_RADIUS,
            TANK_COLLISION_RADIUS
          )
        ) {
          this.handleDirectHit(proj, player);
          break;
        }
      }
    }
  }

  /**
   * 处理直接命中
   */
  private handleDirectHit(proj: Projectile, target: Player): void {
    proj.active = false;

    // 命中事件
    this.pendingEvents.push({
      eventType: 'hit' as GameEventType,
      projectileId: proj.id,
      targetId: target.id,
      hitPos: proj.position.clone(),
      damage: DIRECT_HIT_DAMAGE,
    } as HitEvent);

    // 记录射手命中
    const shooter = this.players.get(proj.shooterId);
    if (shooter) shooter.hits++;

    // 造成伤害
    const died = target.takeDamage(DIRECT_HIT_DAMAGE);

    if (died) {
      this.handleDeath(target, proj.shooterId);
    }

    // 爆炸（含溅射检查，排除已被直击的目标避免双重伤害）
    this.handleProjectileExplode(proj, target.id);
  }

  /**
   * 处理弹体爆炸（溅射伤害）
   */
  private handleProjectileExplode(proj: Projectile, directHitTargetId?: number): void {
    this.pendingEvents.push({
      eventType: 'explode' as GameEventType,
      projectileId: proj.id,
      pos: proj.position.clone(),
      radius: SPLASH_RADIUS,
    } as ExplodeEvent);

    // 溅射伤害（排除射手自身和已被直击的目标）
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      if (player.id === proj.shooterId) continue;
      if (player.id === directHitTargetId) continue;

      const splashDamage = calculateSplashDamage(proj.position, player.position);
      if (splashDamage > 0) {
        const died = player.takeDamage(splashDamage);
        if (died) {
          this.handleDeath(player, proj.shooterId);
        }
      }
    }
  }

  /**
   * 处理玩家死亡
   */
  private handleDeath(victim: Player, killerId: number): void {
    victim.deaths++;
    const killer = this.players.get(killerId);
    if (killer) killer.kills++;

    this.pendingEvents.push({
      eventType: 'death' as GameEventType,
      victimId: victim.id,
      killerId: killerId,
      reason: 'killed',
      pos: victim.position.clone(),
    } as DeathEvent);

    // 加入复活队列
    this.respawnQueue.push({ player: victim, timer: RESPAWN_DELAY });
  }

  /**
   * 更新复活队列
   */
  private updateRespawnQueue(dtMs: number): void {
    const toRespawn: Player[] = [];

    this.respawnQueue = this.respawnQueue.filter((entry) => {
      entry.timer -= dtMs;
      if (entry.timer <= 0) {
        toRespawn.push(entry.player);
        return false;
      }
      return true;
    });

    for (const player of toRespawn) {
      const enemies = Array.from(this.players.values()).filter(
        (p) => p.id !== player.id
      );
      const spawnPos = this.spawnManager.selectSpawnPoint(
        player,
        enemies,
        this.map
      );

      player.respawn(spawnPos);

      this.pendingEvents.push({
        eventType: 'respawn' as GameEventType,
        playerId: player.id,
        spawnPos: spawnPos.clone(),
      } as RespawnEvent);
    }
  }

  /**
   * 生成状态快照
   */
  getSnapshot(forPlayerId: number): SnapshotMessage {
    const player = this.players.get(forPlayerId);
    const allPlayers = Array.from(this.players.values());
    return {
      type: MessageType.Snapshot,
      serverTick: this.currentTick,
      snapshotId: this.snapshotId,
      timestamp: Date.now(),
      lastProcessedSeq: player?.lastProcessedSeq ?? 0,
      tanks: allPlayers.map((p) => p.toSnapshot()),
      projectiles: Array.from(this.projectiles.values())
        .filter((p) => p.active)
        .map((p) => p.toSnapshot()),
      playerCount: allPlayers.length,
      humanCount: allPlayers.filter((p) => !p.isBot).length,
    };
  }

  /**
   * 添加玩家到世界
   */
  addPlayer(player: Player): void {
    this.players.set(player.id, player);
    const enemies = Array.from(this.players.values()).filter(
      (p) => p.id !== player.id
    );
    const spawnPos = this.spawnManager.selectSpawnPoint(
      player,
      enemies,
      this.map
    );
    player.respawn(spawnPos);
  }

  /**
   * 移除玩家
   */
  removePlayer(playerId: number): void {
    this.players.delete(playerId);
    this.respawnQueue = this.respawnQueue.filter(
      (e) => e.player.id !== playerId
    );
  }

  /**
   * 是否应该发送快照
   */
  shouldSendSnapshot(): boolean {
    return this.currentTick % SNAPSHOT_INTERVAL === 0;
  }

  /**
   * 重置世界
   */
  reset(newSeed: number): void {
    this.currentTick = 0;
    this.snapshotId = 0;
    this.projectiles.clear();
    this.respawnQueue = [];
    this.map = MapGenerator.generate(newSeed);
    this.spawnManager.reset();

    // 重新出生所有玩家
    for (const player of this.players.values()) {
      player.resetStats();
      const enemies = Array.from(this.players.values()).filter(
        (p) => p.id !== player.id
      );
      const spawnPos = this.spawnManager.selectSpawnPoint(
        player,
        enemies,
        this.map
      );
      player.respawn(spawnPos);
    }
  }
}
