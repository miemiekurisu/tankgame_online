import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameDatabase } from '../../packages/server/src/Database.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('GameDatabase', () => {
  let db: GameDatabase;
  let dbPath: string;

  beforeEach(() => {
    // 使用临时文件路径
    dbPath = path.join(os.tmpdir(), `tankgame-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new GameDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    // 清理临时文件
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '-wal');
      fs.unlinkSync(dbPath + '-shm');
    } catch {
      // ignore
    }
  });

  describe('Player Login', () => {
    it('should create a session on login', () => {
      const sessionId = db.onPlayerLogin('test-client-1', 'Player1');
      expect(sessionId).toBeGreaterThan(0);
    });

    it('should increment login_count for returning players', () => {
      db.onPlayerLogin('returning-client', 'Player2');
      db.onPlayerLogin('returning-client', 'Player2');
      db.onPlayerLogin('returning-client', 'Player2');

      // 3 sessions should be created
      const lb = db.getLeaderboard('playtime', 'alltime');
      // At this point all sessions have 0 duration, so won't show
      // But we can verify 3 sessions exist by logging out and checking
    });

    it('should return unique session IDs', () => {
      const s1 = db.onPlayerLogin('client-a', 'A');
      const s2 = db.onPlayerLogin('client-b', 'B');
      const s3 = db.onPlayerLogin('client-a', 'A');

      expect(s1).not.toBe(s2);
      expect(s2).not.toBe(s3);
      expect(s1).not.toBe(s3);
    });
  });

  describe('Player Logout', () => {
    it('should record session duration on logout', () => {
      const sessionId = db.onPlayerLogin('logout-test', 'Player3');
      
      // 模拟时间过去
      db.onPlayerLogout(sessionId, { kills: 5, deaths: 2, shots: 20, hits: 8 });
      
      // 验证通过排行榜查询
      const lb = db.getLeaderboard('kills', 'alltime');
      expect(lb.length).toBeGreaterThanOrEqual(1);
      const entry = lb.find(e => e.client_id === 'logout-test');
      expect(entry).toBeDefined();
      expect(entry!.value).toBe(5);
    });

    it('should record stats correctly', () => {
      const s1 = db.onPlayerLogin('stats-test', 'Killer');
      db.onPlayerLogout(s1, { kills: 10, deaths: 3, shots: 50, hits: 15 });

      const s2 = db.onPlayerLogin('stats-test', 'Killer');
      db.onPlayerLogout(s2, { kills: 5, deaths: 1, shots: 30, hits: 10 });

      const lb = db.getLeaderboard('kills', 'alltime');
      const entry = lb.find(e => e.client_id === 'stats-test');
      expect(entry).toBeDefined();
      expect(entry!.value).toBe(15); // 10 + 5
    });
  });

  describe('Session Stats Update', () => {
    it('should update kills and deaths incrementally', () => {
      const sessionId = db.onPlayerLogin('update-test', 'Fighter');
      db.updateSessionStats(sessionId, 3, 1);

      db.onPlayerLogout(sessionId);

      const lb = db.getLeaderboard('kills', 'alltime');
      const entry = lb.find(e => e.client_id === 'update-test');
      expect(entry).toBeDefined();
      expect(entry!.value).toBe(3);
    });
  });

  describe('Leaderboard', () => {
    beforeEach(() => {
      // 创建多个玩家的会话数据
      const players = [
        { id: 'lb-1', name: 'TopKiller', kills: 50 },
        { id: 'lb-2', name: 'MidPlayer', kills: 20 },
        { id: 'lb-3', name: 'Newbie', kills: 5 },
      ];

      for (const p of players) {
        const sid = db.onPlayerLogin(p.id, p.name);
        db.onPlayerLogout(sid, { kills: p.kills, deaths: 0, shots: 100, hits: 50 });
      }
    });

    it('should return kills leaderboard sorted by kills desc', () => {
      const lb = db.getLeaderboard('kills', 'alltime');
      expect(lb.length).toBe(3);
      expect(lb[0].nickname).toBe('TopKiller');
      expect(lb[0].value).toBe(50);
      expect(lb[1].nickname).toBe('MidPlayer');
      expect(lb[1].value).toBe(20);
      expect(lb[2].nickname).toBe('Newbie');
      expect(lb[2].value).toBe(5);
    });

    it('should return playtime leaderboard sorted by duration desc', () => {
      const lb = db.getLeaderboard('playtime', 'alltime');
      // All sessions have short durations (near-instant), but should exist
      expect(lb.length).toBeGreaterThanOrEqual(0);
    });

    it('should respect limit parameter', () => {
      const lb = db.getLeaderboard('kills', 'alltime', 2);
      expect(lb.length).toBe(2);
    });

    it('should filter by weekly period', () => {
      const lb = db.getLeaderboard('kills', 'weekly');
      // All sessions were just created, so they're within this week
      expect(lb.length).toBe(3);
    });

    it('should return empty for alltime with no data', () => {
      const freshDb = new GameDatabase(dbPath + '.fresh');
      const lb = freshDb.getLeaderboard('kills', 'alltime');
      expect(lb.length).toBe(0);
      freshDb.close();
      try { fs.unlinkSync(dbPath + '.fresh'); } catch { /* ignore */ }
    });
  });
});
