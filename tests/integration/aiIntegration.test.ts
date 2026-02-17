import { describe, it, expect, beforeEach } from 'vitest';
import { Vec3, DIRECT_HIT_DAMAGE, TANK_MAX_HP, RESPAWN_DELAY, TICK_INTERVAL } from '@tankgame/shared';
import { GameWorld } from '../../packages/server/src/GameWorld.js';
import { Player } from '../../packages/server/src/Player.js';
import { MapGenerator } from '../../packages/server/src/MapGenerator.js';
import { AIPlayer } from '../../packages/server/src/AIPlayer.js';

/**
 * AI Integration Tests — AI bots interacting with the game world
 */
describe('AI Integration', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = new GameWorld(42);
  });

  describe('AI in game world', () => {
    it('should add AI bots to the world', () => {
      const { player, ai } = AIPlayer.create(100, 'normal');
      world.addPlayer(player);
      expect(world.players.size).toBe(1);
      expect(player.alive).toBe(true);
    });

    it('should process AI inputs through game loop', () => {
      const { player, ai } = AIPlayer.create(100, 'normal');
      world.addPlayer(player);

      const startPos = player.position.clone();

      // AI generates input, then world processes it
      for (let i = 0; i < 60; i++) {
        ai.update(world.players, world.map.width, world.map.depth);
        world.update();
      }

      // AI should have moved
      const moved = player.position.distanceTo(startPos);
      expect(moved).toBeGreaterThan(0);
    });

    it('should have AI engage human player', () => {
      const { player: bot, ai } = AIPlayer.create(100, 'hard');
      const human = new Player(1, 'Human');
      world.addPlayer(bot);
      world.addPlayer(human);

      // Place them facing each other
      bot.position.set(0, 0, 0);
      human.position.set(0, 0, -50);

      let fireDetected = false;
      for (let i = 0; i < 600; i++) {
        ai.update(world.players, world.map.width, world.map.depth);
        const events = world.update();
        for (const e of events) {
          if (e.eventType === 'fire' && (e as any).shooterId === 100) {
            fireDetected = true;
          }
        }
        if (fireDetected) break;
      }

      // Hard AI should eventually fire at the human
      expect(fireDetected).toBe(true);
    });

    it('should keep AI on terrain surface', () => {
      const { player: bot, ai } = AIPlayer.create(100, 'normal');
      world.addPlayer(bot);

      for (let i = 0; i < 120; i++) {
        ai.update(world.players, world.map.width, world.map.depth);
        world.update();

        const terrainH = MapGenerator.getHeightAt(
          world.map,
          bot.position.x,
          bot.position.z
        );
        expect(Math.abs(bot.position.y - terrainH)).toBeLessThan(5);
      }
    });

    it('should keep AI within map boundaries', () => {
      const { player: bot, ai } = AIPlayer.create(100, 'normal');
      world.addPlayer(bot);

      for (let i = 0; i < 300; i++) {
        ai.update(world.players, world.map.width, world.map.depth);
        world.update();
      }

      expect(Math.abs(bot.position.x)).toBeLessThanOrEqual(world.map.width / 2);
      expect(Math.abs(bot.position.z)).toBeLessThanOrEqual(world.map.depth / 2);
    });
  });

  describe('AI vs AI combat', () => {
    it('should simulate combat between two AI bots', () => {
      const { player: bot1, ai: ai1 } = AIPlayer.create(100, 'hard');
      const { player: bot2, ai: ai2 } = AIPlayer.create(101, 'hard');
      world.addPlayer(bot1);
      world.addPlayer(bot2);

      bot1.position.set(-30, 0, 0);
      bot2.position.set(30, 0, 0);

      let combatEvents = 0;
      for (let i = 0; i < 600; i++) {
        ai1.update(world.players, world.map.width, world.map.depth);
        ai2.update(world.players, world.map.width, world.map.depth);
        const events = world.update();
        combatEvents += events.length;
      }

      // Some combat should have occurred
      expect(combatEvents).toBeGreaterThan(0);
    });

    it('should handle AI death and respawn', () => {
      const { player: bot, ai } = AIPlayer.create(100, 'normal');
      const killer = new Player(1, 'Killer');
      world.addPlayer(bot);
      world.addPlayer(killer);

      // Kill the bot - killer faces toward bot (forward = (0,0,-1))
      bot.hp = 1;
      bot.position.set(0, 0, 0);
      killer.position.set(0, 0, 10);
      killer.bodyYaw = 0;

      killer.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: true, stabilize: false,
        timestamp: Date.now(),
      });

      let deathDetected = false;
      let respawnDetected = false;

      for (let i = 0; i < 300; i++) {
        if (bot.alive) {
          ai.update(world.players, world.map.width, world.map.depth);
        }
        const events = world.update();
        for (const e of events) {
          if (e.eventType === 'death' && (e as any).victimId === 100) {
            deathDetected = true;
          }
          if (e.eventType === 'respawn' && (e as any).playerId === 100) {
            respawnDetected = true;
          }
        }
      }

      expect(deathDetected).toBe(true);
      expect(respawnDetected).toBe(true);
      expect(bot.alive).toBe(true);
      expect(bot.hp).toBe(TANK_MAX_HP);
    });
  });

  describe('multiple AI difficulties', () => {
    it('should create bots with different behaviors', () => {
      const { player: easyBot, ai: easyAi } = AIPlayer.create(100, 'easy');
      const { player: hardBot, ai: hardAi } = AIPlayer.create(101, 'hard');
      world.addPlayer(easyBot);
      world.addPlayer(hardBot);

      const target = new Player(1, 'Target');
      target.position.set(50, 0, 0);
      target.alive = true;
      world.addPlayer(target);

      // Both should generate valid inputs
      for (let i = 0; i < 60; i++) {
        easyAi.update(world.players, world.map.width, world.map.depth);
        hardAi.update(world.players, world.map.width, world.map.depth);
        world.update();
      }

      expect(easyBot.alive).toBe(true);
      expect(hardBot.alive).toBe(true);
    });
  });
});
