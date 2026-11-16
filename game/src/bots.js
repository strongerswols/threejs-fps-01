// Bots: nine of them, four Ember teammates and five Vanta defenders. Each bot is a
// low-poly figure (body, head, visor, gun) with health, a weapon profile and a small
// state machine: route along the waypoint graph to its objective, hold a position and
// scan, engage when it sees an enemy, plant or defuse when the objective calls for it.
// Vision is a ray against the world's colliders; hearing is a radius around loud events.
// Bot fire is a ray with a spread that grows with distance and target speed, fired in
// bursts with a reaction delay, so fights are readable and fair.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { range } from './rng.js';

const BOT_RADIUS = 0.36;
const BOT_HEIGHT = 1.72;
const BOT_EYE = 1.55;
const BOT_SPEED = 3.3;
const ENGAGE_RANGE = 42;
const HEAR_RANGE = 16;

const NAMES = {
  ember: ['Ash', 'Cinder', 'Flint', 'Soot'],
  vanta: ['Shade', 'Umbra', 'Gloom', 'Wraith', 'Hollow'],
};

function makeFigure(team, name) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color: new THREE.Color(team === 'ember' ? PALETTE.ember : PALETTE.vanta),
    roughness: 0.7, metalness: 0.1,
  });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x23262b), roughness: 0.8, metalness: 0.1 });
  const visor = new THREE.MeshStandardMaterial({
    color: new THREE.Color(team === 'ember' ? PALETTE.accent : 0x9fe8ff),
    roughness: 0.2, metalness: 0.6, emissive: new THREE.Color(team === 'ember' ? PALETTE.accent : 0x9fe8ff),
    emissiveIntensity: 0.5,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), suit);
  body.position.y = 0.95;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), dark);
  head.position.y = 1.62;
  head.castShadow = true;
  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), visor);
  visorMesh.position.set(0, 1.64, 0.19);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.3), dark);
  legs.position.y = 0.25;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), dark);
  gun.position.set(0.3, 1.15, 0.3);
  group.add(body, head, visorMesh, legs, gun);
  body.userData.botPart = 'body';
  head.userData.botPart = 'head';
  visorMesh.userData.botPart = 'head';
  group.userData.name = name;
  return { group, body, head, visor: visorMesh, legs };
}

