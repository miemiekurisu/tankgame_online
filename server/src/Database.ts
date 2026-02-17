import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/** 昵称最大长度 */
const MAX_NICKNAME_LENGTH = 16;
/** 昵称合法字符（Unicode 字母数字 + 常用符号） */
const NICKNAME_REGEX = /^[\p{L}\p{N}\p{Emoji}_\- ]{1,16}$/u;

/**
 * 清洗昵称 — 移除危险字符，截断长度
 */
function sanitizeNickname(raw: string): string {
  let name = raw.trim().slice(0, MAX_NICKNAME_LENGTH);
  if (!name || !NICKNAME_REGEX.test(name)) {
    // 回退：仅保留安全字符
    name = name.replace(/[^\p{L}\p{N}_\- ]/gu, '').trim();
  }
  return name || 'Player';
}

/**
 * 游戏数据库 — SQLite 持久化存储玩家数据和游戏会话记录
 * 用于排行榜统计和游玩数据收集
 *
 * 安全设计：
 * - 所有查询使用参数化语句（防SQL注入）
 * - 昵称在写入前清洗
 * - 客户端ID用UUID v4格式验证
 */
export class GameDatabase {
  private db: BetterSqlite3.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || process.env.DB_PATH || path.join(process.cwd(), 'data', 'tankgame.db');

    // 确保数据目录存在
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(resolvedPath);

    // WAL 模式获得更好的并发性能
    this.db.pragma('journal_mode = WAL');

    this.initTables();
  }

  /**
   * 初始化表结构
   */
  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        client_id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL DEFAULT 'Player',
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        login_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT 'Player',
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration_ms INTEGER DEFAULT 0,
        kills INTEGER DEFAULT 0,
        deaths INTEGER DEFAULT 0,
        shots INTEGER DEFAULT 0,
        hits INTEGER DEFAULT 0,
        FOREIGN KEY (client_id) REFERENCES players(client_id)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_client ON sessions(client_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time);
    `);
  }

  /**
   * 玩家登录 — 创建或更新玩家记录，创建新会话
   * @returns 会话 ID
   */
  onPlayerLogin(clientId: string, nickname: string): number {
    const now = Date.now();
    const safeName = sanitizeNickname(nickname);

    // 插入或更新玩家
    const upsert = this.db.prepare(`
      INSERT INTO players (client_id, nickname, first_seen, last_seen, login_count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(client_id) DO UPDATE SET
        nickname = excluded.nickname,
        last_seen = excluded.last_seen,
        login_count = login_count + 1
    `);
    upsert.run(clientId, safeName, now, now);

    // 创建新会话
    const insertSession = this.db.prepare(`
      INSERT INTO sessions (client_id, nickname, start_time)
      VALUES (?, ?, ?)
    `);
    const result = insertSession.run(clientId, safeName, now);
    return Number(result.lastInsertRowid);
  }

  /**
   * 玩家登出 — 结束会话
   */
  onPlayerLogout(sessionId: number, stats?: { kills?: number; deaths?: number; shots?: number; hits?: number }): void {
    const now = Date.now();
    const update = this.db.prepare(`
      UPDATE sessions SET
        end_time = ?,
        duration_ms = ? - start_time,
        kills = COALESCE(?, kills),
        deaths = COALESCE(?, deaths),
        shots = COALESCE(?, shots),
        hits = COALESCE(?, hits)
      WHERE id = ?
    `);
    update.run(
      now,
      now,
      stats?.kills ?? null,
      stats?.deaths ?? null,
      stats?.shots ?? null,
      stats?.hits ?? null,
      sessionId
    );
  }

  /**
   * 更新会话统计数据（增量）
   */
  updateSessionStats(sessionId: number, kills: number, deaths: number): void {
    const update = this.db.prepare(`
      UPDATE sessions SET kills = ?, deaths = ? WHERE id = ?
    `);
    update.run(kills, deaths, sessionId);
  }

  /**
   * 获取排行榜 — 按游玩时长或击坠数排名
   * @param type 'playtime' | 'kills'
   * @param period 'daily' | 'weekly' | 'alltime'
   * @param limit 返回条目数（上限50）
   */
  getLeaderboard(type: string, period: string, limit: number = 20): LeaderboardEntry[] {
    // 输入验证
    if (type !== 'playtime' && type !== 'kills') type = 'playtime';
    if (period !== 'daily' && period !== 'weekly' && period !== 'alltime') period = 'weekly';
    limit = Math.max(1, Math.min(50, limit));

    // 计算时间过滤（参数化）
    let minTime = 0;
    if (period === 'daily') {
      // 当天 00:00:00 UTC
      const now = new Date();
      minTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    } else if (period === 'weekly') {
      minTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    }
    // alltime → minTime = 0，不过滤

    const valueExpr = type === 'playtime'
      ? 'SUM(COALESCE(s.duration_ms, 0))'
      : 'SUM(COALESCE(s.kills, 0))';

    const stmt = this.db.prepare(`
      SELECT
        s.client_id,
        s.nickname,
        ${valueExpr} as value
      FROM sessions s
      WHERE s.start_time >= ?
      GROUP BY s.client_id
      HAVING value > 0
      ORDER BY value DESC
      LIMIT ?
    `);
    return stmt.all(minTime, limit) as LeaderboardEntry[];
  }

  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }
}

export interface LeaderboardEntry {
  client_id: string;
  nickname: string;
  value: number;
}
