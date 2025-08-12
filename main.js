import * as THREE from 'https://unpkg.com/three@0.157.0/build/three.module.js';
import { Sky } from 'https://unpkg.com/three@0.157.0/examples/jsm/objects/Sky.js?module';

// --- Renderer & Scene ---
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xf4dfb5, 0.0085);

const sky = new Sky();
sky.scale.setScalar(45000);
scene.add(sky);

const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 10;
skyUniforms['rayleigh'].value = 2;
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.8;

const sunPos = new THREE.Vector3();
const phi = THREE.MathUtils.degToRad(88);
const theta = THREE.MathUtils.degToRad(-120);
sunPos.setFromSphericalCoords(1, phi, theta);
skyUniforms['sunPosition'].value.copy(sunPos);

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(sky).texture;
scene.environment = envTex;
scene.background = envTex;
pmrem.dispose();

// Lighting
const hemi = new THREE.HemisphereLight(0xfff4cf, 0x997a45, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.95);
sun.position.set(-40, 50, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(65, innerWidth/innerHeight, 0.1, 2000);
scene.add(camera);

// --- Helpers ---
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// --- Ground (infinite tiles) ---
const tileSize = 200; // each ground tile is 200x200
const tiles = [];
const TILE_GRID = 3; // 3x3 tiles around the player

function makeSandTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = 128;
  const ctx = cnv.getContext('2d');
  // base
  ctx.fillStyle = '#f2d9a6';
  ctx.fillRect(0,0,128,128);
  // noise
  for (let i=0;i<1500;i++){
    const x = Math.random()*128, y = Math.random()*128;
    const r = Math.random()*2+0.5;
    ctx.fillStyle = `rgba(150,120,70,${Math.random()*0.08})`;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8,8);
  return tex;
}
const sandTex = makeSandTexture();
const groundMat = new THREE.MeshStandardMaterial({ color: 0xf1d59b, map: sandTex, roughness: 0.95, metalness: 0 });
const groundGeo = new THREE.PlaneGeometry(tileSize, tileSize, 1, 1);

function createTiles() {
  for (let gx=-1; gx<=1; gx++){
    for (let gz=-1; gz<=1; gz++){
      const mesh = new THREE.Mesh(groundGeo, groundMat);
      mesh.rotation.x = -Math.PI/2;
      mesh.receiveShadow = true;
      scene.add(mesh);
      tiles.push({ mesh, gx, gz });
    }
  }
  positionTiles(0, 0);
}

function positionTiles(px, pz){
  // Center tiles around (px,pz) in tile space
  const baseGX = Math.round(px / tileSize);
  const baseGZ = Math.round(pz / tileSize);
  let i=0;
  for (let gx=-1; gx<=1; gx++){
    for (let gz=-1; gz<=1; gz++){
      const tile = tiles[i++];
      tile.mesh.position.set((baseGX+gx)*tileSize, 0, (baseGZ+gz)*tileSize);
    }
  }
}

// --- Player ---
const player = {
  root: new THREE.Object3D(),
  speed: 0,
  maxSpeed: 120,
  accel: 55,
  brakeDecel: 110,
  drag: 10,
  boost: 0,
  boostPower: 80,
  steering: 0,
  steerRate: 1.8, // radians/sec at full steer
  heading: 0,
  bboxRadius: 2.3,
  alive: true
};
scene.add(player.root);

function makeCar(){
  const grp = new THREE.Group();
  // body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 1.0, 6.0),
    new THREE.MeshStandardMaterial({ color: 0xcc3b3b, roughness: 0.4, metalness: 0.6 })
  );
  body.position.y = 1.2;
  body.castShadow = true; body.receiveShadow = true;
  grp.add(body);
  // canopy
  const canopy = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.2, 1.4, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.05, metalness: 1 })
  );
  canopy.position.set(0, 1.8, -0.6);
  canopy.rotation.x = Math.PI * 0.03;
  canopy.castShadow = true; grp.add(canopy);
  // fins
  const finGeo = new THREE.BoxGeometry(0.2, 1.0, 2.0);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x861f1f, roughness: 0.5, metalness: 0.3 });
  for (let s of [-1,1]){
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.set(1.9*s, 1.4, 1.0);
    fin.rotation.z = -s*0.2;
    fin.castShadow = true; grp.add(fin);
  }
  // subtle hover effect
  grp.userData.bobPhase = 0;
  return grp;
}

const car = makeCar();
player.root.add(car);

// --- Obstacles & Gates ---
const obstacles = []; // { mesh, radius }
const gates = []; // { mesh, z, passed }

