// Circuit Arena 3D test worlds: the car arena and the drone sky, lit by a real sky (HDRI) with scanned props.
// The game's own physics (S.w) moves the car and the drone; this file only draws them.
import * as THREE from './three.module.min.js';
import { GLTFLoader, RGBELoader, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, GroundedSkybox } from './three-addons.js';

const A = './arena/';
const cache = {};
// Every download gives up after a while, so a slow or broken connection never leaves the arena stuck on "Loading".
const timed = (p, ms = 25000) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
const loadTex = (url, srgb) => cache[url] || (cache[url] = new Promise(res => new THREE.TextureLoader().load(url, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; res(t); }, undefined, () => res(null))));
const loadGLB = name => cache[name] || (cache[name] = new Promise(res => new GLTFLoader().load(A + name + '.glb', g => {
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); res(g.scene); }, undefined, () => res(null))));
const loadHDR = () => cache.hdr || (cache.hdr = new Promise(res => new RGBELoader().load(A + 'sky.hdr', t => { t.mapping = THREE.EquirectangularReflectionMapping; res(t); }, undefined, () => res(null))));

// Fit a loaded model to a size (metres) and sit it on the ground.
function fitModel(src, size, mode = 'max') {
  const m = src.clone(true); const b = new THREE.Box3().setFromObject(m); const s = b.getSize(new THREE.Vector3());
  const k = mode === 'h' ? size / s.y : mode === 'x' ? size / s.x : size / Math.max(s.x, s.z);
  m.scale.setScalar(k); const b2 = new THREE.Box3().setFromObject(m); const c = b2.getCenter(new THREE.Vector3());
  m.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z)); const g = new THREE.Group(); g.add(m); return g;
}

const FONT = '"Oxanium","IBM Plex Sans",system-ui,sans-serif';
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const std = (color, rough = .5, metal = 0, x = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...x });
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
function rbox(w, h, d, r, mat) { // rounded box from an extruded rounded rectangle
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2; r = Math.min(r, w / 2, d / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: Math.min(.006, h / 4), bevelSize: Math.min(.006, h / 4), bevelSegments: 3, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); g.translate(0, 0, 0); return mesh(g, mat);
}

// ---------- materials ----------
const MAT = {};
const M = (k, f) => MAT[k] || (MAT[k] = f());
const carbonTex = () => M('carbonT', () => { const t = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#121416'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { const a = ((x + y) / 16) % 2; const gr = g.createLinearGradient(x, y, x + 16, y + 16);
    gr.addColorStop(0, a ? '#2a2e33' : '#1a1d20'); gr.addColorStop(1, a ? '#16181b' : '#2b2f34'); g.fillStyle = gr; g.fillRect(x, y, 16, 16); } }); t.repeat.set(3, 3); return t; });
const carbon = () => M('carbon', () => new THREE.MeshPhysicalMaterial({ map: carbonTex(), roughness: .35, metalness: .2, clearcoat: 1, clearcoatRoughness: .15 }));
const metal = () => M('metal', () => std(0xc7ccd1, .25, 1));
const dark = () => M('dark', () => std(0x1b1d20, .45, .3));
const rubber = () => M('rubber', () => std(0x141516, .92));
const yellowPl = () => M('yellow', () => std(0xf2b21b, .4));
const acrylic = () => M('acrylic', () => new THREE.MeshPhysicalMaterial({ color: 0xdfeef5, roughness: .08, transparent: true, opacity: .28, clearcoat: 1, depthWrite: false }));   // no transmission: it costs a render pass and breaks on some GPUs

function pcbTex(color, label, sub = '') {
  return canvasTex(512, 320, (g, w, h) => { g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 3; for (let i = 0; i < 22; i++) { g.beginPath(); g.moveTo(Math.random() * w, Math.random() * h); g.lineTo(Math.random() * w, Math.random() * h); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = `700 46px ${FONT}`; g.fillText(label, 30, h - 40); if (sub) { g.font = `600 22px ${FONT}`; g.fillText(sub, 32, h - 14); }
    g.fillStyle = '#d6b864'; for (const [x, y] of [[16, 16], [w - 16, 16], [16, h - 16], [w - 16, h - 16]]) { g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); } });
}

