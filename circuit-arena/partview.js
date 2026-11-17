// Circuit Arena "Meet the part": one part as a real-looking 3D model in a bright studio, with numbered hotspots
// tied to cards that explain each feature and pin. Drag to turn, pinch or scroll to zoom, tap a card to turn the part to it.
// Loaded only when a part page opens; the models come from the 3D bench.
import * as THREE from './three.module.min.js';
import { buildPart, makeEnv, portsLocal, U } from './bench3d.js';

// Feature hotspots per part type: [x (fraction of width), y (height in model units), z (fraction of depth), title, text].
// Text may be a function of the part so it can show live values such as the resistor colour code.
const BANDS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];
const resBands = p => { const r = Math.max(.1, +p.props.r || 330); let e = Math.floor(Math.log10(r)) - 1, s = Math.round(r / 10 ** e); if (s >= 100) { s = Math.round(s / 10); e++; }
  return `${BANDS[Math.floor(s / 10) % 10]} · ${BANDS[s % 10]} · ${e < 0 ? 'gold' : BANDS[Math.min(9, e)]} · gold = ${s}×10^${e} Ω ±5%`; };
const FEAT = {
  arduino: [[-.44, .34, -.2, 'USB-B port', 'Uploads code and powers the board with 5 V from a computer.'], [-.44, .28, .27, 'DC barrel jack', 'Takes 7–12 V from a battery or adapter. The on-board regulator makes 5 V.'],
    [.2, .13, .12, 'ATmega328P', 'The brain: 16 MHz, 32 KB flash for your code, 2 KB RAM. It sits in a socket so you can swap it.'], [-.08, .1, -.05, '16 MHz crystal', 'The clock that keeps the chip ticking 16 million times a second.'],
    [-.36, .1, -.38, 'RESET button', 'Restarts your sketch from the top.'], [.02, .06, -.24, 'TX / RX / L LEDs', 'Blink while code uploads; L is wired to pin 13.']],
  mega: [[-.45, .3, -.18, 'USB-B port', 'Uploads code and powers the board.'], [.12, .1, .05, 'ATmega2560', '54 digital pins, 16 analog inputs, 256 KB flash.']],
  nano: [[-.45, .14, 0, 'Mini USB', 'Uploads code and powers the board.'], [.12, .1, .05, 'ATmega328P', 'Same chip as the Uno in a breadboard-sized board.']],
  esp32: [[.0, .1, 0, 'ESP32-WROOM-32', 'Dual-core 240 MHz chip with Wi-Fi and Bluetooth under the metal shield.'], [.39, .06, 0, 'PCB antenna', 'The zig-zag copper trace is the Wi-Fi antenna: keep metal away from it.'],
    [-.46, .1, 0, 'Micro-USB port', 'Power and code upload.'], [-.36, .1, .3, 'BOOT and EN buttons', 'EN restarts the board; hold BOOT while resetting to flash new firmware.']],
  rpi: [[-.05, .11, 0, 'BCM2711 processor', 'Quad-core 1.5 GHz ARM computer running Linux.'], [.44, .28, -.22, 'USB ports', 'Keyboard, mouse, cameras and storage.'], [.44, .28, .18, 'USB ports', 'More USB and gigabit Ethernet on the real board.']],
  pi5: [[-.05, .11, 0, 'BCM2712 processor', '2.4 GHz quad-core, about 3× faster than a Pi 4.']],
  pico: [[.12, .1, .05, 'RP2040', 'Two Cortex-M0+ cores at 133 MHz, 264 KB RAM.']],
  led: [[0, .47, -.18, 'Epoxy lens', 'The coloured dome. The chip inside glows when current flows from + to −.'], [-.18, .05, .5, 'Anode (+), longer leg', 'Goes towards the positive side, through a resistor.'], [.18, .05, .5, 'Cathode (−), flat side', 'Goes to ground.']],
  resistor: [[-.1, .19, 0, 'Colour bands', resBands], [.5, .12, 0, 'Leads', 'No polarity: it works either way round.']],
  battery: [[0, .32, .1, 'Label', p => `${p.props.v || 9} V · ${p.props.mah || 500} mAh · about ${p.props.r ?? 1.5} Ω inside, so the voltage sags at high current.`]],
  motor: [[0, .22, -.1, 'Shaft and propeller', 'Spins about 5,000 RPM at 6 V. Swap the wires and it turns the other way.'], [0, .22, .4, 'End cap and brushes', 'Carbon brushes feed the spinning coil. Never drive it straight from an Arduino pin.']],
  bldc: [[.36, .22, -.13, 'Propeller', 'Two-blade prop: it pushes air down to make thrust.'], [0, .2, -.13, 'Brushless motor', 'Magnets in the spinning bell, coils inside: no brushes to wear out.'], [0, .09, .27, 'ESC', 'Electronic speed controller: turns the flight controller signal into three-phase power.']],
  fc: [[0, .13, 0, 'STM32F405', '168 MHz processor running Betaflight: it keeps the drone level 8,000 times a second.'], [.28, .12, .18, 'Gyro (IMU)', 'Senses rotation and tilt.'],
    [.4, .1, .38, 'Rubber grommets', 'Soak up motor vibration so the gyro reads cleanly.'], [-.46, .14, 0, 'USB port', 'Connects to Betaflight on a computer for setup.'], [.33, .12, -.2, 'Status LEDs', 'Blue = powered, green = armed.']],
  rc: [[.35, .45, -.45, 'Antennas', '2.4 GHz antennas: keep them at 90° to each other for the best range.']],
  usbc: [[-.42, .18, .15, 'Mains pins', 'Plug into the wall: 230 V AC goes in, a safe 5 V DC comes out.'], [.04, .2, -.38, 'USB-C cable', 'Carries 5 V and ground to your circuit.'], [.06, .35, .2, 'Rating', '5 V, up to 2 A (10 W).']],
  lamp: [[0, .36, -.08, 'Tungsten filament', 'A thin wire that glows white-hot at about 2,500 °C.'], [0, .12, -.08, 'Screw base', 'The metal base carries current to the filament.']],
  bulb: [[0, .52, -.12, 'LED bulb', 'Mains bulb switched by the relay.'], [.22, .24, .3, 'Relay', 'A 5 V coil pulls a switch that can carry 10 A at 250 V.']],
  servo: [[.15, .3, 0, 'Horn', 'Turns to the angle you send: 0–180°.']],
  ultrasonic: [[-.28, .26, -.1, 'Transmitter', 'Sends a 40 kHz ping.'], [.28, .26, -.1, 'Receiver', 'Hears the echo. Time × speed of sound ÷ 2 = distance.']],
};

