/**
 * Coin data, only from real sources, stored in `coin_stats` so pages read the database (fast) and a
 * stale row is refreshed in after() / the tick:
 *  - DexScreener `tokens/v1/solana/<mints>` (batched by 30): market cap, price, 24 h change, volume,
 *    buys / sells (it indexes pump.fun curves and PumpSwap pools);
 *  - the pump.fun bonding curve read from chain: progress, graduation, and the market cap when
 *    DexScreener has no pair yet (price = virtual SOL / virtual tokens × SOL/USD from Coinbase);
 *  - pump.fun `coins/top-holders/<mint>` → totalHolders.
 * A failed read leaves the field null: the page shows "—", never a guess. Every refresh also stores
 * a market-cap snapshot (sparkline) and records the milestones a coin crosses.
 */
import { PublicKey } from "@solana/web3.js";
import { MILESTONES_USD } from "../config/fypad.ts";
import { cached, connection, pumpHolders, solUsd } from "./chain.ts";
import type { Q } from "./db.ts";
import { num } from "./db.ts";
import { bondingCurvePda, parseBondingCurve } from "./pump.ts";

export interface CoinStats {
  mint: string;
  mcapUsd: number | null;
  priceUsd: number | null;
  change24h: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  curveProgress: number | null;
  graduated: boolean | null;
  buys24h: number | null;
  sells24h: number | null;
  source: string | null;
  updatedAt: number;
}

export type Partial = Omit<CoinStats, "mint" | "updatedAt">;

export interface MarketSource {
  dex(mints: string[]): Promise<Map<string, Partial>>;
  curve(mint: string): Promise<Pick<Partial, "mcapUsd" | "priceUsd" | "curveProgress" | "graduated"> | null>;
  holders(mint: string): Promise<number | null>;
}

export const EMPTY_STATS: Partial = { mcapUsd: null, priceUsd: null, change24h: null, volume24hUsd: null, holders: null, curveProgress: null, graduated: null, buys24h: null, sells24h: null, source: null };

