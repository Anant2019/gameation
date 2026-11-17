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

// A PCB top: glossy solder mask, copper traces under the mask, vias, pads, silkscreen outlines, pin names and a label.
// pins: optional [{n,x,z,side}] in board units so the silkscreen names sit next to each header pin.
function pcbTex(color, W, D, label, seed = 1, sub = '', at = null, pins = null) {
  const TW = W > 1.4 ? 2048 : 1024, TH = Math.max(128, Math.round(TW * D / W));
  return canvasTex(TW, TH, (g, w, h) => {
    const px = w / W;
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    const r = (n => () => (n = (n * 9301 + 49297) % 233280) / 233280)(seed * 977 + 13);
    // copper under the mask shows as slightly lighter lines with 45° bends
    g.strokeStyle = shade(color, 1.28); g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 46; i++) { g.lineWidth = [3, 4, 6, 9][Math.floor(r() * 4)]; g.globalAlpha = .55; g.beginPath();
      let x = r() * w, y = r() * h; g.moveTo(x, y);
      for (let k = 0; k < 3; k++) { const L = 30 + r() * 160, dir = Math.floor(r() * 8) * Math.PI / 4; x += Math.cos(dir) * L; y += Math.sin(dir) * L; g.lineTo(x, y); }
      g.stroke(); g.globalAlpha = 1; g.fillStyle = '#c9b46a'; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); g.fillStyle = '#2a2a24'; g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); }
    // ground pour hatch near the edges
    g.globalAlpha = .12; g.fillStyle = shade(color, 1.4); g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10); g.globalAlpha = 1;
    // silkscreen boxes for parts that are not modelled
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
    for (let i = 0; i < 7; i++) { const bw = 26 + r() * 50, bh = 14 + r() * 26, x = 60 + r() * (w - 160), y = 50 + r() * (h - 120); g.strokeRect(x, y, bw, bh);
      g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `600 13px ${FONT}`; g.fillText(['R', 'C', 'U', 'D', 'L', 'Q'][i % 6] + (1 + Math.floor(r() * 30)), x, y - 4); }
    // mounting holes: gold ring, dark hole
    for (const [x, y] of [[18, 18], [w - 18, 18], [18, h - 18], [w - 18, h - 18]]) { g.fillStyle = '#d4bd72'; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill(); g.fillStyle = '#141414'; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill(); }
    // plated through-hole pads: gold ring, dark hole, a bright solder dome
    if (pins) for (const q of pins) { const x = (q.x / W + .5) * w, y = (q.z / D + .5) * h, R = Math.max(7, .045 * px);
      g.fillStyle = '#d9bf6a'; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); const sg = g.createRadialGradient(x - R * .3, y - R * .3, 1, x, y, R * .8); sg.addColorStop(0, '#f4f6f7'); sg.addColorStop(1, '#8d9396');
      g.fillStyle = sg; g.beginPath(); g.arc(x, y, R * .72, 0, 7); g.fill(); }
    // pin names beside the headers
    if (pins) { g.fillStyle = 'rgba(255,255,255,.92)'; g.textAlign = 'center'; const fs = Math.max(11, Math.min(18, (w / Math.max(8, pins.length)) * .5)); g.font = `700 ${fs}px ${FONT}`;
      for (const q of pins) { const x = (q.x / W + .5) * w, y = (q.z / D + .5) * h; const off = 28;
        const ty = q.side === 'top' ? y + off + fs : q.side === 'bottom' ? y - off : y + fs * .35; const tx = q.side === 'left' ? x + off + 10 : q.side === 'right' ? x - off - 10 : x;
        g.fillText(q.n.replace('GPIO', ''), tx, Math.max(fs, Math.min(h - 4, ty))); } }
    g.textAlign = 'left';
    if (label) { g.fillStyle = 'rgba(255,255,255,.92)'; const fs = Math.min(at ? 64 : 84, h * .18); g.font = `800 ${fs}px ${FONT}`;
      if (at) g.fillText(label, w * at[0], h * at[1]); else { g.textAlign = 'center'; g.fillText(label, w / 2, h * .6); } }
    if (sub) { g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `600 ${Math.min(34, h * .1)}px ${FONT}`; g.textAlign = at ? 'left' : 'center'; g.fillText(sub, at ? w * at[0] : w / 2, at ? h * at[1] + 40 : h * .78); }
  }, `pcb2${color}${label}${sub}${W.toFixed(2)}${D.toFixed(2)}${at}${pins ? pins.map(q => q.n).join('') : ''}`);
}
// A circuit board slab: glossy solder mask on top, darker edges.
function pcbBox(w, d, tex, sideColor) {
  const side = mat('pcbside' + sideColor, () => std(new THREE.Color(sideColor), .6));
  const top = new THREE.MeshPhysicalMaterial({ map: tex, roughness: .55, clearcoat: .55, clearcoatRoughness: .25 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, PCB, d), [side, side, top, side, side, side]); b.position.y = PCB / 2; b.castShadow = true; b.receiveShadow = true; return b;
}
// Laser-etched chip top: dark epoxy, grey text, pin-1 dot.
function chipTex(text, sub = '', w = 256, h = 256) {
  return canvasTex(w, h, (g) => { g.fillStyle = '#17191b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * .025})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = 'rgba(205,210,214,.82)'; g.textAlign = 'center'; g.font = `700 ${Math.min(44, w / Math.max(6, text.length) * 1.5)}px ${FONT}`; g.fillText(text, w / 2, h * .5);
    if (sub) { g.font = `500 ${Math.min(26, w / 10)}px ${FONT}`; g.fillStyle = 'rgba(205,210,214,.6)'; g.fillText(sub, w / 2, h * .5 + 34); }
    g.fillStyle = '#0c0d0e'; g.beginPath(); g.arc(w * .14, h * .2, Math.min(w, h) * .05, 0, 7); g.fill(); }, `chip${text}${sub}${w}${h}`);
}
const RNG = s => () => (s = (s * 9301 + 49297) % 233280) / 233280;
// Many copies of one small mesh in a single draw call.
function instances(geo, m, list) {
  const im = new THREE.InstancedMesh(geo, m, list.length); const o = new THREE.Object3D();
  list.forEach(([x, y, z, ry = 0], i) => { o.position.set(x, y, z); o.rotation.set(0, ry, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.castShadow = true; im.receiveShadow = true; return im;
}
const goldPin = () => mat('goldpin', () => std(0xe2c06a, .25, 1));
// Pin headers. Male: black base strip with square gold pins standing up. Female: a tall black socket with a hole per pin.
function headerRow(g, pts, h = .085, female = false, y0 = PCB) {
  if (!pts.length) return;
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
  const minX = Math.min(...xs) - .06, maxX = Math.max(...xs) + .06, minZ = Math.min(...zs) - .06, maxZ = Math.max(...zs) + .06;
  const w = horizontal ? maxX - minX : .1, d = horizontal ? .1 : maxZ - minZ;
  if (female) {
    g.add(box(w, h, d, mat('femhdr', () => std(0x141517, .45)), (minX + maxX) / 2, y0, (minZ + maxZ) / 2));
    g.add(instances(new THREE.BoxGeometry(.045, .004, .045), mat('hole', () => std(0x030303, .95)), pts.map(([x, z]) => [x, y0 + h + .001, z])));
    g.add(instances(new THREE.BoxGeometry(.018, .004, .018), goldPin(), pts.map(([x, z]) => [x, y0 + h + .002, z])));
  } else {
    g.add(box(w, .028, d, mat('malehdr', () => std(0x141517, .5)), (minX + maxX) / 2, y0, (minZ + maxZ) / 2));
    g.add(instances(new THREE.BoxGeometry(.016, h, .016), goldPin(), pts.map(([x, z]) => [x, y0 + h / 2, z])));
  }
}
// Little surface-mount parts sprinkled over free board space (resistors, capacitors, SOT-23 transistors), avoiding the big parts.
function smdScatter(g, W, D, seed, n, avoid = [], y0 = PCB) {
  const r = RNG(seed * 131 + 7), res = [], cap = [], ends = [], sot = [];
  const free = (x, z) => Math.abs(x) < W / 2 - .12 && Math.abs(z) < D / 2 - .16 && !avoid.some(([ax, az, aw, ad]) => Math.abs(x - ax) < aw / 2 + .04 && Math.abs(z - az) < ad / 2 + .04);
  for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) { const x = (r() - .5) * W, z = (r() - .5) * D; if (!free(x, z)) continue; i++;
    const ry = r() < .5 ? 0 : Math.PI / 2, kind = r();
    if (kind < .45) { res.push([x, y0 + .009, z, ry]); ends.push([x + Math.cos(ry) * .024, y0 + .009, z - Math.sin(ry) * .024, ry], [x - Math.cos(ry) * .024, y0 + .009, z + Math.sin(ry) * .024, ry]); }
    else if (kind < .85) { cap.push([x, y0 + .011, z, ry]); ends.push([x + Math.cos(ry) * .024, y0 + .009, z - Math.sin(ry) * .024, ry], [x - Math.cos(ry) * .024, y0 + .009, z + Math.sin(ry) * .024, ry]); }
    else sot.push([x, y0 + .012, z, ry]); }
  if (res.length) g.add(instances(new THREE.BoxGeometry(.04, .018, .022), mat('smdres', () => std(0x141414, .5)), res));
  if (cap.length) g.add(instances(new THREE.BoxGeometry(.04, .022, .022), mat('smdcap', () => std(0xb08a5a, .55)), cap));
  if (ends.length) g.add(instances(new THREE.BoxGeometry(.01, .02, .024), mat('smdend', () => std(0xd8dcdf, .3, 1)), ends));
  if (sot.length) g.add(instances(new THREE.BoxGeometry(.05, .024, .032), mat('sot', () => std(0x18191b, .5)), sot));
}
// Integrated circuits. qfp: square chip with gull-wing legs on four sides; dip: through-hole chip with bent legs on two sides.
function qfp(g, x, z, s, text, sub = '', y0 = PCB, rot = 0) {
  const c = new THREE.Group(); c.position.set(x, y0, z); c.rotation.y = rot; g.add(c);
  const body = texBox(s, .03, s, chipTex(text, sub), 0x17191b, .5); body.position.y = .004; c.add(body);
  const n = Math.max(4, Math.round(s / .03)), legs = [];
  for (let i = 0; i < n; i++) { const t = (i + .5) / n * s * .86 - s * .43; legs.push([t, .006, s / 2 + .012, 0], [t, .006, -s / 2 - .012, 0], [s / 2 + .012, .006, t, Math.PI / 2], [-s / 2 - .012, .006, t, Math.PI / 2]); }
  c.add(instances(new THREE.BoxGeometry(.01, .006, .026), metal(), legs)); return c;
}
function dip(g, x, z, len, wid, n, text, sub = '', y0 = PCB) {
  const c = new THREE.Group(); c.position.set(x, y0, z); g.add(c);
  const body = texBox(len, .07, wid, chipTex(text, sub, 512, 160), 0x17191b, .5); body.position.y = .03; c.add(body);
  c.add(at(cyl(.025, .004, mat('notch', () => std(0x0b0b0b, .8)), 0, 0, 0, 16), -len / 2 + .045, .1, 0));
  const legs = [], feet = []; for (let i = 0; i < n; i++) { const t = (i + .5) / n * len - len / 2; for (const s of [-1, 1]) { legs.push([t, .06, s * (wid / 2 + .012), 0]); feet.push([t, .02, s * (wid / 2 + .022), 0]); } }
  c.add(instances(new THREE.BoxGeometry(.03, .012, .03), metal(), legs)); c.add(instances(new THREE.BoxGeometry(.016, .05, .01), metal(), feet)); return c;
}
// Connectors and small parts used on many boards.
function usbB(g, x, z, rot = 0) { const c = new THREE.Group(); c.position.set(x, PCB, z); c.rotation.y = rot; g.add(c);
  c.add(box(.42, .3, .36, mat('usbshell', () => std(0xd9dde0, .3, 1))));
  const mouth = box(.012, .18, .22, mat('usbmouth', () => std(0x050505, .9)), -.21, .06, 0); c.add(mouth);
  c.add(box(.014, .1, .1, plastic(0xf2f2ee), -.2, .1, 0)); return c; }
function usbMicro(g, x, z, rot = 0, wide = .2) { const c = new THREE.Group(); c.position.set(x, PCB, z); c.rotation.y = rot; g.add(c);
  c.add(box(.16, .06, wide, mat('usbshell', () => std(0xd9dde0, .3, 1)))); c.add(box(.012, .03, wide * .7, mat('usbmouth', () => std(0x050505, .9)), -.08, .015, 0)); return c; }
function dcJack(g, x, z) { const c = new THREE.Group(); c.position.set(x, PCB, z); g.add(c);
  c.add(box(.4, .26, .22, mat('jack', () => std(0x101112, .45))));
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .02, 24), mat('hole', () => std(0x030303, .95))); hole.rotation.z = Math.PI / 2; hole.position.set(-.2, .13, 0); c.add(hole);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .03, 12), metal()); pin.rotation.z = Math.PI / 2; pin.position.set(-.205, .13, 0); c.add(pin); return c; }
function crystal(g, x, z, y0 = PCB) { const c = new THREE.Mesh(new THREE.CapsuleGeometry(.04, .1, 6, 16), mat('xtal', () => std(0xdfe3e6, .25, 1))); c.rotation.z = Math.PI / 2; c.scale.set(1, 1, .45); c.position.set(x, y0 + .04, z); c.castShadow = true; g.add(c); }
function tactile(g, x, z, cap = 0xd0362a, y0 = PCB) { g.add(box(.12, .04, .12, mat('tactbody', () => std(0xc8ccd0, .3, 1)), x, y0, z)); g.add(cyl(.035, .03, plastic(cap), x, y0 + .04, z, 20)); }
function eCap(g, x, z, r = .06, h = .16, y0 = PCB) { const c = cyl(r, h, mat('ecap', () => std(0x1c1f24, .35, .2)), x, y0, z, 28); g.add(c);
  g.add(cyl(r * .92, .004, mat('ecaptop', () => std(0xc9ced2, .3, 1)), x, y0 + h, z, 28)); g.add(box(r * 1.5, .006, .008, mat('ecapx', () => std(0x6e767c, .4, 1)), x, y0 + h + .003, z));
  const st = new THREE.Mesh(new THREE.CylinderGeometry(r + .001, r + .001, h * .95, 28, 1, true, 0, .9), mat('ecapstripe', () => std(0xb8bec4, .4))); st.position.set(x, y0 + h / 2, z); g.add(st); }
