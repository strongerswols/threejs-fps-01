// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. This file owns the match flow (buy, live, round end, match end), the player's
// shooting and grenades, the Spark plant/defuse, and the wiring between the bots, the
// world and the HUD. ?shot=start|play|end with &seed=N sets up a deterministic frame
// for a capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld, SITES, SPAWNS, HOLD_SPOTS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, GRENADE_PRICE } from './weapons.js';
import { createBots } from './bots.js';
import { createMatch, BUY_SECONDS, ROUND_SECONDS, PLANT_SECONDS, DEFUSE_SECONDS, FUSE_SECONDS, KILL_REWARD, PLANT_REWARD } from './match.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const lowQuality = params.get('quality') === 'low';
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(shot ? seed : (Date.now() % 2147483647));

const renderer = new THREE.WebGLRenderer({ antialias: !lowQuality, powerPreference: 'high-performance' });
renderer.setPixelRatio(lowQuality ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !lowQuality;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 22, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene);
const match = createMatch();
const bots = createBots(scene, world, random);
const player = createPlayer(world.colliders);
const weapon = createWeapon(camera);
const input = createInput(renderer.domElement, onLockChange);
const hud = createHud({
  onPlay,
  onBuyToggle: () => {
    if (match.state.phase !== 'buy' || shot) return;
    buyOpen = !buyOpen;
    if (buyOpen) hud.showBuy(match.state.money, ownedWeapons());
    else hud.hideBuy();
  },
  onBuy: buyItem,
});
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const losRay = new THREE.Ray();
const direction = new THREE.Vector3();
const tempVec = new THREE.Vector3();
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.4, metalness: 0.7 });

const playerProxy = {
  isPlayer: true,
  position: player.state.position,
  velocity: player.state.velocity,
  eye: player.state.eye,
  alive: true,
};

let owned = ['pistol'];
let buyOpen = false;
let started = false;
let frozen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let stepDistance = 0;
let beepAccumulator = 0;
let bannerTimer = 0;

function ownedWeapons() {
  return owned.slice();
}

function emberBots() {
  return bots.bots.filter((b) => b.team === 'ember');
}
function vantaBots() {
  return bots.bots.filter((b) => b.team === 'vanta');
}

function placeBotsForRound() {
  const emberSpawns = SPAWNS.ember;
  const vantaSpawns = SPAWNS.vanta;
  const ember = emberBots();
  const vanta = vantaBots();
  const siteKeys = ['A', 'B'];
  const emberSite = siteKeys[Math.floor(random() * 2)];
  ember.forEach((bot, i) => {
    const objective = i < 2 ? SITES[emberSite].center : SITES[emberSite === 'A' ? 'B' : 'A'].center;
    bots.resetBot(bot, emberSpawns[(i + 1) % emberSpawns.length], objective);
    bot.yaw = Math.PI;
  });
  const holds = [...HOLD_SPOTS.A, ...HOLD_SPOTS.B, ...HOLD_SPOTS.mid];
  vanta.forEach((bot, i) => {
    const spot = holds[i % holds.length];
    bots.resetBot(bot, vantaSpawns[i % vantaSpawns.length], spot);
    bot.yaw = 0;
    bot.state = 'hold';
    bot.holdUntil = elapsed + 9999;
    bot.objective = spot;
  });
}

function spawnAll() {
  if (bots.bots.length === 0) {
    for (let i = 0; i < 4; i += 1) bots.spawnBot('ember', i, SPAWNS.ember[(i + 1) % 5]);
    for (let i = 0; i < 5; i += 1) bots.spawnBot('vanta', i, SPAWNS.vanta[i % 5]);
  }
  placeBotsForRound();
  player.reset(SPAWNS.ember[0], 0);
  playerProxy.alive = true;
  // Loadout persists across rounds; only the ammunition is topped up.
  if (!owned.includes(weapon.state.id)) weapon.equip('pistol');
  weapon.refillAmmo();
  syncHud();
}

