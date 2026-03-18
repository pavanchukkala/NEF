/*
  ai.js

  Implements simple AI opponents for Volt Surge.  Bots follow
  steering behaviours inspired by Craig Reynolds: seeking the
  nearest target, wandering randomly, and occasionally avoiding
  obstacles.  They use the same public API as human players but
  schedule inputs programmatically.  This module exports a `Bot`
  class that can be instantiated with a reference to the game
  world.  When the server detects an insufficient number of human
  players, it can spawn bots to populate the room.

  Note: These bots are intentionally imperfect.  They sometimes
  hesitate, over‑rotate or make suboptimal decisions to avoid
  feeling like omniscient AIs.  Tweak the constants below to
  adjust the difficulty.
*/

export class Bot {
  constructor(player, world) {
    this.player = player;
    this.world = world;
    this.target = null;
    this.timer = 0;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      // Choose a new behaviour every 0.5–1.5 seconds
      this.timer = 500 + Math.random() * 1000;
      this.chooseTarget();
    }
    this.applySteering();
    // Occasionally use an ability if available
    if (Math.random() < 0.005) this.player.useShield();
    if (Math.random() < 0.003) this.player.usePulse();
    if (Math.random() < 0.004) this.player.useSurge();
  }

  chooseTarget() {
    // Find the closest enemy player
    const enemies = this.world.players.filter(p => p !== this.player);
    if (enemies.length === 0) {
      this.target = null;
      return;
    }
    enemies.sort((a,b) => this.dist(a) - this.dist(b));
    this.target = enemies[0];
  }

  dist(p) {
    const dx = p.x - this.player.x;
    const dy = p.y - this.player.y;
    return Math.sqrt(dx*dx + dy*dy);
  }

  applySteering() {
    const { player, target } = this;
    if (!target) {
      // wander randomly
      player.turnRate = (Math.random() - 0.5) * 6;
      return;
    }
    // steer towards target with slight randomness
    const desiredAngle = Math.atan2(target.y - player.y, target.x - player.x);
    let delta = desiredAngle - player.angle;
    // Wrap delta between -π and π
    delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI;
    // Apply smoothing
    player.turnRate = delta * 2 + (Math.random() - 0.5) * 0.5;
  }
}