function smdLed(g, x, z, color, y0 = PCB) { const m = std(color, .3, 0, { emissive: color, emissiveIntensity: 1.6 }); g.add(box(.03, .016, .02, m, x, y0, z)); return m; }
function shieldTex(text, sub) { return canvasTex(512, 384, (g, w, h) => { g.fillStyle = '#c8ccd0'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { g.strokeStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '90,95,100'},${Math.random() * .12})`; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.lineTo(w, y + Math.random() * 4 - 2); g.stroke(); }
  g.fillStyle = 'rgba(60,64,68,.85)'; g.font = `700 46px ${FONT}`; g.textAlign = 'center'; g.fillText(text, w / 2, h * .42); g.font = `500 28px ${FONT}`; g.fillText(sub, w / 2, h * .58);
  g.strokeStyle = 'rgba(60,64,68,.5)'; g.lineWidth = 3; g.strokeRect(14, 14, w - 28, h - 28); }, 'shield' + text); }
function antennaTex() { return canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#16191b'; g.fillRect(0, 0, w, h); g.strokeStyle = '#a8925a'; g.lineWidth = 7; g.beginPath(); g.moveTo(20, h - 14);
  for (let i = 0; i < 6; i++) { const x = 34 + i * 34; g.lineTo(x, h - 14); g.lineTo(x, 20); g.lineTo(x + 17, 20); g.lineTo(x + 17, h - 14); } g.stroke(); }, 'antenna'); }

const MALE_BOARD = /^(nano|esp32|pico)$/, HDR_LIFT = .11;
function boardModel(p, d, W, D) {
  const g = new THREE.Group(); const t = p.type, ps = portsLocal(d, W, D);
  const names = { arduino: ['UNO', 'ARDUINO'], nano: ['NANO', 'ARDUINO'], mega: ['MEGA 2560', 'ARDUINO'], rpi: ['Raspberry Pi 4 Model B', '© Raspberry Pi'], pi5: ['Raspberry Pi 5', '© Raspberry Pi'],
    pizero: ['Raspberry Pi Zero 2 W', ''], pico: ['Raspberry Pi Pico', '© 2020'], esp32: ['ESP32 DevKitC', 'WROOM-32'] }[t] || [d.name, ''];
  const ard = /^(arduino|mega|nano)$/.test(t), pi = /^(rpi|pi5|pizero)$/.test(t);
  const color = t === 'esp32' ? '#14181b' : d.sw;
  const labelAt = ard ? [.36, .62] : pi ? [.08, .62] : [.3, .62];
  g.add(pcbBox(W, D, pcbTex(color, W, D, names[0], p.id + 3, names[1], labelAt, ps), shade(color, .65)));
  const female = t === 'arduino' || t === 'mega', male = MALE_BOARD.test(t);
  if (!male) for (const side of ['top', 'bottom', 'left', 'right']) { const row = ps.filter(q => q.side === side).map(q => [q.x, q.z]); if (row.length) headerRow(g, row, female ? .085 : .07, female); }
  const avoid = [];
  if (t === 'arduino' || t === 'mega') {
    usbB(g, -W / 2 + .14, -D * .2); avoid.push([-W / 2 + .14, -D * .2, .5, .42]);
    dcJack(g, -W / 2 + .14, D * .27); avoid.push([-W / 2 + .14, D * .27, .46, .3]);
    if (t === 'arduino') { dip(g, W * .2, D * .12, .72, .16, 14, 'ATMEGA328P', 'AU 1952'); avoid.push([W * .2, D * .12, .8, .3]); }
    else { qfp(g, W * .12, D * .02, .3, 'ATMEGA2560', '16AU'); avoid.push([W * .12, D * .02, .4, .4]); }
    qfp(g, -W * .2, -D * .2, .12, '16U2'); avoid.push([-W * .2, -D * .2, .18, .18]);
    crystal(g, -W * .08, -D * .05); avoid.push([-W * .08, -D * .05, .22, .1]);
    tactile(g, -W * .36, -D * .38); avoid.push([-W * .36, -D * .38, .16, .16]);
    eCap(g, -W * .22, D * .3); eCap(g, -W * .1, D * .3); avoid.push([-W * .16, D * .3, .3, .16]);
    g.add(box(.14, .05, .1, mat('reg', () => std(0x17191b, .5)), -W * .3, PCB, D * .1)); avoid.push([-W * .3, D * .1, .18, .14]);
    headerRow(g, [[W * .45, -.05], [W * .45, .05], [W * .45 - .1, -.05], [W * .45 - .1, .05], [W * .45 - .2, -.05], [W * .45 - .2, .05]], .07); avoid.push([W * .4, 0, .3, .2]);
    const leds = [smdLed(g, W * .02, -D * .3, 0xffc23a), smdLed(g, W * .02, -D * .24, 0xffc23a), smdLed(g, W * .02, -D * .18, 0xffc23a), smdLed(g, W * .3, -D * .3, 0x3cff6a)]; void leds;
    avoid.push([W * .02, -D * .24, .1, .2], [W * .3, -D * .3, .08, .08]);
  } else if (t === 'nano') {
    usbMicro(g, -W / 2 + .08, 0, 0, .26); qfp(g, W * .05, 0, .22, 'ATMEGA328P', 'AU'); crystal(g, -W * .2, 0); tactile(g, W * .25, 0);
    avoid.push([-W / 2 + .08, 0, .2, .3], [W * .05, 0, .3, .3], [-W * .2, 0, .2, .1], [W * .25, 0, .16, .16]);
  } else if (t === 'esp32') {
    // the WROOM module: its own little board, a brushed metal shield with etched text, and the meander PCB antenna
    const mx = W * .08, mw = W * .62, md = D * .62;
    g.add(at(pcbBox(mw, md, canvasTex(64, 64, (c, w, h) => { c.fillStyle = '#16191b'; c.fillRect(0, 0, w, h); }, 'modpcb'), '#101214'), mx, PCB, 0));
    const sh = texBox(mw * .72, .05, md * .92, shieldTex('ESP32-WROOM-32', 'Wi-Fi + Bluetooth'), 0xc8ccd0, .3); sh.position.set(mx - mw * .12, PCB * 2, 0); sh.material.forEach?.(m => { m.metalness = .9; m.roughness = .3; }); g.add(sh);
    g.add(at(texBox(mw * .24, .004, md * .9, antennaTex(), 0x16191b, .5), mx + mw * .36, PCB * 2, 0));
    usbMicro(g, -W / 2 + .08, 0); tactile(g, -W * .36, -D * .3, 0x222222); tactile(g, -W * .36, D * .3, 0x222222);
    g.add(box(.12, .05, .08, mat('reg', () => std(0x17191b, .5)), -W * .26, PCB, 0)); smdLed(g, -W * .22, D * .22, 0xff3030);
    avoid.push([mx, 0, mw, md], [-W / 2 + .08, 0, .2, .26], [-W * .36, 0, .16, D]);
  } else if (t === 'pico') {
    usbMicro(g, -W / 2 + .08, 0); qfp(g, W * .02, 0, .2, 'RP2', 'B1'); g.add(box(.16, .03, .1, mat('flash', () => std(0x17191b, .5)), W * .2, PCB, 0)); tactile(g, -W * .22, -D * .1, 0xf2f2f2);
    crystal(g, W * .12, D * .2); smdLed(g, -W * .3, D * .22, 0x3cff6a); avoid.push([-W / 2 + .08, 0, .2, .26], [W * .02, 0, .3, .3], [W * .2, 0, .2, .14], [-W * .22, -D * .1, .16, .16], [W * .12, D * .2, .2, .1]);
  } else if (pi) {
    g.add(at(box(.36, .03, .36, mat('soclid', () => std(0xb7bcc0, .35, 1))), -W * .08, PCB, -D * .02)); g.add(at(texBox(.3, .012, .3, chipTex(t === 'pi5' ? 'BCM2712' : 'BCM2711', 'Broadcom'), 0xb7bcc0, .3), -W * .08, PCB + .03, -D * .02));
    qfp(g, W * .12, -D * .02, .22, 'LPDDR4', '4GB');
    if (t !== 'pizero') { for (const z of [-D * .22, D * .2]) { g.add(box(.38, .3, .3, mat('usbshell', () => std(0xd9dde0, .3, 1)), W / 2 - .2, PCB, z)); g.add(box(.02, .16, .24, plastic(t === 'pi5' ? 0x2f6fd0 : 0x111111), W / 2 - .01, PCB + .07, z)); }
      g.add(box(.2, .1, .14, mat('usbshell', () => std(0xd9dde0, .3, 1)), -W * .3, PCB, D / 2 - .08)); g.add(box(.14, .06, .1, mat('usbshell', () => std(0xd9dde0, .3, 1)), -W * .05, PCB, D / 2 - .06)); }
    g.add(box(.2, .05, .06, plastic(0xf2f2ee), W * .02, PCB, D * .26));
    avoid.push([-W * .08, -D * .02, .4, .4], [W * .12, -D * .02, .3, .3], [W / 2 - .2, 0, .44, D], [-W * .2, D / 2 - .1, .5, .2]);
  }
  smdScatter(g, W, D, p.id + t.length, Math.round(W * D * 18), avoid);
  if (male) {
    // lift the board onto its pins: black plastic spacers under the board, long gold pins down to the bench, short tips and solder on top
    g.children.forEach(c => { c.position.y += HDR_LIFT; });
    for (const side of ['top', 'bottom']) { const row = ps.filter(q => q.side === side); if (!row.length) continue; const xs = row.map(q => q.x);
      g.add(box(Math.max(...xs) - Math.min(...xs) + .1, .03, .09, mat('malehdr', () => std(0x141517, .5)), (Math.max(...xs) + Math.min(...xs)) / 2, HDR_LIFT - .03, row[0].z)); }
    g.add(instances(new THREE.BoxGeometry(.016, HDR_LIFT + .04, .016), goldPin(), ps.map(q => [q.x, (HDR_LIFT + .04) / 2, q.z])));
    // solder joints: a low shiny dome around each pin tip
    const dome = new THREE.SphereGeometry(.027, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); dome.scale(1, .55, 1);
    g.add(instances(dome, mat('solder', () => std(0xd5d9dc, .18, 1)), ps.map(q => [q.x, HDR_LIFT + PCB, q.z])));
  }
  return g;
}

function dipModel(p, d, W, D, label) {
  const g = new THREE.Group(); const ps = portsLocal(d, W, D);
  const n = Math.max(4, Math.round(ps.length / 2)), bw = Math.min(W * .86, n * .1 + .06), bd = Math.min(D * .5, .3);
  dip(g, 0, 0, bw, bd, n, label, '', .02);
  for (const q of ps) g.add(box(.02, .08, .012, metal(), q.x, 0, q.z));
  return g;
}

function moduleModel(p, d, W, D, opts = {}) {
  // Sensor/module board: glossy PCB with traces and pin names, the sensor feature, a few SMD parts, a power LED and a male header.
  const g = new THREE.Group(); const ps = portsLocal(d, W, D);
  // real module boards are mostly blue or green; the part's UI swatch colour is only used when it is a plausible solder-mask colour
  const lum = new THREE.Color(d.sw || '#2e7d4f').getHSL({}).l;
  const c = opts.color || ({ pir: '#1e6b45', ldr: '#1f5fbf', temp: '#1f5fbf' }[p.type]) || (lum > .55 || lum < .12 ? (p.id % 2 ? '#1f5fbf' : '#1e6b45') : d.sw);
  g.add(pcbBox(W, D, pcbTex(c, W, D, opts.label ?? (d.tag || d.short || d.name), p.id, '', null, ps), shade(c, .7)));
  if (opts.feature) opts.feature(g);
  smdScatter(g, W, D, p.id + 11, Math.max(3, Math.round(W * D * 10)), [[0, -D * .1, W * .55, D * .55]]);
  smdLed(g, W / 2 - .1, -D / 2 + .1, 0xff3030);
  headerRow(g, ps.map(q => [q.x, q.z]), .06);
  return g;
}

// ---------- part models ----------
// Every builder gets (p, d, W, D) with W×D the footprint in world units and returns a THREE.Group centred on the part.
// Dynamic pieces are stored on group.userData so update() can move them.

function portsLocal(d, W, D) {
  return d.ports.map(([n, x, y, k]) => ({ n, k, x: x / U - W / 2, z: y / U - D / 2, side: y === 0 ? 'top' : y === d.h ? 'bottom' : x === 0 ? 'left' : 'right' }));
}

function legs(g, pts, topY, m = metal()) {
  // Thin metal legs from a body down to the bench at the port positions.
  for (const [x, z, y0 = topY] of pts) { const l = cyl(.009, y0, m, x, 0, z, 8); g.add(l); }
}

function ledModel(p, d, W, D) {
  const g = new THREE.Group(); const c = (d.props && p.props.color) || 'red';
  const C = { red: 0xe5403a, green: 0x2e9e4a, yellow: 0xd8a820, blue: 0x2f62d8, white: 0xd8dce6, orange: 0xe8741e, purple: 0x7e3fd0, pink: 0xe0559a }[c] || 0xe5403a;
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
  g.add(pcbBox(W, D * .8, pcbTex('#1f5fbf', W, D * .8, 'HC-SR04', p.id), 0x194f9e));
  const can = x => { const c = cyl(.16, .2, metal(), x, PCB, -D * .05, 32); g.add(c);
    const mesh = cyl(.13, .005, mat('mesh', () => std(0x2a2a2a, .9)), x, PCB + .2, -D * .05, 32); g.add(mesh); };
  can(-W * .28); can(W * .28);
  g.add(box(.12, .05, .05, metal(), 0, PCB, -D * .22));
  headerRow(g, portsLocal(d, W, D).map(q => [q.x, q.z]));
  return g;
}

function lcdModel(p, d, W, D) {
  const g = new THREE.Group();
  g.add(pcbBox(W, D, pcbTex('#2e7d4f', W, D, '', p.id), 0x245f3d));
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
  const g = new THREE.Group(); g.add(pcbBox(W, D, pcbTex('#b3262c', W, D, 'L298N', p.id), 0x8a1d22));
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
    else if (type === 'pir') { const dome = new THREE.Mesh(new THREE.SphereGeometry(.2, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat('fresnel', () => { const t = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#f4f3ee'; c.fillRect(0, 0, w, h);
      // the faceted Fresnel lens: a grid of small cells, each with its own shading
      for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) { const v = 205 + Math.floor(Math.random() * 40); c.fillStyle = `rgb(${v},${v},${v - 6})`; c.fillRect(x * 16 + 1, y * 32 + 1, 14, 30); } }, 'fresnelT');
      return new THREE.MeshPhysicalMaterial({ map: t, bumpMap: t, bumpScale: 2, roughness: .55, transmission: 0, sheen: .3, color: 0xffffff }); })); dome.position.y = PCB + .03; dome.castShadow = true; g.add(dome); g.add(box(.42, .03, .42, plastic(0xf4f4f0), 0, PCB, 0)); }
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

// ---------- realistic models for power, lights, motors and drone parts ----------
// A rounded block (battery packs, chargers, pouches): a rounded rectangle extruded upwards with soft bevelled edges.
function roundBlock(w, h, d, r, m, bv = .014) {
  const s = new THREE.Shape(), x = -w / 2 + bv, y = -d / 2 + bv, a = w - 2 * bv, b = d - 2 * bv, k = Math.min(r, a / 2, b / 2);
  s.moveTo(x + k, y); s.lineTo(x + a - k, y); s.quadraticCurveTo(x + a, y, x + a, y + k); s.lineTo(x + a, y + b - k); s.quadraticCurveTo(x + a, y + b, x + a - k, y + b);
  s.lineTo(x + k, y + b); s.quadraticCurveTo(x, y + b, x, y + b - k); s.lineTo(x, y + k); s.quadraticCurveTo(x, y, x + k, y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(.002, h - 2 * bv), bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 3, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, bv, 0);
  const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; return o;
}
// A printed label lying on top of a part.
function decal(w, d, tex, y, x = 0, z = 0, rough = .45) {
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: rough }));
  o.rotation.x = -Math.PI / 2; o.position.set(x, y, z); o.receiveShadow = true; return o;
}
// A soft cable through a few points.
function cable(pts, r, color) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  const o = new THREE.Mesh(new THREE.TubeGeometry(c, 28, r, 8), mat('cab' + color, () => std(color, .55))); o.castShadow = true; return o;
}
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
function texCanvas(w, h, key, draw) { return canvasTex(w, h, draw, key); }
const LAMP3 = { warm: [0xfff3d2, 0xffc860], white: [0xf4f7ff, 0xffffff], yellow: [0xfff2a8, 0xffe04a], orange: [0xffd9b8, 0xff9a3c], red: [0xffc9c0, 0xff4a30],
  green: [0xcff5d8, 0x4cff70], blue: [0xcfe0ff, 0x5c9bff], purple: [0xe4d2ff, 0xa86cff], pink: [0xffd3ea, 0xff7cc0] };

function resistorModel(p, d, W, D) {
  const g = new THREE.Group(); const r = Math.max(.1, +(p.props && p.props.r) || 330);
  let e = Math.floor(Math.log10(r)) - 1, sig = Math.round(r / 10 ** e); if (sig >= 100) { sig = Math.round(sig / 10); e++; }
  const cols = [BANDC[Math.floor(sig / 10) % 10], BANDC[sig % 10], e < 0 ? '#C9A227' : BANDC[Math.min(9, e)], '#C9A227'];
  // the classic "dog bone": fat end caps, slimmer middle, round ends
  const L = .5, N = 72, cap = .068, neck = .053, end = .06;
  const ss = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
  const rad = t => { if (t < end) return cap * Math.sqrt(Math.max(0, 1 - ((end - t) / end) ** 2)); if (t > 1 - end) return cap * Math.sqrt(Math.max(0, 1 - ((t - 1 + end) / end) ** 2));
    const bump = 1 - ss(.29, .36, t) + ss(.64, .71, t); return neck + (cap - neck) * Math.min(1, bump); };
  const pts = []; for (let i = 0; i <= N; i++) { const t = i / N; pts.push(new THREE.Vector2(Math.max(.0004, rad(t)), (t - .5) * L)); }
  const tex = canvasTex(32, 512, (c, w, h) => { c.fillStyle = '#D9BD8B'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(120,90,50,${Math.random() * .08})`; c.fillRect(0, Math.random() * h, w, 1 + Math.random() * 2); }
    [[.16, cols[0]], [.25, cols[1]], [.43, cols[2]], [.8, cols[3]]].forEach(([t, col]) => { c.fillStyle = col; c.fillRect(0, (1 - t - .03) * h, w, .06 * h); }); }, 'res4' + cols.join(''));
  const m = new THREE.MeshPhysicalMaterial({ map: tex, roughness: .42, clearcoat: .35, clearcoatRoughness: .4 });
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), m); body.rotation.z = -Math.PI / 2; body.position.set(0, .11, 0); body.castShadow = true; g.add(body);
  for (const q of portsLocal(d, W, D)) { g.add(box(Math.abs(q.x) - L * .45, .012, .012, metal(), q.x / 2 + Math.sign(q.x) * L * .225, .104, q.z)); g.add(cyl(.009, .11, metal(), q.x, 0, q.z, 8)); }
  return g;
}