// Fresh match state: money and loadout reset only here and at boot.
function resetLoadout() {
  owned = ['pistol'];
  match.state.money = 800;
  weapon.equip('pistol');
  weapon.refillAmmo();
  weapon.state.grenades = 0;
}

function onPlay() {
  audio.unlock();
  if (shot) return;
  if (match.state.phase === 'matchEnd') {
    restartMatch();
    return;
  }
  input.requestLock();
}

function restartMatch() {
  match.state.round = 1;
  match.state.wins.ember = 0;
  match.state.wins.vanta = 0;
  match.state.matchWinner = null;
  match.state.kills = 0;
  match.state.deaths = 0;
  match.state.lastKillFeed = [];
  match.resetRound();
  resetLoadout();
  spawnAll();
  hud.hideOverlay();
  input.requestLock();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (match.state.phase === 'buy') {
      hud.showBuy(match.state.money, ownedWeapons());
      buyOpen = true;
    } else {
      hud.hideBuy();
      buyOpen = false;
    }
  } else if (match.state.phase !== 'matchEnd' && player.state.alive) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function buyItem(id) {
  if (match.state.phase !== 'buy' || shot) return;
  const money = match.state.money;
  if (id === 'grenade') {
    if (weapon.state.grenades >= 2 || money < GRENADE_PRICE) return;
    match.state.money -= GRENADE_PRICE;
    weapon.state.grenades += 1;
    audio.buy();
  } else {
    const def = WEAPONS[id];
    if (!def || owned.includes(id) || money < def.price) return;
    match.state.money -= def.price;
    owned.push(id);
    weapon.equip(id);
    audio.buy();
  }
  hud.setMoney(match.state.money);
  hud.setWeapon(weapon.def().name, weapon.state.grenades);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  if (buyOpen) hud.showBuy(match.state.money, ownedWeapons());
}

function syncHud() {
  hud.setHealth(player.state.health);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(weapon.def().name, weapon.state.grenades);
  hud.setMoney(match.state.money);
  hud.setScore(match.state.wins.ember, match.state.wins.vanta, match.state.round);
  hud.setAlive(1 + bots.aliveCount('ember'), bots.aliveCount('vanta'));
  hud.setKillfeed(match.state.lastKillFeed);
  hud.setTimer(match.state.phaseLeft);
  hud.setBombStatus('');
  hud.setSparkHint('');
}

