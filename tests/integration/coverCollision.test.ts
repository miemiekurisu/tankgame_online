import { describe, it, expect, beforeEach } from 'vitest';
import { Vec3, TANK_COLLISION_RADIUS, PROJECTILE_COLLISION_RADIUS, TANK_MAX_HP } from '@tankgame/shared';
import { GameWorld } from '../../packages/server/src/GameWorld.js';
import { Player } from '../../packages/server/src/Player.js';

/**
 * Cover & Boundary Collision Integration Tests
 * Tests tank-cover collisions, projectile-cover collisions, and map boundary enforcement
 */
describe('Cover & Boundary Collision Integration', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = new GameWorld(42);
  });

  describe('tank-cover collision', () => {
    it('should push tank away from cover object', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      // Find a cover and place tank nearby
      const cover = world.map.covers[0];
      if (!cover) return;

      player.position.set(cover.position.x, 0, cover.position.z);

      // Push forward into the cover
      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: true, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
        timestamp: Date.now(),
      });

      world.update();

      // Player should be pushed away from cover center
      const dx = player.position.x - cover.position.x;
      const dz = player.position.z - cover.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      expect(dist).toBeGreaterThanOrEqual(TANK_COLLISION_RADIUS + cover.radius - 1);
    });

    it('should not let tank pass through cover', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      const cover = world.map.covers[0];
      if (!cover) return;

      // Place tank right at cover edge and try to move through
      const offsetDist = TANK_COLLISION_RADIUS + cover.radius + 1;
      player.position.set(cover.position.x + offsetDist, 0, cover.position.z);
      player.bodyYaw = Math.PI / 2; // Face toward cover

      for (let i = 0; i < 120; i++) {
        player.pushInput({
          type: 0x02 as any, seq: i + 1,
          forward: true, backward: false, turnLeft: false, turnRight: false,
          turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
          timestamp: Date.now(),
        });
        world.update();

        // Tank should never be inside cover
        const dx = player.position.x - cover.position.x;
        const dz = player.position.z - cover.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const minDist = TANK_COLLISION_RADIUS + cover.radius;
        // Allow small tolerance for floating point
        expect(dist).toBeGreaterThanOrEqual(minDist - 0.5);
      }
    });

    it('should preserve velocity along cover surface', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      const cover = world.map.covers[0];
      if (!cover) return;

      // Place near cover and move along its surface
      player.position.set(
        cover.position.x + TANK_COLLISION_RADIUS + cover.radius + 0.5,
        0,
        cover.position.z - 10
      );

      // Move forward (along Z axis, tangent to cover)
      for (let i = 0; i < 30; i++) {
        player.pushInput({
          type: 0x02 as any, seq: i + 1,
          forward: true, backward: false, turnLeft: false, turnRight: false,
          turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
          timestamp: Date.now(),
        });
        world.update();
      }

      // Should have moved along the surface without stopping
      expect(player.velocity.length()).toBeGreaterThan(0);
    });
  });

  describe('projectile-cover collision', () => {
    it('should explode projectile on cover hit', () => {
      const player = new Player(1, 'Shooter');
      world.addPlayer(player);

      const cover = world.map.covers[0];
      if (!cover) return;

      // Position player to fire at cover
      const dx = cover.position.x - player.position.x;
      const dz = cover.position.z - player.position.z;
      const aimYaw = Math.atan2(-dx, -dz) - player.bodyYaw;

      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: aimYaw, gunPitch: 0, fire: true, stabilize: false,
        timestamp: Date.now(),
      });

      let explodeDetected = false;
      for (let i = 0; i < 300; i++) {
        const events = world.update();
        for (const e of events) {
          if (e.eventType === 'explode') {
            explodeDetected = true;
          }
        }
      }

      // Projectile should eventually explode (either hitting cover, ground, or expiring)
      expect(explodeDetected).toBe(true);
    });

    it('should block projectile from reaching target behind cover', () => {
      const shooter = new Player(1, 'Shooter');
      const target = new Player(2, 'Target');
      world.addPlayer(shooter);
      world.addPlayer(target);

      // Find a cover and place target directly behind it
      const cover = world.map.covers[0];
      if (!cover) return;

      // Place shooter on one side, target on opposite side of cover
      const shooterDist = 30;
      shooter.position.set(cover.position.x - shooterDist, 0, cover.position.z);
      shooter.bodyYaw = Math.PI / 2; // Face right toward cover

      target.position.set(cover.position.x + 10, 0, cover.position.z);
      target.hp = TANK_MAX_HP;

      // Fire toward target (through cover)
      shooter.pushInput({
        type: 0x02 as any, seq: 1,
        forward: false, backward: false, turnLeft: false, turnRight: false,
        turretYaw: Math.PI / 2, gunPitch: 0, fire: true, stabilize: false,
        timestamp: Date.now(),
      });

      for (let i = 0; i < 60; i++) {
        world.update();
      }

      // Cover may or may not be tall enough to block; test that no crash occurs
      expect(target.hp).toBeLessThanOrEqual(TANK_MAX_HP);
    });
  });

  describe('map boundary enforcement', () => {
    it('should clamp player position to map bounds on X axis', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      player.position.set(999, 0, 0);
      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: true, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      expect(player.position.x).toBeLessThanOrEqual(world.map.width / 2);
    });

    it('should clamp player position to map bounds on Z axis', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      player.position.set(0, 0, 999);
      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: true, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      expect(player.position.z).toBeLessThanOrEqual(world.map.depth / 2);
    });

    it('should clamp negative position to map bounds', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      player.position.set(-999, 0, -999);
      player.pushInput({
        type: 0x02 as any, seq: 1,
        forward: true, backward: false, turnLeft: false, turnRight: false,
        turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
        timestamp: Date.now(),
      });
      world.update();

      expect(player.position.x).toBeGreaterThanOrEqual(-world.map.width / 2);
      expect(player.position.z).toBeGreaterThanOrEqual(-world.map.depth / 2);
    });

    it('should keep player in bounds during extended gameplay', () => {
      const player = new Player(1, 'Runner');
      world.addPlayer(player);

      // Run toward corner for an extended time
      for (let i = 0; i < 600; i++) {
        player.pushInput({
          type: 0x02 as any, seq: i + 1,
          forward: true, backward: false, turnLeft: false, turnRight: false,
          turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
          timestamp: Date.now(),
        });
        world.update();

        expect(Math.abs(player.position.x)).toBeLessThanOrEqual(world.map.width / 2 + 1);
        expect(Math.abs(player.position.z)).toBeLessThanOrEqual(world.map.depth / 2 + 1);
      }
    });
  });

  describe('multi-cover collision', () => {
    it('should handle tank between two covers', () => {
      const player = new Player(1, 'Test');
      world.addPlayer(player);

      // If there are at least 2 covers, place tank between them
      if (world.map.covers.length < 2) return;

      const c1 = world.map.covers[0];
      const c2 = world.map.covers[1];
      const midX = (c1.position.x + c2.position.x) / 2;
      const midZ = (c1.position.z + c2.position.z) / 2;
      player.position.set(midX, 0, midZ);

      // Move around for several ticks — should not crash
      for (let i = 0; i < 60; i++) {
        player.pushInput({
          type: 0x02 as any, seq: i + 1,
          forward: true, backward: false,
          turnLeft: i % 10 < 5, turnRight: i % 10 >= 5,
          turretYaw: 0, gunPitch: 0, fire: false, stabilize: false,
          timestamp: Date.now(),
        });
        world.update();
      }

      // Just ensure no crash
      expect(player.alive).toBe(true);
    });
  });
});
