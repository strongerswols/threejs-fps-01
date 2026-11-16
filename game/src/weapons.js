// Weapons: three guns and a grenade, each with its own damage, fire rate, magazine,
// price and feel. Spread is a function of movement and stance, so stopping to aim pays:
// standing still is tight, walking is loose, firing while running is a spray. The view
// model is a small low-poly gun attached to the camera, with a muzzle flash and kick.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 26, headDamage: 78, magSize: 12, reserve: 48,
    fireGap: 0.16, reloadTime: 1.4, spreadStill: 0.003, spreadMove: 0.02, auto: false,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Longshot', kind: 'rifle', price: 2700,
    damage: 34, headDamage: 102, magSize: 30, reserve: 90,
    fireGap: 0.096, reloadTime: 2.1, spreadStill: 0.0022, spreadMove: 0.028, auto: true,
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', kind: 'smg', price: 1500,
    damage: 22, headDamage: 66, magSize: 32, reserve: 96,
    fireGap: 0.07, reloadTime: 1.7, spreadStill: 0.004, spreadMove: 0.03, auto: true,
  },
};

export const GRENADE_PRICE = 300;
const WALK_REFERENCE = 5.4;

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.wallDark), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x3a3f45), roughness: 0.45, metalness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  // One view model rebuilt per weapon: a receiver, a barrel, a stock and a sight.
  const model = new THREE.Group();
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(model);
  camera.add(flash);
  camera.add(flashLight);

  const state = {
    id: 'pistol', mag: 12, reserve: 48, cooldown: 0, reloadLeft: 0,
    flash: 0, kick: 0, grenades: 0,
  };

  function rebuildModel(def) {
    while (model.children.length) model.remove(model.children[0]);
    const long = def.kind === 'rifle';
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, long ? 0.46 : 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, long ? 0.42 : 0.26), grip);
    barrel.position.set(0, 0.025, long ? -0.42 : -0.3);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), accent);
    sight.position.set(0, 0.075, -0.08);
    model.add(receiver, barrel, stock, sight);
    // Small, pulled back and angled, so the gun sits in the lower-right corner
    // with its barrel pointing at the crosshair instead of filling the frame.
    model.position.set(0.32, -0.28, -0.9);
    model.rotation.y = 0.35;
    model.scale.setScalar(0.55);
    flash.position.set(0.32, -0.24, long ? -1.35 : -1.1);
  }
  rebuildModel(WEAPONS.pistol);

  function def() {
    return WEAPONS[state.id];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.9 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    const current = def();
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (current.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = current.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    def,
    equip(id) {
      if (!WEAPONS[id] || state.id === id) return false;
      state.id = id;
      const next = WEAPONS[id];
      state.mag = next.magSize;
      state.reserve = next.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      rebuildModel(next);
      return true;
    },
    refillAmmo() {
      const current = def();
      state.mag = current.magSize;
      state.reserve = current.reserve;
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const current = def();
      if (state.reloadLeft > 0 || state.mag === current.magSize || state.reserve === 0) return false;
      state.reloadLeft = current.reloadTime;
      return true;
    },
    // Spread grows with speed and crouching/aiming shrink it; air time is worst.
    spread(speed, crouching, aiming, onGround) {
      const current = def();
      let spread = current.spreadStill;
      spread += Math.min(1, speed / WALK_REFERENCE) * current.spreadMove;
      if (crouching) spread *= 0.7;
      if (aiming) spread *= 0.6;
      if (!onGround) spread *= 1.8;
      return spread;
    },
  };
}
