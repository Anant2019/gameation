// Circuit Arena 3D bench: shows the circuit on the 2D bench as a lit, real-looking 3D model.
// Loaded only when the player taps "3D View". The 2D bench stays the editor; this view follows it live.
import * as THREE from './three.module.min.js';

const U = 100;            // bench pixels per world unit
const PCB = 0.032;        // board thickness
const LF = 0.72;          // the 3D layout pulls parts closer together than the 2D bench, like a real crowded bench
const BB_H = 0.09;        // breadboard thickness
// Small through-hole parts sit on a breadboard, like on a real bench.
const ON_BB = new Set(['led', 'resistor', 'diode', 'button', 'switch', 'pot', 'mosfet', 'regulator', 'lm35', 'buzzer', 'mcu', 'ic555', 'ic4017', 'lm393', 'uln2003',
  'ic7400', 'ic7402', 'ic7404', 'ic7408', 'ic7432', 'ic7486']);

// ---------- shared materials and canvas textures ----------
const M = {};
const mat = (k, f) => M[k] || (M[k] = f());
const std = (color, rough = .55, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const metal = () => mat('metal', () => std(0xc9ced3, .28, 1));
const darkMetal = () => mat('dmetal', () => std(0x6e767c, .35, 1));
const gold = () => mat('gold', () => std(0xd8b25a, .3, 1));
const black = () => mat('black', () => std(0x16181a, .5));
const plastic = c => mat('pl' + c, () => std(c, .45));
const rubber = c => mat('rb' + c, () => std(c, .85));

function canvasTex(w, h, draw, key) {
  if (key && M['tx' + key]) return M['tx' + key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (key) M['tx' + key] = t;
  return t;
}
const FONT = '"Oxanium","IBM Plex Sans",system-ui,sans-serif';

function shade(hex, f) {
  const c = new THREE.Color(hex); const h = {}; c.getHSL(h);
  c.setHSL(h.h, h.s, Math.max(0, Math.min(1, h.l * f))); return '#' + c.getHexString();
}

// A PCB top: solder mask colour, faint traces, mounting holes and silkscreen text.
function pcbTex(color, W, D, label, seed = 1, sub = '', at = null) {
  return canvasTex(512, Math.max(64, Math.round(512 * D / W)), (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    const r = (n => () => (n = (n * 9301 + 49297) % 233280) / 233280)(seed * 977);
    g.strokeStyle = shade(color, 1.35); g.globalAlpha = .35; g.lineWidth = 3;
    for (let i = 0; i < 14; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y);
      for (let k = 0; k < 3; k++) { if (r() < .5) x = r() * w; else y = r() * h; g.lineTo(x, y); } g.stroke(); }
    g.globalAlpha = 1; g.fillStyle = '#d9c27a';
    for (const [x, y] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) { g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.fillStyle = '#d9c27a'; }
    if (label) { g.fillStyle = 'rgba(255,255,255,.88)'; const fs = Math.min(at ? 40 : 54, h * .2); g.font = `700 ${fs}px ${FONT}`;
      if (at) { g.textAlign = 'left'; g.fillText(label, w * at[0], h * at[1]); } else { g.textAlign = 'center'; g.fillText(label, w / 2, h * .62); } }
    if (sub) { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `600 ${Math.min(26, h * .12)}px ${FONT}`; g.textAlign = 'center'; g.fillText(sub, w / 2, h * .8); }
  }, `pcb${color}${label}${sub}${W.toFixed(2)}${D.toFixed(2)}${at}`);
}

function labelTex(text, bg, fg = '#fff', w = 256, h = 64, size = 34) {
  return canvasTex(w, h, (g) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = `700 ${size}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2); }, `lb${text}${bg}${fg}${w}${h}${size}`);
}

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y + h / 2, z);
  b.castShadow = true; b.receiveShadow = true; return b;
}
function cyl(r, h, m, x = 0, y = 0, z = 0, seg = 24, rTop = r) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, h, seg), m); c.position.set(x, y + h / 2, z);
  c.castShadow = true; c.receiveShadow = true; return c;
}
// A box whose top face shows a texture and whose sides use a plain material.
function texBox(w, h, d, tex, sideColor, rough = .55) {
  const side = plastic(sideColor);
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: rough });
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, side, side, side]);
  b.position.y = h / 2; b.castShadow = true; b.receiveShadow = true; return b;
}

// ---------- part models ----------
// Every builder gets (p, d, W, D) with W×D the footprint in world units and returns a THREE.Group centred on the part.
// Dynamic pieces are stored on group.userData so update() can move them.

function headerRow(g, pts, h = .085) {
  // A black plastic header with gold pins under every port of a board edge.
  if (!pts.length) return;
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
  const minX = Math.min(...xs) - .07, maxX = Math.max(...xs) + .07, minZ = Math.min(...zs) - .07, maxZ = Math.max(...zs) + .07;
  const w = horizontal ? maxX - minX : .1, d = horizontal ? .1 : maxZ - minZ;
  g.add(box(w, h, d, black(), (minX + maxX) / 2, PCB, (minZ + maxZ) / 2));
  for (const [x, z] of pts) { const s = box(.05, .012, .05, mat('hole', () => std(0x050505, .9)), x, PCB + h - .006, z); g.add(s); }
}

function portsLocal(d, W, D) {
  return d.ports.map(([n, x, y, k]) => ({ n, k, x: x / U - W / 2, z: y / U - D / 2, side: y === 0 ? 'top' : y === d.h ? 'bottom' : x === 0 ? 'left' : 'right' }));
}

function boardModel(p, d, W, D) {
  const g = new THREE.Group();
  const names = { arduino: 'ARDUINO UNO', nano: 'NANO', mega: 'ARDUINO MEGA 2560', rpi: 'Raspberry Pi 4', pi5: 'Raspberry Pi 5', pizero: 'Pi Zero 2 W', pico: 'Raspberry Pi Pico', esp32: 'ESP32 DevKit' };
  const pb = texBox(W, PCB, D, pcbTex(d.sw, W, D, names[p.type] || d.name, p.id, '', [.08, .84]), shade(d.sw, .7));
  g.add(pb);
  const ps = portsLocal(d, W, D);
  for (const side of ['top', 'bottom', 'left', 'right']) headerRow(g, ps.filter(q => q.side === side).map(q => [q.x, q.z]));
  const isPi = /^(rpi|pi5|pizero)$/.test(p.type);
  // main chip
  const chip = texBox(Math.min(.62, W * .3), .045, Math.min(.36, D * .3), labelTex(isPi ? 'BCM2711' : p.type === 'esp32' ? 'ESP-WROOM-32' : p.type === 'pico' ? 'RP2040' : 'ATMEGA328P', '#1b1d1f', '#c9ccd0', 256, 96, 24), 0x1b1d1f, .4);
  chip.position.set(W * .12, PCB + .0225, D * .05); g.add(chip);
  if (p.type === 'esp32') { const can = box(Math.min(.7, W * .32), .03, Math.min(.5, D * .45), metal(), -W * .18, PCB, 0); g.add(can); }
  if (isPi) {
    const lid = box(.42, .03, .42, metal(), -W * .05, PCB + .045, 0); g.add(lid);
    g.add(box(.36, .26, .3, metal(), W / 2 - .2, PCB, -D * .22)); g.add(box(.36, .26, .3, metal(), W / 2 - .2, PCB, D * .18));
  } else if (/^(arduino|mega)$/.test(p.type)) {
    g.add(box(.42, .28, .36, metal(), -W / 2 + .16, PCB, -D * .18));                         // USB-B
    g.add(box(.36, .26, .22, black(), -W / 2 + .14, PCB, D * .28));                          // DC jack
    g.add(cyl(.07, .14, mat('cap', () => std(0x2a2d30, .35, .3)), -W * .2, PCB, D * .25));   // capacitors
    g.add(cyl(.07, .14, mat('cap', () => std(0x2a2d30, .35, .3)), -W * .28, PCB, D * .25));
    g.add(box(.08, .03, .05, plastic(0x30ff70), W * .3, PCB, -D * .32));                      // ON LED
  } else { g.add(box(.22, .1, .18, metal(), -W / 2 + .1, PCB, 0)); }                            // micro USB
  return g;
}

function legs(g, pts, topY, m = metal()) {
  // Thin metal legs from a body down to the bench at the port positions.
  for (const [x, z, y0 = topY] of pts) { const l = cyl(.009, y0, m, x, 0, z, 8); g.add(l); }
}

function ledModel(p, d, W, D) {
  const g = new THREE.Group(); const c = (d.props && p.props.color) || 'red';
  const C = { red: 0xe5403a, green: 0x2e9e4a, yellow: 0xd8a820, blue: 0x2f62d8, white: 0xd8dce6 }[c] || 0xe5403a;
  const ps = portsLocal(d, W, D);
  const cx = 0, cz = -D * .18, base = .2;
  legs(g, ps.map(q => [q.x, q.z, base + .01]), base);
  const m = new THREE.MeshPhysicalMaterial({ color: C, roughness: .15, transmission: 0, transparent: true, opacity: .82, emissive: C, emissiveIntensity: 0, clearcoat: 1 });
  const rim = cyl(.105, .04, m, cx, base, cz, 28); g.add(rim);
  const body = cyl(.088, .2, m, cx, base + .04, cz, 28); g.add(body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(.088, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), m); dome.position.set(cx, base + .24, cz); dome.castShadow = true; g.add(dome);
  // bent legs from the body down to the two ports
  for (const q of ps) { const l = box(.016, .012, Math.abs(q.z - cz) + .02, metal(), q.x, base, (q.z + cz) / 2); g.add(l);
    const v = cyl(.009, .03, metal(), q.x, base, cz, 8); g.add(v); }
  g.userData.glow = { mat: m, color: C, pos: new THREE.Vector3(cx, base + .27, cz), kind: 'led' };
  return g;
}

const BANDC = ['#111', '#7A4A1E', '#C0392B', '#E67E22', '#F1C40F', '#27AE60', '#2E6FD0', '#8E44AD', '#8A8F8C', '#F4F4F4'];
function resistorModel(p, d, W, D) {
  const g = new THREE.Group(); const r = Math.max(1, +(p.props && p.props.r) || 330);
  const e = Math.floor(Math.log10(r)) - 1; const sig = Math.round(r / 10 ** e); const b = [Math.floor(sig / 10) % 10, sig % 10, Math.max(0, e)];
  // the capsule's texture runs along its length in v, so the bands are horizontal stripes
  const tex = canvasTex(64, 256, (gc, w, h) => { gc.fillStyle = '#d9bf93'; gc.fillRect(0, 0, w, h);
    [[.26, b[0]], [.37, b[1]], [.48, b[2]]].forEach(([y, v]) => { gc.fillStyle = BANDC[v]; gc.fillRect(0, y * h, w, h * .07); });
    gc.fillStyle = '#C9A227'; gc.fillRect(0, .7 * h, w, h * .07); }, 'res' + b.join(''));
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: .5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.065, W * .4, 6, 20), m);
  body.position.set(0, .11, 0); body.castShadow = true;
  body.rotation.set(0, 0, Math.PI / 2); g.add(body);   // CapsuleGeometry runs along Y: lay it along X
  const ps = portsLocal(d, W, D);
  for (const q of ps) { g.add(box(Math.abs(q.x) - W * .2, .014, .014, metal(), q.x / 2 + Math.sign(q.x) * W * .1, .1, q.z)); g.add(cyl(.009, .11, metal(), q.x, 0, q.z, 8)); }
  return g;
}

function batteryModel(p, d, W, D) {
  const g = new THREE.Group(); const pre = (p.props && p.props.preset) || '9V';
  if (/AA/.test(pre)) {
    g.add(box(W, .06, D * .9, plastic(0x1d1f22)));
    const n = pre === '2AA' ? 2 : 1;
    for (let i = 0; i < n; i++) { const z = (i - (n - 1) / 2) * .2; const c = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, W * .8, 28), plastic(0xd4502a));
      c.rotation.z = Math.PI / 2; c.position.set(0, .15, z); c.castShadow = true; g.add(c); }
  } else if (/usb|phone|watch|li|lipo/.test(pre)) {
    const m = pre === 'usb' ? plastic(0xe9ecef) : plastic(0x2b5ea8);
    const b = texBox(W * .95, .12, D * .85, labelTex(pre === 'usb' ? 'POWER BANK 5V' : (p.props.v || '') + 'V LiPo', pre === 'usb' ? '#e9ecef' : '#2b5ea8', pre === 'usb' ? '#333' : '#fff', 256, 128, 26), pre === 'usb' ? 0xe9ecef : 0x2b5ea8, .4);
    g.add(b); void m;
  } else {
    // a 9 V block battery standing on its side with the snap on top
    const tex = canvasTex(256, 160, (gc, w, h) => { const gr = gc.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#1b1c1e'); gr.addColorStop(.62, '#2a2c2f'); gr.addColorStop(.62, '#c9a227'); gr.addColorStop(1, '#e2c060');
      gc.fillStyle = gr; gc.fillRect(0, 0, w, h); gc.fillStyle = '#fff'; gc.font = `800 64px ${FONT}`; gc.textAlign = 'center'; gc.fillText((p.props.v || 9) + 'V', w * .32, h * .62); }, '9v' + (p.props && p.props.v));
    g.add(texBox(W * .95, .32, D * .78, tex, 0x1b1c1e, .4));
  }
  const ps = portsLocal(d, W, D);
  for (const q of ps) { const t = cyl(.035, .05, q.n === '+' ? metal() : darkMetal(), q.x, .32, q.z, 6); g.add(t); }
  return g;
}

function dipModel(p, d, W, D, label) {
  const g = new THREE.Group(); const ps = portsLocal(d, W, D);
  const bw = W * .86, bd = Math.min(D * .5, .34);
  const top = labelTex(label, '#1e2124', '#d6d9dc', 512, 160, 52);
  const b = texBox(bw, .07, bd, top, 0x1e2124, .45); b.position.y = .05 + .035; g.add(b);
  const notch = cyl(.03, .01, black(), -bw / 2 + .06, .12, 0, 16); g.add(notch);
  for (const q of ps) { const sz = Math.sign(q.z) * bd / 2; const l = box(.035, .01, Math.abs(q.z - sz), metal(), q.x, .08, (q.z + sz) / 2); g.add(l);
    g.add(box(.02, .08, .012, metal(), q.x, 0, q.z)); }
  return g;
}

function servoModel(p, d, W, D) {
  const g = new THREE.Group(); const bw = W * .7, bd = D * .72;
  const body = texBox(bw, .26, bd, labelTex('SG90', '#2457a4', '#fff', 256, 128, 44), 0x2457a4, .45); body.position.x = W * .1; g.add(body);
  g.add(box(bw * 1.3, .025, bd * .6, plastic(0x2457a4), W * .1, .18, 0));
  const boss = cyl(.06, .07, plastic(0x2457a4), W * .1 + bw * .28, .26, 0, 20); g.add(boss);
  const horn = new THREE.Group(); horn.position.set(W * .1 + bw * .28, .345, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(.36, .025, .06), plastic(0xf4f4f4)); arm.position.x = .14; arm.castShadow = true;
  const hub = cyl(.045, .03, plastic(0xf4f4f4), 0, -.015, 0, 20);
  horn.add(arm, hub); g.add(horn); g.userData.horn = horn;
  // the brown-red-orange cable going to the ports
  const ps = portsLocal(d, W, D); const C = { GND: 0x6b3e1e, VCC: 0xd0362a, SIG: 0xe08a1a };
  for (const q of ps) g.add(box(Math.abs(q.x - (W * .1 - bw / 2)) + .02, .02, .025, plastic(C[q.n] || 0x888888), (q.x + W * .1 - bw / 2) / 2, .06, q.z));
  return g;
}

function ultrasonicModel(p, d, W, D) {
  const g = new THREE.Group();
  g.add(texBox(W, PCB, D * .8, pcbTex('#1f5fbf', W, D * .8, 'HC-SR04', p.id), 0x194f9e));
  const can = x => { const c = cyl(.16, .2, metal(), x, PCB, -D * .05, 32); g.add(c);
    const mesh = cyl(.13, .005, mat('mesh', () => std(0x2a2a2a, .9)), x, PCB + .2, -D * .05, 32); g.add(mesh); };
  can(-W * .28); can(W * .28);
  g.add(box(.12, .05, .05, metal(), 0, PCB, -D * .22));
  headerRow(g, portsLocal(d, W, D).map(q => [q.x, q.z]));
  return g;
}

function moduleModel(p, d, W, D, opts = {}) {
  // Generic sensor/module: coloured PCB, a feature on top and the pin header.
  const g = new THREE.Group(); const c = opts.color || d.sw || '#2e7d4f';
  g.add(texBox(W, PCB, D, pcbTex(c, W, D, opts.label ?? (d.tag || d.short || d.name), p.id), shade(c, .7)));
  if (opts.feature) opts.feature(g);
  headerRow(g, portsLocal(d, W, D).map(q => [q.x, q.z]), .06);
  return g;
}

function lcdModel(p, d, W, D) {
  const g = new THREE.Group();
  g.add(texBox(W, PCB, D, pcbTex('#2e7d4f', W, D, '', p.id), 0x245f3d));
  g.add(box(W * .9, .05, D * .66, black(), 0, PCB, -D * .06));
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(W * .82, D * .5), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: .9, roughness: .3 }));
  scr.rotation.x = -Math.PI / 2; scr.position.set(0, PCB + .052, -D * .06); g.add(scr);
  g.userData.lcd = { c, t, last: null };
  headerRow(g, portsLocal(d, W, D).map(q => [q.x, q.z]), .06);
  return g;
}
function drawLcd(u, text, on) {
  const key = (on ? 1 : 0) + JSON.stringify(text); if (u.last === key) return; u.last = key;
  const g = u.c.getContext('2d'); g.fillStyle = on ? '#3f8fd8' : '#1c2a35'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = on ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.2)';
  for (let r = 0; r < 2; r++) for (let i = 0; i < 16; i++) g.fillRect(14 + i * 30.5, 12 + r * 56, 27, 46);
  if (on) { g.fillStyle = '#eef6ff'; g.font = `600 40px ui-monospace,Menlo,monospace`; g.textBaseline = 'top';
    (text || ['', '']).slice(0, 2).forEach((s, r) => { String(s).slice(0, 16).split('').forEach((ch, i) => g.fillText(ch, 18 + i * 30.5, 16 + r * 56)); }); }
  u.t.needsUpdate = true;
}

function keypadModel(p, d, W, D, KEYPAD) {
  const g = new THREE.Group(); const keys = KEYPAD || ['1', '2', '3', '+', '4', '5', '6', '-', '7', '8', '9', '*', 'C', '0', '=', '/'];
  g.add(box(W, .02, D * .88, plastic(0x15181b), 0, 0, -D * .05));
  g.userData.keys = [];
  keys.forEach((k, i) => { const r = Math.floor(i / 4), c = i % 4; const op = /[^0-9]/.test(k);
    const kb = texBox(.23, .035, .26, labelTex(k === '*' ? '×' : k === '/' ? '÷' : k, op ? '#3a4552' : '#2b3036', '#e8eef0', 128, 128, 72), op ? 0x3a4552 : 0x2b3036, .6);
    kb.position.set(-W / 2 + .2 + c * .27, .02 + .0175, -D * .05 - D * .44 + .2 + r * .31); g.add(kb); g.userData.keys.push(kb); });
  g.add(box(W * .66, .01, .1, plastic(0x2e7d4f), 0, 0, D / 2 - .06));
  return g;
}

function meterModel(p, d, W, D) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(W * .96, .14, D * .9), plastic(new THREE.Color(d.sw).getHex())); body.position.y = .07; body.castShadow = true; g.add(body);
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(W * .7, D * .32), new THREE.MeshStandardMaterial({ map: t, roughness: .35 }));
  scr.rotation.x = -Math.PI / 2; scr.position.set(0, .142, -D * .18); g.add(scr);
  const knob = cyl(.11, .05, black(), 0, .14, D * .16, 28); g.add(knob);
  g.userData.meter = { c, t, last: null, unit: p.type === 'voltmeter' ? 'V' : 'A' };
  return g;
}
function drawMeter(u, val) {
  const s = isFinite(val) ? (u.unit === 'V' ? val.toFixed(2) + ' V' : (val * 1000).toFixed(1) + ' mA') : '--';
  if (u.last === s) return; u.last = s; const g = u.c.getContext('2d');
  g.fillStyle = '#b8c6a3'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#1b2318'; g.font = `700 50px ui-monospace,Menlo,monospace`; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText(s, 244, 50); u.t.needsUpdate = true;
}

function fanModel(p, d, W, D) {
  const g = new THREE.Group(); const s = Math.min(W, D) * .92;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(s, .12, s), plastic(0x23282c)); frame.position.y = .06; frame.castShadow = true; g.add(frame);
  const hole = cyl(s * .44, .125, mat('fanhole', () => std(0x0b0d0e, .9)), 0, 0, 0, 40); g.add(hole);
  const rot = new THREE.Group(); rot.position.y = .13;
  rot.add(cyl(.07, .03, plastic(0x3a4247), 0, -.015, 0, 20));
  for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(s * .38, .012, .1), plastic(0x4e5b63));
    b.position.set(Math.cos(i * 1.2566) * s * .2, 0, Math.sin(i * 1.2566) * s * .2); b.rotation.y = -i * 1.2566; b.rotation.x = .35; b.castShadow = true; rot.add(b); }
  g.add(rot); g.userData.spin = rot; return g;
}

function motorModel(p, d, W, D) {
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .42, 32), metal()); can.rotation.x = Math.PI / 2; can.position.set(0, .23, -D * .1); can.castShadow = true; g.add(can);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .05, 32), plastic(0xc0392b)); cap.rotation.x = Math.PI / 2; cap.position.set(0, .23, -D * .1 + .23); g.add(cap);
  const rot = new THREE.Group(); rot.position.set(0, .23, -D * .1 - .27);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .12, 10), metal()); shaft.rotation.x = Math.PI / 2; rot.add(shaft);
  const prop = new THREE.Mesh(new THREE.BoxGeometry(.5, .05, .012), plastic(0xf2a33a)); prop.position.z = -.06; prop.castShadow = true; rot.add(prop);
  g.add(rot); g.userData.spinZ = rot;
  for (const q of portsLocal(d, W, D)) g.add(cyl(.012, .1, gold(), q.x, 0, q.z, 8));
  return g;
}

function bulbModel(p, d, W, D) {
  const g = new THREE.Group();
  g.add(box(W * .9, .03, D * .4, plastic(0x2e7d4f), 0, 0, D * .25));
  g.add(cyl(.09, .14, metal(), 0, 0, -D * .1, 24));
  const m = new THREE.MeshPhysicalMaterial({ color: 0xfff6d8, roughness: .05, transparent: true, opacity: .55, emissive: 0xffd36a, emissiveIntensity: 0, clearcoat: 1 });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(.2, 32, 20), m); glass.position.set(0, .34, -D * .1); glass.castShadow = true; g.add(glass);
  const fil = cyl(.012, .1, mat('fil', () => std(0x888888, .4, 1, { emissive: 0xff9a2a, emissiveIntensity: 0 })), 0, .26, -D * .1, 6); g.add(fil);
  g.userData.glow = { mat: m, color: 0xffd36a, pos: new THREE.Vector3(0, .36, -D * .1), kind: 'bulb', fil: fil.material };
  return g;
}

function alarmModel(p, d, W, D) {
  const g = new THREE.Group();
  g.add(box(W * .9, .05, D * .8, plastic(0x2e7d4f)));
  g.add(cyl(.16, .06, black(), 0, .05, 0, 28));
  const m = new THREE.MeshPhysicalMaterial({ color: 0xd8261c, roughness: .2, transparent: true, opacity: .85, emissive: 0xff2a1a, emissiveIntensity: 0, clearcoat: 1 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(.15, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), m); dome.position.y = .11; dome.castShadow = true; g.add(dome);
  g.userData.glow = { mat: m, color: 0xff2a1a, pos: new THREE.Vector3(0, .2, 0), kind: 'alarm' };
  return g;
}

function buzzerModel(p, d, W, D) {
  const g = new THREE.Group(); g.add(cyl(.2, .16, plastic(0x1d1f22), 0, 0, -D * .1, 32));
  g.add(cyl(.03, .005, mat('hole', () => std(0x050505, .9)), 0, .16, -D * .1, 12));
  const plus = texBox(.2, .002, .1, labelTex('+', '#1d1f22', '#ddd', 64, 32, 28), 0x1d1f22); plus.position.set(.08, .162, -D * .1 + .12); g.add(plus);
  for (const q of portsLocal(d, W, D)) g.add(cyl(.009, .05, metal(), q.x, 0, q.z, 8));
  g.userData.buzz = true; return g;
}

function potModel(p, d, W, D) {
  const g = new THREE.Group(); g.add(box(W * .8, .12, D * .7, plastic(0x2457a4), 0, 0, -D * .1));
  const knob = new THREE.Group(); knob.position.set(0, .12, -D * .1);
  knob.add(cyl(.05, .12, metal(), 0, 0, 0, 20)); const k2 = cyl(.13, .1, plastic(0x2a2d30), 0, .1, 0, 28); knob.add(k2);
  knob.add(box(.02, .012, .1, plastic(0xf4f4f4), 0, .2, -.05)); g.add(knob);
  knob.rotation.y = -(((p.props && p.props.pos) ?? 50) / 100 - .5) * 4.7;
  for (const q of portsLocal(d, W, D)) g.add(cyl(.012, .1, metal(), q.x, 0, q.z, 8));
  return g;
}

function switchModel(p, d, W, D) {
  const g = new THREE.Group();
  if (p.type === 'button') {
    g.add(box(.3, .1, .3, plastic(0x22262a)));
    const cap = cyl(.09, .07, plastic(new THREE.Color(d.sw).getHex()), 0, .1, 0, 24); g.add(cap); g.userData.press = cap;
  } else {
    g.add(box(W * .6, .14, .22, plastic(0x3a3f3c)));
    const nub = box(.08, .07, .1, plastic(0xe8e8e8), 0, .14, 0); g.add(nub); g.userData.slide = { nub, W };
  }
  for (const q of portsLocal(d, W, D)) g.add(box(Math.max(.02, Math.abs(q.x) - (p.type === 'button' ? .15 : W * .3)), .012, .02, metal(), q.x - Math.sign(q.x) * (Math.abs(q.x) - (p.type === 'button' ? .15 : W * .3)) / 2, .03, q.z));
  return g;
}

function to220Model(p, d, W, D, label) {
  const g = new THREE.Group(); const z = -D * .12;
  const tab = texBox(.34, .015, .36, labelTex('', '#9aa0a4', '#000', 32, 32, 10), 0x9aa0a4, .3); tab.material[2] = metal(); tab.position.set(0, .26, z - .18); g.add(tab);
  const body = texBox(.36, .14, .34, labelTex(label, '#1e2124', '#d6d9dc', 256, 192, 54), 0x1e2124, .45); body.position.set(0, .2, z + .1); g.add(body);
  for (const q of portsLocal(d, W, D)) { g.add(cyl(.012, .22, metal(), q.x, 0, q.z, 8)); g.add(box(.02, .012, Math.abs(q.z - (z + .27)), metal(), q.x, .22, (q.z + z + .27) / 2)); }
  return g;
}

function solarModel(p, d, W, D) {
  const g = new THREE.Group();
  const tex = canvasTex(512, 320, (gc, w, h) => { gc.fillStyle = '#c9ced3'; gc.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const x = 12 + c * 82, y = 12 + r * 74; const gr = gc.createLinearGradient(x, y, x + 76, y + 68); gr.addColorStop(0, '#1d3466'); gr.addColorStop(1, '#0e1c3d');
      gc.fillStyle = gr; gc.fillRect(x, y, 76, 68); gc.strokeStyle = 'rgba(190,200,230,.35)'; gc.lineWidth = 1.5; for (let k = 1; k < 3; k++) { gc.beginPath(); gc.moveTo(x, y + k * 22); gc.lineTo(x + 76, y + k * 22); gc.stroke(); } } }, 'solar');
  const b = texBox(W, .04, D, tex, 0xc9ced3, .2); b.position.y = .08; b.rotation.x = -.12; g.add(b);
  g.add(box(W * .1, .08, D * .1, metal(), -W * .3, 0, D * .3)); g.add(box(W * .1, .08, D * .1, metal(), W * .3, 0, D * .3));
  return g;
}

function dynamoModel(p, d, W, D) {
  const g = new THREE.Group(); g.add(box(W * .9, .05, D * .7, plastic(0x2a2d30)));
  g.add(cyl(.26, .28, metal(), 0, .05, 0, 32));
  const rot = new THREE.Group(); rot.position.y = .36; rot.add(box(.5, .03, .06, plastic(0xc0392b), .22, 0, 0)); rot.add(cyl(.035, .14, plastic(0xc0392b), .45, 0, 0, 12));
  g.add(rot); g.userData.spin = rot; return g;
}

function driverModel(p, d, W, D) {
  const g = new THREE.Group(); g.add(texBox(W, PCB, D, pcbTex('#b3262c', W, D, 'L298N', p.id), 0x8a1d22));
  const hs = new THREE.Group(); hs.position.set(0, PCB, -D * .05);
  for (let i = 0; i < 9; i++) hs.add(box(.025, .34, .5, darkMetal(), -.2 + i * .05, 0, 0)); g.add(hs);
  for (const q of portsLocal(d, W, D)) g.add(box(.12, .1, .12, plastic(0x2a74c9), q.x - Math.sign(q.x) * (q.side === 'left' || q.side === 'right' ? .07 : 0), PCB, q.z - (q.side === 'top' ? -.07 : 0)));
  return g;
}

function relayModel(p, d, W, D) {
  return moduleModel(p, d, W, D, { color: '#1f5fbf', label: '', feature: g => { g.add(texBox(W * .5, .2, D * .55, labelTex('SRD-05VDC', '#2a5fd0', '#fff', 256, 128, 24), 0x2a5fd0, .4)); } });
}

function sensorFeature(type) {
  return g => {
    if (type === 'ldr') { g.add(cyl(.06, .03, plastic(0xc97a3a), 0, PCB, -.06, 20)); }
    else if (type === 'temp') { g.add(texBox(.3, .14, .36, canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#4fa3d8'; c.fillRect(0, 0, w, h); c.fillStyle = '#2b6f9e'; for (let y = 0; y < 6; y++) for (let x = 0; x < 5; x++) c.fillRect(10 + x * 23, 10 + y * 19, 14, 10); }, 'dht'), 0x4fa3d8)); }
    else if (type === 'pir') { const dome = new THREE.Mesh(new THREE.SphereGeometry(.2, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat('fresnel', () => std(0xf4f4f0, .7))); dome.position.y = PCB + .03; dome.castShadow = true; g.add(dome); g.add(box(.42, .03, .42, plastic(0xf4f4f0), 0, PCB, 0)); }
    else if (type === 'gas' || type === 'flame' || type === 'sound') { g.add(cyl(.12, .16, metal(), -.08, PCB, -.04, 24)); g.add(cyl(.1, .005, mat('mesh', () => std(0x2a2a2a, .9)), -.08, PCB + .16, -.04, 24)); }
    else { g.add(box(.16, .05, .16, black(), -.1, PCB, -.04)); }
    g.add(cyl(.04, .03, plastic(0x2457a4), .14, PCB, -.06, 16));
  };
}

function lm35Model(p, d, W, D) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .2, 24, 1, false, 0, Math.PI), plastic(0x1e2124)); b.position.set(0, .3, -D * .1); b.castShadow = true; g.add(b);
  g.add(box(.18, .2, .005, plastic(0x1e2124), 0, .2, -D * .1));
  for (const q of portsLocal(d, W, D)) { g.add(cyl(.01, .22, metal(), q.x, 0, q.z, 8)); }
  return g;
}

function genericModel(p, d, W, D) {
  // Any other part: a module board with its name, sized to the part.
  return moduleModel(p, d, W, D, { label: d.short || d.name, feature: g => { g.add(box(Math.min(.3, W * .3), .05, Math.min(.3, D * .3), black(), 0, PCB, -D * .1)); } });
}

function buildPart(p, d, api) {
  const W = d.w / U, D = d.h / U;
  let g;
  if (d.board) g = boardModel(p, d, W, D);
  else switch (p.type) {
    case 'led': g = ledModel(p, d, W, D); break;
    case 'resistor': g = resistorModel(p, d, W, D); break;
    case 'battery': g = batteryModel(p, d, W, D); break;
    case 'servo': g = servoModel(p, d, W, D); break;
    case 'ultrasonic': g = ultrasonicModel(p, d, W, D); break;
    case 'lcd': g = lcdModel(p, d, W, D); break;
    case 'keypad': g = keypadModel(p, d, W, D, api.KEYPAD); break;
    case 'voltmeter': case 'ammeter': g = meterModel(p, d, W, D); break;
    case 'fan': g = fanModel(p, d, W, D); break;
    case 'motor': case 'pump': g = motorModel(p, d, W, D); break;
    case 'bulb': case 'lamp': g = bulbModel(p, d, W, D); break;
    case 'alarm': g = alarmModel(p, d, W, D); break;
    case 'buzzer': g = buzzerModel(p, d, W, D); break;
    case 'pot': g = potModel(p, d, W, D); break;
    case 'switch': case 'button': g = switchModel(p, d, W, D); break;
    case 'mosfet': g = to220Model(p, d, W, D, 'IRLZ44N'); break;
    case 'regulator': g = to220Model(p, d, W, D, '7805'); break;
    case 'solar': g = solarModel(p, d, W, D); break;
    case 'dynamo': g = dynamoModel(p, d, W, D); break;
    case 'driver': g = driverModel(p, d, W, D); break;
    case 'relay': g = relayModel(p, d, W, D); break;
    case 'lm35': g = lm35Model(p, d, W, D); break;
    case 'diode': { g = resistorModel({ ...p, props: { r: 1 } }, d, W, D); g.children[0].material = mat('diode', () => new THREE.MeshStandardMaterial({ map: canvasTex(256, 64, (c, w, h) => { c.fillStyle = '#1b1c1e'; c.fillRect(0, 0, w, h); c.fillStyle = '#c9ced3'; c.fillRect(w * .72, 0, w * .09, h); }, 'diodeT'), roughness: .4 })); break; }
    case 'ldr': case 'temp': case 'pir': g = moduleModel(p, d, W, D, { label: '', feature: sensorFeature(p.type) }); break;
    case 'mcu': g = dipModel(p, d, W, D, 'PROG IC'); break;
    case 'ic555': g = dipModel(p, d, W, D, 'NE555'); break;
    case 'ic4017': g = dipModel(p, d, W, D, 'CD4017'); break;
    case 'lm393': g = dipModel(p, d, W, D, 'LM393'); break;
    case 'uln2003': g = dipModel(p, d, W, D, 'ULN2003'); break;
    default:
      if (/^ic74/.test(p.type)) g = dipModel(p, d, W, D, '74HC' + p.type.slice(4));
      else if (d.gen) g = moduleModel(p, d, W, D, { label: d.tag || '', feature: sensorFeature(d.sensor === 'gas' ? 'gas' : d.sensor) });
      else g = genericModel(p, d, W, D);
  }
  if (p.burnt) g.traverse(o => { if (o.isMesh) { o.material = Array.isArray(o.material) ? o.material.map(() => mat('burnt', () => std(0x1d1b19, .95))) : mat('burnt', () => std(0x1d1b19, .95)); } });
  g.userData.part = p; g.userData.W = W; g.userData.D = D;
  return g;
}

// ---------- the scene ----------
const WIRE_COLORS = { pos: 0xd0362a, neg: 0x1f2124, sig: [0xe8b923, 0x2f8be0, 0x3fb950, 0xe07a1a, 0x9b59b6, 0x1abc9c], gen: 0xf2f2f2 };

function woodTex() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#7a5232'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const y = Math.random() * h; g.strokeStyle = `rgba(${40 + Math.random() * 40},${22 + Math.random() * 20},10,${.08 + Math.random() * .18})`;
      g.lineWidth = 1 + Math.random() * 3; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 64) g.lineTo(x, y + Math.sin(x / 140 + i) * 6); g.stroke(); }
    for (let i = 0; i < 7; i++) { g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(0, i * h / 7, w, 3); }
  }, 'wood');
}
function matTex() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#1d5a4a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(210,240,230,.22)'; g.lineWidth = 1.2;
    for (let i = 0; i <= 40; i++) { const p = i * w / 40; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
    g.strokeStyle = 'rgba(210,240,230,.45)'; g.lineWidth = 2.4;
    for (let i = 0; i <= 8; i++) { const p = i * w / 8; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
  }, 'mat');
}

function breadboardTex(W, D) {
  return canvasTex(1024, Math.max(128, Math.round(1024 * D / W)), (g, w, h) => {
    g.fillStyle = '#f3f1ea'; g.fillRect(0, 0, w, h);
    const px = w / (W * 100) * 10;                       // one 2.54 mm-style pitch every 10 bench px
    const rail = Math.min(h * .12, px * 2.6);
    g.fillStyle = '#e9e6dc'; g.fillRect(0, h / 2 - px * .6, w, px * 1.2);   // centre channel
    for (const [y, c] of [[rail * .35, '#d0362a'], [rail * .95, '#2f62d8'], [h - rail * .95, '#d0362a'], [h - rail * .35, '#2f62d8']]) { g.fillStyle = c; g.globalAlpha = .7; g.fillRect(px, y - 1.5, w - px * 2, 3); }
    g.globalAlpha = 1; g.fillStyle = '#3a3a36';
    for (let y = rail * 1.4; y < h - rail * 1.4; y += px) { if (Math.abs(y - h / 2) < px * .9) continue;
      for (let x = px; x < w - px * .5; x += px) g.fillRect(x - px * .17, y - px * .17, px * .34, px * .34); }
    for (const y of [rail * .55, rail * .75, h - rail * .75, h - rail * .55]) for (let x = px * 1.5; x < w - px; x += px) if ((x / px | 0) % 6) g.fillRect(x - px * .15, y - px * .15, px * .3, px * .3);
  }, 'bb' + W.toFixed(2) + D.toFixed(2));
}

function makeEnv(renderer) {
  // A soft studio room for reflections (adapted from three.js RoomEnvironment).
  const env = new THREE.Scene(); const geo = new THREE.BoxGeometry(); geo.deleteAttribute('uv');
  const room = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side: THREE.BackSide })); room.position.set(-.757, 13.219, .717); room.scale.set(31.713, 28.305, 28.591); env.add(room);
  const pl = new THREE.PointLight(0xffffff, 900, 28, 2); pl.position.set(.418, 16.199, .3); env.add(pl);
  const area = (i, p, s) => { const m = new THREE.MeshBasicMaterial(); m.color.setScalar(i); const b = new THREE.Mesh(geo, m); b.position.set(...p); b.scale.set(...s); env.add(b); };
  area(50, [-16.116, 14.37, 8.208], [.1, 2.428, 2.739]); area(50, [-16.109, 18.021, -8.207], [.1, 2.425, 2.751]);
  area(17, [14.904, 12.198, -1.832], [.15, 4.265, 6.331]); area(43, [-.462, 8.89, 14.52], [4.38, 5.441, .088]);
  area(20, [3.235, 11.486, -12.541], [2.5, 2, .1]); area(100, [0, 20, 0], [1, .1, 1]);
  const pm = new THREE.PMREMGenerator(renderer); const tex = pm.fromScene(env, .04).texture; pm.dispose();
  return tex;
}

export function open(container, api) {
  const { S, PD } = api;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!api.keepBuffer });
  const mobile = matchMedia('(pointer:coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101416);
  scene.environment = makeEnv(renderer); scene.environmentIntensity = .55;
  scene.fog = new THREE.Fog(0x101416, 18, 40);

  const camera = new THREE.PerspectiveCamera(38, 1, .05, 120);
  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x3a2a1a, .55); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e2, 2.4); sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02; sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xbfd6ff, .5); fill.position.set(-6, 5, -4); scene.add(fill);
  const glowLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffffff, 0, 2.2, 2); scene.add(l); return l; });

  // table and cutting mat
  const wood = woodTex(); wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(3, 3);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: wood, roughness: .75 }));
  table.rotation.x = -Math.PI / 2; table.position.y = -.012; table.receiveShadow = true; scene.add(table);
  const mtx = matTex(); mtx.wrapS = mtx.wrapT = THREE.RepeatWrapping;
  const mat3 = new THREE.Mesh(new THREE.BoxGeometry(1, .01, 1), new THREE.MeshStandardMaterial({ map: mtx, roughness: .9 }));
  mat3.position.y = -.005; mat3.receiveShadow = true; scene.add(mat3);

  const root = new THREE.Group(); scene.add(root);
  let parts = new Map(), wires = [], bounds = { cx: 480, cy: 280, w: 6, d: 4 };
  const sparkTex = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, 'spark');

  const toW = (x, y) => new THREE.Vector3((x - bounds.cx) / U, 0, (y - bounds.cy) / U);
  let place = new Map();   // part id -> { c: world centre, lift: height of what it stands on }

  function structureKey() {
    return S.parts.map(p => [p.id, p.type, Math.round(p.x), Math.round(p.y), p.burnt ? 1 : 0, JSON.stringify(p.props || {})].join(',')).join('|') + '#' + S.wires.map(w => w.join('-')).join('|');
  }

  function clearRoot() {
    root.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    root.clear(); parts = new Map(); wires = [];
  }

  function rebuild() {
    clearRoot(); place = new Map();
    if (S.parts.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      S.parts.forEach(p => { const d = PD[p.type]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + d.w); y1 = Math.max(y1, p.y + d.h); });
      bounds = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: 0, d: 0 };
    }
    // where each part goes: its 2D centre pulled towards the middle
    let ex0 = Infinity, ez0 = Infinity, ex1 = -Infinity, ez1 = -Infinity;
    for (const p of S.parts) { const d = PD[p.type]; if (!d) continue; const c = toW(p.x + d.w / 2, p.y + d.h / 2).multiplyScalar(LF);
      place.set(p.id, { c, lift: 0, w: d.w / U, d: d.h / U });
      ex0 = Math.min(ex0, c.x - d.w / U / 2); ex1 = Math.max(ex1, c.x + d.w / U / 2); ez0 = Math.min(ez0, c.z - d.h / U / 2); ez1 = Math.max(ez1, c.z + d.h / U / 2); }
    if (place.size) { const ox = (ex0 + ex1) / 2, oz = (ez0 + ez1) / 2; for (const v of place.values()) { v.c.x -= ox; v.c.z -= oz; } bounds.w = ex1 - ex0; bounds.d = ez1 - ez0; }
    else { bounds.w = 6; bounds.d = 4; }
    // breadboards: small through-hole parts that sit close together share one board
    const small = S.parts.filter(p => ON_BB.has(p.type) && place.has(p.id));
    const grp = new Map(small.map(p => [p.id, p.id])); const find = i => grp.get(i) === i ? i : find(grp.get(i));
    for (const a of small) for (const b of small) { if (a.id >= b.id) continue; const A = place.get(a.id), B = place.get(b.id);
      if (Math.abs(A.c.x - B.c.x) < (A.w + B.w) / 2 + .45 && Math.abs(A.c.z - B.c.z) < (A.d + B.d) / 2 + .45) grp.set(find(a.id), find(b.id)); }
    const clusters = new Map(); for (const p of small) { const k = find(p.id); if (!clusters.has(k)) clusters.set(k, []); clusters.get(k).push(p); }
    // one rectangle per group, then join any boards that would overlap so they never stack on each other
    let boards = [...clusters.values()].map(list => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of list) { const v = place.get(p.id); x0 = Math.min(x0, v.c.x - v.w / 2); x1 = Math.max(x1, v.c.x + v.w / 2); z0 = Math.min(z0, v.c.z - v.d / 2); z1 = Math.max(z1, v.c.z + v.d / 2); v.lift = BB_H; }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = Math.max(1.6, x1 - x0 + .5), D = Math.max(1.1, z1 - z0 + .5);
      return { x0: cx - W / 2, x1: cx + W / 2, z0: cz - D / 2, z1: cz + D / 2 }; });
    for (let merged = true; merged;) { merged = false;
      for (let i = 0; i < boards.length && !merged; i++) for (let j = i + 1; j < boards.length && !merged; j++) { const a = boards[i], b = boards[j];
        if (a.x0 < b.x1 + .05 && b.x0 < a.x1 + .05 && a.z0 < b.z1 + .05 && b.z0 < a.z1 + .05) {
          boards[i] = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1) }; boards.splice(j, 1); merged = true; } } }
    for (const b of boards) { const W = b.x1 - b.x0, D = b.z1 - b.z0;
      const bb = texBox(W, BB_H, D, breadboardTex(W, D), 0xeceae2, .7); bb.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2); root.add(bb); }
    mat3.scale.set(bounds.w + 1.6, 1, bounds.d + 1.6); mtx.repeat.set((bounds.w + 1.6) / 4, (bounds.d + 1.6) / 4);
    for (const p of S.parts) {
      const d = PD[p.type]; if (!d) continue; const pl = place.get(p.id);
      const g = buildPart(p, d, api); g.position.set(pl.c.x, pl.lift, pl.c.z);
      root.add(g); parts.set(p.id, g);
      if (g.userData.glow) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: g.userData.glow.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
        s.position.copy(g.userData.glow.pos); s.scale.setScalar(.6); g.add(s); g.userData.glow.sprite = s; }
    }
    // wires: a sagging cable between the two pins, with plug housings at both ends
    let sigN = 0;
    S.wires.forEach(([a, b]) => {
      const A = api.portPos(a), B = api.portPos(b); if (!A || !B) return;
      const kind = api.wireKind(A, B); const color = kind === 'sig' ? WIRE_COLORS.sig[sigN++ % WIRE_COLORS.sig.length] : WIRE_COLORS[kind];
      const pa = pinW(A), pb = pinW(B); const hA = pa.y, hB = pb.y;
      const dist = pa.distanceTo(pb); const lift = .18 + Math.min(1.1, dist * .16);
      const dirA = sideDir(A.s), dirB = sideDir(B.s);
      const pts = [pa, pa.clone().add(new THREE.Vector3(0, .12, 0)), pa.clone().add(new THREE.Vector3(dirA.x * .15, lift * .8, dirA.z * .15)),
        pa.clone().lerp(pb, .5).add(new THREE.Vector3(0, lift, 0)),
        pb.clone().add(new THREE.Vector3(dirB.x * .15, lift * .8, dirB.z * .15)), pb.clone().add(new THREE.Vector3(0, .12, 0)), pb];
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', .5);
      const m = mat('w' + color, () => std(color, .42));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, .016, 10, false), m); tube.castShadow = true; root.add(tube);
      for (const [pt, hh] of [[pa, hA], [pb, hB]]) { const plug = box(.05, .11, .05, black(), pt.x, hh - .02, pt.z); root.add(plug); }
      wires.push(tube);
    });
    fitSun();
  }
  function pinW(A) {
    // the pin's place on the placed 3D model (not the raw 2D position, because the layout is pulled together)
    const d = PD[A.p.type], pl = place.get(A.p.id) || { c: new THREE.Vector3(), lift: 0 };
    return new THREE.Vector3(pl.c.x + (A.q[1] - d.w / 2) / U, pinHeight(A) + pl.lift, pl.c.z + (A.q[2] - d.h / 2) / U);
  }
  function pinHeight(A) { const d = PD[A.p.type]; return d.board || /^(ultrasonic|lcd|relay|driver|ldr|temp|pir)$/.test(A.p.type) || d.gen ? PCB + .085 + .02 : .1; }
  function sideDir(s) { return s === 'top' ? new THREE.Vector3(0, 0, -1) : s === 'bottom' ? new THREE.Vector3(0, 0, 1) : s === 'left' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0); }
  function fitSun() {
    const r = Math.max(bounds.w, bounds.d) / 2 + 1.2;
    sun.position.set(r * .9, r * 2.2 + 3, r * 1.3); sun.target.position.set(0, 0, 0);
    const sc = sun.shadow.camera; sc.left = -r * 1.4; sc.right = r * 1.4; sc.top = r * 1.4; sc.bottom = -r * 1.4; sc.near = .5; sc.far = r * 6 + 10; sc.updateProjectionMatrix();
  }

  // ---------- camera control: drag to orbit, pinch or wheel to zoom, two fingers or right-drag to pan ----------
  const ctl = { theta: -.55, phi: .95, r: 7, target: new THREE.Vector3(), goal: null, auto: false };
  const want = { theta: ctl.theta, phi: ctl.phi, r: ctl.r, target: ctl.target.clone() };
  function fit(view = 'persp') {
    // distance that makes the circuit fill the view: width limited by the aspect ratio, depth by the vertical field of view
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), asp = Math.max(.5, camera.aspect || 1.6);
    const need = Math.max((bounds.w + .5) / (2 * t * asp), (bounds.d + .6) / (2 * t), 2.2);
    want.r = need * (view === 'top' ? 1.05 : 1.22) + .5; want.target.set(0, .1, view === 'top' ? 0 : .15);
    if (view === 'top') { want.phi = .02; want.theta = 0; }
    else if (view === 'front') { want.phi = 1.25; want.theta = 0; }
    else if (view === 'side') { want.phi = 1.15; want.theta = Math.PI / 2; }
    else { want.phi = .92; want.theta = -.5; }
  }
  const ptrs = new Map(); let last = null, pinch = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }); ctl.auto = false; el.style.cursor = 'grabbing'; if (ptrs.size === 2) pinch = null; });
  el.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      if (p.b === 2 || p.sh) pan(dx, dy); else { want.theta -= dx * .0065; want.phi = Math.max(.02, Math.min(1.45, want.phi - dy * .0055)); }
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinch) { want.r = Math.max(1.5, Math.min(40, want.r * pinch.dist / Math.max(1, dist))); pan((mid.x - pinch.mid.x), (mid.y - pinch.mid.y)); }
      pinch = { dist, mid };
    }
  });
  const up = e => { ptrs.delete(e.pointerId); pinch = null; if (!ptrs.size) el.style.cursor = 'grab'; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('wheel', e => { e.preventDefault(); want.r = Math.max(1.5, Math.min(40, want.r * Math.exp(e.deltaY * .0012))); }, { passive: false });
  el.addEventListener('dblclick', () => fit());
  function pan(dx, dy) {
    const k = want.r * .0016; const right = new THREE.Vector3(Math.cos(want.theta), 0, -Math.sin(want.theta)); const fwd = new THREE.Vector3(Math.sin(want.theta), 0, Math.cos(want.theta));
    want.target.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k);
  }

  // ---------- on-screen buttons ----------
  const ui = document.createElement('div'); ui.className = 'v3d-ui';
  ui.innerHTML = `<div class="v3d-bar"><button data-v="persp">3D</button><button data-v="top">Top</button><button data-v="front">Front</button><button data-v="side">Side</button><button data-v="fit">Fit</button><button data-v="spin" aria-pressed="false" aria-label="Spin">↻<span> Spin</span></button><button data-v="full" aria-pressed="false" aria-label="Full screen">⛶</button></div>
    <div class="v3d-hint">Drag to look around · pinch or scroll to zoom</div>`;
  container.appendChild(ui);
  ui.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; const v = b.dataset.v;
    if (v === 'spin') { ctl.auto = !ctl.auto; b.setAttribute('aria-pressed', ctl.auto); }
    else if (v === 'full') { const on = !container.classList.contains('full'); container.classList.toggle('full', on); b.setAttribute('aria-pressed', on); setTimeout(() => fit(), 60); }
    else fit(v === 'fit' ? 'persp' : v); });
  setTimeout(() => { const h = ui.querySelector('.v3d-hint'); if (h) h.style.opacity = '0'; }, 4500);

  function resize() { const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // ---------- live updates from the simulation ----------
  let key = '', keyT = 0, raf = 0, alive = true, t0 = performance.now();
  function update(now) {
    if (now - keyT > 250) { keyT = now; const k = structureKey(); if (k !== key) { const first = !key; key = k; rebuild(); if (first) { fit(); Object.assign(ctl, { theta: want.theta + .9, phi: .55, r: want.r * 1.35 }); ctl.target.copy(want.target); } } }
    const glows = [];
    for (const [id, g] of parts) {
      const p = g.userData.part; const live = S.parts.find(q => q.id === id) || p; const st = live.st || {};
      const u = g.userData;
      if (u.glow) {
        let b = 0; if (!live.burnt) { if (u.glow.kind === 'led') b = st.on ? Math.min(1.3, st.bright || 1) : 0; else if (u.glow.kind === 'alarm') b = st.on ? (Math.floor(now / 220) % 2 ? 1.1 : .25) : 0; else b = st.on ? Math.min(1.3, st.bright ?? 1) : 0; }
        u.glow.mat.emissiveIntensity = b * (u.glow.kind === 'bulb' ? 2.2 : 2.6); if (u.glow.fil) u.glow.fil.emissiveIntensity = b * 4;
        u.glow.sprite.material.opacity = Math.min(1, b); u.glow.sprite.scale.setScalar((u.glow.kind === 'bulb' ? 1.8 : u.glow.kind === 'alarm' ? 1.3 : .95) * (.7 + b * .5));
        if (b > .05) glows.push({ b, g, u });
      }
      if (u.horn) u.horn.rotation.y = -((st.angle || 0) - 90) * Math.PI / 180;
      if (u.spin) u.spin.rotation.y = -(st.rot || 0) * Math.PI / 180;
      if (u.spinZ) u.spinZ.rotation.z = (st.rot || 0) * Math.PI / 180;
      if (u.lcd) drawLcd(u.lcd, st.text, !!st.on && !live.burnt);
      if (u.meter) drawMeter(u.meter, live.type === 'voltmeter' ? st.v : st.i);
      if (u.press) u.press.position.y = .1 - (live.on ? .03 : 0);
      if (u.slide) u.slide.nub.position.x = (live.on ? 1 : -1) * u.slide.W * .12;
      if (u.keys) u.keys.forEach((k, i) => { k.position.y = .02 + .0175 - (live.kidx === i + 1 ? .015 : 0); });
      if (u.buzz && st.on && !live.burnt) g.position.y = Math.sin(now / 9) * .003; else if (u.buzz) g.position.y = 0;
    }
    glows.sort((a, b) => b.b - a.b);
    glowLights.forEach((l, i) => { const x = glows[i]; if (!x) { l.intensity = 0; return; }
      l.color.setHex(x.u.glow.color); l.intensity = x.b * (x.u.glow.kind === 'bulb' ? 4 : 2.6); x.g.localToWorld(l.position.copy(x.u.glow.pos)); });
    // smooth camera
    if (ctl.auto) want.theta += .0035;
    const k = .14; ctl.theta += (want.theta - ctl.theta) * k; ctl.phi += (want.phi - ctl.phi) * k; ctl.r += (want.r - ctl.r) * k; ctl.target.lerp(want.target, k);
    camera.position.set(ctl.target.x + ctl.r * Math.sin(ctl.phi) * Math.sin(ctl.theta), ctl.target.y + ctl.r * Math.cos(ctl.phi), ctl.target.z + ctl.r * Math.sin(ctl.phi) * Math.cos(ctl.theta));
    camera.lookAt(ctl.target);
  }
  function loop(now) { if (!alive) return; raf = requestAnimationFrame(loop); if (document.hidden) return; update(now); renderer.render(scene, camera); }
  raf = requestAnimationFrame(loop);
  void t0;

  return {
    exitFull() { if (!container.classList.contains('full')) return false; container.classList.remove('full'); const b = ui.querySelector('[data-v=full]'); if (b) b.setAttribute('aria-pressed', false); setTimeout(() => fit(), 60); return true; },
    close() { container.classList.remove('full'); alive = false; cancelAnimationFrame(raf); ro.disconnect(); clearRoot(); renderer.dispose(); scene.environment && scene.environment.dispose(); container.innerHTML = ''; },
    fit, snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', .9); },
    view: (v) => fit(v), settle() { Object.assign(ctl, { theta: want.theta, phi: want.phi, r: want.r }); ctl.target.copy(want.target); },
  };
}