function bulbModel(p, d, W, D) {
  const g = new THREE.Group(); const [off, on] = LAMP3[(p.props && p.props.color) || 'warm'] || LAMP3.warm;
  const smart = p.type === 'bulb', cz = smart ? -D * .12 : -D * .08, y0 = smart ? .1 : .04;
  if (smart) {
    g.add(at(pcbBox(W * .95, D * .32, pcbTex('#2E7D4F', W * .95, D * .32, 'RELAY', p.id), 0x1f5a39), 0, 0, D * .3));
    const rl = texBox(.3, .2, .22, labelTex('SRD-05VDC', '#1F5FBF', '#fff', 256, 128, 26), 0x1f5fbf, .35); rl.position.set(W * .22, PCB, D * .3); g.add(rl);
    g.add(cyl(.12, .1, plastic(0xf2f2ee), 0, 0, cz, 28));
  }
  // screw base with threads and a black insulator
  const base = new THREE.Group(); base.position.set(0, y0, cz); g.add(base);
  base.add(cyl(.045, .03, black(), 0, 0, 0, 20)); base.add(cyl(.085, .13, metal(), 0, .03, 0, 28));
  for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(.086, .009, 6, 28), metal()); t.rotation.x = Math.PI / 2; t.position.y = .05 + i * .028; base.add(t); }
  // pear-shaped glass
  const prof = [[.07, 0], [.074, .04], [.11, .1], [.16, .17], [.18, .24], [.17, .31], [.13, .37], [.07, .405], [0, .415]].map(([r, y]) => new THREE.Vector2(r, y));
  const glassM = new THREE.MeshPhysicalMaterial({ color: off, roughness: smart ? .5 : .12, transparent: true, opacity: smart ? .92 : .72, emissive: on, emissiveIntensity: 0, clearcoat: 1 });
  const glass = new THREE.Mesh(new THREE.LatheGeometry(new THREE.SplineCurve(prof).getPoints(24), 40), glassM); glass.position.y = .16; glass.castShadow = true; base.add(glass);
  let fil = null;
  if (!smart) { const fm = mat('fil', () => std(0x888888, .4, 1, { emissive: 0xffa040, emissiveIntensity: 0 }));
    base.add(cyl(.006, .14, metal(), -.03, .16, 0, 6)); base.add(cyl(.006, .14, metal(), .03, .16, 0, 6));
    const coil = new THREE.Mesh(new THREE.TorusGeometry(.03, .006, 6, 18, Math.PI), fm); coil.position.set(0, .3, 0); base.add(coil); fil = fm; }
  for (const q of portsLocal(d, W, D)) g.add(cyl(.009, smart ? .06 : .05, metal(), q.x, 0, q.z, 8));
  if (!smart) for (const q of portsLocal(d, W, D)) g.add(box(.012, .012, Math.abs(q.z - cz), metal(), q.x * .6, .04, (q.z + cz) / 2));
  g.userData.glow = { mat: glassM, color: on, pos: new THREE.Vector3(0, y0 + .4, cz), kind: 'bulb', fil };
  return g;
}