export function createBots(scene, world, random) {
  const bots = [];
  const losRay = new THREE.Raycaster();
  losRay.far = ENGAGE_RANGE;
  const losOrigin = new THREE.Vector3();
  const losDir = new THREE.Vector3();
  const probe = new THREE.Box3();
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 });

  function collides(x, z) {
    probe.min.set(x - BOT_RADIUS, 0.05, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, BOT_HEIGHT - 0.05, z + BOT_RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function hasLineOfSight(from, to) {
    losOrigin.copy(from);
    losDir.copy(to).sub(from);
    const dist = losDir.length();
    if (dist < 0.01) return true;
    losDir.normalize();
    losRay.set(losOrigin, losDir);
    losRay.far = dist;
    const hit = losRay.intersectObjects(world.shootables, false)[0];
    return !hit;
  }

  function spawnBot(team, index, spawn) {
    const name = NAMES[team][index];
    const figure = makeFigure(team, name);
    scene.add(figure.group);
    const bot = {
      id: `${team}-${index}`,
      name,
      team,
      figure,
      position: spawn.clone(),
      yaw: team === 'ember' ? Math.PI : 0,
      health: 100,
      alive: true,
      state: 'route',
      objective: null,
      path: [],
      pathIndex: 0,
      holdSpot: null,
      holdUntil: 0,
      target: null,
      seenAt: -10,
      burstLeft: 0,
      nextShotAt: 0,
      pauseUntil: 0,
      channel: null,
      channelProgress: 0,
      damageFlash: 0,
      walkPhase: random() * Math.PI * 2,
      speed: BOT_SPEED * range(random, 0.92, 1.08),
      reaction: range(random, 0.35, 0.7),
      aimError: range(random, 0.012, 0.02),
    };
    figure.body.userData.bot = bot;
    figure.head.userData.bot = bot;
    figure.visor.userData.bot = bot;
    bots.push(bot);
    return bot;
  }

  function resetBot(bot, spawn, objective) {
    bot.position.copy(spawn);
    bot.health = 100;
    bot.alive = true;
    bot.state = 'route';
    bot.objective = objective;
    bot.path = [];
    bot.pathIndex = 0;
    bot.target = null;
    bot.seenAt = -10;
    bot.burstLeft = 0;
    bot.channel = null;
    bot.channelProgress = 0;
    bot.damageFlash = 0;
    bot.figure.group.visible = true;
    bot.figure.group.rotation.set(0, bot.yaw, 0);
    bot.figure.group.position.copy(bot.position);
  }

  function eyeOf(bot) {
    return new THREE.Vector3(bot.position.x, BOT_EYE, bot.position.z);
  }

  function moveToward(bot, target, dt) {
    const dx = target.x - bot.position.x;
    const dz = target.z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const stepDistance = bot.speed * dt;
    const nx = bot.position.x + (dx / dist) * stepDistance;
    const nz = bot.position.z + (dz / dist) * stepDistance;
    if (!collides(nx, bot.position.z)) bot.position.x = nx;
    if (!collides(bot.position.x, nz)) bot.position.z = nz;
    bot.yaw = Math.atan2(dx, dz);
    bot.walkPhase += dt * 9;
    return dist < 0.6;
  }

  // Pick the nearest living enemy the bot can see; hearing keeps a recent target.
  function acquireTarget(bot, enemies, now) {
    let best = null;
    let bestScore = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dist = bot.position.distanceTo(enemy.position);
      if (dist > ENGAGE_RANGE) continue;
      const targetEye = enemy.isPlayer
        ? new THREE.Vector3(enemy.position.x, enemy.position.y + enemy.eye, enemy.position.z)
        : eyeOf(enemy);
      if (!hasLineOfSight(eyeOf(bot), targetEye)) continue;
      // Closer and more central targets win.
      const score = dist + Math.abs(enemy.position.x - bot.position.x) * 0.1;
      if (score < bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    if (best) {
      if (bot.target !== best) bot.seenAt = now + bot.reaction;
      bot.target = best;
    } else if (bot.target && now - bot.seenAt > 1.2) {
      bot.target = null;
    }
    return bot.target;
  }

  function fireAt(bot, target, now, onShot) {
    if (now < bot.nextShotAt || now < bot.pauseUntil) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      bot.pauseUntil = now + range(random, 0.35, 0.8);
    }
    bot.burstLeft -= 1;
    bot.nextShotAt = now + 0.11;
    const from = eyeOf(bot);
    const targetPos = target.isPlayer
      ? new THREE.Vector3(target.position.x, target.position.y + target.eye * 0.8, target.position.z)
      : new THREE.Vector3(target.position.x, 1.2, target.position.z);
    const dist = from.distanceTo(targetPos);
    const speedPenalty = target.isPlayer ? Math.hypot(target.velocity.x, target.velocity.z) * 0.004 : 0.004;
    const spread = bot.aimError + dist * 0.0012 + speedPenalty;
    const dir = targetPos.sub(from).normalize();
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    onShot(bot, from, dir);
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.damageFlash = 0.15;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.health = 0;
      bot.channel = null;
      bot.figure.group.rotation.x = -Math.PI / 2;
      bot.figure.group.position.y = 0.25;
      return true;
    }
    return false;
  }

  function hear(bot, point) {
    if (!bot.alive) return;
    if (bot.position.distanceTo(point) < HEAR_RANGE && bot.state === 'hold') {
      bot.state = 'route';
      bot.path = world.route(bot.position, point);
      bot.pathIndex = 0;
    }
  }

  function step(bot, dt, now, context) {
    if (!bot.alive) return;
    bot.damageFlash = Math.max(0, bot.damageFlash - dt);
    bot.figure.body.material.emissive.setHex(bot.damageFlash > 0 ? 0xaa0000 : 0x000000);

    // The channel (plant/defuse) freezes the bot in place.
    if (bot.channel) {
      bot.channelProgress += dt;
      if (bot.channelProgress >= bot.channel.duration) {
        const done = bot.channel;
        bot.channel = null;
        bot.channelProgress = 0;
        context.onChannelDone(bot, done.kind);
      }
      return;
    }

    const enemies = context.enemiesOf(bot);
    const target = acquireTarget(bot, enemies, now);

    if (target && now >= bot.seenAt) {
      // Face the target and shoot in bursts; strafe a little while firing.
      const dx = target.position.x - bot.position.x;
      const dz = target.position.z - bot.position.z;
      bot.yaw = Math.atan2(dx, dz);
      const strafe = Math.sin(now * 1.3 + bot.walkPhase) * 0.8;
      const strafeX = Math.cos(bot.yaw) * strafe * dt;
      const strafeZ = -Math.sin(bot.yaw) * strafe * dt;
      if (!collides(bot.position.x + strafeX, bot.position.z)) bot.position.x += strafeX;
      if (!collides(bot.position.x, bot.position.z + strafeZ)) bot.position.z += strafeZ;
      fireAt(bot, target, now, context.onBotShot);
      bot.state = 'engage';
    } else if (bot.state === 'hold') {
      if (now > bot.holdUntil) {
        bot.state = 'route';
        bot.path = world.route(bot.position, bot.objective);
        bot.pathIndex = 0;
      }
      bot.yaw += Math.sin(now * 0.5 + bot.walkPhase) * dt * 0.4;
    } else {
      // Route: follow the waypoint path; on arrival, hold and scan.
      if (bot.pathIndex >= bot.path.length) {
        if (bot.objective) {
          bot.path = world.route(bot.position, bot.objective);
          bot.pathIndex = 0;
        }
        if (bot.pathIndex >= bot.path.length) {
          bot.state = 'hold';
          bot.holdUntil = now + range(random, 3, 7);
          return;
        }
      }
      const waypoint = bot.path[bot.pathIndex];
      if (moveToward(bot, waypoint, dt)) bot.pathIndex += 1;
      bot.state = 'route';
    }

    bot.figure.group.position.set(bot.position.x, 0, bot.position.z);
    bot.figure.group.rotation.y = bot.yaw;
    const moving = bot.state === 'route';
    bot.figure.legs.position.y = 0.25 + (moving ? Math.abs(Math.sin(bot.walkPhase)) * 0.06 : 0);
  }

  function addTracer(from, to) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geometry, tracerMat);
    line.userData.born = performance.now();
    scene.add(line);
    tracers.push(line);
    if (tracers.length > 24) {
      const old = tracers.shift();
      scene.remove(old);
      old.geometry.dispose();
    }
  }

  function stepTracers() {
    const now = performance.now();
    for (let i = tracers.length - 1; i >= 0; i -= 1) {
      if (now - tracers[i].userData.born > 70) {
        scene.remove(tracers[i]);
        tracers[i].geometry.dispose();
        tracers.splice(i, 1);
      }
    }
  }

  return {
    bots,
    spawnBot,
    resetBot,
    damage,
    hear,
    eyeOf,
    hasLineOfSight,
    step,
    addTracer,
    stepTracers,
    shootables() {
      const meshes = [];
      for (const bot of bots) {
        if (!bot.alive) continue;
        meshes.push(bot.figure.body, bot.figure.head, bot.figure.visor);
      }
      return meshes;
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
  };
}
