/**
 * Plays FYPAD end to end in headless Chrome over CDP (zero deps), with two "FYPAD Test" stub wallets
 * (scripts/dev-wallet.js: throwaway keypairs that really sign) and the fake Solana RPC on port 8919
 * (tests/fake-rpc.ts: executes create_v2, the fee split, sweep / distribute, verifies signatures).
 *
 *   npx next build && npm run play          fake AI (tests/fake-ai.ts): the whole product loop
 *   npm run play:real                       REAL OpenAI: OPENAI_API_KEY is read from ../factory/.env and
 *        passed ONLY to the server process env — never printed, never written in this repo. Generates
 *        one real influencer (persona, portrait, 3 posts), publishes it, screenshots it.
 *
 * Server: `next start` on PLAY_PORT (default 3929) with a throwaway data dir data/play-<mode> (wiped
 * before each run). Never a real wallet, never mainnet, nothing deployed.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { SYSTEM, startFakeRpc } from "../tests/fake-rpc.ts";
import { startFakeAi } from "../tests/fake-ai.ts";

const REAL = process.argv.includes("--real");
const PORT = Number(process.env.PLAY_PORT ?? 3929);
const RPC_PORT = Number(process.env.PLAY_RPC_PORT ?? 8919);
const base = `http://localhost:${PORT}`;
const root = resolve(import.meta.dirname, "..");
const shots = join(root, "shots");
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = REAL ? "real" : "fake";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const CRON = "play-cron-secret";

// ── throwaway wallets
const keyA = nacl.sign.keyPair().secretKey;
const keyB = nacl.sign.keyPair().secretKey;
const addrA = bs58.encode(keyA.slice(32));
const addrB = bs58.encode(keyB.slice(32));
const TREASURY = Keypair.generate().publicKey.toBase58();
console.log(`creator wallet ${addrA}, fan wallet ${addrB} ${REAL ? "(REAL OpenAI)" : "(fake AI)"}`);

const dataDir = join(root, "data", `play-${tag}`);
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

// ── fake chain (+ fake AI unless --real)
const fake = await startFakeRpc(undefined, RPC_PORT);
fake.state.accounts.set(addrA, { lamports: 3_000_000_000, owner: SYSTEM });
fake.state.accounts.set(addrB, { lamports: 1_000_000_000, owner: SYSTEM });
{
  // pump.fun Global (devnet values read on 2026-10-08: 1 SOL virtual reserve, fee 95 bps, creator 5 bps)
  const { globalPda } = await import("../src/server/pump.ts");
  const g = Buffer.alloc(1100);
  for (let i = 0; i < 8; i++) Keypair.generate().publicKey.toBuffer().copy(g, i === 0 ? 41 : 162 + 32 * (i - 1));
  for (let i = 0; i < 8; i++) Keypair.generate().publicKey.toBuffer().copy(g, 741 + 32 * i);
  g.writeBigUInt64LE(1_073_000_000_000_000n, 73);
  g.writeBigUInt64LE(1_000_000_000n, 81);
  g.writeBigUInt64LE(793_100_000_000_000n, 89);
  g.writeBigUInt64LE(95n, 105);
  g.writeBigUInt64LE(5n, 154);
  fake.state.accounts.set(globalPda().toBase58(), { lamports: 1, owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", data: g });
}
const ai = REAL ? null : await startFakeAi();
let openaiKey = null;
if (REAL) {
  const env = readFileSync(resolve(root, "..", "factory", ".env"), "utf8");
  openaiKey = env.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim() ?? null;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not found in factory/.env");
}

// ── server (the built app)
const serverEnv = {
  ...process.env,
  FYPAD_PGLITE_DIR: join(dataDir, "pglite"),
  FYPAD_MEDIA_DIR: join(dataDir, "media"),
  SOLANA_RPC_URL: fake.url,
  SOLANA_CLUSTER: "devnet",
  FYPAD_TREASURY_WALLET: TREASURY,
  NEXT_PUBLIC_SITE_URL: base,
  CRON_SECRET: CRON,
  FYPAD_ALLOW_CLOCK_OVERRIDE: "1",
  OPERATOR_SECRET_KEY: "",
  DATABASE_URL: "",
  BLOB_READ_WRITE_TOKEN: "",
  ...(REAL ? { OPENAI_API_KEY: openaiKey, OPENAI_BASE_URL: "" } : { OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: ai.url }),
};
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], { cwd: root, env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write(`[next] ${String(d).replaceAll(openaiKey ?? "\u0000", "***")}`));
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try {
    up = (await fetch(`${base}/api/health`)).ok;
  } catch {}
  if (!up) await sleep(500);
}
if (!up) throw new Error(`next start did not answer on ${PORT}`);

// ── chrome over CDP (browser-level socket, one session per page, two browser contexts = two wallets)
const chromePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
const profile = join(tmpdir(), `fypad-play-${Date.now()}`);
const chrome = spawn(chromePath, ["--headless=new", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let cdpPort = null;
for (let i = 0; i < 100 && !cdpPort; i++) {
  try {
    cdpPort = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null;
  } catch {}
  if (!cdpPort) await sleep(150);
}
const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let msgId = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) rej(new Error(m.error.message));
    else res(m.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const naclSrc = readFileSync(join(root, "node_modules", "tweetnacl", "nacl-fast.min.js"), "utf8");
const stub = readFileSync(join(root, "scripts", "dev-wallet.js"), "utf8");

async function page(secret) {
  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 1536, height: 960, deviceScaleFactor: 1, mobile: false });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: `${naclSrc}\n;window.FYPAD_TEST_SECRET=${JSON.stringify(Array.from(secret))};window.FYPAD_TEST_RPC=${JSON.stringify(fake.url)};\n${stub}` });
  const js = async (expression) => (await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const waitFor = async (expression, ms = 20000) => {
    for (let t = 0; t < ms; t += 400) {
      const v = await js(expression).catch(() => null);
      if (v) return v;
      await sleep(400);
    }
    return null;
  };
  const click = (sel) => js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
  const clickText = (text, scope = "body") =>
    js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button, ${scope} a`)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)}) && !x.disabled); if (b) b.click(); return Boolean(b); })()`);
  const setVal = (sel, v) =>
    js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const p = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, "value").set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  const go = async (path) => {
    await s("Page.navigate", { url: `${base}${path}` });
    await waitFor(`document.readyState === "complete"`);
    await sleep(1200);
  };
  let width = 1536;
  const viewport = async (w, h = w < 500 ? 844 : 960) => {
    width = w;
    await s("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  };
  const shot = async (name, full = false) => {
    await sleep(500);
    const params = { format: "png" };
    if (full) {
      const { cssContentSize } = await s("Page.getLayoutMetrics");
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width, height: Math.min(7000, Math.ceil(cssContentSize.height)), scale: 1 };
    }
    const { data } = await s("Page.captureScreenshot", params);
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`     shots/${name}.png`);
  };
  return { s, js, waitFor, click, clickText, setVal, go, shot, viewport };
}

async function signIn(p) {
  await p.go("/");
  await p.click("[data-testid=connect]");
  await p.waitFor(`[...document.querySelectorAll(".wallet-option")].some((b) => b.textContent.includes("FYPAD Test"))`);
  await p.clickText("FYPAD Test", "[data-testid=wallet-dialog]");
  await p.waitFor(`Boolean(document.querySelector("[data-testid=sign-in]"))`);
  await p.click("[data-testid=sign-in]");
  const ok = await p.waitFor(`document.querySelector("[data-testid=signed-in]")?.innerText`);
  await p.js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  await sleep(300);
  return ok;
}

const cronTick = async (at) => {
  const r = await fetch(`${base}/api/cron/tick${at ? `?at=${at}` : ""}`, { headers: { authorization: `Bearer ${CRON}` } });
  return r.json();
};

async function main() {
  const A = await page(keyA);
  await A.go("/");
  check("cold start: home renders with real zero counters and an empty feed", await A.waitFor(`document.querySelector("[data-testid=feed-empty]") && document.querySelector("[data-testid=counters]")?.innerText.includes("0")`));
  await A.shot(`${tag}-home-empty-1536`);
  check("creator signs in by signed message", await signIn(A));

  // ── create: hero prompt → describe (prefilled) → generate → review
  await A.go("/");
  await A.setVal("[data-testid=hero-idea]", "a Tokyo street-style girl who only wears thrifted Y2K");
  await A.click("[data-testid=hero-create]");
  const prefilled = await A.waitFor(`document.querySelector("#c-idea")?.value`);
  check("hero sentence opens Create prefilled", prefilled?.includes("thrifted Y2K"), prefilled ?? "");
  await A.clickText("Fashion", "[data-testid=create-flow]");
  await A.setVal("#c-vibe", "35mm film, warm tones, Tokyo at night");
  await A.shot(`${tag}-create-1-describe-1536`);
  await A.click("[data-testid=generate]");
  await A.waitFor(`document.querySelector("[data-testid=create-flow]")?.dataset.step === "generating"`, 20000);
  await sleep(REAL ? 25000 : 2500);
  await A.shot(`${tag}-create-2-generating-1536`);
  const t0 = Date.now();
  const reviewed = await A.waitFor(`document.querySelector("[data-testid=create-flow]")?.dataset.step === "review" && document.querySelector("#r-handle")?.value`, REAL ? 600000 : 90000);
  check("persona + portrait + 3 posts generated", reviewed, reviewed ? `@${reviewed} in ${Math.round((Date.now() - t0) / 1000)} s` : await A.js(`document.querySelector("[data-testid=create-error]")?.innerText`));
  if (!reviewed) return;
  const handle = reviewed;
  const tiles = await A.js(`[...document.querySelectorAll("[data-testid=create-flow] .tile img")].length`);
  check("review shows the 3 first posts with photos", tiles === 3, String(tiles));
  await A.shot(`${tag}-create-3-review-1536`);

  // draft survives a refresh (server + browser)
  await A.go("/create");
  const restored = await A.waitFor(`document.querySelector("[data-testid=create-flow]")?.dataset.step === "review" && document.querySelector("#r-handle")?.value`, 20000);
  check("draft survives a page refresh", restored === handle, `${restored}`);
  await A.setVal("#r-bio", "Tokyo thrift on a ¥3000 budget 🧥✨\nY2K only. Koenji → Harajuku daily");
  await A.click("[data-testid=publish-next]");
  const coinStep = await A.waitFor(`document.querySelector("[data-testid=create-flow]")?.dataset.step === "coin"`, 20000);
  check("publish → coin step", coinStep);

  if (REAL) {
    // real run: keep the generated influencer coin-less and look at it
    await A.go(`/${handle}`);
    await A.waitFor(`document.querySelector("[data-testid=profile-grid]")`);
    await A.shot(`real-profile-1536`);
    await A.shot(`real-profile-1536-full`, true);
    const firstPost = await A.js(`document.querySelector("[data-testid=profile-grid] a")?.getAttribute("href")`);
    await A.go(firstPost);
    await A.shot(`real-post-1536`);
    await A.viewport(390);
    await A.go(`/${handle}`);
    await A.shot(`real-profile-390`, true);
    const bio = await A.js(`document.querySelector("[data-testid=profile] p.whitespace-pre-line")?.innerText`);
    check("real influencer page live with its bio and 3 posts", (await A.js(`document.querySelectorAll("[data-testid=profile-grid] a").length`)) === 3, bio?.slice(0, 80));
    return;
  }

  await A.setVal("#k-ticker", "MIKA");
  await A.setVal("#k-buy", "0.1");
  await A.shot(`${tag}-create-4-coin-1536`);
  // declined in the wallet first
  await A.js(`window.__FYPAD_REJECT_NEXT = true`);
  await A.click("[data-testid=launch-coin]");
  const declined = await A.waitFor(`document.querySelector("[data-testid=create-error]")?.innerText`);
  check("wallet declines: nothing sent, clear message", declined?.includes("declined") && fake.state.sent.length === 0, declined ?? "");
  await A.click("[data-testid=launch-coin]");
  const confirmed = await A.waitFor(`document.querySelector("[data-testid=launch-confirmed]")?.innerText`, 60000);
  check("create_v2 + initial buy signed by the user, confirmed after chain read-back", confirmed, confirmed ?? (await A.js(`document.querySelector("[data-testid=create-error]")?.innerText`)));
  await A.shot(`${tag}-create-5-split-1536`);
  await A.click("[data-testid=sign-split]");
  const done = await A.waitFor(`document.querySelector("[data-testid=create-done]")?.innerText`, 60000);
  check("80/20 fee split signed and verified on chain", done?.includes("80/20 fee split active"), done?.replace(/\s+/g, " ").slice(0, 120));
  await A.shot(`${tag}-create-6-done-1536`);
  check("fake chain: 2 landed transactions (create, split), signatures verified", fake.state.sent.filter((t) => t.landed && !t.err).length === 2, String(fake.state.sent.length));
  const mint = await A.js(`fetch("/api/search?q=MIKA").then((r) => r.json()).then(() => null)`);
  void mint;

  // ── profile live
  await A.click("[data-testid=view-profile]");
  await A.waitFor(`location.pathname === "/${handle}"`, 15000);
  await A.go(`/${handle}`);
  const prof = await A.waitFor(`document.querySelector("[data-testid=coin-panel]") && document.querySelectorAll("[data-testid=profile-grid] a").length`);
  check("profile live: coin panel + 3 posts", prof === 3, String(prof));
  const mcap = await A.js(`document.querySelector("[data-testid=coin-mcap]")?.innerText`);
  check("market cap read from the coin's bonding curve on chain", mcap && mcap.startsWith("$"), mcap ?? "");

  // ── a day later: the auto-post tick
  const day = Date.now() + 25 * 3_600_000;
  const t1 = await cronTick(day);
  check("auto-post tick queues and publishes the daily post", t1.scheduled === 1 && t1.steps >= 2, JSON.stringify(t1));
  await A.go(`/${handle}`);
  const n4 = await A.waitFor(`document.querySelectorAll("[data-testid=profile-grid] a").length === 4 && 4`);
  check("profile shows the new post (4 posts)", n4 === 4, String(n4));
  await A.shot(`${tag}-profile-1536`);
  await A.shot(`${tag}-profile-1536-full`, true);
  const newest = await A.js(`document.querySelector("[data-testid=profile-grid] a")?.getAttribute("href")`);

  // ── fan wallet: follow, like, comment
  const B = await page(keyB);
  check("fan signs in with a second wallet", await signIn(B));
  await B.go(newest);
  await B.waitFor(`document.querySelector("[data-testid=post-detail]")`);
  await B.click("[data-testid=like]");
  await B.waitFor(`document.querySelector("[data-testid=likes]")?.innerText === "1"`);
  await B.click("[data-testid=follow]");
  await B.waitFor(`document.querySelector("[data-testid=follow]")?.innerText === "Following"`);
  await B.setVal("[data-testid=comment-input]", "love this fit!! where is the shop?");
  await B.click("[data-testid=comment-post]");
  const commented = await B.waitFor(`document.querySelectorAll("[data-testid=comment]").length === 1`);
  const likes = await B.js(`document.querySelector("[data-testid=likes]")?.innerText`);
  check("fan likes, follows and comments (counts are real)", commented && likes === "1", `likes ${likes}`);

  // ── reply tick: the influencer answers in character
  const t2 = await cronTick(day + 60_000);
  await B.go(newest);
  const reply = await B.waitFor(`document.querySelector("[data-testid=reply]")?.innerText`, 15000);
  check("reply tick: the influencer answers the comment", reply, `${reply?.replace(/\s+/g, " ").slice(0, 90)} ${JSON.stringify(t2)}`);
  await B.shot(`${tag}-post-1536`);

  // ── fees: trades accrue, the creator collects, a distribution is recorded
  const coinMint = await A.js(`fetch("/api/search?q=${handle}").then((r) => r.json()).then((j) => j.people?.[0]?.ticker)`);
  const mintAddr = [...fake.state.accounts.entries()].find(([, a]) => a.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" && a.data?.includes(Buffer.from("MIKA")))?.[0];
  await fetch(`${fake.url}/__control`, { method: "POST", body: JSON.stringify({ accrue: { mint: mintAddr, lamports: 50_000_000 } }) });
  await A.go("/earnings");
  await A.waitFor(`document.querySelector("[data-testid=collect]") && !document.querySelector("[data-testid=collect]").disabled`);
  await A.click("[data-testid=collect]");
  const collected = await A.waitFor(`document.querySelector("[data-testid=collect-msg]")?.innerText`, 40000);
  await A.go("/earnings");
  const rows = await A.waitFor(`document.querySelectorAll("[data-testid=distribution-row]").length`);
  const earned = await A.js(`document.querySelector("[data-testid=earned]")?.innerText`);
  check("earnings: Collect pays 80 % on chain and a distribution is recorded", rows === 1 && earned === "0.04 SOL", `${coinMint} · ${collected} · earned ${earned}`);
  await A.shot(`${tag}-earnings-1536`);

  // ── rising + notifications + home
  await A.go("/rising");
  const ranked = await A.waitFor(`document.querySelectorAll("[data-testid=rising-row]").length`);
  check("rising lists the coin", ranked === 1, String(ranked));
  await A.shot(`${tag}-rising-1536`);
  await A.go("/notifications");
  const kinds = await A.js(`["follow","like","comment","distribution"].filter((k) => document.querySelector("[data-testid=notif-" + k + "]"))`);
  check("owner notifications: follow, like, comment, fee payout", kinds?.length === 4, JSON.stringify(kinds));
  await A.shot(`${tag}-notifications-1536`);
  await A.go("/");
  await A.waitFor(`document.querySelectorAll("[data-testid=post-card]").length >= 4`);
  await A.shot(`${tag}-home-1536`);
  await A.shot(`${tag}-home-1536-full`, true);
  await A.go(newest);
  await A.shot(`${tag}-post-owner-1536`);

  // ── phone width (true 390 px viewport)
  await A.viewport(390);
  for (const [name, path] of [["home", "/"], ["profile", `/${handle}`], ["post", newest], ["rising", "/rising"], ["earnings", "/earnings"], ["create", "/create"]]) {
    await A.go(path);
    await sleep(800);
    const over = await A.js("document.documentElement.scrollWidth > innerWidth");
    check(`no horizontal overflow at 390 px: ${name}`, !over);
    await A.shot(`${tag}-${name}-390`, true);
  }
}

let failed = true;
try {
  await main();
  failed = results.length === 0 || results.some((r) => !r.ok);
} catch (e) {
  console.error(e);
} finally {
  ws.close();
  chrome.kill();
  server.kill();
  await fake.close();
  await ai?.close();
  await sleep(700);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  console.log(failed ? `\nplay (${tag}): FAILED` : `\nplay (${tag}): green (${results.length} checks)`);
  process.exit(failed ? 1 : 0);
}