function motorModel(p, d, W, D) {
  // a "130" hobby motor lying down: brushed-steel can with flat sides, plastic end cap with brass tabs, shaft and a small propeller
  const g = new THREE.Group(); const z0 = -D * .05, y = .21;
  const can = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .44, 40), mat('mcan', () => std(0xd5d9dc, .32, 1))); can.rotation.x = Math.PI / 2; can.scale.set(1, 1, .8);
  can.position.set(0, y, z0); can.castShadow = true; g.add(can);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(.17, .012, 8, 40), mat('mcan', () => std(0xd5d9dc, .32, 1))); lip.position.set(0, y, z0 - .22); lip.scale.set(1, .8, 1); g.add(lip);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .05, 20), metal()); boss.rotation.x = Math.PI / 2; boss.position.set(0, y, z0 - .245); g.add(boss);
  const capM = plastic(0x1e2123);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .08, 40), capM); cap.rotation.x = Math.PI / 2; cap.scale.set(1, 1, .8); cap.position.set(0, y, z0 + .26); g.add(cap);
  for (const s of [-1, 1]) { g.add(box(.05, .1, .012, gold(), s * .1, y - .05, z0 + .305)); }
  g.add(cyl(.02, .01, plastic(0xd0362a), -.14, y + .1, z0 + .23, 12));
  const rot = new THREE.Group(); rot.position.set(0, y, z0 - .3);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .14, 10), metal()); shaft.rotation.x = Math.PI / 2; rot.add(shaft);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .05, 16), plastic(0x2f6fd0)); hub.rotation.x = Math.PI / 2; hub.position.z = -.06; rot.add(hub);
  for (const s of [-1, 1]) { const bl = new THREE.Mesh(new THREE.BoxGeometry(.26, .06, .012), plastic(0x2f6fd0)); bl.position.set(s * .14, 0, -.06); bl.rotation.x = s * .35; bl.castShadow = true; rot.add(bl); }
  g.add(rot); g.userData.spinZ = rot;
  for (const q of portsLocal(d, W, D)) { g.add(cyl(.01, .1, gold(), q.x, 0, q.z, 8)); g.add(cable([[q.x, .1, q.z], [q.x * .9, .14, q.z - .05], [Math.sign(q.x) * .1, y - .08, z0 + .31]], .012, q.x < 0 ? 0xd0362a : 0x1f2124)); }
  return g;
}

