import { MessageType } from '@tankgame/shared';
import type {
  SnapshotMessage,
  JoinAckMessage,
  GameEventMessage,
  PongMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  AFKKickMessage,
  InputCmd,
} from '@tankgame/shared';

type MessageHandler = {
  onJoinAck?: (msg: JoinAckMessage) => void;
  onSnapshot?: (msg: SnapshotMessage) => void;
  onGameEvent?: (msg: GameEventMessage) => void;
  onPong?: (msg: PongMessage) => void;
  onPlayerJoined?: (msg: PlayerJoinedMessage) => void;
  onPlayerLeft?: (msg: PlayerLeftMessage) => void;
  onAFKKick?: (msg: AFKKickMessage) => void;
  onDisconnect?: () => void;
};

/**
 * 网络客户端 — WebSocket 通信
 */
export class NetworkClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler;
  private rtt: number = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(handlers: MessageHandler) {
    this.handlers = handlers;
  }

  /**
   * 连接服务器
   */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[Network] Connected to server');
        this.startPing();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.dispatchMessage(msg);
        } catch (err) {
          console.error('[Network] parse error:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('[Network] Disconnected');
        this.stopPing();
        this.handlers.onDisconnect?.();
      };

      this.ws.onerror = (err) => {
        console.error('[Network] Error:', err);
        reject(err);
      };
    });
  }

  /**
   * 分发消息到处理器
   */
  private dispatchMessage(msg: { type: number }): void {
    switch (msg.type) {
      case MessageType.JoinAck:
        this.handlers.onJoinAck?.(msg as unknown as JoinAckMessage);
        break;
      case MessageType.Snapshot:
        this.handlers.onSnapshot?.(msg as unknown as SnapshotMessage);
        break;
      case MessageType.GameEvent:
        this.handlers.onGameEvent?.(msg as unknown as GameEventMessage);
        break;
      case MessageType.Pong:
        const pong = msg as unknown as PongMessage;
        this.rtt = performance.now() - pong.clientTime;
        this.handlers.onPong?.(pong);
        break;
      case MessageType.PlayerJoined:
        this.handlers.onPlayerJoined?.(msg as unknown as PlayerJoinedMessage);
        break;
      case MessageType.PlayerLeft:
        this.handlers.onPlayerLeft?.(msg as unknown as PlayerLeftMessage);
        break;
      case MessageType.AFKKick:
        this.handlers.onAFKKick?.(msg as unknown as AFKKickMessage);
        break;
    }
  }

  /**
   * 发送加入房间请求
   */
  joinRoom(nickname: string, clientId?: string): void {
    this.send({ type: MessageType.JoinRoom, nickname, clientId });
  }

  /**
   * 发送输入命令
   */
  sendInput(cmd: InputCmd): void {
    this.send(cmd);
  }

  /**
   * 发送 JSON 消息
   */
  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * 开始 Ping
   */
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({
        type: MessageType.Ping,
        clientTime: performance.now(),
      });
    }, 2000);
  }

  /**
   * 停止 Ping
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * 获取当前 RTT
   */
  getRTT(): number {
    return this.rtt;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }
}