function syncCamera() {
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - player.state.position.x;
  const dy = point.y - (player.state.position.y + player.state.eye);
  const dz = point.z - player.state.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

// Ray against the player's two hit boxes; returns 'head', 'body' or null.
function rayHitsPlayer(origin, dir, maxDist) {
  if (!player.state.alive) return null;
  const pos = player.state.position;
  const bodyBox = new THREE.Box3(
    new THREE.Vector3(pos.x - 0.36, pos.y, pos.z - 0.36),
    new THREE.Vector3(pos.x + 0.36, pos.y + 1.45, pos.z + 0.36),
  );
  const headBox = new THREE.Box3(
    new THREE.Vector3(pos.x - 0.2, pos.y + 1.45, pos.z - 0.2),
    new THREE.Vector3(pos.x + 0.2, pos.y + 1.8, pos.z + 0.2),
  );
  losRay.set(origin, dir);
  const headHit = losRay.intersectBox(headBox, tempVec);
  if (headHit && headHit.distanceTo(origin) <= maxDist) return 'head';
  const bodyHit = losRay.intersectBox(bodyBox, tempVec);
  if (bodyHit && bodyHit.distanceTo(origin) <= maxDist) return 'body';
  return null;
}

function hurtPlayer(amount, attackerName) {
  if (!player.state.alive) return;
  player.state.health -= amount;
  audio.hurt();
  hud.setHealth(player.state.health);
  if (player.state.health <= 0) {
    player.state.health = 0;
    player.state.alive = false;
    playerProxy.alive = false;
    match.state.deaths += 1;
    match.addKillFeed(`<b>${attackerName}</b> ▸ You`);
    hud.setKillfeed(match.state.lastKillFeed);
    hud.setAlive(bots.aliveCount('ember'), bots.aliveCount('vanta'));
    if (match.state.spark.state === 'carried' && match.state.spark.carrier === 'player') {
      match.dropSpark(player.state.position);
    }
    input.releaseLock();
    if (!shot) hud.showOverlay('dead');
  }
}

function onBotShot(bot, from, dir) {
  audio.shot('rifle', Math.min(1, from.distanceTo(camera.position) / 40));
  const hitPart = rayHitsPlayer(from, dir, 90);
  let end = tempVec.copy(from).addScaledVector(dir, 30).clone();
  if (hitPart) {
    const damage = hitPart === 'head' ? 22 : 13;
    hurtPlayer(damage, bot.name);
    end = tempVec.copy(from).addScaledVector(dir, from.distanceTo(camera.position)).clone();
  } else {
    // Check whether the bot's shot hit one of its own team's enemies.
    raycaster.set(from, dir);
    const hits = raycaster.intersectObjects(bots.shootables(), false);
    const first = hits[0];
    if (first && first.object.userData.bot && first.object.userData.bot.team !== bot.team) {
      const victim = first.object.userData.bot;
      const part = first.object.userData.botPart;
      const killed = bots.damage(victim, part === 'head' ? 51 : 17);      end = first.point.clone();
      if (killed) onBotKill(bot, victim);
    } else if (first) {
      end = first.point.clone();
    } else {
      const wall = raycaster.intersectObjects(world.shootables, false)[0];
      if (wall) end = wall.point.clone();
    }
  }
  bots.addTracer(from.clone(), end);
}

function onBotKill(killer, victim) {
  match.addKillFeed(`<b>${killer.name}</b> ▸ ${victim.name}`);
  hud.setKillfeed(match.state.lastKillFeed);
  hud.setAlive(1 + bots.aliveCount('ember'), bots.aliveCount('vanta'));
  checkRoundEnd();
}

function shootPlayer() {
  const def = weapon.def();
  if (!weapon.takeRound()) {
    audio.dryFire();
    return;
  }
  camera.getWorldDirection(direction);
  const speed = player.groundSpeed();
  const spread = weapon.spread(speed, player.state.crouching, player.state.aiming, player.state.onGround);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  audio.shot(def.kind, 0);
  // Hear the shot: nearby bots turn toward it.
  for (const bot of bots.bots) bots.hear(bot, player.state.position);
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const targets = world.shootables.concat(bots.shootables());
  const hit = raycaster.intersectObjects(targets, false)[0];
  const muzzle = new THREE.Vector3(0.32, -0.26, -1.15).applyMatrix4(camera.matrixWorld);
  let end = camera.position.clone().addScaledVector(direction, 40);
  if (hit) {
    end = hit.point.clone();
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const headshot = hit.object.userData.botPart === 'head';
      const damage = headshot ? def.headDamage : def.damage;
      const killed = bots.damage(bot, damage);
      hud.hitMarker(headshot);
      audio.hit(headshot);
      if (killed) {
        match.state.kills += 1;
        match.state.money += KILL_REWARD;
        match.addKillFeed(`<b>You</b> ▸ ${bot.name}${headshot ? ' (headshot)' : ''}`);
        hud.setKillfeed(match.state.lastKillFeed);
        hud.setMoney(match.state.money);
        hud.setAlive(1 + bots.aliveCount('ember'), bots.aliveCount('vanta'));
        checkRoundEnd();
      }
    }
  }
  bots.addTracer(muzzle, end);
  weapon.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
}

function throwGrenade() {
  if (weapon.state.grenades <= 0 || !player.state.alive) return;
  weapon.state.grenades -= 1;
  audio.grenadeThrow();
  hud.setWeapon(weapon.def().name, weapon.state.grenades);
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.castShadow = true;
  scene.add(mesh);
  const start = camera.position.clone();
  grenades.push({
    mesh,
    position: start,
    velocity: direction.clone().multiplyScalar(16).add(new THREE.Vector3(0, 3.5, 0)),
    fuse: 1.6,
  });
}

