// Dustline Yard: an original industrial yard built for three lanes and two bomb sites.
// The yard is 46 by 36 metres. Ember spawns south, Vanta north. Site A, the Kiln, sits
// west; Site B, the Silo, sits east; Mid cuts between them with a covered bridge. Crates,
// containers and low walls make the corners and sightlines; every solid thing is both a
// mesh and a Box3 collider, and the waypoint graph below is how the bots move through it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HALF_X = 23;
const HALF_Z = 18;

// Waypoints the bots route over: spawns, lane junctions, site doors and hold spots.
const WAYPOINTS = [
  [-4, 14], [0, 14], [4, 14],           // Ember spawn
  [-8, 8], [0, 8], [8, 8],              // south lane
  [-14, 2], [-6, 2], [0, 2], [6, 2], [14, 2], // mid south
  [-18, -4], [-8, -4], [0, -4], [8, -4], [18, -4], // mid north
  [-16, -10], [-12, -12], [-18, -13],  // Site A (Kiln)
  [16, -10], [12, -12], [18, -13],     // Site B (Silo)
  [-4, -13], [4, -13],                  // Vanta spawn
  [0, -8],                              // bridge
  [-12, 6], [12, 6],                    // flank corners
];

export const SITES = {
  A: { name: 'Kiln', center: new THREE.Vector3(-16, 0, -11), half: 4.5 },
  B: { name: 'Silo', center: new THREE.Vector3(16, 0, -11), half: 4.5 },
};

export const SPAWNS = {
  ember: [
    new THREE.Vector3(-4, 0, 14), new THREE.Vector3(-1.5, 0, 15),
    new THREE.Vector3(1.5, 0, 15), new THREE.Vector3(4, 0, 14),
    new THREE.Vector3(0, 0, 12.5),
  ],
  vanta: [
    new THREE.Vector3(-4, 0, -13), new THREE.Vector3(-1.5, 0, -14),
    new THREE.Vector3(1.5, 0, -14), new THREE.Vector3(4, 0, -13),
    new THREE.Vector3(0, 0, -11.5),
  ],
};

// Hold spots: where Vanta bots wait when they defend a site.
export const HOLD_SPOTS = {
  A: [new THREE.Vector3(-18, 0, -13), new THREE.Vector3(-12.5, 0, -13.5), new THREE.Vector3(-8, 0, -4)],
  B: [new THREE.Vector3(18, 0, -13), new THREE.Vector3(12.5, 0, -13.5), new THREE.Vector3(8, 0, -4)],
  mid: [new THREE.Vector3(0, 0, -8), new THREE.Vector3(-6, 0, 2)],
};

function material(color, roughness = 0.85, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness });
}

