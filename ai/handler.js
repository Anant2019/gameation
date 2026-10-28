// AI features for Circuit Arena: "build with AI" and the "Circuit Doctor".
// Uses Claude when the Cloudflare secret ANTHROPIC_API_KEY is set, otherwise Cloudflare Workers AI (no key needed).
// Clients only send a short request; the prompts are fixed here, so the key
// cannot be used as a general chatbot.
import CATALOG from './catalog.json';

const MODEL = 'claude-haiku-5-5';
// Used when no Anthropic key is set: Cloudflare Workers AI, no key needed (free daily allowance).
const CF_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const API = 'https://api.anthropic.com/v1/messages';
const ORIGINS = ['https://calmtype.life', 'https://www.calmtype.life', 'https://gameation.anant-21920010.workers.dev'];
// Requests per IP per day, counted in each Cloudflare location (good enough to stop abuse).
const DAILY = { build: 15, doctor: 15 };

const BUILD_TOOL = {
  name: 'build_circuit',
  description: 'Return the circuit to place on the Circuit Arena workbench.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short name of the build, max 40 characters' },
      summary: { type: 'string', description: 'One or two sentences: what it does' },
      parts: { type: 'array', items: { type: 'object', properties: {
        type: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, props: { type: 'object' } }, required: ['type', 'x', 'y'] } },
      wires: { type: 'array', items: { type: 'object', properties: {
        a: { type: 'integer', description: 'index of the first part' }, pa: { type: 'string', description: 'pin name on part a' },
        b: { type: 'integer' }, pb: { type: 'string' } }, required: ['a', 'pa', 'b', 'pb'] } },
      rules: { type: 'array', description: 'Board rules (Arduino/Raspberry Pi/Pico boards only)', items: { type: 'object', properties: {
        in: { type: 'string', description: 'input pin, or "*" for always' }, op: { type: 'string', enum: ['<', '>', '=', '!=', '<=', '>='] },
        value: { type: 'number' }, out: { type: 'string' }, then: { type: 'string' }, else: { type: 'string' } }, required: ['in', 'out', 'then'] } },
      code: { type: 'array', description: 'Programs for programmable parts (mcu, esp32)', items: { type: 'object', properties: {
        part: { type: 'integer' }, source: { type: 'string' } }, required: ['part', 'source'] } },
      env: { type: 'object', description: 'Starting sensor values, using the env keys' },
      try: { type: 'string', description: 'One sentence telling the player what to change in Controls to see it work' },
      how: { type: 'string', description: 'Two to four sentences explaining how it works, for a student' },
    },
    required: ['title', 'summary', 'parts', 'wires', 'try', 'how'],
  },
};