function batteryModel(p, d, W, D) {
  const g = new THREE.Group(); const pr = p.props || {}, pre = pr.preset || '9V', v = +pr.v || 9, ps = portsLocal(d, W, D);
  const pos = ps.find(q => q.n === '+'), neg = ps.find(q => q.n === '-');
  const leads = (fromZ, h) => { for (const [q, c] of [[pos, 0xd0362a], [neg, 0x1f2124]]) { g.add(cable([[q.x * .55, h, fromZ], [q.x * .8, h + .08, (fromZ + q.z) / 2], [q.x, .1, q.z]], .018, c)); g.add(cyl(.016, .1, gold(), q.x, 0, q.z, 10)); } };
  if (/^lipo/.test(pre)) {
    const n = pre.slice(4, 5);
    const tex = texCanvas(512, 256, 'lipo' + pre + v + pr.mah, (c, w, h) => { c.fillStyle = '#1F4FA0'; c.fillRect(0, 0, w, h); c.fillStyle = '#F2F4F7'; c.fillRect(30, 30, w - 60, h - 60);
      c.fillStyle = '#1F4FA0'; c.font = `800 64px ${FONT}`; c.fillText(n + 'S LiPo', 52, 104); c.fillStyle = '#2B2F2D'; c.font = `600 40px ${FONT}`; c.fillText(`${v}V  ${pr.mah || 1500}mAh`, 52, 162);
      c.fillStyle = '#E3884B'; c.fillRect(w - 150, 64, 100, 54); c.fillStyle = '#fff'; c.font = `800 36px ${FONT}`; c.fillText('25C', w - 136, 104); });
    const pack = roundBlock(W * .92, .2, D * .7, .05, mat('lipoW', () => std(0x1f4fa0, .35))); pack.position.z = D * .12; g.add(pack);
    g.add(decal(W * .86, D * .62, tex, .201, 0, D * .12, .35));
    leads(-D * .2, .12);
    g.add(at(roundBlock(.12, .05, .08, .01, plastic(0xf4f4f0)), W * .4, .06, -D * .2));
  } else if (pre === 'AA' || pre === '2AA' || pre === 'li') {
    const holder = roundBlock(W * .96, .1, D * .82, .03, plastic(0x1b1d1f)); holder.position.z = D * .06; g.add(holder);
    const n = pre === '2AA' ? 2 : 1, rr = pre === 'li' ? .1 : .085;
    for (let i = 0; i < n; i++) { const z = D * .06 + (i - (n - 1) / 2) * .2;
      const cell = new THREE.Group(); cell.position.set(0, .1 + rr * .6, z); g.add(cell);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, W * .62, 32), pre === 'li' ? mat('li18650', () => std(0x2e7d5b, .35)) : mat('aaBlack', () => std(0x1b1c1e, .35)));
      body.rotation.z = Math.PI / 2; body.position.x = -W * .07; body.castShadow = true; cell.add(body);
      if (pre !== 'li') { const top = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, W * .14, 32), mat('aaCopper', () => std(0xc77a2c, .3, .6))); top.rotation.z = Math.PI / 2; top.position.x = W * .31; cell.add(top); }
      const nub = new THREE.Mesh(new THREE.CylinderGeometry(rr * .4, rr * .4, .03, 16), metal()); nub.rotation.z = Math.PI / 2; nub.position.x = W * .395; cell.add(nub);
      const lab = decal(W * .3, rr * 1.2, labelTex(pre === 'li' ? '18650 3.7V' : 'AA 1.5V', pre === 'li' ? '#2e7d5b' : '#1b1c1e', '#fff', 256, 64, 30), rr + .001, -W * .1, 0); cell.add(lab); }
    leads(-D * .15, .1);
  } else if (pre === 'usb' || pre === 'phone' || pre === 'watch') {
    const usb = pre === 'usb', col = usb ? 0xedeff1 : 0x1c1e21;
    const blk = roundBlock(W * .92, usb ? .2 : .06, D * .7, usb ? .1 : .02, mat('bt' + pre, () => std(col, usb ? .4 : .3))); blk.position.z = D * .12; g.add(blk);
    g.add(decal(W * .7, D * .4, labelTex(usb ? 'POWER BANK 5V' : `Li-Po ${v}V ${pr.mah || ''}mAh`, usb ? '#edeff1' : '#1c1e21', usb ? '#3a4045' : '#E9D9A6', 512, 160, 52), (usb ? .2 : .06) + .001, 0, D * .12));
    if (!usb) g.add(box(.3, .012, .1, gold(), 0, .03, -D * .25));
    leads(-D * .2, usb ? .1 : .05);
  } else if (pre === 'lead') {
    g.add(at(roundBlock(W * .96, .4, D * .8, .03, mat('lead', () => std(0x1f2224, .5))), 0, 0, D * .08));
    g.add(decal(W * .7, D * .4, labelTex('12V 7Ah', '#E3C22A', '#1f2224', 256, 128, 52), .401, 0, D * .1));
    for (const q of [pos, neg]) { g.add(box(.12, .05, .08, q === pos ? plastic(0xd0362a) : black(), q.x, .4, -D * .2)); g.add(cable([[q.x, .44, -D * .2], [q.x, .3, (q.z - D * .2) / 2], [q.x, .1, q.z]], .016, q === pos ? 0xd0362a : 0x1f2124)); }
  } else {
    // a 9 V block standing upright with its snap terminals on top
    const tex = texCanvas(512, 256, '9v' + v, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1b1c1e'); gr.addColorStop(.66, '#26282b'); gr.addColorStop(.66, '#c79a2e'); gr.addColorStop(1, '#e8c35a');
      c.fillStyle = gr; c.fillRect(0, 0, w, h); c.fillStyle = '#E8C35A'; c.font = `700 30px ${FONT}`; c.fillText('ALKALINE', 30, 50); c.fillStyle = '#fff'; c.font = `800 110px ${FONT}`; c.textAlign = 'center'; c.fillText(v + 'V', w / 2, h * .58); });
    const blk = roundBlock(W * .9, .3, D * .62, .03, mat('9vside', () => std(0x1b1c1e, .35))); blk.position.z = D * .1; g.add(blk);
    g.add(decal(W * .86, D * .58, tex, .301, 0, D * .1, .3));
    g.add(cyl(.045, .05, metal(), pos.x, .3, -D * .14, 20)); const hex = cyl(.055, .05, metal(), neg.x, .3, -D * .14, 6); g.add(hex);
    for (const q of [pos, neg]) g.add(cable([[q.x, .34, -D * .14], [q.x, .3, (q.z - D * .14) / 2], [q.x, .1, q.z]], .014, q === pos ? 0xd0362a : 0x1f2124));
    for (const q of [pos, neg]) g.add(cyl(.016, .1, gold(), q.x, 0, q.z, 10));
  }
  return g;
}

