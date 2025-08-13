import * as THREE from 'https://unpkg.com/three@0.157.0/build/three.module.js';
import { Sky } from 'https://unpkg.com/three@0.157.0/examples/jsm/objects/Sky.js';

// Renderer
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('game'),
  antialias: true
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;

// Scene & Camera
const scene = new THREE.Scene();
const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);
scene.fog = new THREE.FogExp2(0xf6e6c1, 0.002);

const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 2000);
camera.position.set(0,5,-10);
scene.add(camera);

// Lights
const hemi = new THREE.HemisphereLight(0xfff5cf, 0x997a45, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
scene.add(sun);

const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 10;
skyUniforms['rayleigh'].value = 2;
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.8;
const sunPos = new THREE.Vector3();
function updateSun(){
  const phi = THREE.MathUtils.degToRad(90 - 10);
  const theta = THREE.MathUtils.degToRad(180);
  sunPos.setFromSphericalCoords(1, phi, theta);
  sky.material.uniforms['sunPosition'].value.copy(sunPos);
  sun.position.copy(sunPos).multiplyScalar(1000);
}
updateSun();

// Sand texture & ground
function makeSandTexture(){
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2d9a6';
  ctx.fillRect(0,0,256,256);
  for(let i=0;i<4000;i++){
    const x=Math.random()*256, y=Math.random()*256, r=Math.random()*2+0.5;
    ctx.fillStyle=`rgba(150,120,70,${Math.random()*0.05})`;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40,40);
  return tex;
}

function duneHeight(x,z){
  return Math.sin(x*0.02) * 3 + Math.sin(z*0.018) * 3;
}

const groundGeo = new THREE.PlaneGeometry(2000, 2000, 100, 100);
groundGeo.rotateX(-Math.PI/2);
const pos = groundGeo.attributes.position;
for(let i=0;i<pos.count;i++){
  const x = pos.getX(i);
  const z = pos.getZ(i);
  pos.setY(i, duneHeight(x, z));
}
groundGeo.computeVertexNormals();

const groundMat = new THREE.MeshStandardMaterial({color:0xf5d7a1,map:makeSandTexture()});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);

function addRock(x,z){
  const radius = Math.random()*1 + 0.5;
  const geo = new THREE.IcosahedronGeometry(radius,1);
  const mat = new THREE.MeshStandardMaterial({color:0x888888, flatShading:true});
  const rock = new THREE.Mesh(geo, mat);
  rock.castShadow = true;
  rock.position.set(x, duneHeight(x,z) + radius, z);
  scene.add(rock);
}
for(let i=0;i<30;i++){
  addRock((Math.random()-0.5)*500, (Math.random()-0.5)*500);
}

// Car
const car = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(2.2,0.8,4), new THREE.MeshStandardMaterial({color:0x2244aa,metalness:0.2,roughness:0.8}));
body.position.y = 1;
body.castShadow = true;
car.add(body);

function makeWheel(){
  const geo = new THREE.CylinderGeometry(0.5,0.5,0.4,16);
  const mat = new THREE.MeshStandardMaterial({color:0x111111,metalness:0.3,roughness:0.8});
  const wheel = new THREE.Mesh(geo, mat);
  wheel.rotation.z = Math.PI/2;
  wheel.castShadow = true;
  return wheel;
}

[[ -0.9,0.5,-1.5], [0.9,0.5,-1.5], [-0.9,0.5,1.5], [0.9,0.5,1.5]].forEach(p=>{const w=makeWheel(); w.position.set(...p); car.add(w);});
scene.add(car);

// Input
const input = {f:false,b:false,l:false,r:false};
const keyMap = {KeyW:'f',ArrowUp:'f',KeyS:'b',ArrowDown:'b',KeyA:'l',ArrowLeft:'l',KeyD:'r',ArrowRight:'r'};
addEventListener('keydown',e=>{const k=keyMap[e.code]; if(k) input[k]=true;});
addEventListener('keyup',e=>{const k=keyMap[e.code]; if(k) input[k]=false;});

// Movement
let speed = 0;
let heading = 0;

function update(dt){
  const accel = input.f ? 40 : 0;
  const brake = input.b ? 60 : 0;
  // drag proportional to speed
  speed += (accel - brake - 8*speed) * dt;
  speed = Math.max(0, Math.min(speed, 120));

  const steer = (input.l?1:0) - (input.r?1:0);
  heading -= steer * dt * (Math.PI/2) * (speed/120);

  const vx = Math.sin(heading)*speed*dt;
  const vz = Math.cos(heading)*speed*dt;
  car.position.x += vx;
  car.position.z += vz;
  car.rotation.y = heading;

  const target = new THREE.Vector3(
    car.position.x - Math.sin(heading)*8,
    car.position.y + 4,
    car.position.z - Math.cos(heading)*8
  );
  camera.position.lerp(target, 1 - Math.exp(-dt*3));
  camera.lookAt(car.position.x, car.position.y+1, car.position.z + Math.cos(heading)*2);

  document.getElementById('speed').textContent = Math.round(speed).toString();
}

// Resize
addEventListener('resize',()=>{
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
});

let last = performance.now();
function loop(){
  const now = performance.now();
  const dt = Math.min((now-last)/1000, 0.1);
  last = now;
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