function makeCactus(){
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a8f4a, roughness: 0.9 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 4, 6), mat);
  trunk.castShadow = true; trunk.receiveShadow = true; trunk.position.y = 2; g.add(trunk);
  for (let side of [-1,1]){
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.2, 6), mat);
    arm.position.set(0.7*side, 2.4, 0);
    arm.rotation.z = side*1.0;
    arm.castShadow = true; g.add(arm);
  }
  g.userData.radius = 1.4;
  return g;
}

function makeRock(){
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a6b46, roughness: 1 });
  const geo = new THREE.DodecahedronGeometry(rand(0.8, 1.8));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.radius = 1.0;
  return mesh;
}

function makeGate(){
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5, metalness: 0.1 });
  const postGeo = new THREE.CylinderGeometry(0.4, 0.4, 6, 8);
  const barGeo = new THREE.BoxGeometry(8, 0.4, 0.6);
  const p1 = new THREE.Mesh(postGeo, mat); p1.position.set(-4, 3, 0); p1.castShadow = true; g.add(p1);
  const p2 = new THREE.Mesh(postGeo, mat); p2.position.set( 4, 3, 0); p2.castShadow = true; g.add(p2);
  const bar = new THREE.Mesh(barGeo, mat); bar.position.set(0, 6, 0); bar.castShadow = true; g.add(bar);
  g.userData.radius = 4.5;
  return g;
}

const world = {
  nextSpawnZ: 40,
  trackHalfWidth: 12,
  finishGateCount: 6
};

function spawnChunk(untilZ){
  while (world.nextSpawnZ < untilZ){
    // Place obstacles
    for (let i=0;i<3;i++){
      const obj = Math.random() < 0.5 ? makeCactus() : makeRock();
      const x = rand(-world.trackHalfWidth, world.trackHalfWidth);
      const z = world.nextSpawnZ + rand(-10, 10);
      obj.position.set(x, 0, z);
      scene.add(obj);
      obstacles.push({ mesh: obj, radius: obj.userData.radius || 1.2 });
    }
    // Occasionally place a gate
    if (Math.random() < 0.25){
      const gate = makeGate();
      gate.position.set(0, 0, world.nextSpawnZ + rand(-5,5));
      scene.add(gate);
      gates.push({ mesh: gate, z: gate.position.z, passed: false });
    }
    world.nextSpawnZ += rand(24, 40);
  }
}

// Initial population
createTiles();
spawnChunk(400);

// --- Input ---
const input = { f:0, b:0, l:0, r:0, boost:0, paused:false };
const keys = new Set();
const onKey = (e, down) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') input.f = down?1: (keys.has('w')||keys.has('arrowup'))?1:0;
  if (k === 's' || k === 'arrowdown') input.b = down?1: (keys.has('s')||keys.has('arrowdown'))?1:0;
  if (k === 'a' || k === 'arrowleft') input.l = down?1: (keys.has('a')||keys.has('arrowleft'))?1:0;
  if (k === 'd' || k === 'arrowright') input.r = down?1: (keys.has('d')||keys.has('arrowright'))?1:0;
  if (k === ' ') input.boost = down?1:0;
  if (!down) keys.delete(k); else keys.add(k);
  if (k === 'p' && down){ input.paused = !input.paused; banner(input.paused? 'Paused' : ''); }
  if (k === 'r' && down){ reset(); }
};
addEventListener('keydown', e=>onKey(e,true));
addEventListener('keyup', e=>onKey(e,false));

// Mobile touch buttons
const btn = id => document.getElementById(id);
const bindHold = (el, on, off) => {
  let holding = false, tid;
  const start = (e)=>{ e.preventDefault(); if (holding) return; holding=true; on(); };
  const end = ()=>{ if (!holding) return; holding=false; off(); };
  el.addEventListener('touchstart', start, {passive:false});
  el.addEventListener('mousedown', start);
  ['mouseleave','mouseup','touchend','touchcancel'].forEach(evt=>el.addEventListener(evt, end));
};
bindHold(btn('left'), ()=>input.l=1, ()=>input.l=0);
bindHold(btn('right'), ()=>input.r=1, ()=>input.r=0);
bindHold(btn('throttle'), ()=>input.f=1, ()=>input.f=0);
bindHold(btn('brake'), ()=>input.b=1, ()=>input.b=0);

// --- HUD ---
const elSpeed = document.getElementById('speed');
const elTime = document.getElementById('time');
const elGates = document.getElementById('gates');
const elBanner = document.getElementById('banner');
const elFlash = document.getElementById('flash');
let startTime = null, finished = false;

function banner(text){ elBanner.textContent = text; }

function flash(){ elFlash.style.opacity = 1; setTimeout(()=>{ elFlash.style.opacity = 0; }, 120); }

// --- Update Loop ---
let last = performance.now();