function explodeGrenade(grenade) {
  scene.remove(grenade.mesh);
  audio.explosion();
  const flash = new THREE.PointLight(0xffc46a, 60, 18, 1.5);
  flash.position.copy(grenade.position);
  scene.add(flash);
  window.setTimeout(() => scene.remove(flash), 180);
  const victims = [];
  if (player.state.alive) victims.push({ pos: player.state.position, isPlayer: true });
  for (const bot of bots.bots) if (bot.alive) victims.push({ pos: bot.position, bot });
  for (const victim of victims) {
    const dist = victim.pos.distanceTo(grenade.position);
    if (dist > 6.5) continue;
    let damage = Math.round(120 - (dist / 6.5) * 100);
    const eye = victim.isPlayer
      ? new THREE.Vector3(victim.pos.x, victim.pos.y + 1.4, victim.pos.z)
      : new THREE.Vector3(victim.pos.x, 1.4, victim.pos.z);
    if (!bots.hasLineOfSight(grenade.position.clone().add(new THREE.Vector3(0, 0.3, 0)), eye)) damage = Math.round(damage * 0.5);
    if (damage <= 0) continue;
    if (victim.isPlayer) hurtPlayer(damage, 'Spark Grenade');
    else {
      const killed = bots.damage(victim.bot, damage);
      if (killed) {
        match.state.kills += 1;
        match.state.money += KILL_REWARD;
        match.addKillFeed(`<b>You</b> ▸ ${victim.bot.name} (grenade)`);
        hud.setKillfeed(match.state.lastKillFeed);
        hud.setMoney(match.state.money);
        hud.setAlive(1 + bots.aliveCount('ember'), bots.aliveCount('vanta'));
      }
    }
  }
  checkRoundEnd();
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const grenade = grenades[i];
    grenade.fuse -= dt;
    grenade.velocity.y -= 18 * dt;
    grenade.position.addScaledVector(grenade.velocity, dt);
    // Bounce off colliders: reverse the offending axis with a damp.
    const box = new THREE.Box3(
      grenade.position.clone().add(new THREE.Vector3(-0.1, -0.1, -0.1)),
      grenade.position.clone().add(new THREE.Vector3(0.1, 0.1, 0.1)),
    );
    for (const c of world.colliders) {
      if (!box.intersectsBox(c)) continue;
      if (grenade.position.y < c.max.y && grenade.velocity.y < 0 && grenade.position.y > c.max.y - 0.3) {
        grenade.position.y = c.max.y + 0.1;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.45;
      } else if (grenade.velocity.x > 0 && grenade.position.x < c.min.x + 0.2) grenade.velocity.x *= -0.45;
      else if (grenade.velocity.x < 0 && grenade.position.x > c.max.x - 0.2) grenade.velocity.x *= -0.45;
      else if (grenade.velocity.z > 0 && grenade.position.z < c.min.z + 0.2) grenade.velocity.z *= -0.45;
      else if (grenade.velocity.z < 0 && grenade.position.z > c.max.z - 0.2) grenade.velocity.z *= -0.45;
    }
    if (grenade.position.y < 0.09) {
      grenade.position.y = 0.09;
      grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.45;
      grenade.velocity.x *= 0.7;
      grenade.velocity.z *= 0.7;
    }
    grenade.mesh.position.copy(grenade.position);
    if (grenade.fuse <= 0) {
      explodeGrenade(grenade);
      grenades.splice(i, 1);
    }
  }
}

function checkRoundEnd() {
  if (match.state.phase !== 'live') return;
  const emberAlive = (player.state.alive ? 1 : 0) + bots.aliveCount('ember');
  const vantaAlive = bots.aliveCount('vanta');
  if (vantaAlive === 0) endRound('ember', 'Vanta team eliminated');
  else if (emberAlive === 0 && match.state.spark.state !== 'planted') endRound('vanta', 'Ember team eliminated');
}