// ---------- the robot car, built from the parts on the bench ----------
function buildCar(S) {
  const has = t => S.parts.some(p => p.type === t);
  const car = new THREE.Group();
  const deck = rbox(.5, .006, .27, .03, acrylic()); deck.position.y = .085; car.add(deck);
  const deck2 = rbox(.46, .006, .25, .03, acrylic()); deck2.position.y = .14; car.add(deck2);
  for (const [x, z] of [[.2, .1], [.2, -.1], [-.2, .1], [-.2, -.1]]) car.add(mesh(new THREE.CylinderGeometry(.005, .005, .055, 10), metal(), x, .113, z)); // brass standoffs
  // gear motors + wheels; wheels are kept so they can spin
  const wheels = [];
  const tread = M('treadT', () => canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#18191a'; g.fillRect(0, 0, w, h); g.fillStyle = '#0d0e0f'; for (let x = 0; x < w; x += 12) g.fillRect(x, 0, 6, h); }));
  const tyreMat = M('tyre', () => std(0x1a1b1c, .9, 0, { map: tread, bumpMap: tread, bumpScale: .6 }));
  for (const [x, side] of [[.16, 1], [-.16, 1], [.16, -1], [-.16, -1]]) {
    car.add(mesh(new THREE.BoxGeometry(.07, .022, .05), yellowPl(), x, .06, side * .1));                       // TT motor gearbox
    car.add(mesh(new THREE.CylinderGeometry(.011, .011, .03, 16).rotateZ(Math.PI / 2), metal(), x - .03, .06, side * .1));
    const w = new THREE.Group(); w.position.set(x, .065, side * .165);
    const tyre = mesh(new THREE.CylinderGeometry(.065, .065, .028, 32).rotateX(Math.PI / 2), tyreMat); w.add(tyre);
    const hub = mesh(new THREE.CylinderGeometry(.04, .04, .03, 6).rotateX(Math.PI / 2), yellowPl()); w.add(hub);
    for (let i = 0; i < 3; i++) { const sp = mesh(new THREE.BoxGeometry(.075, .008, .031), yellowPl()); sp.rotation.z = i * Math.PI / 3; w.add(sp); }
    car.add(w); wheels.push({ w, side });
  }
  // battery pack under the top deck
  const bat = S.parts.find(p => p.type === 'battery'); const pre = bat && bat.props ? bat.props.preset : '9V';
  if (pre === '9V') { car.add(mesh(new THREE.BoxGeometry(.048, .026, .026), M('9v', () => new THREE.MeshStandardMaterial({ map: canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#1b1c1e'; g.fillRect(0, 0, w, h); g.fillStyle = '#d6b864'; g.fillRect(w * .62, 0, w, h); g.fillStyle = '#fff'; g.font = `800 28px ${FONT}`; g.fillText('9V', 12, 42); }), roughness: .4 })), -.12, .101, 0)); }
  else { const hold = mesh(new THREE.BoxGeometry(.08, .022, .044), dark(), -.12, .1, 0); car.add(hold);
    for (const z of [-.011, .011]) car.add(mesh(new THREE.CylinderGeometry(.009, .009, .066, 20).rotateZ(Math.PI / 2), M('cell', () => std(0x2e7bd6, .35, .2)), -.12, .113, z)); }
  // driver board
  if (has('driver')) { car.add(mesh(new THREE.BoxGeometry(.044, .003, .044), M('l298', () => std(0xb3262c, .5)), .02, .1, 0));
    const hs = new THREE.Group(); for (let i = 0; i < 7; i++) hs.add(mesh(new THREE.BoxGeometry(.003, .022, .022), M('hs', () => std(0x2a2d31, .4, .6)), -.009 + i * .003, .113, 0)); hs.position.x = .02; car.add(hs); }
  // the brain on top
  const brain = has('arduino') ? ['#00878f', 'ARDUINO', 'UNO'] : has('esp32') ? ['#1d2733', 'ESP32', 'DevKit'] : has('mcu') ? ['#1d5c3a', 'PROG IC', 'on breadboard'] : ['#00878f', 'ARDUINO', 'UNO'];
  const board = mesh(new THREE.BoxGeometry(.11, .003, .07), [std(0x0b5d63), std(0x0b5d63), new THREE.MeshStandardMaterial({ map: pcbTex(...brain), roughness: .5 }), std(0x0b5d63), std(0x0b5d63), std(0x0b5d63)], -.03, .148, 0); car.add(board);
  car.add(mesh(new THREE.BoxGeometry(.02, .012, .018), metal(), -.08, .155, -.02));
  car.add(mesh(new THREE.BoxGeometry(.03, .004, .016), M('chip', () => std(0x16181a, .4)), -.02, .152, .01));
  // ultrasonic "eyes" on the nose
  let eyes = null;
  if (has('ultrasonic')) { eyes = new THREE.Group(); eyes.position.set(.25, .11, 0);
    eyes.add(mesh(new THREE.BoxGeometry(.004, .022, .045), M('usb', () => std(0x1f5fbf, .5))));
    for (const z of [-.013, .013]) { eyes.add(mesh(new THREE.CylinderGeometry(.008, .008, .012, 24).rotateZ(Math.PI / 2), metal(), .008, 0, z)); }
    car.add(eyes); }
  // headlights and tail lights glow (bloom picks them up)
  const head = M('head', () => std(0xffffff, .2, 0, { emissive: 0xfff4d8, emissiveIntensity: 3 }));
  const tail = M('tail', () => std(0xff2a1a, .3, 0, { emissive: 0xff2a1a, emissiveIntensity: 2.5 }));
  for (const z of [-.09, .09]) { car.add(mesh(new THREE.SphereGeometry(.007, 12, 8), head, .25, .09, z)); car.add(mesh(new THREE.SphereGeometry(.007, 12, 8), tail, -.25, .09, z)); }
  // jumper wires between the decks for a hand-built look
  const cols = [0xd0362a, 0x1f2124, 0xe8b923, 0x2f8be0, 0x3fb950];
  for (let i = 0; i < 5; i++) { const a = new THREE.Vector3(-.03 + i * .012, .148, -.03), b = new THREE.Vector3(.02 + (i - 2) * .01, .1, .02 * (i - 2)), m = a.clone().lerp(b, .5).add(new THREE.Vector3(.04, .03, 0));
    car.add(mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, m, b), 12, .0022, 6), M('jw' + i, () => std(cols[i], .45)))); }
  car.userData = { wheels, eyes };
  return car;
}

// ---------- the quadcopter ----------
function buildDrone() {
  // A modern quad: tapered carbon arms, white/orange canopy, motor bells with red rings, curved two-blade props inside guard rings,
  // gimbal camera at the front, antennas and nav lights.
  const d = new THREE.Group();
  const R = .127;
  const armShape = new THREE.Shape(); armShape.moveTo(0, -.016); armShape.lineTo(R, -.009); armShape.quadraticCurveTo(R + .018, 0, R, .009); armShape.lineTo(0, .016); armShape.lineTo(0, -.016);
  const armGeo = new THREE.ExtrudeGeometry(armShape, { depth: .007, bevelEnabled: true, bevelThickness: .001, bevelSize: .001, bevelSegments: 1 }); armGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 4; i++) { const arm = mesh(armGeo, carbon()); arm.rotation.y = Math.PI / 4 + i * Math.PI / 2; arm.position.y = .03; d.add(arm); }
  const base = rbox(.12, .008, .09, .02, carbon()); base.position.y = .022; d.add(base);
  // canopy: a smooth shell over the electronics
  const shellM = M('shell', () => new THREE.MeshPhysicalMaterial({ color: 0xf4f5f6, roughness: .28, clearcoat: 1, clearcoatRoughness: .1 }));
  const shell = mesh(new THREE.SphereGeometry(.06, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), shellM, 0, .034, 0); shell.scale.set(1.25, .62, .92); d.add(shell);
  const stripe = mesh(new THREE.SphereGeometry(.0605, 40, 6, 0, Math.PI * 2, Math.PI * .3, Math.PI * .08), M('stripe', () => std(0xe3884b, .35, .1)), 0, .034, 0); stripe.scale.copy(shell.scale); d.add(stripe);
  const vent = mesh(new THREE.BoxGeometry(.03, .004, .05), dark(), -.045, .066, 0); d.add(vent);
  // battery slung underneath
  const bat = rbox(.08, .026, .038, .006, M('lipo', () => new THREE.MeshStandardMaterial({ map: canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#e8552a'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.fillRect(0, h * .62, w, h * .38);
    g.fillStyle = '#fff'; g.font = `800 40px ${FONT}`; g.fillText('3S 1500', 18, 62); }), roughness: .4 })));
  bat.position.y = -.008; d.add(bat); d.add(mesh(new THREE.BoxGeometry(.012, .03, .042), M('strap', () => std(0x111111, .8)), 0, .004, 0));
  // gimbal camera
  d.add(mesh(new THREE.BoxGeometry(.012, .016, .022), dark(), .07, .03, 0));
  const cam = mesh(new THREE.SphereGeometry(.014, 20, 14), M('camb', () => std(0x22252a, .3, .6)), .082, .026, 0); d.add(cam);
  d.add(mesh(new THREE.CylinderGeometry(.008, .009, .006, 24).rotateZ(Math.PI / 2), M('lens', () => std(0x0a0c18, .05, .8)), .095, .026, 0));
  d.add(mesh(new THREE.CircleGeometry(.0055, 20).rotateY(Math.PI / 2), M('glint', () => std(0x6fa8ff, .05, .2, { emissive: 0x1d3c80, emissiveIntensity: .6 })), .0985, .026, 0));
  // antennas
  for (const z of [-.03, .03]) { const a = mesh(new THREE.CylinderGeometry(.0015, .0015, .05, 6), dark(), -.07, .06, z); a.rotation.z = .6; d.add(a);
    d.add(mesh(new THREE.CylinderGeometry(.003, .003, .012, 8), M('ant', () => std(0xe3884b, .4)), -.084, .08, z)); }
  const props = [];
  const discMat = M('disc', () => new THREE.MeshBasicMaterial({ color: 0xc8d4e0, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide }));
  const guardM = M('guard', () => new THREE.MeshPhysicalMaterial({ color: 0x2a2e33, roughness: .35, clearcoat: .6 }));
  const bladeShape = new THREE.Shape(); bladeShape.moveTo(0, -.004); bladeShape.bezierCurveTo(.02, -.009, .05, -.008, .064, -.002); bladeShape.bezierCurveTo(.066, .002, .064, .004, .061, .005); bladeShape.bezierCurveTo(.045, .007, .02, .008, 0, .004);
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: .0015, bevelEnabled: false }); bladeGeo.rotateX(Math.PI / 2);
  [[1, 1, 0xf2f2f2], [1, -1, 0xf2f2f2], [-1, 1, 0x1f2124], [-1, -1, 0x1f2124]].forEach(([sx, sz, col], i) => {
    const x = sx * R * Math.SQRT1_2 * 1.414, z = sz * R * Math.SQRT1_2 * 1.414;
    d.add(mesh(new THREE.CylinderGeometry(.015, .017, .022, 28), M('motor', () => std(0x1a1c1f, .3, .9)), x, .045, z));
    const ring = mesh(new THREE.TorusGeometry(.0158, .0025, 8, 28), M('mring', () => std(0xc0392b, .3, .8)), x, .052, z); ring.rotation.x = Math.PI / 2; d.add(ring);
    d.add(mesh(new THREE.CylinderGeometry(.009, .009, .006, 20), M('bell', () => std(0x9aa3ab, .2, 1)), x, .058, z));
    // prop guard ring with two struts to the arm
    const guard = mesh(new THREE.TorusGeometry(.072, .0035, 8, 48), guardM, x, .055, z); guard.rotation.x = Math.PI / 2; d.add(guard);
    const p = new THREE.Group(); p.position.set(x, .063, z);
    const blade = M('blade' + col, () => new THREE.MeshPhysicalMaterial({ color: col, roughness: .3, transparent: true, opacity: .95, clearcoat: .8, side: THREE.DoubleSide }));
    for (const r of [0, Math.PI]) { const b = mesh(bladeGeo, blade); b.rotation.set(0, r, (i % 2 ? 1 : -1) * .2 * (r ? -1 : 1)); p.add(b); }
    p.add(mesh(new THREE.CylinderGeometry(.006, .007, .008, 16), M('nut', () => std(0xc0392b, .3, .8))));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(.066, 40).rotateX(-Math.PI / 2), discMat); disc.visible = false; p.add(disc);
    d.add(p); props.push({ p, disc, dir: i === 0 || i === 3 ? 1 : -1 });
  });
  // navigation LEDs under the motors: green front, red back
  for (const [x, z, c] of [[R, R, 0x30ff70], [R, -R, 0x30ff70], [-R, R, 0xff2a1a], [-R, -R, 0xff2a1a]])
    d.add(mesh(new THREE.SphereGeometry(.0065, 10, 8), M('nav' + c, () => std(c, .3, 0, { emissive: c, emissiveIntensity: 4 })), x, .03, z));
  // landing legs
  for (const z of [-.05, .05]) { d.add(mesh(new THREE.CylinderGeometry(.004, .004, .15, 8).rotateZ(Math.PI / 2), M('skid', () => std(0xe9ecef, .4)), 0, -.03, z));
    for (const x of [-.045, .045]) { const l = mesh(new THREE.CylinderGeometry(.003, .003, .05, 8), dark(), x, -.008, z * .8); l.rotation.x = z > 0 ? -.35 : .35; d.add(l); } }
  d.children.forEach(c => { c.position.y += .035; });   // the skids rest on the ground
  d.userData = { props };
  return d;
}