function chargerModel(p, d, W, D) {
  // a white USB wall charger: two round mains pins, a USB-C cable that splits into red and black leads
  const g = new THREE.Group(); const ps = portsLocal(d, W, D);
  const body = roundBlock(W * .78, .34, D * .62, .07, mat('charger', () => std(0xf4f4f2, .38))); body.position.set(W * .06, 0, D * .14); g.add(body);
  g.add(decal(W * .6, D * .36, labelTex('5V ⎓ 2A', '#f4f4f2', '#2b2f2d', 256, 96, 44), .341, W * .06, D * .2));
  for (const z of [D * .04, D * .26]) { const pin = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .14, 14), metal()); pin.rotation.z = Math.PI / 2; pin.position.set(-W * .4, .17, z); g.add(pin); }
  g.add(box(.012, .02, .012, plastic(0x3fff70), W * .36, .34, D * .38));
  g.add(box(.1, .06, .07, plastic(0xe9ecef), W * .06, .12, -D * .18));
  g.add(cable([[W * .06, .15, -D * .2], [W * .06, .2, -D * .3], [W * .02, .16, -D * .38]], .022, 0xe9ecef));
  for (const q of ps) { g.add(cable([[W * .02, .16, -D * .38], [q.x * .6, .16, -D * .44], [q.x, .1, q.z]], .014, q.n === '+' ? 0xd0362a : 0x1f2124)); g.add(cyl(.016, .1, gold(), q.x, 0, q.z, 10)); }
  return g;
}

function bldcModel(p, d, W, D) {
  // drone motor: black bell with a red ring and cooling slots, two-blade propeller, ESC in blue heat-shrink
  const g = new THREE.Group(); const cz = -D * .13, ps = portsLocal(d, W, D);
  const esc = roundBlock(W * .5, .07, D * .2, .02, mat('esc', () => std(0x1e5aa8, .35))); esc.position.set(0, 0, D * .27); g.add(esc);
  g.add(decal(W * .4, D * .12, labelTex('ESC 30A', '#1e5aa8', '#fff', 256, 64, 34), .071, 0, D * .27));
  [[-1, 0x1f2124], [0, 0xd0362a], [1, 0xe3c22a]].forEach(([s, c]) => g.add(cable([[s * .06, .05, D * .17], [s * .05, .1, D * .05], [s * .04, .1, cz + .12]], .012, c)));
  for (const q of ps) { g.add(cable([[q.x * .5, .04, D * .37], [q.x, .1, q.z]], .011, q.n === 'VCC' ? 0xd0362a : q.n === 'GND' ? 0x1f2124 : 0xe8b923)); g.add(cyl(.009, .1, gold(), q.x, 0, q.z, 8)); }
  const mot = new THREE.Group(); mot.position.set(0, 0, cz); g.add(mot);
  mot.add(cyl(.12, .03, mat('mbase', () => std(0x2a2d30, .35, .8)), 0, 0, 0, 32));
  const bell = cyl(.15, .14, mat('bell', () => std(0x17191b, .3, .7)), 0, .03, 0, 40); mot.add(bell);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.15, .013, 8, 40), mat('ring', () => std(0xc0392b, .3, .7))); ring.rotation.x = Math.PI / 2; ring.position.y = .14; mot.add(ring);
  for (let i = 0; i < 6; i++) { const s = box(.05, .011, .03, mat('slot', () => std(0x050505, .9)), Math.cos(i * 1.047) * .09, .168, Math.sin(i * 1.047) * .09); s.rotation.y = -i * 1.047; mot.add(s); }
  mot.add(cyl(.06, .02, metal(), 0, .17, 0, 24));
  const prop = new THREE.Group(); prop.position.y = .2; mot.add(prop);
  const bm = new THREE.MeshStandardMaterial({ color: 0x25313a, roughness: .35, transparent: true, opacity: .95 });
  const sh = new THREE.Shape(); sh.moveTo(0, -.025); sh.bezierCurveTo(.12, -.05, .32, -.045, .42, -.012); sh.bezierCurveTo(.43, .005, .42, .02, .4, .024); sh.bezierCurveTo(.3, .03, .12, .04, 0, .025); sh.lineTo(0, -.025);
  const bg = new THREE.ExtrudeGeometry(sh, { depth: .008, bevelEnabled: false }); bg.rotateX(Math.PI / 2);
  for (const s of [0, Math.PI]) { const b = new THREE.Mesh(bg, bm); b.rotation.set(0, s, s ? -.18 : .18); b.castShadow = true; prop.add(b); }
  prop.add(cyl(.035, .05, plastic(0xc0392b), 0, -.01, 0, 16));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(.43, 48), new THREE.MeshBasicMaterial({ color: 0x9fb0bc, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = .205; disc.visible = false; mot.add(disc);
  g.userData.prop = { grp: prop, disc, mat: bm };
  return g;
}

function fcModel(p, d, W, D) {
  // F405 flight controller on rubber grommets: black PCB, gold pads, STM32 turned 45°, status LEDs
  const g = new THREE.Group(); const ps = portsLocal(d, W, D), st = p.st || {};
  const tex = texCanvas(512, 432, 'fcpcb', (c, w, h) => { c.fillStyle = '#111315'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(80,90,95,.22)'; c.lineWidth = 2; for (let i = 0; i < 10; i++) { c.beginPath(); c.moveTo(Math.random() * w, Math.random() * h); c.lineTo(Math.random() * w, Math.random() * h); c.stroke(); }
    c.fillStyle = '#C9A227'; ps.forEach(q => { const x = (q.x / W + .5) * w, y = (q.z / D + .5) * h; c.fillRect(x - 18, y < h / 2 ? 6 : h - 34, 36, 28); });
    c.fillStyle = '#fff'; c.font = `700 28px ${FONT}`; c.textAlign = 'center'; ps.forEach(q => { const x = (q.x / W + .5) * w, y = (q.z / D + .5) * h; c.fillText(q.n, x, y < h / 2 ? 70 : h - 48); });
    c.beginPath(); c.moveTo(w / 2, 92); c.lineTo(w / 2 + 22, 124); c.lineTo(w / 2 - 22, 124); c.fill(); c.font = `700 24px ${FONT}`; c.fillText('F405  FC', w / 2, h - 96); });
  const pcb = texBox(W * .96, .025, D * .96, tex, 0x111315, .5); pcb.position.y = .07; g.add(pcb);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const x = sx * W * .4, z = sz * D * .38;
    g.add(cyl(.05, .09, mat('grom', () => std(0x6a3fb0, .7)), x, 0, z, 20)); g.add(cyl(.022, .12, metal(), x, 0, z, 10)); }
  const mcu = texBox(.3, .035, .3, labelTex('STM32F405', '#1e2124', '#c9ccd0', 256, 256, 30), 0x1e2124, .4); mcu.position.y = .095; mcu.rotation.y = Math.PI / 4; g.add(mcu);
  g.add(box(.09, .02, .09, black(), W * .28, .095, D * .18));
  g.add(box(.14, .06, .1, metal(), -W * .46, .095, 0));
  const ledA = box(.03, .02, .03, mat('fcLedB', () => std(0x6fa8ff, .3, 0, { emissive: 0x3070ff, emissiveIntensity: 0 })), W * .3, .095, -D * .2); g.add(ledA);
  const ledB = box(.03, .02, .03, mat('fcLedG', () => std(0x5cff7e, .3, 0, { emissive: 0x20ff60, emissiveIntensity: 0 })), W * .36, .095, -D * .2); g.add(ledB);
  g.userData.fcLeds = [ledA.material, ledB.material];
  for (const q of ps) g.add(cyl(.009, .1, gold(), q.x, 0, q.z, 8));
  void st; return g;
}