function reset(){
  // remove old obstacles/gates
  for (const o of obstacles) scene.remove(o.mesh);
  obstacles.length = 0;
  for (const g of gates) scene.remove(g.mesh);
  gates.length = 0;
  // reset world
  world.nextSpawnZ = 40;
  spawnChunk(400);
  // reset player
  player.root.position.set(0, 0, 0);
  player.heading = 0; player.speed = 0; player.boost = 0; player.alive = true;
  // HUD
  startTime = null; finished = false; elGates.textContent = `0 / ${world.finishGateCount}`; banner('');
}

function update(dt){
  if (input.paused) return;

  // Start timer on first movement
  if (!startTime && (input.f||input.b)) startTime = performance.now();

  // Steering input
  const steerInput = input.r - input.l;
  player.steering = steerInput;

  // Acceleration/Braking/Drag
  const accel = input.f ? player.accel : 0;
  const brake = input.b ? player.brakeDecel : 0;
  const boost = input.boost ? player.boostPower : 0;
  player.speed += (accel - brake - player.drag*Math.sign(player.speed)) * dt;
  player.speed += boost * dt;
  player.speed = clamp(player.speed, 0, player.maxSpeed + 30);

  // Heading changes scale with speed
  const turn = player.steering * player.steerRate * (player.speed / (player.maxSpeed+1));
  player.heading -= turn * dt; // -Z forward visually nicer, but we're using +Z; choose sign for intuitive steering

  // Movement in XZ
  const vx = Math.sin(player.heading) * player.speed;
  const vz = Math.cos(player.heading) * player.speed;
  player.root.position.x += vx * dt;
  player.root.position.z += vz * dt;

  // Hover bob
  car.userData.bobPhase += dt * (4 + player.speed*0.05);
  const bob = Math.sin(car.userData.bobPhase) * 0.08;
  car.position.y = 1.2 + bob;
  player.root.rotation.y = player.heading;

  // Keep within a soft track width
  const off = player.root.position.x;
  if (Math.abs(off) > world.trackHalfWidth*1.4){
    player.speed *= 0.98; // sand slowdown
  }

  // Reposition tiles around player
  positionTiles(player.root.position.x, player.root.position.z);

  // Spawn more world ahead
  spawnChunk(player.root.position.z + 300);

  // Cull objects far behind to keep scene small
  const behindZ = player.root.position.z - 80;
  for (let i=obstacles.length-1;i>=0;i--){
    if (obstacles[i].mesh.position.z < behindZ){ scene.remove(obstacles[i].mesh); obstacles.splice(i,1); }
  }
  for (let i=gates.length-1;i>=0;i--){
    if (gates[i].mesh.position.z < behindZ){ scene.remove(gates[i].mesh); gates.splice(i,1); }
  }

  // Collisions with obstacles (simple sphere-distance)
  const px = player.root.position.x, pz = player.root.position.z;
  for (const o of obstacles){
    const dx = o.mesh.position.x - px;
    const dz = o.mesh.position.z - pz;
    const r = (o.radius || 1.2) + player.bboxRadius;
    if (dx*dx + dz*dz < r*r){
      player.speed *= 0.5; flash();
      // small knock sideways
      player.root.position.x += (dx>0? -0.8: 0.8);
    }
  }

  // Gates
  let passedCount = gates.filter(g=>g.passed).length;
  for (const g of gates){
    if (!g.passed){
      const dz = Math.abs(g.mesh.position.z - pz);
      const dx = Math.abs(g.mesh.position.x - px);
      if (dz < 6 && dx < 3.8){
        g.passed = true; g.mesh.children.forEach(m=>m.material.color.offsetHSL(0.35, -0.1, 0.1));
        passedCount++;
      }
    }
  }

  // Finish condition
  elGates.textContent = `${passedCount} / ${world.finishGateCount}`;
  if (!finished && passedCount >= world.finishGateCount){
    finished = true; banner('🏁 Finished! Press R to race again');
  }

  // Camera: smooth chase
  const target = new THREE.Vector3(px - Math.sin(player.heading)*12, 7 + Math.min(player.speed*0.02, 6), pz - Math.cos(player.heading)*12);
  const look = new THREE.Vector3(px, 1.7, pz + Math.cos(player.heading)*6);
  camera.position.lerp(target, 1 - Math.exp(-dt*3));
  camera.lookAt(look);

  // HUD update
  elSpeed.textContent = Math.round(player.speed).toString();
  if (startTime && !finished){ elTime.textContent = ((performance.now()-startTime)/1000).toFixed(2); }
}

function loop(){
  const now = performance.now();
  let dt = (now - last) / 1000; last = now;
  dt = Math.min(dt, 1/30); // clamp big frame gaps
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// Initial camera
camera.position.set(-8, 6, -10);
camera.lookAt(0,1.5,8);

// Handle resize
addEventListener('resize', ()=>{
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
});

// Little intro banner
banner('Drive through 6 gates to finish!');

loop();