function paintTex(W, D, max = 2048) {
  // arena floor markings: border lines, start box, centre logo
  return canvasTex(max, Math.round(max * D / W), (g, w, h) => {
    g.clearRect(0, 0, w, h); const px = w / W;
    g.strokeStyle = 'rgba(245,245,240,.92)'; g.lineWidth = .06 * px; g.strokeRect(.12 * px, .12 * px, w - .24 * px, h - .24 * px);
    g.setLineDash([.4 * px, .3 * px]); g.lineWidth = .04 * px; g.beginPath(); g.moveTo(w / 2, .3 * px); g.lineTo(w / 2, h - .3 * px); g.stroke(); g.setLineDash([]);
    g.strokeStyle = 'rgba(242,178,27,.85)'; g.lineWidth = .05 * px; g.strokeRect(.3 * px, h / 2 - .55 * px, 1.1 * px, 1.1 * px);
    g.fillStyle = 'rgba(242,178,27,.8)'; g.font = `800 ${.26 * px}px ${FONT}`; g.textAlign = 'center'; g.fillText('START', .85 * px, h / 2 + .1 * px);
    for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? 'rgba(245,245,240,.9)' : 'rgba(20,20,20,.85)'; g.fillRect(w - 1.2 * px, (.3 + i * .26) * px, .26 * px, .26 * px); g.fillStyle = i % 2 ? 'rgba(20,20,20,.85)' : 'rgba(245,245,240,.9)'; g.fillRect(w - .94 * px, (.3 + i * .26) * px, .26 * px, .26 * px); }
    g.fillStyle = 'rgba(245,245,240,.16)'; g.font = `800 ${.55 * px}px ${FONT}`; g.fillText('CIRCUIT ARENA', w / 2, h / 2 + .2 * px);
  });
}