export function createWorld(scene) {
  const colliders = [];
  const shootables = [];
  const group = new THREE.Group();
  scene.add(group);

  const mats = {
    ground: material(PALETTE.ground),
    groundDark: material(PALETTE.groundDark),
    wall: material(PALETTE.wall, 0.9, 0.02),
    wallDark: material(PALETTE.wallDark, 0.9, 0.02),
    containerA: material(PALETTE.containerA, 0.7, 0.25),
    containerB: material(PALETTE.containerB, 0.7, 0.25),
    containerC: material(PALETTE.containerC, 0.7, 0.25),
    crate: material(PALETTE.crate, 0.85, 0.05),
    hazard: material(PALETTE.hazard, 0.6, 0.1),
    accent: material(PALETTE.accent, 0.5, 0.3),
  };

  function box(x, y, z, w, h, d, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = h > 0.5;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      const box3 = new THREE.Box3(
        new THREE.Vector3(x - w / 2, y, z - d / 2),
        new THREE.Vector3(x + w / 2, y + h, z + d / 2),
      );
      colliders.push(box3);
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground: two slabs with a darker mid strip, plus a painted centre line.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const midStrip = new THREE.Mesh(new THREE.PlaneGeometry(10, HALF_Z * 2), mats.groundDark);
  midStrip.rotation.x = -Math.PI / 2;
  midStrip.position.set(0, 0.01, 0);
  midStrip.receiveShadow = true;
  group.add(midStrip);

  // Perimeter walls.
  box(0, 0, -HALF_Z - 0.5, HALF_X * 2 + 2, 4, 1, mats.wall);
  box(0, 0, HALF_Z + 0.5, HALF_X * 2 + 2, 4, 1, mats.wall);
  box(-HALF_X - 0.5, 0, 0, 1, 4, HALF_Z * 2 + 2, mats.wall);
  box(HALF_X + 0.5, 0, 0, 1, 4, HALF_Z * 2 + 2, mats.wallDark);

  // Site A — the Kiln: a round furnace drum and two low walls.
  const kiln = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.4, 18), mats.containerC);
  kiln.position.set(-19.5, 1.7, -14);
  kiln.castShadow = true;
  kiln.receiveShadow = true;
  group.add(kiln);
  colliders.push(new THREE.Box3(new THREE.Vector3(-21.7, 0, -16.2), new THREE.Vector3(-17.3, 3.4, -11.8)));
  shootables.push(kiln);
  box(-14, 0, -15.5, 6, 1.2, 0.6, mats.wallDark);
  box(-19.5, 0, -7.5, 0.6, 1.2, 4, mats.wallDark);

  // Site B — the Silo: a tall cylinder and a container.
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6.5, 18), mats.containerB);
  silo.position.set(19.5, 3.25, -14);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  colliders.push(new THREE.Box3(new THREE.Vector3(17.1, 0, -16.4), new THREE.Vector3(21.9, 6.5, -11.6)));
  shootables.push(silo);
  box(14, 0, -15.5, 6, 1.2, 0.6, mats.wallDark);
  box(19.5, 0, -7.5, 0.6, 1.2, 4, mats.wallDark);

  // Mid bridge: a covered walkway over the centre lane.
  box(0, 2.6, -4, 8, 0.4, 3, mats.wallDark);
  box(-4.2, 0, -4, 0.5, 3, 3, mats.wallDark);
  box(4.2, 0, -4, 0.5, 3, 3, mats.wallDark);

  // Shipping containers: the yard's big cover.
  box(-12, 0, 8, 6, 2.6, 2.4, mats.containerA);
  box(12, 0, 8, 6, 2.6, 2.4, mats.containerB);
  box(-12, 2.6, 8, 6, 2.6, 2.4, mats.containerC); // stacked
  box(6, 0, -10, 2.4, 2.6, 6, mats.containerB);
  box(-6, 0, -10, 2.4, 2.6, 6, mats.containerA);

  // Crates: low cover dotted along the lanes.
  const crates = [
    [-8, 4, 1.2, 1.2, 1.2], [8, 4, 1.2, 1.2, 1.2], [-2, 6, 1, 1, 1],
    [2, 6, 1, 1, 1], [-16, -2, 1.4, 1.4, 1.4], [16, -2, 1.4, 1.4, 1.4],
    [-4, -6, 1, 1, 1], [4, -6, 1, 1, 1], [0, 10, 1.6, 1.2, 1.6],
    [-18, 6, 1, 1, 1], [18, 6, 1, 1, 1], [-10, -8, 1.2, 1.2, 1.2],
    [10, -8, 1.2, 1.2, 1.2],
  ];
  for (const [x, z, w, h, d] of crates) box(x, 0, z, w, h, d, mats.crate);

  // Hazard stripes marking both sites, and a site marker post each.
  for (const site of Object.values(SITES)) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(site.half * 2, 0.5), mats.hazard);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(site.center.x, 0.02, site.center.z + site.half);
    group.add(stripe);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.3), mats.accent);
    post.position.set(site.center.x, 1.1, site.center.z - site.half);
    post.castShadow = true;
    group.add(post);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(site.center.x - 0.15, 0, site.center.z - site.half - 0.15),
      new THREE.Vector3(site.center.x + 0.15, 2.2, site.center.z - site.half + 0.15),
    ));
  }

  // Light: a low dusk sun and warm work lights over the sites and mid.
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.2);
  sun.position.set(18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 80;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8a97a8, 0x2a241c, 0.9));
  for (const [x, z] of [[-16, -11], [16, -11], [0, 0]]) {
    const lamp = new THREE.PointLight(0xffc46a, 22, 20, 1.6);
    lamp.position.set(x, 5.5, z);
    scene.add(lamp);
  }

  // Waypoint graph: nodes link when close enough and the straight 2D path clears every
  // collider taller than a step. Built once; bots run BFS over it.
  const nodes = WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const edges = nodes.map(() => []);
  function blocked2D(a, b) {
    for (const c of colliders) {
      if (c.max.y < 1.0) continue;
      // 2D segment vs expanded AABB, sampled — cheap and exact enough for routing.
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (x > c.min.x - 0.45 && x < c.max.x + 0.45 && z > c.min.z - 0.45 && z < c.max.z + 0.45) return true;
      }
    }
    return false;
  }
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dist = nodes[i].distanceTo(nodes[j]);
      if (dist < 11 && !blocked2D(nodes[i], nodes[j])) {
        edges[i].push(j);
        edges[j].push(i);
      }
    }
  }

  function nearestNode(point) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = nodes[i].distanceToSquared(point);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // BFS route between two nodes; returns an array of positions, start excluded.
  function route(fromPoint, toPoint) {
    const start = nearestNode(fromPoint);
    const goal = nearestNode(toPoint);
    if (start === goal) return [nodes[goal].clone()];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length) {
      const current = queue.shift();
      if (current === goal) break;
      for (const next of edges[current]) {
        if (prev[next] === -1) {
          prev[next] = current;
          queue.push(next);
        }
      }
    }
    if (prev[goal] === -1) return [nodes[goal].clone()];
    const path = [];
    let node = goal;
    while (node !== start) {
      path.unshift(nodes[node].clone());
      node = prev[node];
    }
    return path;
  }

  return { colliders, shootables, route, nearestNode, nodes, group };
}