const DEX = () => process.env["DEXSCREENER_API_URL"] || "https://api.dexscreener.com";
const TOTAL_SUPPLY_TOKENS = 1_000_000_000;
const INITIAL_REAL_TOKENS = 793_100_000_000_000;
const n = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export function liveSource(): MarketSource {
  return {
    async dex(mints) {
      const out = new Map<string, Partial>();
      for (let i = 0; i < mints.length; i += 30) {
        const batch = mints.slice(i, i + 30);
        try {
          const r = await fetch(`${DEX()}/tokens/v1/solana/${batch.join(",")}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
          if (!r.ok) continue;
          type Pair = { baseToken?: { address?: string }; priceUsd?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number }; priceChange?: { h24?: number }; volume?: { h24?: number }; txns?: { h24?: { buys?: number; sells?: number } }; dexId?: string };
          const pairs = (await r.json()) as Pair[];
          if (!Array.isArray(pairs)) continue;
          const best = new Map<string, Pair>();
          for (const p of pairs) {
            const m = p.baseToken?.address;
            if (!m || !batch.includes(m)) continue;
            const cur = best.get(m);
            if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(m, p);
          }
          for (const [m, p] of best) {
            out.set(m, {
              ...EMPTY_STATS,
              mcapUsd: n(p.marketCap ?? p.fdv),
              priceUsd: n(p.priceUsd),
              change24h: n(p.priceChange?.h24),
              volume24hUsd: n(p.volume?.h24),
              buys24h: n(p.txns?.h24?.buys),
              sells24h: n(p.txns?.h24?.sells),
              graduated: p.dexId ? p.dexId !== "pumpfun" : null,
              source: "DexScreener",
            });
          }
        } catch {
          // unavailable this time
        }
      }
      return out;
    },
    async curve(mint) {
      return cached(`curve:${mint}`, 20_000, async () => {
        const acc = await connection().getAccountInfo(bondingCurvePda(new PublicKey(mint)), "confirmed");
        if (!acc) return null;
        const c = parseBondingCurve(acc.data);
        if (c.complete) return { mcapUsd: null, priceUsd: null, curveProgress: 1, graduated: true };
        const progress = Math.max(0, Math.min(1, 1 - Number(c.realTokenReserves) / INITIAL_REAL_TOKENS));
        if (c.virtualTokenReserves <= BigInt(0)) return { mcapUsd: null, priceUsd: null, curveProgress: progress, graduated: false };
        const priceSol = Number(c.virtualQuoteReserves) / 1e9 / (Number(c.virtualTokenReserves) / 1e6);
        const usd = await solUsd();
        return { mcapUsd: usd ? priceSol * usd * TOTAL_SUPPLY_TOKENS : null, priceUsd: usd ? priceSol * usd : null, curveProgress: progress, graduated: false };
      }).catch(() => null);
    },
    holders: (mint) => pumpHolders(mint),
  };
}

// ───────────────────────────── stored stats

function toStats(r: Record<string, unknown>): CoinStats {
  const f = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    mint: String(r.mint),
    mcapUsd: f(r.mcap_usd),
    priceUsd: f(r.price_usd),
    change24h: f(r.change_24h),
    volume24hUsd: f(r.volume_24h_usd),
    holders: r.holders === null || r.holders === undefined ? null : num(r.holders),
    curveProgress: f(r.curve_progress),
    graduated: r.graduated === null || r.graduated === undefined ? null : num(r.graduated) === 1,
    buys24h: r.buys_24h === null || r.buys_24h === undefined ? null : num(r.buys_24h),
    sells24h: r.sells_24h === null || r.sells_24h === undefined ? null : num(r.sells_24h),
    source: (r.source as string) ?? null,
    updatedAt: num(r.updated_at),
  };
}

export async function readStats(q: Q, mints: string[]): Promise<Map<string, CoinStats>> {
  const out = new Map<string, CoinStats>();
  if (!mints.length) return out;
  const rows = await q.query(`SELECT * FROM coin_stats WHERE mint = ANY($1::text[])`, [mints]);
  for (const r of rows) out.set(String(r.mint), toStats(r));
  return out;
}

export const STATS_TTL_MS = 2 * 60_000;
const SNAPSHOT_EVERY_MS = 10 * 60_000;

export interface RefreshResult {
  updated: number;
  milestones: { mint: string; level: number }[];
}

/** Refreshes the given mints (holder counts for up to `holdersFor` of them) and records snapshots + milestones. */
export async function refreshStats(q: Q, mints: string[], src: MarketSource = liveSource(), opts: { holdersFor?: number; now?: number } = {}): Promise<RefreshResult> {
  const now = opts.now ?? Date.now();
  const out: RefreshResult = { updated: 0, milestones: [] };
  if (!mints.length) return out;
  const prev = await readStats(q, mints);
  const dex = await src.dex(mints);
  let holderReads = 0;
  for (const mint of mints) {
    const d = dex.get(mint);
    const c = await src.curve(mint);
    const old = prev.get(mint);
    let holders = old?.holders ?? null;
    if (holderReads < (opts.holdersFor ?? 3)) {
      holderReads++;
      holders = (await src.holders(mint).catch(() => null)) ?? holders;
    }
    const s: Partial = {
      ...EMPTY_STATS,
      ...(d ?? {}),
      mcapUsd: d?.mcapUsd ?? c?.mcapUsd ?? null,
      priceUsd: d?.priceUsd ?? c?.priceUsd ?? null,
      curveProgress: c?.curveProgress ?? (d?.graduated ? 1 : null),
      graduated: c?.graduated ?? d?.graduated ?? null,
      holders,
      source: d ? "DexScreener" : c?.mcapUsd != null ? "pump.fun curve" : null,
    };
    await q.query(
      `INSERT INTO coin_stats (mint, mcap_usd, price_usd, change_24h, volume_24h_usd, holders, curve_progress, graduated, buys_24h, sells_24h, source, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (mint) DO UPDATE SET mcap_usd = $2, price_usd = $3, change_24h = $4, volume_24h_usd = $5, holders = $6, curve_progress = $7, graduated = $8, buys_24h = $9, sells_24h = $10, source = $11, updated_at = $12`,
      [mint, s.mcapUsd, s.priceUsd, s.change24h, s.volume24hUsd, s.holders, s.curveProgress, s.graduated === null ? null : s.graduated ? 1 : 0, s.buys24h, s.sells24h, s.source, now],
    );
    out.updated++;
    if (s.mcapUsd != null && s.mcapUsd > 0) {
      const last = await q.query("SELECT at FROM market_snapshots WHERE mint = $1 ORDER BY at DESC LIMIT 1", [mint]);
      if (!last[0] || now - num(last[0].at) >= SNAPSHOT_EVERY_MS) await q.query("INSERT INTO market_snapshots (mint, at, mcap_usd) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [mint, now, s.mcapUsd]);
      for (const level of MILESTONES_USD) {
        if (s.mcapUsd < level) break;
        const ins = await q.query("INSERT INTO milestones (mint, level, reached_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING level", [mint, level, now]);
        if (ins.length) out.milestones.push({ mint, level });
      }
    }
  }
  return out;
}

/** Market-cap points of the last `hours` (oldest first) for the sparkline. */
export async function sparkline(q: Q, mint: string, now = Date.now(), hours = 24): Promise<number[]> {
  const rows = await q.query("SELECT mcap_usd FROM market_snapshots WHERE mint = $1 AND at >= $2 ORDER BY at ASC LIMIT 200", [mint, now - hours * 3_600_000]);
  return rows.map((r) => Number(r.mcap_usd));
}

/** The highest milestone reached and not yet announced in a post (then marked announced by the caller). */
export async function pendingMilestone(q: Q, mint: string): Promise<number | null> {
  const r = await q.query("SELECT level FROM milestones WHERE mint = $1 AND announced = 0 ORDER BY level DESC LIMIT 1", [mint]);
  return r[0] ? num(r[0].level) : null;
}

export async function markMilestonesAnnounced(q: Q, mint: string) {
  await q.query("UPDATE milestones SET announced = 1 WHERE mint = $1 AND announced = 0", [mint]);
}