function rcModel(p, d, W, D) {
  const g = new THREE.Group();
  g.add(at(roundBlock(W * .9, .12, D * .7, .03, mat('rcbox', () => std(0x232726, .45))), 0, 0, D * .05));
  g.add(decal(W * .7, D * .36, labelTex('RX 2.4GHz', '#232726', '#d6dadc', 256, 96, 38), .121, 0, D * .05));
  for (const s of [-1, 1]) g.add(cable([[W * .3, .1, -D * .25], [W * (.35 + s * .05), .3, -D * .45], [W * (.4 + s * .12), .5, -D * .5]], .006, 0x111111));
  g.add(box(.03, .015, .03, mat('rcLed', () => std(0x5cff7e, .3, 0, { emissive: 0x20ff60, emissiveIntensity: 1.2 })), W * .35, .12, D * .25));
  for (const q of portsLocal(d, W, D)) g.add(cyl(.009, .1, gold(), q.x, 0, q.z, 8));
  return g;
}

// ---------- what sits on top of each sensor or module board ----------
// trimmer pot (blue cube, brass screw), screw terminal block, glass screen, lens barrel and other recurring pieces
function trimPot(g, x, z) { g.add(box(.09, .07, .09, plastic(0x2457c8), x, PCB, z)); g.add(cyl(.028, .012, gold(), x, PCB + .07, z, 16)); g.add(box(.04, .004, .008, mat('slot', () => std(0x050505, .9)), x, PCB + .082, z)); }
function terminal(g, x, z, n = 2, rot = 0) { const c = new THREE.Group(); c.position.set(x, PCB, z); c.rotation.y = rot; g.add(c);
  c.add(box(n * .1, .1, .1, plastic(0x2a7fd4))); for (let i = 0; i < n; i++) { const sx = (i - (n - 1) / 2) * .1; c.add(cyl(.026, .012, metal(), sx, .1, -.01, 14)); c.add(box(.03, .004, .006, mat('slot', () => std(0x050505, .9)), sx, .113, -.01)); c.add(box(.05, .04, .01, mat('hole', () => std(0x030303, .95)), sx, .03, .051)); } }
function screen(g, w, d, color, x = 0, z = 0, round = false, y0 = PCB) {
  const glassM = new THREE.MeshPhysicalMaterial({ color, roughness: .08, clearcoat: 1, clearcoatRoughness: .05, metalness: .1 });
  const s = round ? cyl(Math.min(w, d) / 2, .025, glassM, x, y0, z, 48) : box(w, .025, d, glassM, x, y0, z); g.add(s); return s; }
function lens(g, x, z, r = .07, h = .08, y0 = PCB) { g.add(box(r * 2.6, .05, r * 2.6, mat('lensbody', () => std(0x141516, .5)), x, y0, z)); g.add(cyl(r, h, mat('barrel', () => std(0x1b1c1e, .35, .4)), x, y0 + .05, z, 32));
  g.add(cyl(r * .7, .006, new THREE.MeshPhysicalMaterial({ color: 0x14204a, roughness: .02, metalness: .3, clearcoat: 1, iridescence: .6 }), x, y0 + .05 + h, z, 32)); }
function flex(g, x, z, len, w = .1, rot = 0) { const f = box(w, .006, len, mat('flex', () => std(0xc8862e, .45)), x, PCB, z); f.rotation.y = rot; g.add(f); }
function ledT(g, x, z, color, clear = false, y0 = PCB) { const m = new THREE.MeshPhysicalMaterial({ color, roughness: .15, transparent: clear, opacity: clear ? .7 : 1, clearcoat: 1 });
  g.add(cyl(.035, .1, m, x, y0 + .02, z, 20)); const dome = new THREE.Mesh(new THREE.SphereGeometry(.035, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m); dome.position.set(x, y0 + .12, z); g.add(dome); }
function traceTex(kind, color) { return canvasTex(256, 256, (c, w, h) => { c.fillStyle = color; c.fillRect(0, 0, w, h); c.strokeStyle = '#d8c47a'; c.lineWidth = 9;
  if (kind === 'comb') { for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(i % 2 ? w - 14 : 14, 20 + i * 27); c.lineTo(i % 2 ? 30 : w - 30, 20 + i * 27); c.stroke(); } c.beginPath(); c.moveTo(14, 10); c.lineTo(14, h - 10); c.moveTo(w - 14, 10); c.lineTo(w - 14, h - 10); c.stroke(); }
  else if (kind === 'strips') { for (let i = 0; i < 10; i++) { c.beginPath(); c.moveTo(20 + i * 24, 20); c.lineTo(20 + i * 24, h - 10); c.stroke(); } }
  else if (kind === 'loop') { c.lineWidth = 6; for (let i = 0; i < 4; i++) c.strokeRect(16 + i * 12, 16 + i * 12, w - 32 - i * 24, h - 32 - i * 24); } }, 'trace' + kind + color); }