const BUILD_SYSTEM = `You design circuits for Circuit Arena, an electronics simulator game. Players type what they want and you place the parts and wires.

Use ONLY these part types and EXACT pin names:
${CATALOG.parts}

Sensor inputs players can change (env keys and ranges):
${CATALOG.env}

Battery presets: ${CATALOG.batteries}. LED colours: ${CATALOG.ledColors}.

Wiring rules:
- Boards (arduino, nano, mega, rpi, pi5, pizero, pico, esp32) are USB powered. Power modules from their 5V (or 3V3) and GND pins.
- Sensor and actuator modules: VCC to board 5V (use 3V3 when the part's max voltage is below 4 V), GND to board GND, OUT/SIG to a board pin.
- An LED on a board pin needs a resistor (220-470 ohm) from the pin to LED +, and LED - to GND. Never connect an LED straight to a battery.
- Motors need a driver (driver/mosfet/relay); never power a motor from a board pin. Servos: VCC 5V, GND, SIG to a pin.
- Without a board you can build with battery, switch, button, resistor, LED, chips and so on. Every circuit needs a closed loop back to battery -.
- Wires join two pins: {a: part index, pa: pin, b: part index, pb: pin}. Part indexes start at 0 in the parts list.

Logic:
- For arduino/nano/mega/rpi/pi5/pizero/pico use rules: {in, op, value, out, then, else}. "in" is a board pin (or "*" for always). Sensor modules report real units (cm, °C, %, ppm, 0/1); raw analog parts (pot wiper, LM35) read 0-1023 on Arduino analog pins.
- then/else accept numbers or formulas: map(x,a,b,c,d), constrain(x,a,b), blink(ms). 1 = ON, servo 0-180, PWM 0-255, motor driver -255 to 255.
- For mcu (pins P0-P5) and esp32 (pins G2...G34) write Arduino-style C in "code" instead of rules. Example:
${CATALOG.icExample}

Layout: x between 40 and 900, y between 60 and 520, at least 140 apart; put the board near the bottom middle. Use at most 12 parts. Keep it simple and working.
Set "env" so the circuit starts in a sensible state, and write "try" so the player knows what to move in Controls.
What the simulator cannot do: no image or object recognition, no file or photo upload, no cutting blade part, and no robot-arm or wheel movement outside the car and drone worlds. For such requests build the closest simple version with real parts (servos for arm joints, a DC motor through a motor driver as the cutter or spinner, a push button or IR sensor standing in for "object detected") and start the summary with what you simplified, e.g. "Simplified: the camera cannot recognise crops here, so a button stands in for 'crop detected'."
Pin reminders: motor has only pins A and B (drive it from driver L1/L2 or through a mosfet, never straight from a board pin); servo has GND, VCC, SIG; camera, rfid, ecg, spo2 and bmp work at 3.3 V only (power them from the 3V3 pin of an esp32 or rpi; Arduino has no 3V3 pin).
Only build low-voltage hobby electronics. If the request is unsafe (mains wiring, weapons) or not an electronics build, return an empty parts list and explain in "summary" what you can build instead.
Reply in the player's language for title, summary, try and how (Hindi or Hinglish if they write that way).

Two correct examples (note: each rule reads the exact board pin the sensor OUT is wired to, writes the exact pin the output SIG is wired to, and compares in the sensor's own units):
Request: smart dustbin
{"title": "Smart Dustbin", "summary": "The lid opens by itself when a hand comes close.", "parts": [{"type": "arduino", "x": 360, "y": 330}, {"type": "ultrasonic", "x": 150, "y": 110}, {"type": "servo", "x": 660, "y": 130}], "wires": [{"a": 1, "pa": "VCC", "b": 0, "pb": "5V"}, {"a": 1, "pa": "GND", "b": 0, "pb": "GND"}, {"a": 1, "pa": "OUT", "b": 0, "pb": "D2"}, {"a": 2, "pa": "VCC", "b": 0, "pb": "5V"}, {"a": 2, "pa": "GND", "b": 0, "pb": "GND"}, {"a": 2, "pa": "SIG", "b": 0, "pb": "D3"}], "rules": [{"in": "D2", "op": "<", "value": 20, "out": "D3", "then": "90", "else": "0"}], "env": {"distance": 100}, "try": "In Controls, bring the hand distance below 20 cm: the lid opens.", "how": "The ultrasonic sensor measures distance in cm on D2. When it is under 20 cm the Arduino turns the servo on D3 to 90 degrees."}
Request: night lamp
{"title": "Night Lamp", "summary": "A bulb switches on by itself when it gets dark.", "parts": [{"type": "arduino", "x": 380, "y": 340}, {"type": "ldr", "x": 150, "y": 120}, {"type": "bulb", "x": 650, "y": 110}], "wires": [{"a": 1, "pa": "VCC", "b": 0, "pb": "5V"}, {"a": 1, "pa": "GND", "b": 0, "pb": "GND"}, {"a": 1, "pa": "OUT", "b": 0, "pb": "A0"}, {"a": 2, "pa": "VCC", "b": 0, "pb": "5V"}, {"a": 2, "pa": "GND", "b": 0, "pb": "GND"}, {"a": 2, "pa": "SIG", "b": 0, "pb": "D5"}], "rules": [{"in": "A0", "op": "<", "value": 40, "out": "D5", "then": "1", "else": "0"}], "env": {"light": 80}, "try": "In Controls, drag the light level below 40%: the bulb turns on.", "how": "The LDR module reports light from 0 to 100% on A0. Below 40% the Arduino switches the bulb on D5."}`;

const DOCTOR_SYSTEM = `You are the Circuit Doctor in Circuit Arena, an electronics simulator game for students.
You get the player's circuit as JSON (parts with id, type, values, live readings and warnings; wires between "id:pin"; board rules; chip code) and their question.
Find what is wrong or answer the question. Reply in the player's language (Hindi or Hinglish if they write that way), under 130 words, friendly and concrete:
first one line on the cause, then numbered fixes that name the parts and pins exactly. Mention safe current limits when something burnt.
Facts: an LED needs a series resistor (about 330 ohm on 9 V, 220 ohm on 5 V) and burns above 50 mA; a 1/4 W resistor burns above 1 W; modules need VCC, GND and their signal pin wired; boards are powered over USB.`;

const json = (body, status = 200, origin) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) },
});
function cors(origin) {
  const ok = origin && (ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin));
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {};
}

