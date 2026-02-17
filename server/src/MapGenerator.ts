import { Vec3 } from '@tankgame/shared';
import {
  MAP_WIDTH,
  MAP_DEPTH,
  HEIGHTMAP_RESOLUTION,
  MAX_SLOPE,
  PERTURBATION_AMPLITUDE,
} from '@tankgame/shared';

/**
 * 掩体节点
 */
export interface CoverNode {
  position: Vec3;
  radius: number;
  height: number;
}

/**
 * 出生区域
 */
export interface SpawnZone {
  id: number;
  center: Vec3;
  radius: number;
}

/**
 * 地图数据
 */
export interface GameMapData {
  width: number;
  depth: number;
  heightmap: Float32Array;
  resolution: number;
  covers: CoverNode[];
  spawnZones: SpawnZone[];
  seed: number;
}

/**
 * 地图验证结果
 */
export interface MapValidationResult {
  connectivity: boolean;
  fairness: number;
  maxLOSCorridor: number;
  slopeExceedance: number;
  isValid: boolean;
}

/**
 * 地图生成器 — 模板骨架 + 微扰动
 */
export class MapGenerator {
  /**
   * 生成一张新地图
   */
  static generate(seed: number): GameMapData {
    const resolution = HEIGHTMAP_RESOLUTION;
    const heightmap = new Float32Array(resolution * resolution);
    const rng = createSeededRandom(seed);

    // 1. 基础地形 — 中央平坦，边缘起伏
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const nx = x / resolution - 0.5;
        const nz = z / resolution - 0.5;

        // 基础高度：多层噪声
        let h = 0;
        h += simplex2D(nx * 2, nz * 2, seed) * 8;
        h += simplex2D(nx * 4, nz * 4, seed) * 4;
        h += simplex2D(nx * 8, nz * 8, seed) * 2;

        // 中央区域压低（主交战区）
        const centerDist = Math.sqrt(nx * nx + nz * nz) * 2;
        h *= Math.min(1, centerDist * 1.5);

        // 微扰动
        h += (rng() - 0.5) * PERTURBATION_AMPLITUDE * 0.3;

        heightmap[z * resolution + x] = h;
      }
    }

    // 2. 坡度验证与修正
    clampSlopes(heightmap, resolution, MAX_SLOPE, MAP_WIDTH / resolution);

    // 3. 生成掩体
    const covers = generateCovers(rng, resolution);

    // 4. 生成出生区域
    const spawnZones = generateSpawnZones();

    return {
      width: MAP_WIDTH,
      depth: MAP_DEPTH,
      heightmap,
      resolution,
      covers,
      spawnZones,
      seed,
    };
  }

  /**
   * 验证地图质量
   */
  static validate(map: GameMapData): MapValidationResult {
    const slopeExceedance = checkSlopeExceedance(
      map.heightmap,
      map.resolution,
      MAX_SLOPE,
      map.width / map.resolution
    );

    return {
      connectivity: true, // 简版：假设连通
      fairness: calculateFairness(map.spawnZones),
      maxLOSCorridor: 0,
      slopeExceedance,
      isValid: slopeExceedance < 0.15,
    };
  }

  /**
   * 从地图获取某点高度
   */
  static getHeightAt(map: GameMapData, x: number, z: number): number {
    const gx = ((x + map.width / 2) / map.width) * (map.resolution - 1);
    const gz = ((z + map.depth / 2) / map.depth) * (map.resolution - 1);

    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;

    if (ix < 0 || ix >= map.resolution - 1 || iz < 0 || iz >= map.resolution - 1) {
      return 0;
    }

    const h00 = map.heightmap[iz * map.resolution + ix];
    const h10 = map.heightmap[iz * map.resolution + ix + 1];
    const h01 = map.heightmap[(iz + 1) * map.resolution + ix];
    const h11 = map.heightmap[(iz + 1) * map.resolution + ix + 1];

    // 双线性插值
    const h0 = h00 + (h10 - h00) * fx;
    const h1 = h01 + (h11 - h01) * fx;
    return h0 + (h1 - h0) * fz;
  }

  /**
   * 获取地形法线
   */
  static getNormalAt(map: GameMapData, x: number, z: number): Vec3 {
    const step = map.width / map.resolution;
    const hL = MapGenerator.getHeightAt(map, x - step, z);
    const hR = MapGenerator.getHeightAt(map, x + step, z);
    const hD = MapGenerator.getHeightAt(map, x, z - step);
    const hU = MapGenerator.getHeightAt(map, x, z + step);

    const normal = new Vec3(hL - hR, 2 * step, hD - hU);
    return normal.normalize();
  }
}