function endRound(winner, reason) {
  if (!match.endRound(winner, reason)) return;
  audio[`${winner === 'ember' ? 'roundWin' : 'roundLose'}`]();
  hud.hideBuy();
  buyOpen = false;
  hud.setProgress(null, 0);
  hud.setBombStatus('');
  hud.setSparkHint('');
  if (match.state.phase === 'matchEnd') {
    hud.setScore(match.state.wins.ember, match.state.wins.vanta, match.state.round);
    input.releaseLock();
    hud.showOverlay('matchEnd', { winner: match.state.matchWinner, ember: match.state.wins.ember, vanta: match.state.wins.vanta });
  } else {
    hud.showBanner(
      winner === 'ember' ? 'Ember wins the round' : 'Vanta wins the round',
      `${reason} — ${match.state.wins.ember} : ${match.state.wins.vanta}`,
    );
    bannerTimer = 4;
  }
}

// Assign objectives each round and whenever the Spark changes hands.
function assignBotObjectives() {
  const spark = match.state.spark;
  for (const bot of emberBots()) {
    if (!bot.alive || bot.channel) continue;
    if (spark.state === 'dropped' && bot.objective !== spark.position) {
      bot.path = world.route(bot.position, spark.position);
      bot.pathIndex = 0;
      bot.objective = spark.position;
      bot.state = 'route';
    } else if (spark.state === 'carried' && spark.carrier !== 'player' && spark.carrier !== bot.id) {
      // Follow the carrier toward a site.
      bot.objective = bot.objective ?? SITES.A.center;
    }
  }
  for (const bot of vantaBots()) {
    if (!bot.alive || bot.channel) continue;
    if (spark.state === 'planted' && spark.position) {
      if (bot.objective !== spark.position) {
        bot.path = world.route(bot.position, spark.position);
        bot.pathIndex = 0;
        bot.objective = spark.position;
        bot.state = 'route';
        bot.holdUntil = 0;
      }
    }
  }
}

function stepPlantDefuse(dt) {
  const spark = match.state.spark;
  const keys = input.state.keys;
  const planting = keys.has('KeyE') && player.state.alive && spark.state === 'carried' && spark.carrier === 'player';
  if (planting) {
    const site = match.siteAt(player.state.position);
    if (site) {
      spark.plantProgress += dt;
      hud.setProgress(`Planting the Spark at the ${SITES[site].name}…`, spark.plantProgress / PLANT_SECONDS);
      if (Math.floor(spark.plantProgress * 4) !== Math.floor((spark.plantProgress - dt) * 4)) audio.plantTick();
      if (spark.plantProgress >= PLANT_SECONDS) {
        match.plantSpark(site, player.state.position);
        match.state.money += PLANT_REWARD;
        hud.setMoney(match.state.money);
        hud.setProgress(null, 0);
        hud.setBombStatus(`SPARK PLANTED — ${SITES[site].name} · ${FUSE_SECONDS}s`);
        audio.beep(true);
      }
      return;
    }
  }
  if (spark.plantProgress > 0 && !planting) {
    spark.plantProgress = 0;
    hud.setProgress(null, 0);
  }

  // A Vanta bot next to the planted Spark defuses it.
  if (spark.state === 'planted' && spark.position) {
    for (const bot of vantaBots()) {
      if (!bot.alive || bot.channel) continue;
      if (bot.position.distanceTo(spark.position) < 1.8) {
        bot.channel = { kind: 'defuse', duration: DEFUSE_SECONDS };
        bot.channelProgress = 0;
      }
    }
  }
}

function onChannelDone(bot, kind) {
  if (kind === 'defuse' && match.state.spark.state === 'planted') {
    match.state.spark.state = 'defused';
    endRound('vanta', 'Spark defused');
  } else if (kind === 'plant' && match.state.spark.state === 'carried') {
    const site = match.siteAt(bot.position);
    if (site) {
      match.plantSpark(site, bot.position);
      hud.setBombStatus(`SPARK PLANTED — ${SITES[site].name} · ${FUSE_SECONDS}s`);
      audio.beep(true);
    }
  }
}

