/**
 * A local stand-in for the OpenAI endpoints FYPAD calls (OPENAI_BASE_URL points here in tests and in
 * `npm run play`). It answers each structured-output schema by name (influencer_persona,
 * first_posts, post, replies) and returns generated gradient PNGs for images, so the UI can be
 * played end to end without a key. It records every request and can be told to fail.
 * Never shipped: test and play only.
 *
 *   node tests/fake-ai.ts   -> prints {"url": "..."} and serves until killed
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { deflateSync } from "node:zlib";

export interface FakeAiState {
  requests: { path: string; schema: string | null; body: string }[];
  failNext: number;
  refuse: boolean;
  /** Answer like an OpenAI account with no credits left (429 insufficient_quota). */
  quota?: boolean;
  /** Text the next "post" answer carries (to test figure stripping end to end). */
  nextCaption: string | null;
  images: number;
}

// ───────────────────────────── a tiny PNG encoder (RGB, no dependencies)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const hsl = (h: number, s: number, l: number): [number, number, number] => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
};

/** A soft two-hue gradient with a round "subject" — recognisably a placeholder photo, different each time. */
export function gradientPng(w: number, h: number, seed: number): Buffer {
  const h1 = (seed * 67) % 360;
  const h2 = (h1 + 40 + ((seed * 29) % 80)) % 360;
  const c1 = hsl(h1, 0.65, 0.62);
  const c2 = hsl(h2, 0.7, 0.42);
  const sub = hsl((h1 + 180) % 360, 0.35, 0.85);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const cx = w * 0.5;
  const cy = h * 0.55;
  const r = Math.min(w, h) * 0.28;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      let px = [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
      const d = Math.hypot(x - cx, (y - cy) * 0.9);
      if (d < r) {
        const m = Math.min(1, (r - d) / 6) * 0.75;
        px = px.map((v, i) => v * (1 - m) + sub[i] * m);
      }
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = px[0];
      raw[o + 1] = px[1];
      raw[o + 2] = px[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ───────────────────────────── canned answers

const PERSONAS = [
  { display_name: "Mika Thrift", handle: "mika.thrift", bio: "Tokyo street style on a ¥3000 budget 🧥✨\nThrifted Y2K only. Harajuku → Koenji daily", personality: "Playful, sharp eye for bargains, loyal to her neighbourhood shops, secretly sentimental.", voice: "Short, lowercase, Japanese loanwords, one or two emoji, ends with a question to fans.", posting_themes: ["thrift hauls in Koenji", "outfit of the day", "hidden vintage shops", "Y2K accessories"], look: "Early-twenties woman, sharp bob with pink streaks, silver hoop earrings, oversized thrifted Y2K jackets, low-rise cargo pants, platform sneakers, warm film-photo look." },
  { display_name: "Ramen Ron", handle: "ramen_ron", bio: "Ex-astronaut. Now I rate ramen in Osaka 🍜🚀", personality: "Calm, nerdy, very precise, warm humour about space.", voice: "Dry jokes, space metaphors, short sentences.", posting_themes: ["ramen reviews", "Osaka nights", "space stories"], look: "Man in his fifties, short grey beard, NASA-style bomber jacket, round glasses, steam from noodle bowls." },
];

function persona(n: number) {
  return PERSONAS[n % PERSONAS.length];
}

function introPosts() {
  return {
    posts: [
      { caption: "hi fypad 👋 i'm mika. i only wear what i find second-hand.\nfirst haul of the week, guess the price?", hashtags: ["thrift", "y2k", "tokyostyle"], scene: "Mirror selfie in a tiny Koenji vintage shop, racks of colourful jackets behind." },
      { caption: "this jacket was ¥800 and it's my whole personality now 🧥", hashtags: ["ootd", "harajuku", "vintage"], scene: "Full-body outfit shot on a Harajuku side street at golden hour." },
      { caption: "secret shop alert: no sign, third floor, cash only ✨", hashtags: ["koenji", "secondhand"], scene: "Climbing a narrow stairwell covered with old posters, looking back at the camera." },
    ],
  };
}

export async function startFakeAi(state: FakeAiState = { requests: [], failNext: 0, refuse: false, nextCaption: null, images: 0 }) {
  let personas = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? "").replace(/^\/v1/, "");
      const text = body.toString("latin1");
      const schema = text.match(/"json_schema":\{"name":"([a-z_]+)"/)?.[1] ?? null;
      state.requests.push({ path, schema, body: text.slice(0, 4000) });
      const json = (code: number, o: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(o));
      if (path === "/__control") {
        Object.assign(state, JSON.parse(body.toString() || "{}"));
        return json(200, { ok: true });
      }
      if (state.quota) return json(429, { error: { message: "You have no credits remaining.", type: "insufficient_quota", code: "credit_balance_exhausted" } });
      if (state.refuse) return json(400, { error: { code: "moderation_blocked", message: "Your request was rejected by the safety system." } });
      if (state.failNext > 0) {
        state.failNext--;
        return json(503, { error: { message: "overloaded" } });
      }
      if (path === "/chat/completions") {
        let content: unknown;
        if (schema === "influencer_persona") content = persona(personas++);
        else if (schema === "first_posts") content = introPosts();
        else if (schema === "post") {
          content = { caption: state.nextCaption ?? "new day, new haul 🛍️ the girl at the counter remembered me lol", hashtags: ["thrift", "dailyfit"], scene: "Holding a paper bag of clothes outside a vintage shop, neon signs, dusk." };
          state.nextCaption = null;
        } else if (schema === "replies") {
          const n = (text.match(/\\n\d+\. /g) ?? []).length || 1;
          content = { replies: Array.from({ length: n }, (_, k) => ({ comment: k + 1, text: k === 0 ? "thank youuu 🥹 come thrift with me next week" : "you get it ✨" })) };
        } else content = {};
        return json(200, { choices: [{ message: { content: JSON.stringify(content) } }] });
      }
      if (path === "/images/generations" || path === "/images/edits") {
        state.images++;
        const tall = text.includes("1024x1536");
        const png = gradientPng(tall ? 400 : 400, tall ? 600 : 400, state.images);
        return json(200, { data: [{ b64_json: png.toString("base64") }], output_format: "png" });
      }
      json(404, { error: { message: `no route ${path}` } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v1`, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const { url } = await startFakeAi();
  console.log(JSON.stringify({ url }));
}
