import { InputCmd, MessageType, GUN_PITCH_MIN, GUN_PITCH_MAX, TURRET_YAW_MAX } from '@tankgame/shared';

/**
 * 输入管理器 — 采集键盘/鼠标输入
 *
 * 炮塔控制模型（坦克风格）：
 * - mouseX 累计鼠标水平移动 → 世界空间目标朝向
 * - turretYaw = worldYaw - bodyYaw → 相对于车体的炮塔偏转角
 * - 受 ±TURRET_YAW_MAX 限制（270° 总行程）
 */
export class InputManager {
  private keys: Set<string> = new Set();
  /** 世界空间炮塔朝向 (鼠标累计) */
  private mouseX: number = 0;
  private mouseY: number = 0;
  private mouseDown: boolean = false;
  private rightMouseDown: boolean = false;
  private seq: number = 0;
  private locked: boolean = false;
  private _aiming: boolean = false;
  /** 当前车体朝向（由 Game.ts 每帧更新） */
  private _bodyYaw: number = 0;
  /** 抑制锁定时的首次点击自动开火 */
  private _suppressNextFire: boolean = false;
  /** 外部暂停状态（暂停时不重新锁定指针） */
  private _externalPaused: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    document.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // 如果尚未锁定指针，本次点击用于锁定，不触发开火
        if (!this.locked) {
          this._suppressNextFire = true;
        } else {
          this.mouseDown = true;
        }
      }
      if (e.button === 2) {
        this.rightMouseDown = true;
        this._aiming = true;
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseDown = false;
        this._suppressNextFire = false;
      }
      if (e.button === 2) {
        this.rightMouseDown = false;
        this._aiming = false;
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.locked) {
        // Chrome/Windows Pointer Lock 有已知 bug：movementX/Y 会偶发巨大尖峰
        // 通过限幅过滤异常值（正常帧 60fps 下鼠标极速约 80-100px/frame）
        const MAX_DELTA = 150;
        const dx = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.movementX));
        const dy = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.movementY));
        // 瞄准时降低灵敏度（与 FOV 缩放比例匹配，参考 War Thunder / WoT）
        const sens = this._aiming ? 0.001 : 0.003;
        this.mouseX -= dx * sens;
        this.mouseY += dy * sens;
        // 限制俯仰角（与服务端 GUN_PITCH_MIN/MAX 保持一致，避免视角不同步）
        // mouseY 正值 = 向下，gunPitch = -mouseY，所以 mouseY 范围为 [-GUN_PITCH_MAX, -GUN_PITCH_MIN]
        this.mouseY = Math.max(-GUN_PITCH_MAX, Math.min(-GUN_PITCH_MIN, this.mouseY));
        // 防止 mouseX 无限累积导致浮点精度问题
        // 规范化到 [-2π, 2π] 范围附近（保留完整圈数以避免跳变）
        if (this.mouseX > Math.PI * 4) this.mouseX -= Math.PI * 2;
        if (this.mouseX < -Math.PI * 4) this.mouseX += Math.PI * 2;
      }
    });

    canvas.addEventListener('click', () => {
      if (!this.locked && !this._externalPaused) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      // 刚获得指针锁定时，清除因锁定点击产生的开火状态
      if (this.locked && this._suppressNextFire) {
        this.mouseDown = false;
        this._suppressNextFire = false;
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * 采集当前帧的输入命令
   * turretYaw 为相对于车体的炮塔偏转角（已限幅 ±TURRET_YAW_MAX）
   */
  sample(): InputCmd {
    // 计算相对于车体的炮塔偏转角并限幅
    let relTurret = this.mouseX - this._bodyYaw;
    // 规范化到 [-π, π]
    while (relTurret > Math.PI) relTurret -= 2 * Math.PI;
    while (relTurret < -Math.PI) relTurret += 2 * Math.PI;
    // 限幅到 ±TURRET_YAW_MAX
    if (relTurret > TURRET_YAW_MAX) {
      relTurret = TURRET_YAW_MAX;
      this.mouseX = this._bodyYaw + TURRET_YAW_MAX;
    } else if (relTurret < -TURRET_YAW_MAX) {
      relTurret = -TURRET_YAW_MAX;
      this.mouseX = this._bodyYaw - TURRET_YAW_MAX;
    }

    return {
      type: MessageType.InputCmd,
      seq: ++this.seq,
      forward: this.keys.has('KeyW'),
      backward: this.keys.has('KeyS'),
      turnLeft: this.keys.has('KeyA'),
      turnRight: this.keys.has('KeyD'),
      turretYaw: relTurret,
      gunPitch: -this.mouseY,
      fire: this.mouseDown,
      stabilize: this.rightMouseDown,
      timestamp: performance.now(),
    };
  }

  /**
   * 重置开火状态（单次发射用）
   */
  clearFire(): void {
    this.mouseDown = false;
  }

  /**
   * 获取当前炮塔相对偏转角（受限幅）
   */
  getTurretYaw(): number {
    let rel = this.mouseX - this._bodyYaw;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    return Math.max(-TURRET_YAW_MAX, Math.min(TURRET_YAW_MAX, rel));
  }

  /**
   * 获取当前鼠标世界朝向（用于相机等）
   */
  getWorldYaw(): number {
    return this.mouseX;
  }

  /**
   * 更新车体朝向（由 Game.ts 每帧调用）
   * 同时将 mouseX 协同归一化，避免 mouseX 与 bodyYaw 差值过大导致角度跳变
   */
  setBodyYaw(yaw: number): void {
    // 当 bodyYaw 发生大幅变化（如服务端角度回绕）时，
    // mouseX 需要跟随偏移以保持 relTurret 连续
    const oldBody = this._bodyYaw;
    this._bodyYaw = yaw;
    // 如果 bodyYaw 发生了回绕（差值超过 π），将 mouseX 同步偏移
    let bodyDiff = yaw - oldBody;
    if (bodyDiff > Math.PI) bodyDiff -= 2 * Math.PI;
    if (bodyDiff < -Math.PI) bodyDiff += 2 * Math.PI;
    const actualDiff = yaw - oldBody;
    if (Math.abs(actualDiff - bodyDiff) > 0.01) {
      // bodyYaw 经过了角度回绕（例如从 3.1 跳到 -3.1），mouseX 需补偿
      this.mouseX += bodyDiff - actualDiff;
    }
  }

  /**
   * 获取当前鼠标垂直值（火炮俯仰）
   */
  getGunPitch(): number {
    return -this.mouseY;
  }

  /**
   * 是否正在瞄准（右键按住）
   */
  isAiming(): boolean {
    return this._aiming;
  }

  /**
   * 设置外部暂停状态（暂停时不自动重新锁定指针）
   */
  setPaused(paused: boolean): void {
    this._externalPaused = paused;
  }
}