// A wide grass field that fades out at its rim into the sky photo's ground.
function grassField(gd, gn, R, y) {
  for (const tx of [gd, gn]) if (tx) tx.repeat.set(R / 1.4, R / 1.4);
  const fade = canvasTex(256, 256, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, w * .34, w / 2, h / 2, w / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  fade.colorSpace = THREE.NoColorSpace;
  const field = mesh(new THREE.CircleGeometry(R, 128).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: gd, normalMap: gn, roughness: .95, alphaMap: fade, transparent: true }));
  field.castShadow = false; field.position.y = y; field.renderOrder = -1; return field;
}

export function open(container, api) {
  const { S } = api;
  const mobile = matchMedia('(pointer:coarse)').matches;
  let quality = api.quality || (mobile ? 'medium' : 'high');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.75 : 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = quality !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9cb6cc);
  const camera = new THREE.PerspectiveCamera(48, 1, .05, 400);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.castShadow = true; sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  sun.shadow.bias = -.0003; sun.shadow.normalBias = .02; scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x4a4030, .35); scene.add(hemi);

  let composer = null, bloom = null;
  function setupPost() {
    if (quality === 'low') { composer = null; return; }
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 === false ? 0 : 4 });   // MSAA: the composer otherwise loses the renderer's antialiasing
    composer = new EffectComposer(renderer, rt); composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .3, .4, .95); composer.addPass(bloom); composer.addPass(new OutputPass());
  }
  setupPost();

  // ---------- HUD ----------
  const hud = document.createElement('div'); hud.className = 'w3d-hud';
  hud.innerHTML = `<div class="w3d-stats"></div><div class="w3d-big"></div><div class="w3d-load">Loading the 3D arena…</div>
    <div class="w3d-bar"><button data-c="chase" aria-pressed="true">Chase</button><button data-c="orbit">Orbit</button><button data-c="top">Top</button><button data-c="q">${quality === 'high' ? 'HD' : quality === 'medium' ? 'SD' : 'Low'}</button><button data-c="2d">2D</button><button data-c="full" aria-label="Full screen">⛶</button></div>`;
  container.appendChild(hud);
  const stats = hud.querySelector('.w3d-stats'), big = hud.querySelector('.w3d-big'), loadEl = hud.querySelector('.w3d-load');
  let camMode = 'chase';
  hud.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c;
    if (c === '2d') { api.onExit && api.onExit(); return; }
    if (c === 'full') { const on = !container.classList.contains('full'); container.classList.toggle('full', on); b.setAttribute('aria-pressed', on); return; }
    if (c === 'q') { quality = quality === 'high' ? 'medium' : quality === 'medium' ? 'low' : 'high'; b.textContent = quality === 'high' ? 'HD' : quality === 'medium' ? 'SD' : 'Low';
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.75 : 1)); renderer.shadowMap.enabled = quality !== 'low'; setupPost(); resize(); api.onQuality && api.onQuality(quality); return; }
    camMode = c; hud.querySelectorAll('[data-c=chase],[data-c=orbit],[data-c=top]').forEach(x => x.setAttribute('aria-pressed', x.dataset.c === c)); });

  // ---------- world contents ----------
  const world = new THREE.Group(); scene.add(world);
  let type = null, car = null, drone = null, sky = null, ready = false, beam = null, dust = null, carKey = '';
  // the game's arena is in centimetres with the origin at a corner; the 3D world is in metres centred on the arena
  const AR = api.ARENA || { w: 960, h: 320 }, ARENA_W = AR.w / 100, ARENA_D = AR.h / 100;
  const toX = x => (x - AR.w / 2) / 100, toZ = y => (y - AR.h / 2) / 100;
  let ramps3 = [], cones3 = [], boostMat = null, gates3 = [];

  async function buildScene(t) {
    world.clear(); car = drone = beam = dust = null; ready = false; ramps3 = []; cones3 = []; gates3 = []; boostMat = null; loadEl.style.display = '';
    THREE.DefaultLoadingManager.onProgress = (u, done, total) => { loadEl.textContent = `Loading the 3D arena… ${Math.round(done / Math.max(1, total) * 100)}%`; };
    const [hdr, crate, tyre, barrier, box, lamp, shrub, pcrate] = await Promise.all([timed(loadHDR(), 40000), timed(loadGLB('wooden_crate_01')), timed(loadGLB('old_tyre')), timed(loadGLB('concrete_road_barrier')),
      timed(loadGLB('cardboard_box_01')), timed(loadGLB('street_lamp_01')), timed(loadGLB('shrub_01')), timed(loadGLB('plastic_crate_01'))]);
    if (type !== t) return;
    if (!hdr) { scene.background = new THREE.Color(0x9cb6cc); hemi.intensity = 1.1; }
    if (hdr) { scene.environment = hdr; scene.environmentIntensity = .9;
      if (sky) scene.remove(sky); sky = new GroundedSkybox(hdr, 12, 160); sky.position.y = 12 - .01; scene.add(sky); scene.background = null; }
    sun.position.set(-18, 26, 12); sun.target.position.set(0, 0, 0);
    if (t === 'car') {
      const [ad, an, ar] = await Promise.all([timed(loadTex(A + 'asphalt_track_diffuse.webp', true)), timed(loadTex(A + 'asphalt_track_nor_gl.webp')), timed(loadTex(A + 'asphalt_track_rough.webp'))]);
      const PW = ARENA_W + 3, PD = ARENA_D + 3;
      for (const tx of [ad, an, ar]) if (tx) tx.repeat.set(PW / 2.5, PD / 2.5);
      const pad = mesh(new THREE.PlaneGeometry(PW, PD).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ad, normalMap: an, roughnessMap: ar, roughness: 1 }));
      pad.castShadow = false; world.add(pad);
      const [gd, gn] = await Promise.all([timed(loadTex(A + 'grass_path_2_diffuse.webp', true)), timed(loadTex(A + 'grass_path_2_nor_gl.webp'))]);
      world.add(grassField(gd, gn, 60, -.01));
      const paint = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: paintTex(ARENA_W, ARENA_D, Math.min(4096, renderer.capabilities.maxTextureSize)), transparent: true, roughness: .8, polygonOffset: true, polygonOffsetFactor: -2 }));
      paint.position.y = .004; paint.receiveShadow = true; world.add(paint);
      // walls: concrete barriers all round
      if (barrier) { const L = .8; const b0 = fitModel(barrier, L, 'x');
        const put = (x, z, ry) => { const b = b0.clone(); b.scale.multiplyScalar(1); b.position.set(x, 0, z); b.rotation.y = ry; world.add(b); };
        for (let x = -ARENA_W / 2 + L / 2; x < ARENA_W / 2; x += L) { put(x, -ARENA_D / 2 - .18, 0); put(x, ARENA_D / 2 + .18, Math.PI); }
        for (let z = -ARENA_D / 2 + L / 2; z < ARENA_D / 2; z += L) { put(-ARENA_W / 2 - .18, z, Math.PI / 2); put(ARENA_W / 2 + .18, z, -Math.PI / 2); } }
      // obstacles: fill each block of the 2D arena with real objects
      const OB = api.OBST || [];
      const kinds = [crate, tyre, box, pcrate];
      OB.forEach(([x, y, w, h], i) => { const src = kinds[i % kinds.length] || crate; if (!src) return;
        const W = w / 100, D = h / 100, cx = toX(x + w / 2), cz = toZ(y + h / 2); const along = D > W ? 'z' : 'x'; const cross = Math.min(W, D), len = Math.max(W, D);
        const n = Math.max(1, Math.round(len / cross)); const step = len / n;
        for (let k = 0; k < n; k++) { const off = -len / 2 + step * (k + .5);
          const m = fitModel(src, Math.min(cross, step) * .98); m.position.set(cx + (along === 'x' ? off : 0), 0, cz + (along === 'z' ? off : 0)); m.rotation.y = (k * 1.7 + i) % .5 - .25; world.add(m);
          if (src === tyre && k % 2 === 0) { const t2 = fitModel(src, Math.min(cross, step) * .9); t2.position.copy(m.position); t2.position.y = new THREE.Box3().setFromObject(m).max.y; t2.rotation.y = .6; world.add(t2); } } });
      // decoration outside the walls
      const hw = ARENA_W / 2, hd = ARENA_D / 2;
      if (lamp) for (const [x, z] of [[-hw - 1.2, -hd - 1], [hw + 1.2, hd + 1], [-hw - 1.2, hd + 1], [hw + 1.2, -hd - 1], [0, -hd - 1.2], [0, hd + 1.2]]) { const l = fitModel(lamp, 4.2, 'h'); l.position.set(x, 0, z); world.add(l); }
      if (shrub) for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, sh = fitModel(shrub, 1 + (i % 3) * .3); sh.position.set(Math.cos(a) * (hw + 3.5), 0, Math.sin(a) * (hd + 3)); sh.rotation.y = i; world.add(sh); }
      if (tyre) for (const [x, z] of [[hw + 2, hd - 1], [-hw - 2.2, -hd + 2]]) { const t3 = fitModel(tyre, .7); t3.position.set(x, 0, z); world.add(t3); }
      // ramps: a yellow-and-black striped plank on dark side frames, rising towards the lip
      const chev = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#f2b21b'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181a'; for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64 + 32, 0); g.lineTo(i * 64 + 96, h); g.lineTo(i * 64 + 64, h); g.fill(); } });
      const RH = (api.RAMP_H || 32) / 100;
      ramps3 = (api.RAMPS || []).map(([x, y, L, Wd, d]) => { const al = Math.abs(Math.cos(d)) > .5, gw = al ? L : Wd, gh = al ? Wd : L;
        const grp = new THREE.Group(); grp.position.set(toX(x + gw / 2), 0, toZ(y + gh / 2)); grp.rotation.y = -d; world.add(grp);
        const len = Math.hypot(L / 100, RH), ang = Math.atan2(RH, L / 100);
        const plank = mesh(new THREE.BoxGeometry(len, .03, Wd / 100), [M('rampside', () => std(0x26292c, .6)), M('rampside', () => std(0x26292c, .6)), new THREE.MeshStandardMaterial({ map: chev, roughness: .6 }), M('rampside', () => std(0x26292c, .6)), M('rampside', () => std(0x26292c, .6)), M('rampside', () => std(0x26292c, .6))]);
        plank.rotation.z = ang; plank.position.set(0, RH / 2, 0); grp.add(plank);
        for (const sz of [-1, 1]) { const sh = new THREE.Shape(); sh.moveTo(-L / 200, 0); sh.lineTo(L / 200, 0); sh.lineTo(L / 200, RH - .01); sh.lineTo(-L / 200, 0);
          const side = mesh(new THREE.ExtrudeGeometry(sh, { depth: .03, bevelEnabled: false }), M('rampframe', () => std(0x3a3f44, .5, .4))); side.position.z = sz * (Wd / 200) - (sz > 0 ? .03 : 0); grp.add(side); }
        return grp; });
      // boost pads: glowing cyan arrows that slide along
      const btex = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#062a33'; g.fillRect(0, 0, w, h); g.fillStyle = '#20d8ff'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * 64 + 10, 14); g.lineTo(i * 64 + 40, h / 2); g.lineTo(i * 64 + 10, h - 14); g.lineTo(i * 64 + 26, h - 14); g.lineTo(i * 64 + 56, h / 2); g.lineTo(i * 64 + 26, 14); g.fill(); } });
      btex.wrapS = THREE.RepeatWrapping; boostMat = new THREE.MeshStandardMaterial({ map: btex, emissiveMap: btex, emissive: 0xffffff, emissiveIntensity: 1.3, roughness: .4 });
      (api.BOOST || []).forEach(([x, y, w2, h2]) => { const b = mesh(new THREE.PlaneGeometry(w2 / 100, h2 / 100).rotateX(-Math.PI / 2), boostMat); b.position.set(toX(x + w2 / 2), .006, toZ(y + h2 / 2)); b.receiveShadow = true; world.add(b); });
      // traffic cones for the slalom; knocked ones fall over
      const coneM = M('cone', () => new THREE.MeshStandardMaterial({ map: canvasTex(64, 128, (g, w, h) => { g.fillStyle = '#f26a1b'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4f4f0'; g.fillRect(0, h * .35, w, h * .14); g.fillRect(0, h * .62, w, h * .1); }), roughness: .55 }));
      cones3 = (api.CONES || []).map(([x, y]) => { const c = new THREE.Group(); c.position.set(toX(x), 0, toZ(y)); world.add(c);
        c.add(mesh(new THREE.BoxGeometry(.2, .02, .2), M('conebase', () => std(0x1d1f22, .7)), 0, .01, 0)); c.add(mesh(new THREE.ConeGeometry(.075, .3, 24, 1, true), coneM, 0, .17, 0)); return c; });
      car = buildCar(S); carKey = partsKey(); world.add(car);
      beam = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, 1, 8).rotateZ(Math.PI / 2).translate(.5, 0, 0), new THREE.MeshBasicMaterial({ color: 0x5cd6ff, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }));
      world.add(beam);
      dust = makeDust(); world.add(dust.points);
    } else {
      const [gd, gn] = await Promise.all([timed(loadTex(A + 'grass_path_2_diffuse.webp', true)), timed(loadTex(A + 'grass_path_2_nor_gl.webp'))]);
      world.add(grassField(gd, gn, 60, .003));
      const pad = mesh(new THREE.CylinderGeometry(.75, .75, .02, 48), new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#2b3036'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f2b21b'; g.lineWidth = 18; g.beginPath(); g.arc(w / 2, h / 2, w * .4, 0, 7); g.stroke();
        g.fillStyle = '#f4f4f0'; g.font = `900 220px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', w / 2, h / 2 + 10); }), roughness: .7 }));
      pad.castShadow = false; world.add(pad);
      if (crate) for (const [x, z] of [[2.2, -1.4], [2.7, -1.0]]) { const c = fitModel(crate, .55); c.position.set(x, 0, z); c.rotation.y = x; world.add(c); }
      if (box) { const b = fitModel(box, .45); b.position.set(-2.1, 0, 1.6); world.add(b); }
      if (lamp) { const l = fitModel(lamp, 4.2, 'h'); l.position.set(-3.4, 0, -2.6); world.add(l); }
      if (shrub) for (const [x, z, s] of [[-4.5, 3, 1.4], [5.5, 2.5, 1.6], [4.2, -4.4, 1.2], [-6, -2, 1.8], [7, -1, 1.2]]) { const sh = fitModel(shrub, s); sh.position.set(x, 0, z); world.add(sh); }
      if (shrub) for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2 + .3, r = 22 + (i % 4) * 5, sh = fitModel(shrub, 1.4 + (i % 3) * .5); sh.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); sh.rotation.y = i; world.add(sh); }
      // race gates: glowing rings on posts; the next one to fly through glows orange
      gates3 = (api.GATES || []).map(([gx, gz, gy, gr], i) => { const g = new THREE.Group(); g.position.set(gx, 0, gz); g.rotation.y = gr; world.add(g);
        const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fe8ff, emissiveIntensity: .5, roughness: .35, metalness: .2 });
        const ring = mesh(new THREE.TorusGeometry(1, .07, 12, 48), m, 0, gy, 0); g.add(ring);
        g.add(mesh(new THREE.CylinderGeometry(.05, .06, gy - 1, 10), M('gatepost', () => std(0x2a2e33, .5, .5)), 0, (gy - 1) / 2, 0));
        g.add(mesh(new THREE.PlaneGeometry(.5, .3), new THREE.MeshBasicMaterial({ map: canvasTex(128, 76, (c, w2, h2) => { c.fillStyle = '#16181a'; c.fillRect(0, 0, w2, h2); c.fillStyle = '#fff'; c.font = `800 54px ${FONT}`; c.textAlign = 'center'; c.fillText(String(i + 1), w2 / 2, 58); }), side: THREE.DoubleSide }), 0, gy + 1.3, 0));
        g.userData.m = m; return g; });
      drone = buildDrone(); drone.scale.setScalar(2.4); world.add(drone);
      dust = makeDust(); world.add(dust.points);
    }
    const sc = sun.shadow.camera; const r = t === 'car' ? 7.5 : 6; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = 80; sc.updateProjectionMatrix();
    loadEl.style.display = 'none'; ready = true;
  }
  const partsKey = () => S.parts.map(p => p.type).sort().join(',');

  function makeDust() {
    const N = 120, pos = new Float32Array(N * 3), life = new Float32Array(N), vel = [];
    for (let i = 0; i < N; i++) { pos[i * 3 + 1] = -10; vel.push(new THREE.Vector3()); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const tex = canvasTex(64, 64, (c, w, h) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(200,190,170,.9)'); gr.addColorStop(1, 'rgba(200,190,170,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
    const points = new THREE.Points(g, new THREE.PointsMaterial({ map: tex, size: .14, transparent: true, depthWrite: false, opacity: .55 }));
    let next = 0;
    return { points, emit(p, v) { const i = next++ % N; pos.set([p.x + (Math.random() - .5) * .05, p.y, p.z + (Math.random() - .5) * .05], i * 3); vel[i].copy(v); life[i] = 1; },
      step(dt) { for (let i = 0; i < N; i++) { if (life[i] <= 0) continue; life[i] -= dt * .9; pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt; vel[i].multiplyScalar(.96); if (life[i] <= 0) pos[i * 3 + 1] = -10; }
        g.attributes.position.needsUpdate = true; } };
  }

  // ---------- camera: chase, orbit (drag) and top ----------
  const orbit = { theta: -.9, phi: 1.05, r: 3.2 }; const ptrs = new Map(); let pinch = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (camMode !== 'orbit') { camMode = 'orbit'; hud.querySelectorAll('[data-c=chase],[data-c=orbit],[data-c=top]').forEach(x => x.setAttribute('aria-pressed', x.dataset.c === 'orbit')); } });
  el.addEventListener('pointermove', e => { const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) { orbit.theta -= dx * .006; orbit.phi = Math.max(.15, Math.min(1.5, orbit.phi - dy * .005)); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) orbit.r = Math.max(.6, Math.min(40, orbit.r * pinch / Math.max(1, d))); pinch = d; } });
  const up = e => { ptrs.delete(e.pointerId); pinch = null; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => { e.preventDefault(); orbit.r = Math.max(.6, Math.min(40, orbit.r * Math.exp(e.deltaY * .0012))); }, { passive: false });
  const camPos = new THREE.Vector3(-3, 2, 3), camLook = new THREE.Vector3();

  function resize() { const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (composer) { composer.setSize(w, h); composer.setPixelRatio(renderer.getPixelRatio()); } }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // ---------- per frame ----------
  let raf = 0, alive = true, last = performance.now();
  const tmp = new THREE.Vector3();
  function frame(now) {
    if (!alive) return; raf = requestAnimationFrame(frame); if (document.hidden || !container.offsetWidth) return;   // off screen: draw nothing
    const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now;   // the first frame's timestamp can be slightly earlier than performance.now()
    const aw = api.activeWorld(); const t = aw && (aw.type === 'car' || aw.type === 'drone') ? aw.type : null;
    if (t && t !== type) { type = t; buildScene(t); }
    const w = S.w || {};
    let target = new THREE.Vector3(), follow = new THREE.Vector3(1, 0, 0);
    if (ready && type === 'car' && car) {
      if (partsKey() !== carKey) { world.remove(car); car = buildCar(S); carKey = partsKey(); world.add(car); }
      const x = toX(w.x || 0), z = toZ(w.y || 0), h = w.h || 0;
      const air = !!w.inAir, onRamp = (w.z || 0) > 0 && !air;
      car.position.set(x, (w.z || 0) / 100, z); car.rotation.y = -h;
      const pitch = air ? Math.max(-.5, Math.min(.5, Math.atan2(w.vzc || 0, Math.max(30, w.vair || 0)) * .7)) : onRamp ? Math.atan2((api.RAMP_H || 32), 200) : 0;
      const shake = w.crash > 0 ? Math.sin(now / 30) * .02 : 0; car.rotation.z = shake + pitch;
      cones3.forEach((c, i) => { const down = (w.cones || []).includes(i); c.rotation.z += ((down ? 1.45 : 0) - c.rotation.z) * Math.min(1, dt * 8); c.position.y = down ? .07 : 0; });
      if (boostMat) boostMat.map.offset.x -= dt * ((w.boost || 0) > 0 ? 3 : 1);
      const sl = (w.wl || 0) * 1.4 / .065, sr = (w.wr || 0) * 1.4 / .065;
      car.userData.wheels.forEach(({ w: wh, side }) => { wh.rotation.z -= (side > 0 ? sr : sl) * dt; });
      const v = Math.abs((w.wl || 0) + (w.wr || 0)) / 2;
      follow.set(Math.cos(h), 0, Math.sin(h));
      if (v > .1 && Math.random() < v * 1.2) for (const s of [-1, 1]) dust.emit(tmp.set(x - follow.x * .2 + s * follow.z * .16, .02, z - follow.z * .2 - s * follow.x * .16), new THREE.Vector3(-follow.x * .3, .25, -follow.z * .3));
      if (beam) { const on = car.userData.eyes && S.parts.some(p => p.type === 'ultrasonic' && p.st && p.st.pow); beam.visible = !!on;
        if (on) { const d = Math.max(.02, (S.env.distance || 0) / 100); beam.scale.set(d, 1, 1); beam.position.set(x + follow.x * .27, .11, z + follow.z * .27); beam.rotation.y = -h; } }
      target.set(x, .12 + (w.z || 0) / 100, z);
      stats.innerHTML = `Speed <b>${(v * 1.8 * ((w.boost || 0) > 0 ? 2.2 : 1)).toFixed(2)} m/s</b> · driven <b>${(w.odo || 0).toFixed(1)} m</b> · stunts <b>${w.score || 0}</b> · best jump ${(w.bestAir || 0).toFixed(1)} s · cones ${(w.cones || []).length}/${(api.CONES || []).length}${S.parts.some(p => p.type === 'ultrasonic' && p.st && p.st.pow) ? ` · sensor <b>${Math.round(S.env.distance)} cm</b>` : ''}${api.battery ? ` · battery ${api.battery()}%` : ''}`;
      big.textContent = w.crash > 0 ? 'CRASH!' : w.stunt ? w.stunt.text : (w.boost || 0) > 0 ? 'BOOST!' : ''; big.className = 'w3d-big' + (w.crash > 0 ? ' bad' : w.stunt || (w.boost || 0) > 0 ? ' good' : '');
    } else if (ready && type === 'drone' && drone) {
      const alt = w.alt || 0; const bl = S.parts.filter(p => p.type === 'bldc'); const spinning = bl.some(b => b.st && b.st.on);
      const bob = alt > .2 && w.crash <= 0 ? Math.sin(now / 420) * .03 : 0;
      const dx = w.dx || 0, dz = w.dz || 0;
      drone.position.set(dx, alt + bob, dz);
      // the drone leans into the direction it flies
      const tilt = w.crash > 0 ? Math.sin(now / 50) * .5 : Math.sin(now / 900) * .03 * (alt > .2) + (w.dvz || 0) * .07;
      drone.rotation.set(tilt, 0, -(w.dvx || 0) * .07 + Math.cos(now / 1100) * .03 * (alt > .2));
      gates3.forEach((g, i) => { const next = i === (w.gate || 0) % gates3.length; g.userData.m.emissive.setHex(next ? 0xff7a1a : 0x9fe8ff); g.userData.m.emissiveIntensity = next ? 1.1 + Math.sin(now / 160) * .35 : .22; });
      drone.userData.props.forEach(({ p, disc, dir }, i) => { const duty = bl[i] && bl[i].st ? (bl[i].st.duty ?? (bl[i].st.on ? .6 : 0)) : 0;
        const sp = spinning ? 40 + duty * 120 : 0; p.rotation.y += dir * sp * dt; disc.visible = sp > 30; p.children.forEach(c => { if (c !== disc) c.visible = sp <= 60; }); });
      if (spinning && alt < 1.2) for (let k = 0; k < 3; k++) { const a = Math.random() * 6.28; dust.emit(tmp.set(dx + Math.cos(a) * .3, .03, dz + Math.sin(a) * .3), new THREE.Vector3(Math.cos(a) * 1.2, .15, Math.sin(a) * 1.2)); }
      target.set(dx, alt + .18, dz);
      const tw = w.weight ? (w.tmax / w.weight) : 0;
      stats.innerHTML = `Altitude <b>${alt.toFixed(1)} m</b> · ${w.vz >= 0 ? '+' : ''}${(w.vz || 0).toFixed(1)} m/s · thrust ${Math.round(w.T || 0)} g / ${Math.round(w.weight || 0)} g · T:W ${tw.toFixed(2)}${w.ftime ? ` · ~${w.ftime.toFixed(1)} min flight` : ''}`;
      stats.innerHTML += ` · gates <b>${w.gates || 0}</b>`;
      big.textContent = w.crash > 0 ? 'CRASH!' : w.stunt ? w.stunt.text : alt > .2 ? (w.hover > .5 ? 'HOVERING' : 'FLYING') : spinning ? 'SPINNING UP' : 'ON THE GROUND'; big.className = 'w3d-big' + (w.crash > 0 ? ' bad' : w.stunt ? ' good' : '');
    }
    if (dust) dust.step(dt);
    // camera: smoothing by time, not by frame, so slow phones reach the same view as fast ones
    const k = r => 1 - Math.exp(-r * dt);
    if (camMode === 'chase') {
      const back = type === 'drone' ? 1.25 + Math.min(1.6, (w.alt || 0) * .06) : 1.7, upH = type === 'drone' ? .45 + Math.min(1.4, (w.alt || 0) * .05) : .85;
      const want = type === 'drone' ? new THREE.Vector3(target.x - back * .8, target.y + upH, target.z + back * .9) : target.clone().addScaledVector(follow, -back).add(new THREE.Vector3(0, upH, 0));
      camPos.lerp(want, k(type === 'drone' ? 3.6 : 5)); camLook.lerp(type === 'car' ? target.clone().addScaledVector(follow, .3) : target, k(9));
    } else if (camMode === 'top') {
      camPos.lerp(type === 'car' ? new THREE.Vector3(0, 9.5, .01) : new THREE.Vector3(0, target.y + 5, .01), k(5)); camLook.lerp(type === 'car' ? new THREE.Vector3(0, 0, 0) : target, k(9));
    } else {
      const want = new THREE.Vector3(target.x + orbit.r * Math.sin(orbit.phi) * Math.sin(orbit.theta), target.y + orbit.r * Math.cos(orbit.phi), target.z + orbit.r * Math.sin(orbit.phi) * Math.cos(orbit.theta));
      camPos.lerp(want, k(12)); camLook.lerp(target, k(12));
    }
    camPos.y = Math.max(.08, camPos.y); camera.position.copy(camPos); camera.lookAt(camLook);
    if (ready) { const sc = sun.shadow.camera, q = (sc.right - sc.left) / sun.shadow.mapSize.x * 4, sx = Math.round(target.x / q) * q, sz = Math.round(target.z / q) * q;   // whole-texel steps: no crawling shadow edges
      sun.position.set(sx - 18, 26, sz + 12); sun.target.position.set(sx, 0, sz); }
    if (composer) composer.render(dt); else renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  window.__arena3d = { camera, scene, renderer, get look() { return camLook; } };   // read-only hook for tests

  return {
    close() { container.classList.remove('full'); alive = false; cancelAnimationFrame(raf); ro.disconnect(); world.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); renderer.dispose(); container.innerHTML = ''; },
    setCam(c) { camMode = c; },
  };
}