// ==================== 辅助函数 ====================

function createSeededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function simplex2D(x: number, y: number, seed: number): number {
  // 简化版噪声（基于带种子哈希的伪噪声）
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const hash = (a: number, b: number) => {
    let h = (a * 374761393 + b * 668265263 + seed * 1013904223) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 0xffffffff - 0.5;
  };

  const n00 = hash(ix, iy);
  const n10 = hash(ix + 1, iy);
  const n01 = hash(ix, iy + 1);
  const n11 = hash(ix + 1, iy + 1);

  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

function clampSlopes(
  heightmap: Float32Array,
  resolution: number,
  maxSlope: number,
  gridSpacing: number
): void {
  const maxHeightDiff = Math.tan(maxSlope) * gridSpacing;
  for (let pass = 0; pass < 3; pass++) {
    for (let z = 1; z < resolution - 1; z++) {
      for (let x = 1; x < resolution - 1; x++) {
        const idx = z * resolution + x;
        const neighbors = [
          heightmap[idx - 1],
          heightmap[idx + 1],
          heightmap[idx - resolution],
          heightmap[idx + resolution],
        ];
        for (const nh of neighbors) {
          const diff = heightmap[idx] - nh;
          if (Math.abs(diff) > maxHeightDiff) {
            heightmap[idx] -= Math.sign(diff) * (Math.abs(diff) - maxHeightDiff) * 0.5;
          }
        }
      }
    }
  }
}

function checkSlopeExceedance(
  heightmap: Float32Array,
  resolution: number,
  maxSlope: number,
  gridSpacing: number
): number {
  let exceeded = 0;
  let total = 0;

  for (let z = 1; z < resolution - 1; z++) {
    for (let x = 1; x < resolution - 1; x++) {
      const idx = z * resolution + x;
      const dx = Math.abs(heightmap[idx + 1] - heightmap[idx - 1]) / (2 * gridSpacing);
      const dz = Math.abs(heightmap[idx + resolution] - heightmap[idx - resolution]) / (2 * gridSpacing);
      const slope = Math.atan(Math.sqrt(dx * dx + dz * dz));
      if (slope > maxSlope) exceeded++;
      total++;
    }
  }
  return total > 0 ? exceeded / total : 0;
}

function generateCovers(rng: () => number, _resolution: number): CoverNode[] {
  const covers: CoverNode[] = [];
  const count = 15 + Math.floor(rng() * 10);
  const halfW = MAP_WIDTH / 2;
  const halfD = MAP_DEPTH / 2;

  for (let i = 0; i < count; i++) {
    covers.push({
      position: new Vec3(
        (rng() - 0.5) * halfW * 1.6,
        0,
        (rng() - 0.5) * halfD * 1.6
      ),
      radius: 2 + rng() * 3,
      height: 2 + rng() * 2,
    });
  }
  return covers;
}

function generateSpawnZones(): SpawnZone[] {
  const halfW = MAP_WIDTH / 2;
  const halfD = MAP_DEPTH / 2;
  const margin = 30;

  return [
    { id: 0, center: new Vec3(-halfW + margin, 0, -halfD + margin), radius: 25 },
    { id: 1, center: new Vec3(halfW - margin, 0, -halfD + margin), radius: 25 },
    { id: 2, center: new Vec3(-halfW + margin, 0, halfD - margin), radius: 25 },
    { id: 3, center: new Vec3(halfW - margin, 0, halfD - margin), radius: 25 },
    { id: 4, center: new Vec3(0, 0, -halfD + margin), radius: 25 },
    { id: 5, center: new Vec3(0, 0, halfD - margin), radius: 25 },
    { id: 6, center: new Vec3(-halfW + margin, 0, 0), radius: 25 },
    { id: 7, center: new Vec3(halfW - margin, 0, 0), radius: 25 },
  ];
}

function calculateFairness(zones: SpawnZone[]): number {
  if (zones.length < 2) return 1;
  const dists = zones.map((z) => z.center.distanceTo(Vec3.zero()));
  const maxDist = Math.max(...dists);
  const minDist = Math.min(...dists);
  return maxDist > 0 ? 1 - (maxDist - minDist) / maxDist : 1;
}
