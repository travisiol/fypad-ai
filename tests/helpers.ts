/** Shared test rig: in-memory PGlite, the fake OpenAI server behind the real adapter, a live influencer. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { providers } from "../src/server/ai.ts";
import type { Providers } from "../src/server/ai.ts";
import { memoryDb } from "../src/server/db.ts";
import type { Db } from "../src/server/db.ts";
import { createDraft, publishInfluencer } from "../src/server/influencers.ts";
import { runToEnd, submitJob } from "../src/server/jobs.ts";
import type { MarketSource } from "../src/server/market.ts";
import { EMPTY_STATS } from "../src/server/market.ts";
import { startFakeAi } from "./fake-ai.ts";

process.env.FYPAD_MEDIA_DIR = mkdtempSync(join(tmpdir(), "fypad-test-media-"));

export async function rig() {
  const ai = await startFakeAi();
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = ai.url;
  const prov: Providers = providers();
  const db: Db = await memoryDb();
  return { ai, prov, db };
}

export const wallet = () => Keypair.generate().publicKey.toBase58();

let keyN = 0;
/** Creates a draft, runs its whole generation, publishes it (publishedAt = `at`). */
export async function liveInfluencer(db: Db, prov: Providers, owner: string, at = Date.now()) {
  const d = await createDraft(db, owner, { idea: "a Tokyo street-style girl who only wears thrifted Y2K", niches: ["Fashion"], vibe: "35mm film" });
  const { job } = await submitJob(db, owner, { influencerId: d.id, kind: "create", idempotencyKey: `create:test-${++keyN}-${Date.now()}` });
  const done = await runToEnd(db, job.id, prov);
  if (done?.status !== "succeeded") throw new Error(`generation ${done?.status}: ${done?.error}`);
  return publishInfluencer(db, owner, d.id, at);
}

/** A market source with fixed answers (no network). */
export function fixedMarket(values: Map<string, { mcapUsd?: number | null; change24h?: number | null; holders?: number | null }>): MarketSource {
  return {
    async dex(mints) {
      const out = new Map();
      for (const m of mints) {
        const v = values.get(m);
        if (v) out.set(m, { ...EMPTY_STATS, mcapUsd: v.mcapUsd ?? null, change24h: v.change24h ?? null, volume24hUsd: 1234, source: "DexScreener" });
      }
      return out;
    },
    async curve() {
      return { mcapUsd: null, priceUsd: null, curveProgress: 0.12, graduated: false };
    },
    async holders(mint) {
      return values.get(mint)?.holders ?? null;
    },
  };
}
