import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { NetworkClient } from './NetworkClient.js';
import { MapGenerator } from '@tankgame/server/MapGenerator.js';
import type { GameMapData } from '@tankgame/server/MapGenerator.js';
import { TutorialGame } from './TutorialGame.js';
import type {
  SnapshotMessage,
  JoinAckMessage,
  GameEventMessage,
  GameConfigSnapshot,
  TankSnapshot,
  DeathEvent,
  ExplodeEvent,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  AFKKickMessage,
} from '@tankgame/shared';
import {
  INPUT_RATE,
  SNAPSHOT_RATE,
  RELOAD_TIME,
  TANK_MAX_HP,
  MessageType,
} from '@tankgame/shared';

/**
 * 游戏主控制器 — 管理渲染循环、输入、网络
 */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private inputManager: InputManager;
  private network: NetworkClient;
  private canvas: HTMLCanvasElement;

  private playerId: number = 0;
  private config: GameConfigSnapshot | null = null;
  private lastTime: number = 0;
  private inputSendTimer: number = 0;
  private inputSendInterval: number = 1000 / INPUT_RATE;

  // 场景对象
  private terrain: THREE.Mesh | null = null;
  private mapData: GameMapData | null = null;
  private tankMeshes: Map<number, THREE.Group> = new Map();
  private projectileMeshes: Map<number, THREE.Mesh> = new Map();

  // 快照插值
  private prevSnapshot: SnapshotMessage | null = null;
  private currSnapshot: SnapshotMessage | null = null;
  private snapshotTime: number = 0;
  private snapshotInterval: number = 1000 / SNAPSHOT_RATE;

  // 瞄准镜 FOV
  private readonly FOV_NORMAL = 75;
  private readonly FOV_SCOPE = 25;     // 约 3x 放大
  private currentFov: number = 75;
  private scopeOverlay: HTMLElement | null = null;

  // 死亡第三人称视角状态
  private isDead: boolean = false;
  private deathTime: number = 0;
  /** 是否已在第三人称视角生成过坦克爆炸 */
  private deathExplosionSpawned: boolean = false;
  /** 死亡第一人称爆炸阶段持续时间 (ms) — 先看到面前火光再切第三人称 */
  private readonly DEATH_FP_EXPLOSION_DURATION = 800;
  /** 死亡残骸粒子（黑烟 + 火苗 + 炮塔环），复活时清理 */
  private wreckageMeshes: THREE.Object3D[] = [];
  private wreckageAnimationId: number = 0;
  /** 死亡时保存原始材质颜色，复活时恢复 */
  private savedMaterialColors: Map<THREE.Mesh, number> = new Map();

  // 通知队列（用于显示"玩家加入/离开"等消息）
  private notifications: { text: string; time: number }[] = [];
  private notificationContainer: HTMLElement | null = null;

  // 已知的 bot 实体 ID 集合（通过快照 isBot 字段学习）
  private botEntityIds: Set<number> = new Set();

  // 客户端唯一标识（浏览器持久化，用于数据统计）
  private clientId: string;

  // 排行榜当前时间段
  private leaderboardPeriod: string = 'daily';

  // 暂停菜单状态
  private paused: boolean = false;
  /** 是否在游戏中（已连接服务器） */
  private inGame: boolean = false;

  // 坦克名称标签（Sprite）
  private nameLabels: Map<number, THREE.Sprite> = new Map();
  /** 名称标签可见距离 (m) — 约等于炮弹有效射程 */
  private readonly NAME_LABEL_MAX_DIST = 150;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    // 生成或恢复客户端唯一标识
    this.clientId = this.getOrCreateClientId();

    // WebGL2 渲染器
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x87ceeb); // 天蓝色背景
    this.renderer.shadowMap.enabled = true;

    // 场景
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 150, 400);
    this.scene.background = new THREE.Color(0x87ceeb);

    // 第一人称相机
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      600
    );

    // 光照 — 明亮的户外场景
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    sunLight.position.set(80, 150, 60);
    sunLight.castShadow = true;
    this.scene.add(sunLight);

    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
    this.scene.add(hemisphereLight);

    // 输入
    this.inputManager = new InputManager(this.canvas);

    // 网络
    this.network = new NetworkClient({
      onJoinAck: (msg) => this.onJoinAck(msg),
      onSnapshot: (msg) => this.onSnapshot(msg),
      onGameEvent: (msg) => this.onGameEvent(msg),
      onPlayerJoined: (msg) => this.onPlayerJoined(msg),
      onPlayerLeft: (msg) => this.onPlayerLeft(msg),
      onAFKKick: (msg) => this.onAFKKick(msg),
      onDisconnect: () => this.onDisconnect(),
    });

    // 窗口大小调整
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.createScopeOverlay();
    this.createNotificationContainer();
    this.setupLoginUI();
    this.setupPauseMenu();
  }

  /**
   * 设置登录界面
   */
  private setupLoginUI(): void {
    const joinBtn = document.getElementById('join-btn')!;
    const nicknameInput = document.getElementById('nickname-input') as HTMLInputElement;

    joinBtn.addEventListener('click', async () => {
      const nickname = nicknameInput.value.trim() || 'Player';
      await this.connect(nickname);
    });

    nicknameInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const nickname = nicknameInput.value.trim() || 'Player';
        await this.connect(nickname);
      }
    });

    // 教学模式按钮
    const tutorialBtn = document.getElementById('tutorial-btn');
    if (tutorialBtn) {
      tutorialBtn.addEventListener('click', () => {
        this.startTutorial();
      });
    }

    // 排行榜按钮
    const leaderboardBtn = document.getElementById('leaderboard-btn');
    if (leaderboardBtn) {
      leaderboardBtn.addEventListener('click', () => {
        this.showLeaderboard();
      });
    }

    // 排行榜关闭按钮
    const lbCloseBtn = document.getElementById('lb-close-btn');
    if (lbCloseBtn) {
      lbCloseBtn.addEventListener('click', () => {
        document.getElementById('leaderboard-panel')!.style.display = 'none';
      });
    }

    // 排行榜标签切换（类型）
    document.querySelectorAll('.lb-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.lb-tab').forEach((t) => {
          (t as HTMLElement).style.background = '#ff6a0010';
          (t as HTMLElement).style.borderColor = '#ff6a0060';
          (t as HTMLElement).style.color = '#ff6a0080';
          t.classList.remove('active');
        });
        (tab as HTMLElement).style.background = '#ff6a0030';
        (tab as HTMLElement).style.borderColor = '#ff6a00';
        (tab as HTMLElement).style.color = '#ff6a00';
        tab.classList.add('active');
        this.loadLeaderboardData((tab as HTMLElement).dataset.type || 'playtime');
      });
    });

    // 排行榜时间段切换（今日 / 本周）
    document.querySelectorAll('.lb-period-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.lb-period-tab').forEach((t) => {
          (t as HTMLElement).style.background = '#ff6a0010';
          (t as HTMLElement).style.borderColor = '#ff6a0060';
          (t as HTMLElement).style.color = '#ff6a0080';
          t.classList.remove('active');
        });
        (tab as HTMLElement).style.background = '#ff6a0030';
        (tab as HTMLElement).style.borderColor = '#ff6a00';
        (tab as HTMLElement).style.color = '#ff6a00';
        tab.classList.add('active');
        this.leaderboardPeriod = (tab as HTMLElement).dataset.period || 'daily';
        // 使用当前选中的类型重新加载
        const activeTypeTab = document.querySelector('.lb-tab.active') as HTMLElement;
        this.loadLeaderboardData(activeTypeTab?.dataset.type || 'playtime');
      });
    });

    // 教学跳过按钮
    const skipBtn = document.getElementById('tutorial-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.exitTutorial();
      });
    }
  }

  /**
   * 连接服务器
   */
  private async connect(nickname: string): Promise<void> {
    try {
      // 开发模式：Vite proxy /ws → ws://localhost:3000
      // 生产模式：同源 WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      await this.network.connect(wsUrl);
      this.network.joinRoom(nickname, this.clientId);
    } catch (err) {
      console.error('Failed to connect:', err);
    }
  }

  /**
   * 加入确认
   */
  private onJoinAck(msg: JoinAckMessage): void {
    this.playerId = msg.playerId;
    this.config = msg.config;
    this.inGame = true;
    this.paused = false;

    // 隐藏登录界面
    document.getElementById('login-screen')!.style.display = 'none';
    document.getElementById('hud')!.style.display = 'block';

    // 从种子生成地形（与服务器一致）
    this.mapData = MapGenerator.generate(msg.mapSeed);
    this.createTerrain();

    // 开始游戏循环
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.gameLoop(t));

    console.log(`[Game] Joined as player ${this.playerId}`);
  }

  /**
   * 从服务器地图数据创建地形 Mesh
   */
  private createTerrain(): void {
    if (!this.mapData) return;

    const map = this.mapData;
    const res = map.resolution;

    // 创建平面几何体，分辨率匹配 heightmap
    const geometry = new THREE.PlaneGeometry(
      map.width,
      map.depth,
      res - 1,
      res - 1
    );
    geometry.rotateX(-Math.PI / 2);

    // 使用服务器 heightmap 设置顶点高度
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const ix = i % res;
      const iz = Math.floor(i / res);
      const idx = iz * res + ix;
      positions.setY(i, map.heightmap[idx]);
    }
    geometry.computeVertexNormals();

    // 根据高度给挎顶点着色
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      // 低处：深绿 → 高处：浅绿/棕色
      const t = Math.max(0, Math.min(1, (y + 5) / 15));
      colors[i * 3] = 0.25 + t * 0.35;     // R
      colors[i * 3 + 1] = 0.45 + t * 0.2;   // G
      colors[i * 3 + 2] = 0.15 + t * 0.15;  // B
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });

    this.terrain = new THREE.Mesh(geometry, material);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    // 添加掩体（使用服务器生成的掩体数据）
    for (const cover of map.covers) {
      const size = cover.radius * 2;
      const coverGeo = new THREE.BoxGeometry(size, cover.height, size);
      const coverMat = new THREE.MeshLambertMaterial({
        color: 0x8b7355,
        flatShading: true,
      });
      const coverMesh = new THREE.Mesh(coverGeo, coverMat);
      // 获取掩体位置的地面高度
      const groundY = MapGenerator.getHeightAt(map, cover.position.x, cover.position.z);
      coverMesh.position.set(
        cover.position.x,
        groundY + cover.height / 2,
        cover.position.z
      );
      coverMesh.castShadow = true;
      coverMesh.receiveShadow = true;
      this.scene.add(coverMesh);
    }

    // 添加地图边缘雾气遮蔽
    this.createBoundaryFog(map.width, map.depth);
  }

  /**
   * 在地图四周创建渐变雾气墙（柔和遮蔽边界）
   */
  private createBoundaryFog(width: number, depth: number): void {
    const halfW = width / 2;
    const halfD = depth / 2;
    const fogDepth = 30;   // 雾气带宽度
    const fogHeight = 25;  // 雾气高度

    // 渐变雾气材质 — 半透明白色，面向摄像机
    const fogMat = new THREE.MeshBasicMaterial({
      color: 0xc8d8e8,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // 更浓的内层
    const fogMatDense = new THREE.MeshBasicMaterial({
      color: 0xb0c4d8,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const sides = [
      { px: 0, pz: -halfD - fogDepth / 2, gw: width + fogDepth * 2, gd: fogDepth },
      { px: 0, pz: halfD + fogDepth / 2, gw: width + fogDepth * 2, gd: fogDepth },
      { px: -halfW - fogDepth / 2, pz: 0, gw: fogDepth, gd: depth + fogDepth * 2 },
      { px: halfW + fogDepth / 2, pz: 0, gw: fogDepth, gd: depth + fogDepth * 2 },
    ];

    for (const s of sides) {
      // 外层淡雾
      const geo = new THREE.BoxGeometry(s.gw, fogHeight, s.gd);
      const fog = new THREE.Mesh(geo, fogMat);
      fog.position.set(s.px, fogHeight / 2 - 3, s.pz);
      fog.renderOrder = 999;
      this.scene.add(fog);

      // 内层浓雾（紧贴边界）
      const innerGeo = new THREE.BoxGeometry(s.gw * 0.85, fogHeight * 0.7, s.gd * 0.6);
      const innerFog = new THREE.Mesh(innerGeo, fogMatDense);
      innerFog.position.set(s.px, fogHeight * 0.35 - 2, s.pz);
      innerFog.renderOrder = 998;
      this.scene.add(innerFog);
    }
  }

  /**
   * 创建坦克模型（低多边形，精细结构：车体+履带+炮塔+炮管层级）
   * 层级结构：
   *   group (bodyYaw)
   *     ├── body, frontPlate, leftTrack, rightTrack
   *     └── turretPivot (turretYaw)
   *           ├── turret, cupola
   *           └── barrelPivot (gunPitch)
   *                 └── barrel, muzzleBrake
   */

  /**
   * 创建坦克名称标签 Sprite（红色粗体文字，悬浮在坦克上方）
   */
  private createNameLabel(name: string, entityId: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const scale = 2; // 高 DPI
    canvas.width = 512 * scale;
    canvas.height = 128 * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);

    // 文字
    ctx.font = 'bold 48px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 黑色描边 + 红色填充
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeText(name, 256, 64);
    ctx.fillStyle = '#ff0000';
    ctx.fillText(name, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,   // 不受深度缓冲遮挡
      depthWrite: false,  // 不写入深度缓冲
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 9999; // 最高优先级，在烟雾/粒子之上
    sprite.scale.set(8, 2, 1); // 宽8m×高2m 的世界空间大小
    sprite.name = `nameLabel_${entityId}`;
    this.scene.add(sprite);
    this.nameLabels.set(entityId, sprite);
    return sprite;
  }

  private createTankMesh(entityId: number, isLocal: boolean, isBot: boolean = false): THREE.Group {
    const group = new THREE.Group();

    // 颜色方案：本机=绿色，AI机器人=蓝灰色，敌方真人=红色
    let bodyColor: number;
    let bodyDarkColor: number;
    if (isLocal) {
      bodyColor = 0x3cb371;
      bodyDarkColor = 0x2e8b57;
    } else if (isBot) {
      bodyColor = 0x708090;     // 石板灰（AI）
      bodyDarkColor = 0x556b7a; // 深石板灰
    } else {
      bodyColor = 0xcd5c5c;     // 红色（敌方真人）
      bodyDarkColor = 0xb22222;
    }
    const trackColor = 0x3a3a3a;
    const barrelColor = 0x555555;

    // === 车体 ===
    const bodyGeo = new THREE.BoxGeometry(3.6, 1.2, 5.5);
    const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    body.castShadow = true;
    group.add(body);

    // 前倾装甲板（方向指示）
    const frontGeo = new THREE.BoxGeometry(3.6, 0.8, 1.2);
    const frontMat = new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true });
    const frontPlate = new THREE.Mesh(frontGeo, frontMat);
    frontPlate.position.set(0, 1.2, -3.0);
    frontPlate.rotation.x = -0.3;
    frontPlate.castShadow = true;
    group.add(frontPlate);

    // 左右履带
    const trackGeo = new THREE.BoxGeometry(0.7, 0.9, 6.0);
    const trackMat = new THREE.MeshLambertMaterial({ color: trackColor, flatShading: true });

    const leftTrack = new THREE.Mesh(trackGeo, trackMat);
    leftTrack.position.set(-2.15, 0.55, 0);
    leftTrack.castShadow = true;
    group.add(leftTrack);

    const rightTrack = new THREE.Mesh(trackGeo.clone(), trackMat);
    rightTrack.position.set(2.15, 0.55, 0);
    rightTrack.castShadow = true;
    group.add(rightTrack);

    // 履带轮（用于滚动动画 — 前后移动都会旋转）
    const wheelRadius = 0.35;
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.55, 8);
    wheelGeo.rotateZ(Math.PI / 2); // 轮轴沿 X 方向
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, flatShading: true });
    const wheelPositionsZ = [-2.2, -1.1, 0, 1.1, 2.2]; // 5 个轮对
    for (const wz of wheelPositionsZ) {
      const lw = new THREE.Mesh(wheelGeo.clone(), wheelMat);
      lw.name = 'trackWheel';
      lw.position.set(-2.15, 0.35, wz);
      group.add(lw);

      const rw = new THREE.Mesh(wheelGeo.clone(), wheelMat);
      rw.name = 'trackWheel';
      rw.position.set(2.15, 0.35, wz);
      group.add(rw);
    }

    // === 炮塔旋转枢纽（跟随 turretYaw 旋转） ===
    const turretPivot = new THREE.Object3D();
    turretPivot.name = 'turretPivot';
    group.add(turretPivot);

    // 炮塔
    const turretGeo = new THREE.BoxGeometry(2.4, 0.9, 2.8);
    const turretMat = new THREE.MeshLambertMaterial({ color: bodyDarkColor, flatShading: true });
    const turret = new THREE.Mesh(turretGeo, turretMat);
    turret.position.y = 1.85;
    turret.castShadow = true;
    turretPivot.add(turret);

    // 指挥塔（炮塔顶部偏后的圆柱）
    const cupolaGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.35, 8);
    const cupolaMat = new THREE.MeshLambertMaterial({ color: bodyDarkColor, flatShading: true });
    const cupola = new THREE.Mesh(cupolaGeo, cupolaMat);
    cupola.position.set(0, 2.5, 0.6);
    cupola.castShadow = true;
    turretPivot.add(cupola);

    // === 炮管俯仰枢纽（跟随 gunPitch 旋转） ===
    const barrelPivot = new THREE.Object3D();
    barrelPivot.name = 'barrelPivot';
    barrelPivot.position.set(0, 2.0, -1.4); // 炮塔前方炮耳位置
    turretPivot.add(barrelPivot);

    // 炮管 — 沿 -Z 方向延伸
    const barrelGeo = new THREE.CylinderGeometry(0.15, 0.18, 4, 6);
    barrelGeo.rotateX(Math.PI / 2);   // Y轴 → Z轴
    barrelGeo.translate(0, 0, -2);    // 基座在 z=0，炮口在 z=-4
    const barrelMat = new THREE.MeshLambertMaterial({ color: barrelColor, flatShading: true });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.castShadow = true;
    barrelPivot.add(barrel);

    // 炮口制退器
    const muzzleGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.3, 6);
    muzzleGeo.rotateX(Math.PI / 2);
    muzzleGeo.translate(0, 0, -4.0);
    const muzzleMat = new THREE.MeshLambertMaterial({ color: 0x444444, flatShading: true });
    const muzzle = new THREE.Mesh(muzzleGeo, muzzleMat);
    barrelPivot.add(muzzle);

    // AI 机器人标记 — 炮塔顶部小天线（区分 AI 与真人）
    if (isBot && !isLocal) {
      const antGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4);
      const antMat = new THREE.MeshLambertMaterial({ color: 0x888888, flatShading: true });
      const antenna = new THREE.Mesh(antGeo, antMat);
      antenna.position.set(0.3, 3.2, 0.6);
      group.add(antenna);

      // 天线顶部小球（蓝色标记）
      const tipGeo = new THREE.SphereGeometry(0.1, 6, 4);
      const tipMat = new THREE.MeshBasicMaterial({ color: 0x4488ff });
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.position.set(0.3, 3.9, 0.6);
      group.add(tip);
    }

    // 真人敌方标记 — 炮塔顶部小旗子
    if (!isBot && !isLocal) {
      // 旗杆
      const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 4);
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x888888, flatShading: true });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(-0.3, 3.35, 0.6);
      group.add(pole);

      // 旗面（红色三角旗）
      const flagShape = new THREE.Shape();
      flagShape.moveTo(0, 0);
      flagShape.lineTo(0.6, 0.2);
      flagShape.lineTo(0, 0.5);
      flagShape.closePath();
      const flagGeo = new THREE.ShapeGeometry(flagShape);
      const flagMat = new THREE.MeshBasicMaterial({
        color: 0xff3333,
        side: THREE.DoubleSide,
      });
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(-0.3, 3.6, 0.6);
      flag.rotation.y = Math.PI / 4;
      group.add(flag);
    }

    this.scene.add(group);
    this.tankMeshes.set(entityId, group);
    return group;
  }

  /**
   * 处理服务器快照
   */
  private onSnapshot(msg: SnapshotMessage): void {
    this.prevSnapshot = this.currSnapshot;
    this.currSnapshot = msg;
    this.snapshotTime = performance.now();

    // 学习 bot ID 映射
    for (const tank of msg.tanks) {
      if (tank.isBot) {
        this.botEntityIds.add(tank.entityId);
      }
    }
  }

  /**
   * 插值渲染坦克（在两帧快照之间平滑）
   * - 所有坦克：使用 turretPivot/barrelPivot 层级，正确同步炮塔偏航和炮管俯仰
   * - 本机坦克存活时：FPS 视角隐藏自身模型
   * - 本机坦克死亡时：显示模型并切换第三人称观察击毁
   */
  private interpolateAndRender(): void {
    if (!this.currSnapshot) return;

    // 计算插值系数
    let t = 1;
    if (this.prevSnapshot) {
      const elapsed = performance.now() - this.snapshotTime;
      t = Math.min(1, elapsed / this.snapshotInterval);
    }

    // 渲染坦克
    for (const currTank of this.currSnapshot.tanks) {
      let mesh = this.tankMeshes.get(currTank.entityId);
      if (!mesh) {
        // 记住 bot 状态
        if (currTank.isBot) this.botEntityIds.add(currTank.entityId);
        mesh = this.createTankMesh(
          currTank.entityId,
          currTank.entityId === this.playerId,
          currTank.isBot
        );
      }

      const isLocal = currTank.entityId === this.playerId;
      const prevTank = this.prevSnapshot?.tanks.find(
        (pt) => pt.entityId === currTank.entityId
      );

      if (currTank.alive) {
        mesh.visible = true;

        if (prevTank && prevTank.alive) {
          // 位置插值
          mesh.position.set(
            prevTank.position.x + (currTank.position.x - prevTank.position.x) * t,
            prevTank.position.y + (currTank.position.y - prevTank.position.y) * t,
            prevTank.position.z + (currTank.position.z - prevTank.position.z) * t
          );
          // 车体朝向插值
          mesh.rotation.y = this.lerpAngle(prevTank.bodyYaw, currTank.bodyYaw, t);

          // 履带轮滚动动画（根据速度沿车体方向投影旋转）
          this.animateTrackWheels(mesh, currTank);

          // 炮塔偏航插值
          const turretPivot = mesh.getObjectByName('turretPivot');
          if (turretPivot) {
            turretPivot.rotation.y = this.lerpAngle(prevTank.turretYaw, currTank.turretYaw, t);
          }
          // 炮管俯仰插值
          const barrelPivot = mesh.getObjectByName('barrelPivot');
          if (barrelPivot) {
            barrelPivot.rotation.x = prevTank.gunPitch + (currTank.gunPitch - prevTank.gunPitch) * t;
          }
        } else {
          // 没有前一帧，直接设置
          mesh.position.set(
            currTank.position.x,
            currTank.position.y,
            currTank.position.z
          );
          mesh.rotation.y = currTank.bodyYaw;

          const turretPivot = mesh.getObjectByName('turretPivot');
          if (turretPivot) turretPivot.rotation.y = currTank.turretYaw;
          const barrelPivot = mesh.getObjectByName('barrelPivot');
          if (barrelPivot) barrelPivot.rotation.x = currTank.gunPitch;
        }

        // 本机坦克：更新相机和 HUD，隐藏模型
        if (isLocal) {
          this.isDead = false;
          this.deathExplosionSpawned = false;
          this.cleanupWreckage();
          this.restoreTankMesh(mesh);
          this.updateCamera(currTank, prevTank, t);
          this.updateHUD(currTank);
          // FPS 视角隐藏自身模型
          mesh.visible = false;
        }
      } else {
        // 死亡状态
        if (isLocal) {
          // 本机坦克死亡 — 先第一人称看到爆炸火光，再切第三人称
          if (!this.isDead) {
            this.isDead = true;
            this.deathTime = performance.now();
            // 在当前视角位置生成第一人称爆炸火光
            this.spawnFirstPersonDeathFlash();
          }

          const elapsed = performance.now() - this.deathTime;

          if (elapsed < this.DEATH_FP_EXPLOSION_DURATION) {
            // === 阶段1：第一人称视角看到面前火光升腾 ===
            // 保持当前相机不动（停在死亡瞬间的位置），让火光填满视野
            mesh.visible = false; // 还在第一人称，不显示模型
          } else {
            // === 阶段2：切换为第三人称环绕相机 ===
            mesh.visible = true;
            mesh.position.set(currTank.position.x, currTank.position.y, currTank.position.z);
            mesh.rotation.y = currTank.bodyYaw;

            const turretPivot = mesh.getObjectByName('turretPivot');
            if (turretPivot) turretPivot.rotation.y = currTank.turretYaw;
            const barrelPivot = mesh.getObjectByName('barrelPivot');
            if (barrelPivot) barrelPivot.rotation.x = currTank.gunPitch;

            // 进入第三人称瞬间在坦克位置生成爆炸（只触发一次）
            if (!this.deathExplosionSpawned) {
              this.deathExplosionSpawned = true;
              this.spawnDeathExplosion(currTank.position);
              this.spawnTankBreakup(currTank.position, currTank.bodyYaw);
              // 将原始模型变为被毁状态（隐藏炮塔+炮管，炖黑车体）
              this.charTankMesh(mesh);
              // 在车体上方生成黑烟 + 火苗 + 炮塔环
              this.spawnWreckage(currTank.position, currTank.bodyYaw);
              // mesh 保持 visible=true（展示被毁底盘）
            }

            this.updateDeathCamera(currTank);
          }
          // HUD 显示 0 血量
          this.updateHUD(currTank);
        } else {
          mesh.visible = false;
        }
      }
    }

    // 渲染弹体
    this.renderProjectiles();

    // 更新名称标签（距离门控）
    this.updateNameLabels();

    // 移除已不存在的坦克及其名称标签
    for (const [eid, mesh] of this.tankMeshes) {
      if (!this.currSnapshot.tanks.find((t) => t.entityId === eid)) {
        this.scene.remove(mesh);
        this.tankMeshes.delete(eid);
        // 清理对应名称标签
        const label = this.nameLabels.get(eid);
        if (label) {
          this.scene.remove(label);
          (label.material as THREE.SpriteMaterial).map?.dispose();
          (label.material as THREE.SpriteMaterial).dispose();
          this.nameLabels.delete(eid);
        }
      }
    }
  }

  /**
   * 更新坦克名称标签 — 非本机坦克头上显示红色名称
   * 仅在射程范围内（NAME_LABEL_MAX_DIST）可见，超距隐藏
   */
  private updateNameLabels(): void {
    if (!this.currSnapshot) return;

    const myTank = this.currSnapshot.tanks.find(t => t.entityId === this.playerId);
    if (!myTank) return;

    const myPos = myTank.position;

    for (const tank of this.currSnapshot.tanks) {
      // 不给自己显示名称
      if (tank.entityId === this.playerId) continue;

      const mesh = this.tankMeshes.get(tank.entityId);
      if (!mesh) continue;

      // 创建或获取名称标签
      let label = this.nameLabels.get(tank.entityId);
      if (!label) {
        const displayName = tank.nickname || (tank.isBot ? 'BOT' : `P${tank.entityId}`);
        label = this.createNameLabel(displayName, tank.entityId);
      }

      if (tank.alive) {
        // 计算距离
        const dx = tank.position.x - myPos.x;
        const dy = tank.position.y - myPos.y;
        const dz = tank.position.z - myPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist <= this.NAME_LABEL_MAX_DIST) {
          label.visible = true;
          // 放在坦克头顶上方 4.5m
          label.position.set(
            mesh.position.x,
            mesh.position.y + 4.5,
            mesh.position.z
          );
        } else {
          label.visible = false;
        }
      } else {
        label.visible = false;
      }
    }
  }

  /**
   * 更新第一人称相机
   * - 普通模式：炮塔后上方偏移，但瞄准方向调整为与炮管在收敛距离处交汇
   * - 瞄准镜模式：相机置于炮镜位置，沿炮管方向看，完美对齐弹道
   */
  private updateCamera(
    currTank: TankSnapshot,
    prevTank: TankSnapshot | undefined,
    t: number
  ): void {
    let px: number, py: number, pz: number;

    if (prevTank && prevTank.alive) {
      px = prevTank.position.x + (currTank.position.x - prevTank.position.x) * t;
      py = prevTank.position.y + (currTank.position.y - prevTank.position.y) * t;
      pz = prevTank.position.z + (currTank.position.z - prevTank.position.z) * t;
    } else {
      px = currTank.position.x;
      py = currTank.position.y;
      pz = currTank.position.z;
    }

    // 将 bodyYaw 同步给 InputManager，让鼠标相对角度正确计算
    this.inputManager.setBodyYaw(currTank.bodyYaw);

    // 旋转使用本地鼠标值，零延迟
    const localTurretYaw = this.inputManager.getTurretYaw();
    const localGunPitch = this.inputManager.getGunPitch();
    const totalYaw = currTank.bodyYaw + localTurretYaw;

    // 炮管方向向量
    const cosPitch = Math.cos(localGunPitch);
    const sinPitch = Math.sin(localGunPitch);
    const dirX = -Math.sin(totalYaw) * cosPitch;
    const dirY = sinPitch;
    const dirZ = -Math.cos(totalYaw) * cosPitch;

    // 炮镜/炮口基准位置（炮塔顶部偏前）
    const sightHeight = 2.2;  // 炮镜高度
    const sightX = px;
    const sightY = py + sightHeight;
    const sightZ = pz;

    const aiming = this.inputManager.isAiming();

    if (aiming) {
      // === 瞄准镜模式：相机在炮镜位置，沿炮管方向看，完美对齐弹道 ===
      this.camera.position.set(sightX, sightY, sightZ);
      this.camera.rotation.set(localGunPitch, totalYaw, 0, 'YXZ');
    } else {
      // === 普通模式：口塞后上方偏移，但瞄向与炮管在收敛距离处交汇 ===
      const camOffsetBack = 1.5;
      const camHeight = 3.8;
      const camX = px - Math.sin(totalYaw) * camOffsetBack;
      const camY = py + camHeight;
      const camZ = pz - Math.cos(totalYaw) * camOffsetBack;
      this.camera.position.set(camX, camY, camZ);

      // 计算收敛点：炮口位置沿炮管方向延伸 200m
      const convergeDist = 200;
      const muzzleFwd = 4;
      const muzzleX = sightX + dirX * muzzleFwd;
      const muzzleY = sightY + dirY * muzzleFwd;
      const muzzleZ = sightZ + dirZ * muzzleFwd;
      const targetX = muzzleX + dirX * convergeDist;
      const targetY = muzzleY + dirY * convergeDist;
      const targetZ = muzzleZ + dirZ * convergeDist;

      // 相机看向收敛点
      const lookDx = targetX - camX;
      const lookDy = targetY - camY;
      const lookDz = targetZ - camZ;
      const lookLen = Math.sqrt(lookDx * lookDx + lookDy * lookDy + lookDz * lookDz);
      const correctedPitch = Math.asin(lookDy / lookLen);
      const correctedYaw = Math.atan2(-lookDx, -lookDz);
      this.camera.rotation.set(correctedPitch, correctedYaw, 0, 'YXZ');
    }
  }

  /**
   * 死亡第三人称相机 — 缓慢环绕玩家死亡位置，俯视击毁的坦克
   * 起始时间从第一人称爆炸阶段结束后计算
   */
  private updateDeathCamera(tank: TankSnapshot): void {
    const elapsed = (performance.now() - this.deathTime - this.DEATH_FP_EXPLOSION_DURATION) / 1000;

    const orbitRadius = 12;
    const orbitHeight = 8;
    const orbitSpeed = 0.3; // rad/s
    const angle = tank.bodyYaw + Math.PI + elapsed * orbitSpeed;

    const camX = tank.position.x + Math.sin(angle) * orbitRadius;
    const camY = tank.position.y + orbitHeight;
    const camZ = tank.position.z + Math.cos(angle) * orbitRadius;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(
      new THREE.Vector3(tank.position.x, tank.position.y + 1, tank.position.z)
    );
  }

  /**
   * 第一人称死亡火光 — 在相机前方生成升腾火焰，
   * 让玩家在死亡瞬间看到面前一片火光
   */
  private spawnFirstPersonDeathFlash(): void {
    // 在相机正前方近处生成火球
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const px = this.camera.position.x + camDir.x * 3;
    const py = this.camera.position.y + camDir.y * 3 - 0.5;
    const pz = this.camera.position.z + camDir.z * 3;

    // 大面积火光（填满视野）
    const flashGeo = new THREE.SphereGeometry(2, 10, 8);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 1.0,
    });
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    flashMesh.position.set(px, py, pz);
    this.scene.add(flashMesh);

    // 黄色内核
    const innerGeo = new THREE.SphereGeometry(1, 8, 6);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 1.0,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.position.set(px, py, pz);
    this.scene.add(innerMesh);

    // 强光
    const light = new THREE.PointLight(0xff6600, 12, 50);
    light.position.set(px, py + 1, pz);
    this.scene.add(light);

    // 上升火焰粒子
    const flames: THREE.Mesh[] = [];
    const flameVels: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const fGeo = new THREE.SphereGeometry(0.4 + Math.random() * 0.6, 6, 4);
      const fMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xff6600 : 0xff2200,
        transparent: true,
        opacity: 0.95,
      });
      const f = new THREE.Mesh(fGeo, fMat);
      f.position.set(
        px + (Math.random() - 0.5) * 2,
        py,
        pz + (Math.random() - 0.5) * 2,
      );
      this.scene.add(f);
      flames.push(f);
      flameVels.push(new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        4 + Math.random() * 6,
        (Math.random() - 0.5) * 2,
      ));
    }

    const startTime = performance.now();
    const duration = this.DEATH_FP_EXPLOSION_DURATION;

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);

      // 火球膨胀并消散
      flashMesh.scale.setScalar(1 + t * 4);
      flashMat.opacity = Math.max(0, 1 - t * 1.5);

      innerMesh.scale.setScalar(1 + t * 3);
      innerMat.opacity = Math.max(0, 1 - t * 2);

      light.intensity = 12 * Math.max(0, 1 - t * 2);

      // 火焰粒子上升
      const dt = 1 / 60;
      for (let i = 0; i < flames.length; i++) {
        flames[i].position.x += flameVels[i].x * dt;
        flames[i].position.y += flameVels[i].y * dt;
        flames[i].position.z += flameVels[i].z * dt;
        flames[i].scale.setScalar(1 + t * 2);
        (flames[i].material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.95 - t * 1.4);
      }

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(flashMesh, innerMesh, light);
        flashGeo.dispose(); innerGeo.dispose();
        for (const f of flames) { this.scene.remove(f); f.geometry.dispose(); }
      }
    };

    requestAnimationFrame(animate);
  }

  /**
   * 履带轮滚动动画 — 根据速度分量沿车体前进方向投影计算旋转
   * 前进时轮子向前滚，后退时轮子反向滚
   */
  private animateTrackWheels(mesh: THREE.Group, tank: TankSnapshot): void {
    // 速度在车体方向的投影（正 = 前进，负 = 后退）
    const fwdX = -Math.sin(tank.bodyYaw);
    const fwdZ = -Math.cos(tank.bodyYaw);
    const speedProjection = tank.velocity.x * fwdX + tank.velocity.z * fwdZ;

    // 轮半径 0.35m，每帧转角 = speed / radius * dt（用固定 dt ≈ 1/60）
    const wheelRadius = 0.35;
    const rotDelta = (speedProjection / wheelRadius) * (1 / 60);

    mesh.traverse((child) => {
      if (child.name === 'trackWheel' && child instanceof THREE.Mesh) {
        child.rotation.x += rotDelta;
      }
    });
  }

  /**
   * 角度最短路径插值
   */
  private lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
  }

  /**
   * 渲染弹体
   */
  private renderProjectiles(): void {
    if (!this.currSnapshot) return;

    const activeIds = new Set<number>();
    for (const proj of this.currSnapshot.projectiles) {
      activeIds.add(proj.projectileId);
      let mesh = this.projectileMeshes.get(proj.projectileId);
      if (!mesh) {
        const geo = new THREE.SphereGeometry(0.3, 6, 4);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
        mesh = new THREE.Mesh(geo, mat);
        this.scene.add(mesh);
        this.projectileMeshes.set(proj.projectileId, mesh);
      }
      mesh.position.set(proj.position.x, proj.position.y, proj.position.z);
    }

    // 清理消失的弹体
    for (const [id, mesh] of this.projectileMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }
  }

  /**
   * 更新 HUD（含死亡状态显示零血量）
   */
  private updateHUD(tank: TankSnapshot): void {
    const speed = Math.sqrt(tank.velocity.x ** 2 + tank.velocity.z ** 2);
    const heading = Math.round(((tank.bodyYaw * 180 / Math.PI) % 360 + 360) % 360);

    const speedEl = document.querySelector('.speed');
    const headingEl = document.querySelector('.heading');
    const hpEl = document.querySelector('.hp-bar');
    const reloadEl = document.querySelector('.reload-bar');

    if (speedEl) speedEl.textContent = `SPD  ${Math.round(speed * 3.6)}`;
    if (headingEl) headingEl.textContent = `HDG  ${heading}`;
    if (hpEl) {
      const hp = Math.max(0, tank.hp); // 确保死亡时显示 0
      const bars = Math.round(hp / TANK_MAX_HP * 12);
      hpEl.textContent = `HP ${'█'.repeat(bars)}${'░'.repeat(12 - bars)} ${hp}`;
    }
    if (reloadEl) {
      if (tank.reloadRemain <= 0) {
        reloadEl.textContent = '▓▓▓▓▓▓▓▓▓▓▓▓ READY';
      } else {
        const progress = Math.round((1 - tank.reloadRemain / RELOAD_TIME) * 12);
        reloadEl.textContent = `${'▓'.repeat(progress)}${'░'.repeat(12 - progress)} RELOAD`;
      }
    }

    const kdEl = document.querySelector('.kd-stat');
    if (kdEl) {
      kdEl.textContent = `K ${tank.kills} / D ${tank.deaths}`;
    }

    // 玩家数量
    const playerCountEl = document.querySelector('.player-count');
    if (playerCountEl && this.currSnapshot) {
      const total = this.currSnapshot.playerCount ?? this.currSnapshot.tanks.length;
      const humans = this.currSnapshot.humanCount ?? this.currSnapshot.tanks.filter(t => !t.isBot).length;
      const bots = total - humans;
      playerCountEl.textContent = `PLY ${humans}+${bots}AI / ${total}`;
    }

    // 瞄准数据面板（Y轴左侧，始终显示 — SPD/ELV/TRT）
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

    // 罗盘 — 右上角显示车体朝向和炮塔相对角度
    this.updateCompass(tank);

    // 狙击镜距离 & 高度 HUD（瞄准时才显示，已移至Y轴左侧）
    const scopeInfo = document.querySelector('.scope-info');
    if (scopeInfo) {
      const alt = Math.round(tank.position.y * 10) / 10;
      // 查找最近敌人距离
      let nearestDist = -1;
      if (this.currSnapshot) {
        for (const t of this.currSnapshot.tanks) {
          if (t.entityId === this.playerId || !t.alive) continue;
          const dx = t.position.x - tank.position.x;
          const dz = t.position.z - tank.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (nearestDist < 0 || dist < nearestDist) {
            nearestDist = dist;
          }
        }
      }
      const distStr = nearestDist >= 0 ? `${Math.round(nearestDist)}m` : '---';
      scopeInfo.textContent = `RNG ${distStr}  ALT ${alt.toFixed(1)}m`;
    }
  }

  /**
   * 罗盘 HUD — 右上角 Canvas
   * - 红色半透明60°扇形（玩家屏幕视野）永远向上
   * - N/E/S/W 刻度环以炮塔世界朝向为参考旋转
   * - 半透明蓝色坦克车身相对于炮塔旋转（显示车体朝向偏差）
   */
  private updateCompass(tank: TankSnapshot): void {
    const canvas = document.getElementById('compass-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    // 炮塔世界朝向 = bodyYaw + turretYaw
    const localTurretYaw = this.inputManager.getTurretYaw();
    const turretWorldYaw = tank.bodyYaw + localTurretYaw;

    // ===== 旋转罗盘刻度环：以炮塔世界朝向为参考 =====
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-turretWorldYaw); // 让 N 相对于炮塔方向旋转

    ctx.fillStyle = '#ff6a00';
    ctx.font = 'bold 10px "Courier New"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelR = r - 8;
    ctx.fillText('N', 0, -labelR);
    ctx.fillText('S', 0, labelR);
    ctx.fillText('E', labelR, 0);
    ctx.fillText('W', -labelR, 0);

    // 小刻度线（每 30° 一条）
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
    // 60° 扇形：以12点钟方向为中心，左右各30°
    const sectorAngle = (60 / 2) * Math.PI / 180; // 30°
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r - 14, -Math.PI / 2 - sectorAngle, -Math.PI / 2 + sectorAngle);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 50, 50, 0.18)';
    ctx.fill();
    // 扇形边缘线
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // ===== 半透明蓝色坦克车身：相对于炮塔旋转 =====
    // turretYaw>0 = 炮塔相对车体右偏 → 车体相对炮塔左偏（画布逆时针）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(localTurretYaw); // 车体在画布中按偏差旋转

    const tankScale = r * 0.4;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#4488cc';
    ctx.strokeStyle = '#4488cc';
    ctx.lineWidth = 1.5;

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

    // 车头三角
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

    // 炮塔偏转角度文字
    const relDeg = Math.round(localTurretYaw * 180 / Math.PI);
    const relSign = relDeg >= 0 ? '+' : '';
    ctx.fillStyle = '#ff6a00';
    ctx.font = '10px "Courier New"';
    ctx.textAlign = 'center';
    ctx.fillText(`${relSign}${relDeg}°`, cx, cy + r + 10);
  }

  /**
   * 处理游戏事件
   */
  private onGameEvent(msg: GameEventMessage): void {
    switch (msg.event.eventType) {
      case 'death': {
        const deathEvt = msg.event as DeathEvent;
        const killFeed = document.querySelector('.kill-feed');
        if (killFeed) {
          const killerIsBot = this.botEntityIds.has(deathEvt.killerId);
          const victimIsBot = this.botEntityIds.has(deathEvt.victimId);
          const killerLabel = killerIsBot ? `[BOT]#${deathEvt.killerId}` : `P${deathEvt.killerId}`;
          const victimLabel = victimIsBot ? `[BOT]#${deathEvt.victimId}` : `P${deathEvt.victimId}`;
          killFeed.textContent = `${killerLabel} → ${victimLabel}`;
          setTimeout(() => { killFeed.textContent = ''; }, 3000);
        }
        // 击坠火焰爆炸效果 — 大而夸张
        this.spawnDeathExplosion(deathEvt.pos);
        break;
      }
      case 'explode': {
        // 炮弹落点火焰爆炸效果 — 小而清晰
        const explodeEvt = msg.event as ExplodeEvent;
        this.spawnImpactExplosion(explodeEvt.pos);
        break;
      }
    }
  }

  /**
   * 击坠爆炸 — 大型火球 + 碎片 + 冲击波 + 持续火焰
   */
  private spawnDeathExplosion(pos: { x: number; y: number; z: number }): void {
    const px = pos.x, py = pos.y + 1.5, pz = pos.z;

    // ① 核心火球（大橙色球体，快速膨胀后消散）
    const fireballGeo = new THREE.SphereGeometry(1, 12, 8);
    const fireballMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 1.0,
    });
    const fireball = new THREE.Mesh(fireballGeo, fireballMat);
    fireball.position.set(px, py, pz);
    this.scene.add(fireball);

    // ② 二层火球（黄色内层）
    const innerGeo = new THREE.SphereGeometry(0.6, 10, 6);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 1.0,
    });
    const innerBall = new THREE.Mesh(innerGeo, innerMat);
    innerBall.position.set(px, py, pz);
    this.scene.add(innerBall);

    // ③ 强光闪烁
    const flash = new THREE.PointLight(0xff6600, 8, 40);
    flash.position.set(px, py + 2, pz);
    this.scene.add(flash);

    // ④ 冲击波光环
    const ringGeo = new THREE.RingGeometry(0.5, 1.5, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(px, py, pz);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);

    // ⑤ 飞散碎片粒子（12个小方块向外飞）
    const debris: THREE.Mesh[] = [];
    const debrisVelocities: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const size = 0.2 + Math.random() * 0.4;
      const dGeo = new THREE.BoxGeometry(size, size, size);
      const dMat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.5 ? 0xff4400 : 0x444444,
        transparent: true,
        opacity: 1.0,
      });
      const d = new THREE.Mesh(dGeo, dMat);
      d.position.set(px, py, pz);
      this.scene.add(d);
      debris.push(d);
      debrisVelocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        Math.random() * 15 + 5,
        (Math.random() - 0.5) * 20,
      ));
    }

    // ⑥ 火焰粒子（持续上升的橙色小球）
    const flames: THREE.Mesh[] = [];
    const flameVelocities: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const fGeo = new THREE.SphereGeometry(0.3 + Math.random() * 0.5, 6, 4);
      const fMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xff6600 : 0xff2200,
        transparent: true,
        opacity: 0.9,
      });
      const f = new THREE.Mesh(fGeo, fMat);
      f.position.set(
        px + (Math.random() - 0.5) * 2,
        py,
        pz + (Math.random() - 0.5) * 2,
      );
      this.scene.add(f);
      flames.push(f);
      flameVelocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        3 + Math.random() * 5,
        (Math.random() - 0.5) * 3,
      ));
    }

    // 动画循环 — 1.5秒内完成
    const startTime = performance.now();
    const duration = 1500;

    const animateExplosion = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);

      // 火球膨胀后消散
      const fireScale = 1 + t * 6;
      fireball.scale.setScalar(fireScale);
      fireballMat.opacity = Math.max(0, 1 - t * 1.5);

      innerBall.scale.setScalar(1 + t * 4);
      innerMat.opacity = Math.max(0, 1 - t * 2);

      // 光强衰减
      flash.intensity = 8 * Math.max(0, 1 - t * 3);

      // 冲击波扩散
      ring.scale.setScalar(1 + t * 12);
      ringMat.opacity = Math.max(0, 0.8 - t * 1.2);

      // 碎片飞散 + 重力
      const dt = 1 / 60;
      for (let i = 0; i < debris.length; i++) {
        debrisVelocities[i].y -= 20 * dt;
        debris[i].position.x += debrisVelocities[i].x * dt;
        debris[i].position.y += debrisVelocities[i].y * dt;
        debris[i].position.z += debrisVelocities[i].z * dt;
        debris[i].rotation.x += 5 * dt;
        debris[i].rotation.z += 3 * dt;
        (debris[i].material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      }

      // 火焰粒子上升 + 消散
      for (let i = 0; i < flames.length; i++) {
        flames[i].position.x += flameVelocities[i].x * dt;
        flames[i].position.y += flameVelocities[i].y * dt;
        flames[i].position.z += flameVelocities[i].z * dt;
        flameVelocities[i].y -= 2 * dt;
        const fScale = 1 + t * 2;
        flames[i].scale.setScalar(fScale);
        (flames[i].material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - t * 1.2);
      }

      if (t < 1) {
        requestAnimationFrame(animateExplosion);
      } else {
        // 清理所有对象
        this.scene.remove(fireball, innerBall, flash, ring);
        fireball.geometry.dispose(); innerGeo.dispose(); ringGeo.dispose();
        for (const d of debris) { this.scene.remove(d); d.geometry.dispose(); }
        for (const f of flames) { this.scene.remove(f); f.geometry.dispose(); }
      }
    };

    requestAnimationFrame(animateExplosion);
  }

  /**
   * 坦克四分五裂动画 — 炮塔、炮管、前装甲板、金属碎片飞散
   * 车体和履带保留为残骸（由原始模型展示）
   */
  private spawnTankBreakup(pos: { x: number; y: number; z: number }, bodyYaw: number): void {
    const px = pos.x, py = pos.y, pz = pos.z;

    // 碎片定义：{ 几何体, 颜色, 偏移, 初始速度, 旋转速度 }
    const parts: {
      geo: THREE.BufferGeometry;
      color: number;
      offset: THREE.Vector3;
      vel: THREE.Vector3;
      rotSpeed: THREE.Vector3;
    }[] = [];

    // 炮塔飞出（向上 + 随机方向抛射）
    parts.push({
      geo: new THREE.BoxGeometry(2.2, 0.8, 2.6),
      color: 0x555555,
      offset: new THREE.Vector3(0, 1.8, 0),
      vel: new THREE.Vector3((Math.random() - 0.5) * 8, 10 + Math.random() * 6, (Math.random() - 0.5) * 8),
      rotSpeed: new THREE.Vector3(3 + Math.random() * 2, 2 + Math.random(), 1 + Math.random()),
    });

    // 炮管（细长圆柱）
    const barrelGeo = new THREE.CylinderGeometry(0.15, 0.18, 3.5, 6);
    barrelGeo.rotateX(Math.PI / 2);
    parts.push({
      geo: barrelGeo,
      color: 0x444444,
      offset: new THREE.Vector3(0, 2.0, -2),
      vel: new THREE.Vector3((Math.random() - 0.5) * 10, 8 + Math.random() * 5, -4 - Math.random() * 4),
      rotSpeed: new THREE.Vector3(4, 2, 3),
    });

    // 指挥塔飞出
    parts.push({
      geo: new THREE.CylinderGeometry(0.35, 0.4, 0.35, 8),
      color: 0x444444,
      offset: new THREE.Vector3(0, 2.5, 0.6),
      vel: new THREE.Vector3((Math.random() - 0.5) * 6, 12 + Math.random() * 4, (Math.random() - 0.5) * 6),
      rotSpeed: new THREE.Vector3(2, 3, 2),
    });

    // 前装甲板碎片
    parts.push({
      geo: new THREE.BoxGeometry(3.0, 0.6, 1.0),
      color: 0x4a4a4a,
      offset: new THREE.Vector3(0, 1.2, -2.8),
      vel: new THREE.Vector3((Math.random() - 0.5) * 6, 6 + Math.random() * 3, -6 - Math.random() * 3),
      rotSpeed: new THREE.Vector3(2, 1, 3),
    });

    // 小碎片金属片（8片随机）
    for (let i = 0; i < 8; i++) {
      const size = 0.2 + Math.random() * 0.5;
      parts.push({
        geo: new THREE.BoxGeometry(size, size * 0.3, size * 0.8),
        color: Math.random() > 0.5 ? 0x666666 : 0x444444,
        offset: new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          0.5 + Math.random() * 1.5,
          (Math.random() - 0.5) * 3
        ),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 18,
          6 + Math.random() * 10,
          (Math.random() - 0.5) * 18,
        ),
        rotSpeed: new THREE.Vector3(
          Math.random() * 8,
          Math.random() * 8,
          Math.random() * 8,
        ),
      });
    }

    // 创建碎片 Mesh
    const meshes: THREE.Mesh[] = [];
    const velocities: THREE.Vector3[] = [];
    const rotSpeeds: THREE.Vector3[] = [];

    const sinYaw = Math.sin(bodyYaw);
    const cosYaw = Math.cos(bodyYaw);

    for (const part of parts) {
      const mat = new THREE.MeshLambertMaterial({
        color: part.color,
        flatShading: true,
        transparent: true,
        opacity: 1.0,
      });
      const mesh = new THREE.Mesh(part.geo, mat);

      // 根据车体朝向旋转偏移量
      const ox = part.offset.x * cosYaw + part.offset.z * sinYaw;
      const oz = -part.offset.x * sinYaw + part.offset.z * cosYaw;
      mesh.position.set(px + ox, py + part.offset.y, pz + oz);
      mesh.rotation.y = bodyYaw;

      mesh.castShadow = true;
      this.scene.add(mesh);
      meshes.push(mesh);

      // 旋转速度向量也根据车体朝向调整
      const vx = part.vel.x * cosYaw + part.vel.z * sinYaw;
      const vz = -part.vel.x * sinYaw + part.vel.z * cosYaw;
      velocities.push(new THREE.Vector3(vx, part.vel.y, vz));
      rotSpeeds.push(part.rotSpeed);
    }

    // 动画 — 2.5秒内完成
    const startTime = performance.now();
    const duration = 2500;
    const gravity = -20;

    const animateBreakup = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const dt = 1 / 60;

      for (let i = 0; i < meshes.length; i++) {
        velocities[i].y += gravity * dt;
        meshes[i].position.x += velocities[i].x * dt;
        meshes[i].position.y += velocities[i].y * dt;
        meshes[i].position.z += velocities[i].z * dt;

        // 碎片落地后停止下落
        if (meshes[i].position.y < py - 0.5) {
          meshes[i].position.y = py - 0.5;
          velocities[i].y = 0;
          velocities[i].x *= 0.9;
          velocities[i].z *= 0.9;
        }

        meshes[i].rotation.x += rotSpeeds[i].x * dt;
        meshes[i].rotation.y += rotSpeeds[i].y * dt;
        meshes[i].rotation.z += rotSpeeds[i].z * dt;

        // 后半段逐渐消散
        if (t > 0.6) {
          const fadeT = (t - 0.6) / 0.4;
          (meshes[i].material as THREE.MeshLambertMaterial).opacity = Math.max(0, 1 - fadeT);
        }
      }

      if (t < 1) {
        requestAnimationFrame(animateBreakup);
      } else {
        for (const m of meshes) {
          this.scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.MeshLambertMaterial).dispose();
        }
      }
    };

    requestAnimationFrame(animateBreakup);
  }

  /**
   * 清理死亡残骸粒子（黑烟、火苗、炮塔环、火光）
   */
  private cleanupWreckage(): void {
    if (this.wreckageAnimationId) {
      cancelAnimationFrame(this.wreckageAnimationId);
      this.wreckageAnimationId = 0;
    }
    for (const obj of this.wreckageMeshes) {
      this.scene.remove(obj);
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
    this.wreckageMeshes = [];
  }

  /**
   * 将坦克模型变为被毁状态：隐藏炮塔/炮管（已飞离），车体变炖黑
   */
  private charTankMesh(group: THREE.Group): void {
    this.savedMaterialColors.clear();
    const charColor = 0x1a1a1a;

    // 隐藏炮塔枢纽（炮塔 + 炮管 + 指挥塔已飞走）
    const turretPivot = group.getObjectByName('turretPivot');
    if (turretPivot) turretPivot.visible = false;

    // 将车体、履带、车轮等变为炖黑色
    group.traverse((child) => {
      if (child === turretPivot) return; // 跳过已隐藏的炮塔
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        this.savedMaterialColors.set(child, child.material.color.getHex());
        child.material.color.setHex(charColor);
      }
    });
  }

  /**
   * 复活时恢复坦克模型原始外观
   */
  private restoreTankMesh(group: THREE.Group): void {
    // 恢复炮塔可见
    const turretPivot = group.getObjectByName('turretPivot');
    if (turretPivot) turretPivot.visible = true;

    // 恢复材质颜色
    for (const [mesh, origColor] of this.savedMaterialColors) {
      if (mesh.material instanceof THREE.MeshLambertMaterial) {
        mesh.material.color.setHex(origColor);
      }
    }
    this.savedMaterialColors.clear();
  }

  /**
   * 被毁残骸粒子特效 — 炮塔环断口 + 持续冒黑烟 + 小火苗
   * 粒子持续生成直到玩家复活，配合原始模型的炖黑底盘使用
   */
  private spawnWreckage(pos: { x: number; y: number; z: number }, _bodyYaw: number): void {
    this.cleanupWreckage();
    const px = pos.x, py = pos.y, pz = pos.z;

    // 破裂的炮塔环（炮塔飞走后留下的圆洞边沿）
    const ringGeo = new THREE.TorusGeometry(0.9, 0.15, 6, 12);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(px, py + 1.0, pz);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    this.wreckageMeshes.push(ring);

    // 炖黑色调火光（橘红闪烁）
    const firelight = new THREE.PointLight(0xff4400, 3, 15);
    firelight.position.set(px, py + 1.5, pz);
    this.scene.add(firelight);
    this.wreckageMeshes.push(firelight as unknown as THREE.Object3D);

    // --- 黑烟粒子系统（持续生成上升的烟雾球） ---
    const smokeParticles: THREE.Mesh[] = [];
    const smokeVelocities: { vy: number; age: number; maxAge: number; scaleRate: number }[] = [];
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 });
    const smokeBallGeo = new THREE.SphereGeometry(0.3, 6, 4);

    // --- 小火苗粒子（底盘上方跳动的橘红火焰） ---
    const flameParticles: THREE.Mesh[] = [];
    const flameData: { vy: number; age: number; maxAge: number }[] = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
    const flameGeo = new THREE.SphereGeometry(0.15, 5, 3);

    let lastSpawnSmoke = 0;
    let lastSpawnFlame = 0;
    const startTime = performance.now();

    const animateWreckage = () => {
      const now = performance.now();
      const totalElapsed = now - startTime;

      // 火光闪烁
      firelight.intensity = 2 + Math.sin(totalElapsed * 0.01) * 1.5 + Math.random() * 0.5;

      // 每 120ms 生成一团黑烟
      if (now - lastSpawnSmoke > 120) {
        lastSpawnSmoke = now;
        const s = new THREE.Mesh(smokeBallGeo, smokeMat.clone());
        s.position.set(
          px + (Math.random() - 0.5) * 1.2,
          py + 1.2,
          pz + (Math.random() - 0.5) * 1.2
        );
        s.scale.setScalar(0.5 + Math.random() * 0.3);
        this.scene.add(s);
        smokeParticles.push(s);
        smokeVelocities.push({
          vy: 2 + Math.random() * 2,
          age: 0,
          maxAge: 1500 + Math.random() * 1000,
          scaleRate: 1 + Math.random() * 0.5,
        });
      }

      // 每 200ms 生成一个小火苗
      if (now - lastSpawnFlame > 200) {
        lastSpawnFlame = now;
        const f = new THREE.Mesh(flameGeo, flameMat.clone());
        f.position.set(
          px + (Math.random() - 0.5) * 1.0,
          py + 0.9 + Math.random() * 0.3,
          pz + (Math.random() - 0.5) * 1.0
        );
        this.scene.add(f);
        flameParticles.push(f);
        flameData.push({
          vy: 1.5 + Math.random() * 1.5,
          age: 0,
          maxAge: 400 + Math.random() * 300,
        });
      }

      // 更新黑烟
      const dt = 1 / 60;
      for (let i = smokeParticles.length - 1; i >= 0; i--) {
        smokeVelocities[i].age += 16;
        const sv = smokeVelocities[i];
        smokeParticles[i].position.y += sv.vy * dt;
        // 烟雾膨胀
        const scaleAdd = sv.scaleRate * dt;
        smokeParticles[i].scale.x += scaleAdd;
        smokeParticles[i].scale.y += scaleAdd * 0.6;
        smokeParticles[i].scale.z += scaleAdd;
        // 淡出
        const lifeRatio = sv.age / sv.maxAge;
        (smokeParticles[i].material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - lifeRatio);
        // 到达寿命后移除
        if (sv.age >= sv.maxAge) {
          this.scene.remove(smokeParticles[i]);
          smokeParticles[i].geometry.dispose();
          (smokeParticles[i].material as THREE.MeshBasicMaterial).dispose();
          smokeParticles.splice(i, 1);
          smokeVelocities.splice(i, 1);
        }
      }

      // 更新小火苗
      for (let i = flameParticles.length - 1; i >= 0; i--) {
        flameData[i].age += 16;
        flameParticles[i].position.y += flameData[i].vy * dt;
        const fr = flameData[i].age / flameData[i].maxAge;
        (flameParticles[i].material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - fr);
        flameParticles[i].scale.setScalar(1 - fr * 0.5);
        if (flameData[i].age >= flameData[i].maxAge) {
          this.scene.remove(flameParticles[i]);
          flameParticles[i].geometry.dispose();
          (flameParticles[i].material as THREE.MeshBasicMaterial).dispose();
          flameParticles.splice(i, 1);
          flameData.splice(i, 1);
        }
      }

      this.wreckageAnimationId = requestAnimationFrame(animateWreckage);
    };

    this.wreckageAnimationId = requestAnimationFrame(animateWreckage);
  }

  /**
   * 炮弹落点爆炸 — 小型火花 + 溅射碎片
   */
  private spawnImpactExplosion(pos: { x: number; y: number; z: number }): void {
    const px = pos.x, py = pos.y + 0.5, pz = pos.z;

    // ① 闪光
    const flash = new THREE.PointLight(0xff6600, 5, 25);
    flash.position.set(px, py + 1, pz);
    this.scene.add(flash);

    // ② 小火球
    const fireGeo = new THREE.SphereGeometry(0.5, 8, 6);
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 1.0,
    });
    const fireMesh = new THREE.Mesh(fireGeo, fireMat);
    fireMesh.position.set(px, py, pz);
    this.scene.add(fireMesh);

    // ③ 溅射碎片（6个小粒子向外飞）
    const sparks: THREE.Mesh[] = [];
    const sparkVelocities: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const sGeo = new THREE.SphereGeometry(0.1, 4, 3);
      const sMat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.3 ? 0xffaa00 : 0xff4400,
        transparent: true,
        opacity: 1.0,
      });
      const s = new THREE.Mesh(sGeo, sMat);
      s.position.set(px, py, pz);
      this.scene.add(s);
      sparks.push(s);
      sparkVelocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        Math.random() * 8 + 2,
        (Math.random() - 0.5) * 12,
      ));
    }

    // 动画 — 0.6秒
    const startTime = performance.now();
    const duration = 600;

    const animateImpact = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);

      // 火球膨胀消散
      fireMesh.scale.setScalar(1 + t * 3);
      fireMat.opacity = Math.max(0, 1 - t * 2);

      flash.intensity = 5 * Math.max(0, 1 - t * 4);

      // 溅射粒子
      const dt = 1 / 60;
      for (let i = 0; i < sparks.length; i++) {
        sparkVelocities[i].y -= 15 * dt;
        sparks[i].position.x += sparkVelocities[i].x * dt;
        sparks[i].position.y += sparkVelocities[i].y * dt;
        sparks[i].position.z += sparkVelocities[i].z * dt;
        (sparks[i].material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t * 1.5);
      }

      if (t < 1) {
        requestAnimationFrame(animateImpact);
      } else {
        this.scene.remove(flash, fireMesh);
        fireGeo.dispose();
        for (const s of sparks) { this.scene.remove(s); s.geometry.dispose(); }
      }
    };

    requestAnimationFrame(animateImpact);
  }

  /**
   * 创建通知容器（用于显示玩家加入/离开等消息）
   */
  private createNotificationContainer(): void {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.style.cssText = `
      position: absolute; top: 50%; left: 20px;
      transform: translateY(-50%);
      display: flex; flex-direction: column;
      gap: 6px; pointer-events: none; z-index: 20;
      font-family: 'Courier New', monospace;
    `;
    document.body.appendChild(container);
    this.notificationContainer = container;
  }

  /**
   * 显示通知消息（带淡入淡出动画）
   */
  private showNotification(text: string, color: string = '#ff6a00'): void {
    if (!this.notificationContainer) return;

    const el = document.createElement('div');
    el.style.cssText = `
      color: ${color}; font-size: 13px;
      background: rgba(0, 0, 0, 0.6);
      padding: 4px 12px; border-left: 2px solid ${color};
      opacity: 0; transition: opacity 0.3s ease;
      white-space: nowrap;
    `;
    el.textContent = text;
    this.notificationContainer.appendChild(el);

    // 淡入
    requestAnimationFrame(() => { el.style.opacity = '1'; });

    // 3秒后淡出并移除
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => { el.remove(); }, 300);
    }, 3000);
  }

  /**
   * 玩家加入通知
   */
  private onPlayerJoined(msg: PlayerJoinedMessage): void {
    // 不通知自己加入，也不通知 AI 加入
    if (msg.playerId === this.playerId || msg.isBot) return;
    this.showNotification(`▶ ${msg.nickname} 加入了房间`, '#4ecf6a');
  }

  /**
   * 玩家离开通知
   */
  private onPlayerLeft(msg: PlayerLeftMessage): void {
    this.showNotification(`◀ ${msg.nickname} 离开了房间`, '#ff6a00');
  }

  /**
   * AFK 踢出处理 — 断开连接，返回登录界面，显示 AFK 提示
   */
  private onAFKKick(msg: AFKKickMessage): void {
    this.network.disconnect();
    this.returnToLogin(msg.reason);
  }

  /**
   * 返回登录界面（附带提示消息）
   */
  private returnToLogin(message?: string): void {
    this.inGame = false;
    this.paused = false;
    document.getElementById('pause-menu')!.style.display = 'none';
    document.getElementById('scoreboard-overlay')!.style.display = 'none';
    document.getElementById('login-screen')!.style.display = 'flex';
    document.getElementById('hud')!.style.display = 'none';

    // 显示提示消息
    if (message) {
      const afkMsg = document.getElementById('login-message');
      if (afkMsg) {
        afkMsg.textContent = message;
        afkMsg.style.display = 'block';
        setTimeout(() => { afkMsg.style.display = 'none'; }, 5000);
      }
    }
  }

  // ==================== 暂停菜单 ====================

  /**
   * 初始化暂停菜单事件
   */
  private setupPauseMenu(): void {
    // ESC 键：浏览器会自动释放 Pointer Lock，我们通过 pointerlockchange 检测
    // 当游戏中指针锁定丢失时，自动显示暂停菜单
    document.addEventListener('pointerlockchange', () => {
      if (this.inGame && !this.paused && document.pointerLockElement === null) {
        this.pauseGame();
      }
    });

    // ESC 键在暂停中时恢复游戏
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.inGame && this.paused) {
        e.preventDefault();
        this.resumeGame();
      }
    });

    // Tab 键：按住显示计分板
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' && this.inGame) {
        e.preventDefault();
        this.showScoreboard();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.hideScoreboard();
      }
    });

    // 继续按钮
    document.getElementById('pause-resume-btn')!.addEventListener('click', () => {
      this.resumeGame();
    });

    // 退出按钮
    document.getElementById('pause-exit-btn')!.addEventListener('click', () => {
      this.exitGame();
    });
  }

  /**
   * 暂停游戏 — 显示暂停菜单（指针锁定已由浏览器释放）
   * 注意：游戏世界继续运行，玩家仍可被攻击
   */
  private pauseGame(): void {
    this.paused = true;
    this.inputManager.setPaused(true);
    // 确保指针已解锁（可能来自 pointerlockchange 或手动调用）
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    document.getElementById('pause-menu')!.style.display = 'block';
  }

  /**
   * 恢复游戏 — 隐藏暂停菜单，重新锁定指针
   */
  private resumeGame(): void {
    this.paused = false;
    this.inputManager.setPaused(false);
    document.getElementById('pause-menu')!.style.display = 'none';
    this.canvas.requestPointerLock();
  }

  /**
   * 退出游戏 — 断开连接，返回登录界面
   */
  private exitGame(): void {
    this.paused = false;
    document.getElementById('pause-menu')!.style.display = 'none';
    this.network.disconnect();
    this.returnToLogin();
  }

  // ==================== Tab 计分板 ====================

  /**
   * 显示计分板（按住 Tab 时）
   */
  private showScoreboard(): void {
    if (!this.currSnapshot) return;
    const overlay = document.getElementById('scoreboard-overlay')!;
    const tbody = document.getElementById('scoreboard-body')!;

    // 按击坠数降序排列，相同时按阵亡数升序
    const sorted = [...this.currSnapshot.tanks].sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.deaths - b.deaths;
    });

    // 渲染行
    let html = '';
    sorted.forEach((t, i) => {
      const isMe = t.entityId === this.playerId;
      const kd = t.deaths === 0 ? t.kills.toFixed(1) : (t.kills / t.deaths).toFixed(1);
      const tag = t.isBot ? ' [BOT]' : '';
      const rowStyle = isMe
        ? 'background:rgba(255,106,0,0.18); font-weight:bold;'
        : '';
      const hpBar = t.alive
        ? `<span style="color:${t.hp > 50 ? '#4f4' : t.hp > 25 ? '#ff4' : '#f44'}">${t.hp}</span>`
        : '<span style="color:#666">DEAD</span>';
      html += `<tr style="${rowStyle}; border-bottom:1px solid #ff6a0020;">
        <td style="padding:6px 8px;">${i + 1}</td>
        <td style="padding:6px 8px;">${isMe ? '▶ ' : ''}${t.nickname ?? '???'}${tag}</td>
        <td style="padding:6px 8px; text-align:center;">${t.kills}</td>
        <td style="padding:6px 8px; text-align:center;">${t.deaths}</td>
        <td style="padding:6px 8px; text-align:center;">${kd}</td>
        <td style="padding:6px 8px; text-align:center;">${hpBar}</td>
      </tr>`;
    });
    tbody.innerHTML = html;
    overlay.style.display = 'block';
  }

  /**
   * 隐藏计分板（松开 Tab 时）
   */
  private hideScoreboard(): void {
    document.getElementById('scoreboard-overlay')!.style.display = 'none';
  }

  /**
   * 获取或创建客户端唯一标识（持久化到 localStorage）
   */
  private getOrCreateClientId(): string {
    const key = 'tankgame_client_id';
    let id = localStorage.getItem(key);
    if (!id) {
      // crypto.randomUUID() 需要安全上下文（HTTPS/localhost），降级使用 getRandomValues
      if (typeof crypto.randomUUID === 'function') {
        id = crypto.randomUUID();
      } else {
        // 手动生成 UUID v4
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      }
      localStorage.setItem(key, id);
    }
    return id;
  }

  /**
   * 断开连接
   */
  private onDisconnect(): void {
    this.returnToLogin();
  }

  /**
   * 创建瞄准镜覆盖层（全屏黑框 + 十字瞄准线 — 橙色高对比度）
   */
  private createScopeOverlay(): void {
    const overlay = document.createElement('div');
    overlay.id = 'scope-overlay';
    overlay.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 15;
      opacity: 0;
      transition: opacity 0.15s ease;
    `;

    // 圆形瞄准镜遮罩 — 中央圆形透明，四周全黑，橙色准星
    overlay.innerHTML = `
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"
           style="position:absolute;top:0;left:0;width:100%;height:100%;">
        <defs>
          <mask id="scope-mask">
            <rect width="100" height="100" fill="white"/>
            <circle cx="50" cy="50" r="32" fill="black"/>
          </mask>
        </defs>
        <!-- 黑色遮罩（圆外区域） -->
        <rect width="100" height="100" fill="black" mask="url(#scope-mask)"/>
        <!-- 镜筒边缘 -->
        <circle cx="50" cy="50" r="32" fill="none" stroke="#333" stroke-width="0.8"/>
        <circle cx="50" cy="50" r="31.6" fill="none" stroke="#555" stroke-width="0.15"/>
        <!-- 十字瞄准线 — 橙色 -->
        <line x1="50" y1="18" x2="50" y2="46" stroke="#ff6a00" stroke-width="0.2" opacity="0.9"/>
        <line x1="50" y1="54" x2="50" y2="82" stroke="#ff6a00" stroke-width="0.12" opacity="0.5"/>
        <line x1="18" y1="50" x2="46" y2="50" stroke="#ff6a00" stroke-width="0.2" opacity="0.9"/>
        <line x1="54" y1="50" x2="82" y2="50" stroke="#ff6a00" stroke-width="0.2" opacity="0.9"/>
        <!-- 水平测距标线（密位） -->
        <line x1="38" y1="49.3" x2="38" y2="50.7" stroke="#ff6a00" stroke-width="0.15" opacity="0.8"/>
        <line x1="42" y1="49.3" x2="42" y2="50.7" stroke="#ff6a00" stroke-width="0.15" opacity="0.8"/>
        <line x1="58" y1="49.3" x2="58" y2="50.7" stroke="#ff6a00" stroke-width="0.15" opacity="0.8"/>
        <line x1="62" y1="49.3" x2="62" y2="50.7" stroke="#ff6a00" stroke-width="0.15" opacity="0.8"/>
        <!-- ===== 距离刻度线（基于弹道计算：v₀=80m/s, g=9.81m/s²） ===== -->
        <!-- 50m: 弹道落差角 2.19° → y=58.8 -->
        <line x1="44" y1="58.8" x2="50" y2="58.8" stroke="#ff6a00" stroke-width="0.2" opacity="0.85"/>
        <line x1="50" y1="58.8" x2="56" y2="58.8" stroke="#ff6a00" stroke-width="0.2" opacity="0.85"/>
        <line x1="44" y1="58.8" x2="44" y2="59.6" stroke="#ff6a00" stroke-width="0.15" opacity="0.7"/>
        <line x1="56" y1="58.8" x2="56" y2="59.6" stroke="#ff6a00" stroke-width="0.15" opacity="0.7"/>
        <text x="57.5" y="59.2" fill="#ff6a00" font-size="1.6" font-family="Courier New" opacity="0.75">50</text>
        <!-- 100m: 弹道落差角 4.38° → y=67.5 -->
        <line x1="43" y1="67.5" x2="50" y2="67.5" stroke="#ff6a00" stroke-width="0.25" opacity="0.9"/>
        <line x1="50" y1="67.5" x2="57" y2="67.5" stroke="#ff6a00" stroke-width="0.25" opacity="0.9"/>
        <line x1="43" y1="67.5" x2="43" y2="68.5" stroke="#ff6a00" stroke-width="0.15" opacity="0.7"/>
        <line x1="57" y1="67.5" x2="57" y2="68.5" stroke="#ff6a00" stroke-width="0.15" opacity="0.7"/>
        <text x="58.5" y="68" fill="#ff6a00" font-size="1.8" font-family="Courier New" opacity="0.85">100</text>
        <!-- 150m: 弹道落差角 6.56° → y=76.2 -->
        <line x1="44" y1="76.2" x2="50" y2="76.2" stroke="#ff6a00" stroke-width="0.2" opacity="0.85"/>
        <line x1="50" y1="76.2" x2="56" y2="76.2" stroke="#ff6a00" stroke-width="0.2" opacity="0.85"/>
        <line x1="44" y1="76.2" x2="44" y2="77" stroke="#ff6a00" stroke-width="0.15" opacity="0.7"/>
        <line x1="56" y1="76.2" x2="56" y2="77" stroke="#ff6a00" stroke-width="0.15" opacity="0.7"/>
        <text x="57.5" y="76.7" fill="#ff6a00" font-size="1.6" font-family="Courier New" opacity="0.75">150</text>
        <!-- 中心点 -->
        <circle cx="50" cy="50" r="0.3" fill="#ff6a00"/>
      </svg>
      <canvas id="scope-compass" width="80" height="80"
        style="position:absolute; bottom:12%; right:12%; pointer-events:none;"></canvas>
    `;

    document.body.appendChild(overlay);
    this.scopeOverlay = overlay;
  }

  /**
   * 每帧更新瞄准镜状态（FOV 平滑过渡 + 覆盖层显隐 + 准星切换）
   */
  private updateScope(dt: number): void {
    const aiming = this.inputManager.isAiming();
    const targetFov = aiming ? this.FOV_SCOPE : this.FOV_NORMAL;

    // FOV 平滑过渡（~0.12s 从 75→25，参考 War Thunder 瞄准镜切换速度）
    const lerpSpeed = 12;
    this.currentFov += (targetFov - this.currentFov) * Math.min(1, lerpSpeed * dt);

    // 接近目标时直接吸附
    if (Math.abs(this.currentFov - targetFov) < 0.3) {
      this.currentFov = targetFov;
    }

    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();

    const isScoped = this.currentFov < 40;

    // 覆盖层显隐
    if (this.scopeOverlay) {
      this.scopeOverlay.style.opacity = isScoped ? '1' : '0';
    }

    // 准星：瞄准镜模式下隐藏普通准星，显示scope-info
    const crosshair = document.querySelector('.crosshair') as HTMLElement;
    if (crosshair) {
      crosshair.style.opacity = isScoped ? '0' : '1';
    }

    // 狙击镜 HUD 信息
    const scopeInfo = document.querySelector('.scope-info') as HTMLElement;
    if (scopeInfo) {
      scopeInfo.style.opacity = isScoped ? '1' : '0';
    }

    // 瞄准镜内方向指示器
    if (isScoped) {
      this.updateScopeCompass();
    }
  }

  /**
   * 瞄准镜内方向罗盘 — 右下角小圆盘
   * 与主 HUD 罗盘一致：绿色坦克车身固定朝上 + 旋转 NSEW 刻度环 + 红色炮塔指针
   */
  private updateScopeCompass(): void {
    const canvas = document.getElementById('scope-compass') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const myTank = this.currSnapshot?.tanks.find(t => t.entityId === this.playerId);
    if (!myTank) return;

    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 6;

    ctx.clearRect(0, 0, size, size);

    // 半透明背景圆
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    ctx.strokeStyle = '#ff6a0050';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ===== 旋转刻度环：以炮塔世界朝向为参考 =====
    const localTurretYaw = this.inputManager.getTurretYaw();
    const turretWorldYaw = myTank.bodyYaw + localTurretYaw;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-turretWorldYaw);

    ctx.fillStyle = '#ff6a00';
    ctx.font = 'bold 8px "Courier New"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelR = r - 6;
    ctx.fillText('N', 0, -labelR);
    ctx.fillText('S', 0, labelR);
    ctx.fillText('E', labelR, 0);
    ctx.fillText('W', -labelR, 0);

    // 小刻度线（每 30°）
    ctx.strokeStyle = '#ff6a0040';
    ctx.lineWidth = 0.8;
    for (let deg = 0; deg < 360; deg += 30) {
      if (deg % 90 === 0) continue;
      const rad = deg * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(Math.sin(rad) * (r - 2), -Math.cos(rad) * (r - 2));
      ctx.lineTo(Math.sin(rad) * (r - 7), -Math.cos(rad) * (r - 7));
      ctx.stroke();
    }
    ctx.restore();

    // ===== 红色60°半透明视野扇形 — 永远朝上 =====
    ctx.save();
    ctx.translate(cx, cy);
    const sectorAngle = (60 / 2) * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r - 8, -Math.PI / 2 - sectorAngle, -Math.PI / 2 + sectorAngle);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 50, 50, 0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.45)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    // ===== 半透明蓝色坦克车身：相对于炮塔旋转 =====
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(localTurretYaw); // 车体相对炮塔偏差

    const ts = r * 0.35;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#4488cc';
    const bw = ts * 0.5;
    const bh = ts * 0.75;
    ctx.beginPath();
    ctx.moveTo(-bw, -bh + 2);
    ctx.lineTo(-bw, bh - 2);
    ctx.quadraticCurveTo(-bw, bh, -bw + 2, bh);
    ctx.lineTo(bw - 2, bh);
    ctx.quadraticCurveTo(bw, bh, bw, bh - 2);
    ctx.lineTo(bw, -bh + 2);
    ctx.quadraticCurveTo(bw, -bh, bw - 2, -bh);
    ctx.lineTo(-bw + 2, -bh);
    ctx.quadraticCurveTo(-bw, -bh, -bw, -bh + 2);
    ctx.closePath();
    ctx.fill();
    // 车头三角
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#66aadd';
    ctx.beginPath();
    ctx.moveTo(0, -bh - 4);
    ctx.lineTo(-bw * 0.4, -bh + 1);
    ctx.lineTo(bw * 0.4, -bh + 1);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.restore();

    // 中心圆点
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3333';
    ctx.fill();

    // 炮塔偏转角度
    const relDeg = Math.round(localTurretYaw * 180 / Math.PI);
    const relSign = relDeg >= 0 ? '+' : '';
    ctx.fillStyle = '#ff6a00';
    ctx.font = '9px "Courier New"';
    ctx.textAlign = 'center';
    ctx.fillText(`${relSign}${relDeg}°`, cx, cy + r + 6);
  }

  /**
   * 游戏主循环
   */
  private gameLoop(timestamp: number): void {
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;

    // 输入采集与发送（死亡或暂停时不发送输入）
    if (!this.isDead && !this.paused) {
      this.inputSendTimer += dt * 1000;
      if (this.inputSendTimer >= this.inputSendInterval) {
        const input = this.inputManager.sample();
        this.network.sendInput(input);
        this.inputSendTimer -= this.inputSendInterval;
      }
    }

    // 插值渲染
    this.interpolateAndRender();

    // 瞄准镜 FOV 平滑过渡
    this.updateScope(dt);

    // 渲染
    this.renderer.render(this.scene, this.camera);

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  // ==================== 排行榜 ====================

  /**
   * 显示排行榜面板
   */
  private showLeaderboard(): void {
    document.getElementById('leaderboard-panel')!.style.display = 'block';
    this.loadLeaderboardData('playtime');
  }

  /**
   * 加载排行榜数据
   */
  private async loadLeaderboardData(type: string): Promise<void> {
    const content = document.getElementById('lb-content');
    if (!content) return;

    content.innerHTML = '<div style="text-align:center; padding:40px; color:#ff6a0060;">加载中...</div>';

    try {
      // API 地址：开发模式通过 Vite 代理，生产模式同源
      const period = this.leaderboardPeriod || 'daily';
      const res = await fetch(`/api/leaderboard?period=${period}&type=${type}`);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();

      if (!data.entries || data.entries.length === 0) {
        const periodLabel = period === 'daily' ? '今日' : '本周';
        content.innerHTML = `<div style="text-align:center; padding:40px; color:#ff6a0060;">${periodLabel}暂无数据</div>`;
        return;
      }

      let html = '<table style="width:100%; border-collapse:collapse; font-size:14px;">';
      html += '<tr style="border-bottom:1px solid #ff6a0030;">';
      html += '<th style="padding:8px; text-align:left;">#</th>';
      html += '<th style="padding:8px; text-align:left;">昵称</th>';
      html += `<th style="padding:8px; text-align:right;">${type === 'playtime' ? '游玩时间' : '击坠数'}</th>`;
      html += '</tr>';

      for (let i = 0; i < data.entries.length; i++) {
        const entry = data.entries[i];
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        const valueStr = type === 'playtime'
          ? this.formatDuration(entry.value)
          : `${entry.value} 击坠`;
        html += `<tr style="border-bottom:1px solid #ff6a0015;">`;
        html += `<td style="padding:8px;">${medal}</td>`;
        html += `<td style="padding:8px;">${this.escapeHtml(entry.nickname)}</td>`;
        html += `<td style="padding:8px; text-align:right; color:#ffaa00;">${valueStr}</td>`;
        html += '</tr>';
      }
      html += '</table>';
      content.innerHTML = html;
    } catch {
      content.innerHTML = '<div style="text-align:center; padding:40px; color:#ff333380;">无法连接服务器</div>';
    }
  }

  /**
   * 格式化时长 (ms → Xh Ym)
   */
  private formatDuration(ms: number): string {
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /**
   * HTML 转义
   */
  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ==================== 教学模式 ====================

  private tutorialGame: TutorialGame | null = null;

  /**
   * 启动教学模式
   */
  private startTutorial(): void {
    document.getElementById('login-screen')!.style.display = 'none';
    document.getElementById('tutorial-screen')!.style.display = 'block';
    // 显示 HUD（准星、罗盘、血量等元素）
    document.getElementById('hud')!.style.display = 'block';

    this.tutorialGame = new TutorialGame(
      this.renderer,
      this.scene,
      this.camera,
      this.inputManager,
      () => this.exitTutorial()
    );
    this.tutorialGame.start();
  }

  /**
   * 退出教学模式
   */
  private exitTutorial(): void {
    if (this.tutorialGame) {
      this.tutorialGame.destroy();
      this.tutorialGame = null;
    }
    document.getElementById('tutorial-screen')!.style.display = 'none';
    document.getElementById('hud')!.style.display = 'none';
    document.getElementById('login-screen')!.style.display = 'flex';
    // 确保瞄准镜和准星回到初始状态
    if (this.scopeOverlay) this.scopeOverlay.style.opacity = '0';
    const crosshair = document.querySelector('.crosshair') as HTMLElement;
    if (crosshair) crosshair.style.opacity = '1';
  }
}
