import { Vec3 } from '@tankgame/shared';
import {
  gaussianScore,
  SPAWN_CANDIDATE_COUNT,
  SPAWN_TOP_K,
  IDEAL_SPAWN_DISTANCE,
  SPAWN_DISTANCE_SIGMA,
  COVER_SEARCH_RADIUS,
  SPAWN_COOLDOWN_RADIUS,
  SPAWN_WEIGHTS,
} from '@tankgame/shared';
import { MapGenerator, type GameMapData } from './MapGenerator.js';
import type { Player } from './Player.js';

/**
 * 出生点管理器
 * 实现"受限随机 zone + 候选点评分 + 回退"算法
 */
export class SpawnManager {
  private recentSpawns: Vec3[] = [];
  private readonly maxRecentSpawns = 20;

  /**
   * 为玩家选择出生点
   */
  selectSpawnPoint(
    player: Player,
    enemies: Player[],
    map: GameMapData
  ): Vec3 {
    const aliveEnemies = enemies.filter((e) => e.alive && e.id !== player.id);
    const candidates = this.generateCandidates(map);

    const scored = candidates.map((point) => ({
      point,
      score: this.scoreCandidate(point, aliveEnemies, map),
    }));

    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, SPAWN_TOP_K);

    const selected = topK[Math.floor(Math.random() * topK.length)].point;

    // 记录出生位置
    this.recentSpawns.push(selected.clone());
    if (this.recentSpawns.length > this.maxRecentSpawns) {
      this.recentSpawns.shift();
    }

    return selected;
  }

  /**
   * 在所有出生区内生成候选点
   */
  private generateCandidates(map: GameMapData): Vec3[] {
    const candidates: Vec3[] = [];
    const pointsPerZone = Math.ceil(SPAWN_CANDIDATE_COUNT / map.spawnZones.length);

    for (const zone of map.spawnZones) {
      for (let i = 0; i < pointsPerZone; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * zone.radius;
        const x = zone.center.x + Math.cos(angle) * r;
        const z = zone.center.z + Math.sin(angle) * r;

        // 限制在地图范围内
        const clampedX = Math.max(-map.width / 2 + 5, Math.min(map.width / 2 - 5, x));
        const clampedZ = Math.max(-map.depth / 2 + 5, Math.min(map.depth / 2 - 5, z));

        const y = MapGenerator.getHeightAt(map, clampedX, clampedZ);
        candidates.push(new Vec3(clampedX, y, clampedZ));
      }
    }

    return candidates;
  }

  /**
   * 评分候选出生点
   */
  scoreCandidate(
    candidate: Vec3,
    enemies: Player[],
    map: GameMapData
  ): number {
    let score = 0;

    // S_dist: 距最近敌人的距离评分
    if (enemies.length > 0) {
      let minDist = Infinity;
      for (const enemy of enemies) {
        const d = candidate.distanceTo(enemy.position);
        if (d < minDist) minDist = d;
      }
      score += gaussianScore(minDist, IDEAL_SPAWN_DISTANCE, SPAWN_DISTANCE_SIGMA) * SPAWN_WEIGHTS.distance;
    } else {
      score += SPAWN_WEIGHTS.distance; // 无敌人时满分
    }

    // S_los: 被敌人直视惩罚（简化版：距离 < 30m 且无掩体）
    let losCount = 0;
    for (const enemy of enemies) {
      const dist = candidate.distanceTo(enemy.position);
      if (dist < 30) {
        // 简化 LOS 检查：检查路径上是否有掩体
        const hasBlockingCover = map.covers.some((cover) => {
          return isPointBetween(candidate, enemy.position, cover.position, cover.radius);
        });
        if (!hasBlockingCover) {
          losCount++;
        }
      }
    }
    score -= losCount * SPAWN_WEIGHTS.los;

    // S_cover: 附近掩体密度
    const nearbyCovers = map.covers.filter(
      (c) => candidate.distanceTo(c.position) < COVER_SEARCH_RADIUS
    );
    score += Math.min(nearbyCovers.length, 3) * SPAWN_WEIGHTS.cover;

    // S_flow: 离中心（主交战区）的距离
    const flowDist = Math.sqrt(candidate.x * candidate.x + candidate.z * candidate.z);
    score += gaussianScore(flowDist, 80, 30) * SPAWN_WEIGHTS.flow;

    // S_recent: 近期出生冷却
    const tooRecent = this.recentSpawns.some(
      (p) => candidate.distanceTo(p) < SPAWN_COOLDOWN_RADIUS
    );
    if (tooRecent) {
      score -= SPAWN_WEIGHTS.recent;
    }

    return score;
  }

  /**
   * 重置（新回合）
   */
  reset(): void {
    this.recentSpawns = [];
  }
}

/**
 * 检查一个点是否大致在两点连线上（用于简化 LOS 遮挡判断）
 */
function isPointBetween(
  from: Vec3,
  to: Vec3,
  point: Vec3,
  radius: number
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.001) return false;

  const t =
    ((point.x - from.x) * dx + (point.z - from.z) * dz) / (len * len);

  if (t < 0 || t > 1) return false;

  const closestX = from.x + t * dx;
  const closestZ = from.z + t * dz;
  const dist = Math.sqrt(
    (point.x - closestX) ** 2 + (point.z - closestZ) ** 2
  );

  return dist < radius;
}