export function open(container, api) {
  const { type, PD, PARTINFO } = api; const d = PD[type], inf = PARTINFO[type] || {};
  container.classList.add('pv');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.environment = makeEnv(renderer);
  const camera = new THREE.PerspectiveCamera(32, 1, .05, 100);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 6, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6;
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: .5, far: 20 }); key.shadow.bias = -.0004; scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4cc, .35));
  // studio floor: soft shadow catcher and thin rings like a product turntable
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: .16 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  for (const [r, o] of [[1.25, .35], [1.7, .22], [2.3, .12]]) { const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + .008, 128), new THREE.MeshBasicMaterial({ color: 0x9aa39a, transparent: true, opacity: o }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .001; scene.add(ring); }

  // the part itself, centred and scaled to fit the stage
  const p = { id: 0, type, props: { ...(d.props || {}), ...(api.props || {}) }, st: { angle: 60, rot: 20, on: false, pow: false }, on: type === 'switch', burnt: false };
  const turn = new THREE.Group(); scene.add(turn);
  const model = buildPart(p, d, api); model.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(model); const size = bb.getSize(new THREE.Vector3()); const ctr = bb.getCenter(new THREE.Vector3());
  const k = 2.5 / Math.max(size.x, size.z, size.y * 1.4, .4);
  const holder = new THREE.Group(); holder.scale.setScalar(k); holder.position.set(-ctr.x * k, -bb.min.y * k, -ctr.z * k); holder.add(model); turn.add(holder);
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const tall = size.y * k;   // tall parts (LEDs, bulbs) need the camera further back and aimed higher

  // hotspots: features first, then the pins (grouped by board edge when there are many)
  const W = d.w / U, D = d.h / U, spots = [];
  const anchor = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); model.add(o); return o; };
  for (const [fx, y, fz, title, text] of FEAT[type] || []) spots.push({ a: anchor(fx * W, y, fz * D), title, text: typeof text === 'function' ? text(p) : text });
  if (!FEAT[type]) spots.push({ a: anchor(0, Math.max(.08, bb.max.y - .02), 0), title: d.short || d.name, text: (inf.d || '').split('. ')[0].replace(/\.$/, '') + '.' });
  const ports = portsLocal(d, W, D), pinText = n => (inf.p || {})[n] || '';
  const ph = d.board || /^(ultrasonic|lcd|relay|driver|ldr|temp|pir)$/.test(type) || d.gen ? .14 : .1;
  if (/^(led|resistor)$/.test(type)) { /* the feature cards already explain both legs */ }
  else if (ports.length <= 5) ports.forEach(q => spots.push({ a: anchor(q.x, ph, q.z), title: `${q.n} pin`, text: pinText(q.n) || 'Connection point.', pin: true }));
  else { const sides = {}; ports.forEach(q => (sides[q.side] = sides[q.side] || []).push(q));
    Object.entries(sides).forEach(([side, qs]) => { const ax = qs.reduce((a, q) => a + q.x, 0) / qs.length, az = qs.reduce((a, q) => a + q.z, 0) / qs.length;
      const names = qs.map(q => q.n); const shown = qs.slice(0, 6).map(q => `<b>${q.n}</b> ${pinText(q.n)}`).join(' · ');
      spots.push({ a: anchor(ax, ph, az), title: `Pin header: ${names.length > 6 ? names[0] + '…' + names[names.length - 1] : names.join(', ')}`, text: shown + (qs.length > 6 ? ` · +${qs.length - 6} more` : ''), pin: true, html: true }); }); }

  // overlay: dots on the model, cards around it, lines between them
  const ui = document.createElement('div'); ui.className = 'pv-ui';
  ui.innerHTML = `<svg class="pv-lines"></svg><div class="pv-cards"></div><div class="pv-hint">Drag to turn · pinch to zoom</div><button class="pv-reset" aria-label="Reset view">↺</button>`;
  container.appendChild(ui);
  const svg = ui.querySelector('.pv-lines'), cardsEl = ui.querySelector('.pv-cards');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  spots.forEach((s, i) => {
    s.dot = document.createElement('button'); s.dot.className = 'pv-dot'; s.dot.textContent = i + 1; s.dot.setAttribute('aria-label', s.title); ui.appendChild(s.dot);
    s.card = document.createElement('button'); s.card.className = 'pv-card' + (s.pin ? ' pin' : '');
    s.card.innerHTML = `<span class="n">${i + 1}</span><span class="t">${esc(s.title)}</span><span class="x">${s.html ? s.text : esc(s.text)}</span>`; cardsEl.appendChild(s.card);
    s.line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); svg.appendChild(s.line);
    const pick = () => focus(i); s.dot.addEventListener('click', pick); s.card.addEventListener('click', pick);
    s.card.addEventListener('pointerenter', () => s.dot.classList.add('hot')); s.card.addEventListener('pointerleave', () => s.dot.classList.remove('hot'));
  });

  // ---------- turning and zooming ----------
  const R0 = Math.max(4.6, tall * 2.6), view = { yaw: -.6, pitch: .55, r: R0, tYaw: -.6, tPitch: .55, tR: R0 }; let idle = 0, active = -1;
  function focus(i) { active = i; spots.forEach((s, j) => { s.card.classList.toggle('on', j === i); s.dot.classList.toggle('on', j === i); });
    const w = spots[i].a.getWorldPosition(new THREE.Vector3()); const ang = Math.atan2(w.x, w.z);
    // turn the part so the hotspot faces the camera (a turn by θ adds θ to a point's angle around the vertical axis)
    turn.userData.tRot = turn.rotation.y + angDiff(ang, view.tYaw); idle = -4; if (spots[i].card.scrollIntoView && narrow) spots[i].card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
  const angDiff = (a, b) => { let x = b - a; while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
  const ptrs = new Map(); let pinch = 0;
  renderer.domElement.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, [e.clientX, e.clientY]); try { renderer.domElement.setPointerCapture(e.pointerId); } catch (x) { } idle = -3; });
  renderer.domElement.addEventListener('pointermove', e => { const o = ptrs.get(e.pointerId); if (!o) return;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); ptrs.set(e.pointerId, [e.clientX, e.clientY]); const [c, f] = [...ptrs.values()]; const d1 = Math.hypot(c[0] - f[0], c[1] - f[1]);
      if (pinch) view.tR = clamp(view.tR * d0 / Math.max(1, d1), 1.1, 12); pinch = 1; return; }
    view.tYaw -= (e.clientX - o[0]) * .008; view.tPitch = clamp(view.tPitch + (e.clientY - o[1]) * .006, .08, 1.35); ptrs.set(e.pointerId, [e.clientX, e.clientY]); idle = -3; });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; };
  renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', up);
  renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); view.tR = clamp(view.tR * (1 + Math.sign(e.deltaY) * .1), 1.1, 12); idle = -3; }, { passive: false });
  ui.querySelector('.pv-reset').addEventListener('click', () => { Object.assign(view, { tYaw: -.6, tPitch: .55, tR: R0 }); turn.userData.tRot = 0; active = -1; spots.forEach(s => { s.card.classList.remove('on'); s.dot.classList.remove('on'); }); });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let narrow = false, stageH = 1;
  // wide: cards float left and right of the part with lines to the dots; narrow: the cards sit in a swipe strip under the stage
  function resize() { const w = container.clientWidth || 1; narrow = w < 760; container.classList.toggle('narrow', narrow);
    if (narrow && cardsEl.parentElement !== container) container.appendChild(cardsEl); else if (!narrow && cardsEl.parentElement !== ui) ui.insertBefore(cardsEl, ui.children[1]);
    const h = stageH = narrow ? 340 : (container.clientHeight || 1);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // ---------- frame loop ----------
  const ray = new THREE.Raycaster(), tmp = new THREE.Vector3(); let last = performance.now(), raf = 0, alive = true, occT = 0;
  function frame(now) {
    if (!alive) return; raf = requestAnimationFrame(frame);
    if (document.hidden || !container.offsetWidth) return;
    const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now; idle += dt;
    if (idle > 2.5 && active < 0) view.tYaw += dt * .25;          // slow turntable while nobody touches it
    const e = 1 - Math.exp(-8 * dt);
    view.yaw += (view.tYaw - view.yaw) * e; view.pitch += (view.tPitch - view.pitch) * e; view.r += (view.tR - view.r) * e;
    if (turn.userData.tRot != null) turn.rotation.y += (turn.userData.tRot - turn.rotation.y) * e;
    const lookY = Math.max(.32, tall * .45);
    camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch) * view.r, lookY + Math.sin(view.pitch) * view.r, Math.cos(view.yaw) * Math.cos(view.pitch) * view.r);
    camera.lookAt(0, lookY, 0);
    renderer.render(scene, camera);
    // place dots, lines and (on wide screens) cards
    const w = container.clientWidth, h = stageH; const R = container.getBoundingClientRect();
    const doOcc = now - occT > 180; if (doOcc) occT = now;
    spots.forEach(s => { s.a.getWorldPosition(tmp); const wp = tmp.clone(); tmp.project(camera); const x = (tmp.x + 1) / 2 * w, y = (1 - tmp.y) / 2 * h;
      s.x = x; s.y = y; s.dot.style.transform = `translate(${x - 13}px,${y - 13}px)`;
      if (doOcc) { const dir = wp.clone().sub(camera.position); const dist = dir.length(); ray.set(camera.position, dir.normalize()); ray.far = dist - .03;
        s.dot.classList.toggle('behind', ray.intersectObject(turn, true).length > 0); }
      if (!narrow) { const cr = s.card.getBoundingClientRect(); const cx = cr.left - R.left + (cr.left - R.left < w / 2 ? cr.width : 0), cy = cr.top - R.top + cr.height / 2;
        s.line.setAttribute('x1', cx); s.line.setAttribute('y1', cy); s.line.setAttribute('x2', x); s.line.setAttribute('y2', y); s.line.style.display = ''; }
      else s.line.style.display = 'none'; });
  }
  raf = requestAnimationFrame(frame);

  return {
    close() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); scene.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); renderer.dispose(); container.innerHTML = ''; container.classList.remove('pv', 'narrow'); },
  };
}