function step(dt) {
  elapsed += dt;
  const phase = match.state.phase;

  if (phase === 'buy') {
    match.state.phaseLeft -= dt;
    hud.setTimer(match.state.phaseLeft);
    if (buyOpen) hud.showBuy(match.state.money, ownedWeapons());
    if (match.state.phaseLeft <= 0) {
      match.startLive();
      hud.hideBuy();
      buyOpen = false;
      hud.setTimer(ROUND_SECONDS);
      hud.showBanner('Round ' + match.state.round, 'Plant the Spark or eliminate Vanta');
      bannerTimer = 2.5;
    }
  } else if (phase === 'live') {
    match.state.phaseLeft -= dt;
    hud.setTimer(match.state.phaseLeft);
    if (match.state.phaseLeft <= 0 && match.state.spark.state !== 'planted') {
      endRound('vanta', 'Time ran out');
    }
  } else if (phase === 'roundEnd') {
    bannerTimer -= dt;
    if (bannerTimer <= 0) {
      hud.hideBanner();
      match.nextRound();
      spawnAll();
      if (!shot) hud.showBuy(match.state.money, ownedWeapons());
      buyOpen = !shot;
    }
  }

  if (bannerTimer > 0 && phase !== 'roundEnd') bannerTimer -= dt;
  if (bannerTimer <= 0 && phase !== 'roundEnd') hud.hideBanner();

  // Fuse countdown and beeps once the Spark is planted.
  const spark = match.state.spark;
  if (spark.state === 'planted') {
    spark.fuseLeft -= dt;
    beepAccumulator += dt;
    const interval = spark.fuseLeft > 10 ? 1 : 0.4;
    if (beepAccumulator >= interval) {
      beepAccumulator = 0;
      audio.beep(spark.fuseLeft <= 5);
    }
    hud.setBombStatus(`SPARK PLANTED — ${SITES[spark.site].name} · ${Math.ceil(spark.fuseLeft)}s`);
    if (spark.fuseLeft <= 0) {
      spark.state = 'exploded';
      audio.explosion();
      endRound('ember', 'The Spark went off');
    }
  }

  // The player only moves and shoots while a round is live (or during buy, at spawn).
  const canAct = phase === 'live' || phase === 'buy';
  if (canAct) {
    player.step(dt, input.state.keys);
    if (input.takeKey('KeyR')) {
      if (weapon.reload()) audio.reload();
    }
    if (input.takeKey('KeyG')) throwGrenade();
    if (input.state.keys.has('KeyE')) stepPlantDefuse(dt);
    else if (spark.plantProgress > 0) {
      spark.plantProgress = 0;
      hud.setProgress(null, 0);
    }
  }

  // Spark pickup: walk over a dropped Spark to carry it.
  if (spark.state === 'dropped' && spark.position) {
    if (player.state.alive && player.state.position.distanceTo(spark.position) < 1.2) {
      match.pickUpSpark('player');
      hud.setSparkHint('');
    }
    for (const bot of emberBots()) {
      if (bot.alive && !bot.channel && bot.position.distanceTo(spark.position) < 1.2) {
        match.pickUpSpark(bot.id);
        bot.objective = SITES.A.center;
        bot.path = world.route(bot.position, SITES.A.center);
        bot.pathIndex = 0;
        bot.state = 'route';
        break;
      }
    }
  }

  // Hints about the Spark.
  if (phase === 'live' && player.state.alive) {
    if (spark.state === 'carried' && spark.carrier === 'player') {
      const site = match.siteAt(player.state.position);
      hud.setSparkHint(site ? 'Hold E to plant the Spark' : 'You carry the Spark — reach the Kiln or the Silo');
    } else if (spark.state === 'dropped' && spark.position) {
      hud.setSparkHint('The Spark is down — walk over it to pick it up');
    } else {
      hud.setSparkHint('');
    }
  }

  // Footsteps.
  const speed = player.groundSpeed();
  if (player.state.alive && speed > 0.5 && player.state.onGround) {
    stepDistance += speed * dt;
    if (stepDistance > 2.4) {
      stepDistance = 0;
      audio.step();
    }
  }

  // Bots move only once the round is live; during buy they hold at spawn.
  if (phase === 'live') {
    assignBotObjectives();
    const context = {
      enemiesOf(bot) {
        if (bot.team === 'ember') return vantaBots().filter((b) => b.alive);
        const foes = emberBots().filter((b) => b.alive);
        if (playerProxy.alive) foes.push(playerProxy);
        return foes;
      },
      onBotShot,
      onChannelDone,
    };
    for (const bot of bots.bots) bots.step(bot, dt, elapsed, context);
    // An Ember bot carrying the Spark plants it once it reaches its site.
    for (const bot of emberBots()) {
      if (!bot.alive || bot.channel) continue;
      if (spark.state === 'carried' && spark.carrier === bot.id) {
        const site = match.siteAt(bot.position);
        if (site && bot.position.distanceTo(SITES[site].center) < 2) {
          bot.channel = { kind: 'plant', duration: PLANT_SECONDS };
          bot.channelProgress = 0;
        }
      }
    }
  }

  stepGrenades(dt);
  bots.stepTracers();
  weapon.step(dt);
  hud.setSpread(weapon.spread(speed, player.state.crouching, player.state.aiming, player.state.onGround));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const def = weapon.def();
    const pressed = input.takePress();
    const wantFire = def.auto ? input.state.firing || pressed : pressed;
    const live = match.state.phase === 'live' && player.state.alive;
    if (wantFire && live && weapon.ready()) shootPlayer();
    else if (wantFire && live && weapon.state.mag === 0 && weapon.state.cooldown === 0) {
      if (weapon.reload()) audio.reload();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  spawnAll();
  match.resetRound();
  hud.hideOverlay();
  hud.hideBuy();
  buyOpen = false;
  if (name === 'start') {
    player.reset(SPAWNS.ember[0], 0);
    player.state.position.set(-2, 0, 13);
    player.state.yaw = -0.15;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -8));
    hud.setScore(0, 0, 1);
    hud.setTimer(BUY_SECONDS);
    hud.showOverlay('start');
    hud.setMoney(800);
  } else if (name === 'play') {
    match.startLive();
    placeBotsForRound();
    player.state.position.set(0, 0, 6);
    player.state.yaw = 0;
    settle(30);
    // Aim at the nearest Vanta bot and fire twice, so the frame shows combat.
    const foe = vantaBots().find((b) => b.alive);
    if (foe) {
      foe.position.set(2.5, 0, -3);
      foe.figure.group.position.copy(foe.position);
      aimAt(new THREE.Vector3(foe.position.x, 1.4, foe.position.z));
      shootPlayer();
      settle(6);
      shootPlayer();
      settle(6);
    }
    hud.setTimer(ROUND_SECONDS - 24);
    hud.setScore(1, 0, 2);
    hud.setAlive(5, 4);
    // Set the match state itself, so the final syncHud keeps these numbers.
    match.state.wins.ember = 1;
    match.state.round = 2;
    match.state.phaseLeft = ROUND_SECONDS - 24;
  } else {
    // end: a round just won, banner up, one bot down in the frame. Settle first
    // while the phase is still buy, so the round-end timer cannot advance.
    match.state.wins.ember = 3;
    match.state.wins.vanta = 2;
    match.state.round = 6;
    const foe = vantaBots()[0];
    bots.damage(foe, 500);
    player.state.position.set(-6, 0, 2);
    player.state.yaw = -0.5;
    settle(20);
    aimAt(new THREE.Vector3(-2, 1.2, -8));
    match.state.phase = 'roundEnd';
    match.state.phaseLeft = 0;
    bannerTimer = 999;
    hud.setScore(3, 2, 6);
    hud.setTimer(0);
    hud.showBanner('Ember wins the round', 'Vanta team eliminated — 3 : 2');
  }
  syncHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

resetLoadout();
spawnAll();
syncCamera();
// Read-only handle for automated play-testing; the game never reads it back.
window.__emberline = { player: player.state, match: match.state, weapon: weapon.state, bots: bots.bots, camera, scene };
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