async function overLimit(request, kind) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const key = new Request(`https://ai-limit.local/${kind}/${day}/${encodeURIComponent(ip)}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  const used = hit ? parseInt(await hit.text(), 10) || 0 : 0;
  if (used >= DAILY[kind]) return true;
  await cache.put(key, new Response(String(used + 1), { headers: { 'cache-control': 'max-age=90000' } }));
  return false;
}

async function callClaude(env, body) {
  const r = await fetch(env.ANTHROPIC_BASE || API, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('upstream ' + r.status);
  return r.json();
}

// Workers AI: same prompts, JSON mode instead of a tool call.
async function cfRun(env, messages, opts) {
  const out = await env.AI.run(env.AI_MODEL || CF_MODEL, { messages, max_tokens: opts.max_tokens, ...(opts.schema ? { response_format: { type: 'json_schema', json_schema: opts.schema } } : {}) });
  const r = out && out.response;
  if (opts.schema) {
    if (r && typeof r === 'object') return r;
    const t = String(r || '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('no json');
    return JSON.parse(t.slice(a, b + 1));
  }
  return String(r || '').trim();
}

async function build(request, env, origin, input) {
  const prompt = String(input.prompt || '').trim().slice(0, 400);
  if (prompt.length < 3) return json({ error: 'empty' }, 400, origin);
  const repair = input.repair && typeof input.repair === 'object' ? input.repair : null;
  // Popular requests are cached for a week so they are free and instant the second time.
  const cacheKey = new Request('https://ai-cache.local/build-v3/' + encodeURIComponent(prompt.toLowerCase().replace(/\s+/g, ' ')));
  if (!repair) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return json({ ...(await hit.json()), cached: true }, 200, origin);
  }
  if (await overLimit(request, 'build')) return json({ error: 'limit' }, 429, origin);
  if (!env.ANTHROPIC_API_KEY) {
    const msgs = [{ role: 'system', content: BUILD_SYSTEM + '\nReply with only the JSON object.' }, { role: 'user', content: prompt }];
    if (repair) {
      msgs.push({ role: 'assistant', content: JSON.stringify(repair.previous || {}) });
      msgs.push({ role: 'user', content: 'The simulator rejected this circuit:\n' + (repair.errors || []).slice(0, 12).join('\n') + '\nFix every problem and reply with the whole corrected JSON.' });
    }
    const b = await cfRun(env, msgs, { max_tokens: 2500, schema: BUILD_TOOL.input_schema });
    const result = { build: b };
    if (!repair && Array.isArray(b.parts) && b.parts.length) {
      await caches.default.put(cacheKey, new Response(JSON.stringify(result), { headers: { 'cache-control': 'max-age=604800' } }));
    }
    return json(result, 200, origin);
  }
  const messages = [{ role: 'user', content: prompt }];
  if (repair) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'prev', name: 'build_circuit', input: repair.previous || {} }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'prev', is_error: true,
      content: 'The simulator rejected this circuit:\n' + (repair.errors || []).slice(0, 12).join('\n') + '\nFix every problem and call build_circuit again.' }] });
  }
  const out = await callClaude(env, {
    model: MODEL, max_tokens: 2500,
    system: [{ type: 'text', text: BUILD_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [BUILD_TOOL], tool_choice: { type: 'tool', name: 'build_circuit' },
    messages,
  });
  const tool = (out.content || []).find(c => c.type === 'tool_use');
  if (!tool) return json({ error: 'no_result' }, 502, origin);
  const result = { build: tool.input };
  if (!repair && Array.isArray(tool.input.parts) && tool.input.parts.length) {
    await caches.default.put(cacheKey, new Response(JSON.stringify(result), { headers: { 'cache-control': 'max-age=604800' } }));
  }
  return json(result, 200, origin);
}

async function doctor(request, env, origin, input) {
  const question = String(input.question || 'What is wrong with my circuit?').trim().slice(0, 400);
  const circuit = JSON.stringify(input.circuit || {}).slice(0, 12000);
  if (await overLimit(request, 'doctor')) return json({ error: 'limit' }, 429, origin);
  if (!env.ANTHROPIC_API_KEY) {
    const text = await cfRun(env, [{ role: 'system', content: DOCTOR_SYSTEM }, { role: 'user', content: `Circuit:\n${circuit}\n\nQuestion: ${question}` }], { max_tokens: 700 });
    return json({ answer: text || 'Sorry, I could not read this circuit. Try again.' }, 200, origin);
  }
  const out = await callClaude(env, {
    model: MODEL, max_tokens: 700,
    system: [{ type: 'text', text: DOCTOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Circuit:\n${circuit}\n\nQuestion: ${question}` }],
  });
  const text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  return json({ answer: text || 'Sorry, I could not read this circuit. Try again.' }, 200, origin);
}

export async function handleAI(request, env) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'method' }, 405, origin);
  if (!env.ANTHROPIC_API_KEY && !env.AI) return json({ error: 'not_configured' }, 503, origin);
  let input;
  try { input = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, origin); }
  const path = new URL(request.url).pathname;
  try {
    if (path === '/api/ai/build') return await build(request, env, origin, input);
    if (path === '/api/ai/doctor') return await doctor(request, env, origin, input);
  } catch (e) {
    return json({ error: 'ai_failed' }, 502, origin);
  }
  return json({ error: 'not_found' }, 404, origin);
}