const FEATURE3D = {
  display: (W, D) => g => { screen(g, W * .9, D * .7, 0x07080a, 0, -D * .05); flex(g, 0, D * .36, D * .14, W * .3); },
  oled: (W, D) => g => { screen(g, W * .78, W * .78, 0x07080a, 0, -D * .05, true); g.add(cyl(W * .41, .018, mat('bezel', () => std(0xb7bcc0, .3, 1)), 0, PCB, -D * .05, 48)); },
  speaker: (W, D) => g => { const fr = cyl(W * .38, .05, mat('spkframe', () => std(0x26292c, .4, .6)), 0, PCB, -D * .05, 40); g.add(fr);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(W * .34, .06, 40, 1, true), mat('cone', () => std(0x161718, .85))); cone.rotation.x = Math.PI; cone.position.set(0, PCB + .08, -D * .05); g.add(cone);
    g.add(cyl(W * .12, .03, mat('dust', () => std(0x1f2022, .6)), 0, PCB + .05, -D * .05, 28)); },
  mic: (W, D) => g => { g.add(box(.14, .05, .1, mat('memsc', () => std(0xc9ced2, .3, 1)), 0, PCB, -D * .05)); g.add(cyl(.012, .002, mat('hole', () => std(0x030303, .95)), 0, PCB + .05, -D * .05, 12)); },
  camera: (W, D) => g => { lens(g, 0, -D * .08, .1, .1); flex(g, 0, D * .3, D * .2, W * .35); },
  modem: (W, D) => g => { g.add(texBox(W * .62, .05, D * .55, shieldTex('LTE CAT-4', '4G modem'), 0xc8ccd0, .3)); g.add(cyl(.03, .02, gold(), W * .38, PCB, -D * .3, 16)); g.add(box(.3, .02, .2, metal(), -W * .28, PCB, D * .3)); },
  hrm: (W, D) => g => { g.add(box(.16, .03, .1, mat('maxpkg', () => std(0x1c1c1e, .3)), 0, PCB, -D * .05)); g.add(box(.05, .004, .04, std(0x30ff70, .2, 0, { emissive: 0x20ff60, emissiveIntensity: 1 }), -.04, PCB + .031, -D * .05)); g.add(box(.05, .004, .04, std(0xff3030, .2, 0, { emissive: 0xff2020, emissiveIntensity: 1 }), .04, PCB + .031, -D * .05)); },
  spo2: (W, D) => FEATURE3D.hrm(W, D),
  vib: (W, D) => g => { g.add(cyl(W * .32, .05, mat('coin', () => std(0xd5d9dc, .3, 1)), 0, PCB, -D * .05, 40)); g.add(cyl(W * .1, .002, mat('coinlabel', () => std(0x9aa1a6, .4, 1)), 0, PCB + .05, -D * .05, 20)); },
  ble: (W, D) => g => { g.add(texBox(W * .5, .004, D * .5, traceTex('loop', '#1e6b45'), 0x1e6b45, .5)); g.add(box(.12, .04, .12, mat('blechip', () => std(0x17191b, .5)), -W * .3, PCB, 0)); },
  soil: (W, D) => g => { for (const s of [-1, 1]) g.add(box(W * .16, PCB, D * .9, new THREE.MeshPhysicalMaterial({ color: 0xd8c47a, metalness: .9, roughness: .3 }), s * W * .2, .002, D * .05)); trimPot(g, W * .3, -D * .3); },
  rain: (W, D) => g => { g.add(at(texBox(W * .8, .004, D * .62, traceTex('comb', '#1e6b45'), 0x1e6b45, .4), 0, PCB, -D * .08)); },
  water: (W, D) => g => { g.add(at(texBox(W * .7, .004, D * .7, traceTex('strips', '#c0392b'), 0xc0392b, .4), 0, PCB, -D * .06)); },
  bmp: (W, D) => g => { g.add(box(.1, .03, .1, mat('bmp', () => std(0xd5d9dc, .3, 1)), 0, PCB, -D * .05)); g.add(cyl(.01, .002, mat('hole', () => std(0x030303, .95)), .02, PCB + .03, -D * .03, 10)); },
  rfid: (W, D) => g => { g.add(at(texBox(W * .7, .004, D * .55, traceTex('loop', '#1f5fbf'), 0x1f5fbf, .4), 0, PCB, -D * .14)); qfp(g, -W * .3, D * .2, .12, 'MFRC522'); crystal(g, W * .1, D * .26); },
  flame: (W, D) => g => { ledT(g, -W * .25, -D * .1, 0x111111); trimPot(g, W * .1, -D * .05); qfp(g, W * .32, D * .05, .1, 'LM393'); },
  sound: (W, D) => g => { g.add(cyl(.09, .08, mat('micfelt', () => std(0x111111, .95)), -W * .25, PCB, -D * .1, 28)); g.add(cyl(.095, .08, mat('miccan', () => std(0xc9ced2, .3, 1)), -W * .25, PCB - .002, -D * .1, 28, .095)); trimPot(g, W * .1, -D * .05); qfp(g, W * .32, D * .05, .1, 'LM393'); },
  irobs: (W, D) => g => { ledT(g, -W * .3, -D * .25, 0xe8f0ff, true); ledT(g, -W * .1, -D * .25, 0x111111); trimPot(g, W * .2, -D * .05); },
  mpu: (W, D) => g => { qfp(g, 0, -D * .05, .1, 'MPU', '6050'); g.add(box(.08, .03, .06, mat('reg', () => std(0x17191b, .5)), -W * .28, PCB, -D * .2)); },
  ecg: (W, D) => g => { qfp(g, -W * .1, -D * .05, .12, 'AD8232'); g.add(box(.2, .12, .16, mat('jack35', () => std(0x141517, .45)), W * .3, PCB, -D * .2)); g.add(cyl(.04, .02, mat('hole', () => std(0x030303, .95)), W * .3 + .1, PCB + .06, -D * .2, 16)); },
  emg: (W, D) => g => { g.add(box(.16, .02, .16, mat('snap', () => std(0xc9ced2, .3, 1)), -W * .25, PCB, -D * .1)); g.add(box(.16, .02, .16, mat('snap', () => std(0xc9ced2, .3, 1)), W * .25, PCB, -D * .1)); qfp(g, 0, -D * .05, .1, 'INA'); },
  eeg: (W, D) => FEATURE3D.ecg(W, D),
  gsr: (W, D) => g => { for (const s of [-1, 1]) { g.add(box(.18, .03, .1, plastic(0x2a2d30), s * W * .22, PCB, -D * .2)); g.add(box(.1, .01, .06, metal(), s * W * .22, PCB + .03, -D * .2)); } qfp(g, 0, D * .1, .1, 'LM324'); },
  acs: (W, D) => g => { terminal(g, -W * .32, 0, 2, Math.PI / 2); g.add(box(.1, .05, .08, mat('soic', () => std(0x17191b, .5)), W * .05, PCB, 0)); },
  gas: (W, D) => g => { const base = cyl(.16, .05, plastic(0x2a2d30), -W * .05, PCB, -D * .05, 32); g.add(base);
    g.add(cyl(.15, .14, mat('mqmesh', () => { const t = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#9aa1a6'; c.fillRect(0, 0, w, h); c.fillStyle = '#2a2d30'; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.fillRect(x * 8 + 2, y * 8 + 2, 4, 4); }, 'mqmeshT'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 1); return new THREE.MeshStandardMaterial({ map: t, metalness: .8, roughness: .45 }); }), -W * .05, PCB + .05, -D * .05, 32));
    trimPot(g, W * .32, D * .15); },
};
function pumpModel(p, d, W, D) {
  // a small submersible pump: black body, blue outlet nozzle, two lead wires
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .44, 32), mat('pump', () => std(0x1c1e20, .5))); body.rotation.z = Math.PI / 2; body.position.set(0, .21, -D * .1); body.castShadow = true; g.add(body);
  g.add(at(cyl(.07, .12, plastic(0x2f6fd0), 0, 0, 0, 20), W * .12, .4, -D * .1)); g.add(at(cyl(.12, .04, plastic(0x2f6fd0), 0, 0, 0, 24), -W * .3, .09, -D * .1));
  for (const q of portsLocal(d, W, D)) { g.add(cable([[q.x, .1, q.z], [q.x * .8, .18, q.z - .1], [q.x * .4, .25, -D * .1 + .15]], .013, q.x < 0 ? 0xd0362a : 0x1f2124)); g.add(cyl(.012, .1, gold(), q.x, 0, q.z, 8)); }
  return g;
}
function lockModel(p, d, W, D) {
  // solenoid door lock: brushed steel box with a sloped latch tongue
  const g = new THREE.Group();
  g.add(roundBlock(W * .7, .32, D * .8, .02, mat('lockbody', () => std(0xbfc4c8, .35, 1)))); 
  const tongue = box(.18, .16, .2, mat('lockbolt', () => std(0xd9dde0, .25, 1)), W * .43, .06, 0); g.add(tongue);
  for (const s of [-1, 1]) g.add(cyl(.03, .01, mat('hole', () => std(0x030303, .95)), s * W * .25, .32, s * D * .25, 16));
  for (const q of portsLocal(d, W, D)) { g.add(cable([[q.x, .1, q.z], [q.x * .6, .2, q.z + .1], [-W * .2, .2, D * .3]], .012, q.x < 0 ? 0xd0362a : 0x1f2124)); g.add(cyl(.012, .1, gold(), q.x, 0, q.z, 8)); }
  return g;
}

function genericModel(p, d, W, D) {
  // Any other part: a module board with its name, sized to the part.
  return moduleModel(p, d, W, D, { label: d.short || d.name, feature: g => { g.add(box(Math.min(.3, W * .3), .05, Math.min(.3, D * .3), black(), 0, PCB, -D * .1)); } });
}

function buildPart(p, d, api) {
  const W = d.w / U, D = d.h / U;
  let g;
  if (d.board || p.type === 'esp32') g = boardModel(p, d, W, D);
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
    case 'motor': g = motorModel(p, d, W, D); break;
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
    case 'pump': g = pumpModel(p, d, W, D); break;
    case 'lock': g = lockModel(p, d, W, D); break;
    case 'usbc': g = chargerModel(p, d, W, D); break;
    case 'bldc': g = bldcModel(p, d, W, D); break;
    case 'fc': g = fcModel(p, d, W, D); break;
    case 'rc': g = rcModel(p, d, W, D); break;
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
      else if (FEATURE3D[p.type]) g = moduleModel(p, d, W, D, { label: d.tag || d.short || '', feature: FEATURE3D[p.type](W, D) });
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
  function pinHeight(A) { const d = PD[A.p.type]; if (MALE_BOARD.test(A.p.type)) return HDR_LIFT + PCB + .05; return d.board || /^(ultrasonic|lcd|relay|driver|ldr|temp|pir)$/.test(A.p.type) || d.gen ? PCB + .085 + .02 : .1; }
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
      if (pinch) { want.r = Math.max(.45, Math.min(40, want.r * pinch.dist / Math.max(1, dist))); pan((mid.x - pinch.mid.x), (mid.y - pinch.mid.y)); }
      pinch = { dist, mid };
    }
  });
  const up = e => { ptrs.delete(e.pointerId); pinch = null; if (!ptrs.size) el.style.cursor = 'grab'; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('wheel', e => { e.preventDefault(); want.r = Math.max(.45, Math.min(40, want.r * Math.exp(e.deltaY * .0012))); }, { passive: false });
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
      if (u.prop) { const fast = (st.duty || 0) > .05 && !live.burnt; u.prop.grp.rotation.y = -(st.rot || 0) * Math.PI / 180; u.prop.disc.visible = fast; u.prop.mat.opacity = fast ? .28 : .95; }
      if (u.fcLeds) { u.fcLeds[0].emissiveIntensity = (st.vin || 0) >= 6.5 ? 2 : 0; u.fcLeds[1].emissiveIntensity = st.armed ? 2 : 0; }
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
export { buildPart, makeEnv, portsLocal, U };
