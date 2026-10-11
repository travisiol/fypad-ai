/**
 * Creator fees, as pump.fun pays them (FYPAD never custodies the creator's 80 %):
 *  - claimable(): what waits for a coin right now, read from chain (fee waiting on the curve + the
 *    creator vault of the sharing config — or of the creator, when the split was declined — minus rent);
 *  - buildCollect(): the permissionless transaction the creator signs from Earnings:
 *    split active   → sweep_creator_fee + distribute_creator_fees_v2 (pays 80 % / 20 % on chain);
 *    split declined → sweep_creator_fee + collect_creator_fee (100 % to the creator);
 *  - recordCollect() / scanLaunch(): read each confirmed transaction's balance deltas and record what
 *    the creator and the treasury actually received, once per signature (anyone's distribution counts);
 *  - the treasury share is credited to that influencer's posting budget up to its cap; the rest is
 *    held for the $FYPAD buyback.
 * Nothing loops: the cron, the Earnings page and the Collect button call these.
 */
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ENV, budgetCapPosts, costPerPostLamports } from "../config/fypad.ts";
import { VAULT_RENT_LAMPORTS } from "../config/solana.ts";
import { creditSplit } from "./cadence.ts";
import type { Db, Q } from "./db.ts";
import { big, num } from "./db.ts";
import { HttpError } from "./errors.ts";
import { getInfluencer } from "./influencers.ts";
import type { ChainPort, LaunchRow } from "./launch.ts";
import { activeLaunchFor, expectedShareholders, rpcChain, toLaunch } from "./launch.ts";
import { notify } from "./notifications.ts";
import { operatorKeypair, sendAsOperator } from "./operator.ts";
import { bondingCurvePda, collectCreatorFeeIx, computeBudget, creatorVaultPda, distributeCreatorFeesV2Ix, parseBondingCurve, parseSharingConfig, sharingConfigPda, sweepCreatorFeeIx } from "./pump.ts";

/** Below this, an automatic crank would cost more in network fees than it moves. */
export const MIN_DISTRIBUTE_LAMPORTS = BigInt(5_000_000);

// ───────────────────────────── budget

export interface Budget {
  credited: bigint;
  spent: bigint;
  buyback: bigint;
  balance: bigint;
}

export async function budgetOf(q: Q, influencerId: string): Promise<Budget> {
  const rows = await q.query("SELECT kind, COALESCE(SUM(lamports), 0) AS s FROM budget_entries WHERE influencer_id = $1 GROUP BY kind", [influencerId]);
  const get = (k: string) => big(rows.find((r) => r.kind === k)?.s ?? 0);
  const credited = get("credit");
  const spent = get("spend");
  return { credited, spent, buyback: get("buyback"), balance: credited - spent };
}

/** Charges one paid post to the budget, once (key = post id). False when the balance is short. */
export async function spendForPost(db: Db, influencerId: string, postId: string, cost = costPerPostLamports(), now = Date.now()): Promise<boolean> {
  return db.tx(async (q) => {
    const done = await q.query("SELECT 1 FROM budget_entries WHERE idempotency_key = $1", [`spend:${postId}`]);
    if (done.length) return true;
    const b = await budgetOf(q, influencerId);
    if (b.balance < cost) return false;
    await q.query("INSERT INTO budget_entries (influencer_id, kind, lamports, ref, idempotency_key, created_at) VALUES ($1,'spend',$2,$3,$4,$5)", [influencerId, cost, postId, `spend:${postId}`, now]);
    return true;
  });
}

// ───────────────────────────── distributions

export interface Delta {
  creator: bigint;
  treasury: bigint;
}

/** What each shareholder received in a transaction (fee paid back if it was also the fee payer). */
export function deltas(tx: { accountKeys: string[]; preBalances: number[]; postBalances: number[]; fee: number }, wallets: { creator: string; treasury: string | null }): Delta {
  const d = (address: string | null) => {
    if (!address) return BigInt(0);
    const i = tx.accountKeys.indexOf(address);
    if (i < 0) return BigInt(0);
    const v = BigInt(tx.postBalances[i] ?? 0) - BigInt(tx.preBalances[i] ?? 0) + (i === 0 ? BigInt(tx.fee) : BigInt(0));
    return v > BigInt(0) ? v : BigInt(0);
  };
  return { creator: d(wallets.creator), treasury: d(wallets.treasury) };
}

export interface DistributionInput {
  signature: string;
  mint: string;
  influencerId: string;
  creatorLamports: bigint;
  treasuryLamports: bigint;
  slot?: number | null;
  blockTime?: number | null;
}

/** Records one distribution (idempotent on signature + mint), credits the budget, notifies the owner. */
export async function recordDistribution(db: Db, d: DistributionInput, now = Date.now()): Promise<{ inserted: boolean }> {
  const total = d.creatorLamports + d.treasuryLamports;
  if (total <= BigInt(0)) return { inserted: false };
  const inserted = await db.tx(async (q) => {
    const ins = await q.query(
      `INSERT INTO distributions (signature, mint, influencer_id, total_lamports, creator_lamports, treasury_lamports, slot, block_time, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (signature, mint) DO NOTHING RETURNING signature`,
      [d.signature, d.mint, d.influencerId, total, d.creatorLamports, d.treasuryLamports, d.slot ?? null, d.blockTime ?? null, now],
    );
    if (!ins.length) return false;
    if (d.treasuryLamports > BigInt(0)) {
      const b = await budgetOf(q, d.influencerId);
      const split = creditSplit(d.treasuryLamports, b.balance, costPerPostLamports() * BigInt(budgetCapPosts()));
      if (split.budget > BigInt(0)) await q.query("INSERT INTO budget_entries (influencer_id, kind, lamports, ref, idempotency_key, created_at) VALUES ($1,'credit',$2,$3,$4,$5)", [d.influencerId, split.budget, d.signature, `credit:${d.signature}:${d.mint}`, now]);
      if (split.buyback > BigInt(0)) await q.query("INSERT INTO budget_entries (influencer_id, kind, lamports, ref, idempotency_key, created_at) VALUES ($1,'buyback',$2,$3,$4,$5)", [d.influencerId, split.buyback, d.signature, `buyback:${d.signature}:${d.mint}`, now]);
    }
    return true;
  });
  if (inserted) {
    const i = await getInfluencer(db, d.influencerId);
    if (i) await notify(db, { recipient: i.owner, kind: "distribution", influencerId: i.id, lamports: d.creatorLamports, text: "creator fees paid to your wallet", key: `dist:${d.signature}:${d.mint}` }, now);
  }
  return { inserted };
}

/** Scans the sharing config's transactions of one coin (cursor in kv) and records every distribution. */
export async function scanLaunch(db: Db, l: LaunchRow, chain: ChainPort): Promise<number> {
  const treasury = ENV.treasuryWallet();
  const sc = sharingConfigPda(new PublicKey(l.mint)).toBase58();
  const cursorKey = `fees_cursor:${l.mint}`;
  const cursor = ((await db.query("SELECT value FROM kv WHERE key = $1", [cursorKey]))[0]?.value as string) ?? null;
  const sigs = await chain.signaturesFor(sc, cursor);
  let added = 0;
  for (const s of [...sigs].reverse()) {
    if (s.err) continue;
    const tx = await chain.transaction(s.signature);
    if (!tx || tx.err) continue;
    const d = deltas(tx, { creator: l.owner, treasury });
    if (d.treasury === BigInt(0)) continue; // not a distribution (the split itself, a sweep alone…)
    const r = await recordDistribution(db, { signature: s.signature, mint: l.mint, influencerId: l.influencerId, creatorLamports: d.creator, treasuryLamports: d.treasury, slot: tx.slot, blockTime: tx.blockTime });
    if (r.inserted) added++;
  }
  if (sigs[0]) await db.query("INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [cursorKey, sigs[0].signature]);
  return added;
}

// ───────────────────────────── claimable + collect

export interface Claimable {
  lamports: bigint;
  mode: "split" | "creator";
}

export async function claimable(l: LaunchRow, chain: ChainPort = rpcChain()): Promise<Claimable> {
  const mint = new PublicKey(l.mint);
  const split = l.sharingStatus === "active";
  const vaultOwner = split ? sharingConfigPda(mint) : new PublicKey(l.owner);
  const [curveAcc, vaultAcc] = [await chain.account(bondingCurvePda(mint).toBase58()), await chain.account(creatorVaultPda(vaultOwner).toBase58())];
  let waiting = BigInt(0);
  if (curveAcc) {
    try {
      waiting = parseBondingCurve(curveAcc.data).creatorFeeWaiting;
    } catch {
      waiting = BigInt(0);
    }
  }
  const vault = BigInt(vaultAcc?.lamports ?? 0);
  const inVault = vault > VAULT_RENT_LAMPORTS ? vault - VAULT_RENT_LAMPORTS : BigInt(0);
  return { lamports: waiting + inVault, mode: split ? "split" : "creator" };
}

async function coinOf(db: Db, me: string | null, influencerId: string): Promise<LaunchRow> {
  if (!me) throw new HttpError(401, "Sign in with your wallet first.");
  const i = await getInfluencer(db, String(influencerId ?? ""));
  if (!i || i.status !== "live") throw new HttpError(404, "Influencer not found.");
  if (i.owner !== me) throw new HttpError(403, "Only this influencer's creator can collect its fees here.");
  const l = await activeLaunchFor(db, i.id);
  if (!l || l.status !== "confirmed") throw new HttpError(409, "This influencer has no coin yet.");
  return l;
}

/** Builds the Collect transaction for the creator's wallet (it only pays the network fee). */
export async function buildCollect(db: Db, me: string | null, influencerId: string, chain: ChainPort = rpcChain()): Promise<{ transaction: string; mode: Claimable["mode"]; lamports: string }> {
  const l = await coinOf(db, me, influencerId);
  if (l.sharingStatus === "submitted" || l.sharingStatus === "prepared") throw new HttpError(409, "The fee split is being set. Try again in a minute.");
  const c = await claimable(l, chain);
  if (c.lamports <= BigInt(0)) throw new HttpError(409, "Nothing to collect yet.");
  const user = new PublicKey(l.owner);
  const mint = new PublicKey(l.mint);
  let ixs;
  if (c.mode === "split") {
    const scAcc = await chain.account(sharingConfigPda(mint).toBase58());
    if (!scAcc) throw new HttpError(409, "The fee split was not found on chain.");
    const config = parseSharingConfig(scAcc.data);
    ixs = [...computeBudget(200_000, 100_000), sweepCreatorFeeIx({ payer: user, mint, creator: sharingConfigPda(mint) }), distributeCreatorFeesV2Ix({ payer: user, mint, shareholders: config.shareholders.map((s) => new PublicKey(s.address)) })];
  } else {
    ixs = [...computeBudget(120_000, 100_000), sweepCreatorFeeIx({ payer: user, mint, creator: user }), collectCreatorFeeIx(user)];
  }
  const { blockhash } = await chain.latestBlockhash();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  return { transaction: Buffer.from(tx.serialize()).toString("base64"), mode: c.mode, lamports: c.lamports.toString() };
}

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** After the wallet sent Collect: confirm, then record what it paid (once). */
export async function recordCollect(db: Db, me: string | null, influencerId: string, signature: unknown, chain: ChainPort = rpcChain(), waitMs = 20_000): Promise<{ status: "recorded" | "pending" | "failed" | "nothing"; creatorLamports?: string; treasuryLamports?: string }> {
  const l = await coinOf(db, me, influencerId);
  const sig = String(signature ?? "");
  if (!SIG_RE.test(sig)) throw new HttpError(400, "Invalid transaction signature.");
  const started = Date.now();
  for (;;) {
    const st = await chain.signatureStatus(sig);
    if (st?.err) return { status: "failed" };
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) break;
    if (Date.now() - started > waitMs) return { status: "pending" };
    await new Promise((r) => setTimeout(r, 800));
  }
  const tx = await chain.transaction(sig);
  if (!tx || tx.err) return { status: "failed" };
  if (!tx.accountKeys.includes(l.mint)) throw new HttpError(400, "That transaction is not about this coin.");
  const d = deltas(tx, { creator: l.owner, treasury: l.sharingStatus === "active" ? ENV.treasuryWallet() : null });
  if (d.creator + d.treasury === BigInt(0)) return { status: "nothing" };
  await recordDistribution(db, { signature: sig, mint: l.mint, influencerId: l.influencerId, creatorLamports: d.creator, treasuryLamports: d.treasury, slot: tx.slot, blockTime: tx.blockTime });
  return { status: "recorded", creatorLamports: d.creator.toString(), treasuryLamports: d.treasury.toString() };
}

/** Optional operator crank (OPERATOR_SECRET_KEY): sweep + distribute when enough fees wait. Holds no funds. */
export async function crankLaunch(l: LaunchRow, chain: ChainPort): Promise<{ sent?: string; skipped?: string; error?: string }> {
  const op = operatorKeypair();
  if (!op) return { skipped: "no operator key" };
  if (l.sharingStatus !== "active") return { skipped: "split not active" };
  const c = await claimable(l, chain);
  if (c.lamports < MIN_DISTRIBUTE_LAMPORTS) return { skipped: `only ${c.lamports} lamports waiting` };
  const mint = new PublicKey(l.mint);
  const sc = sharingConfigPda(mint);
  const scAcc = await chain.account(sc.toBase58());
  if (!scAcc) return { skipped: "sharing config not found" };
  const config = parseSharingConfig(scAcc.data);
  const want = expectedShareholders(l.owner).map((h) => h.address);
  if (config.shareholders.map((s) => s.address).sort().join() !== [...want].sort().join()) return { skipped: "shareholders differ from FYPAD's" };
  const r = await sendAsOperator([sweepCreatorFeeIx({ payer: op.publicKey, mint, creator: sc }), distributeCreatorFeesV2Ix({ payer: op.publicKey, mint, shareholders: config.shareholders.map((s) => new PublicKey(s.address)) })]);
  return "sig" in r ? { sent: r.sig } : { error: r.error };
}

export async function syncFees(db: Db, chain: ChainPort = rpcChain(), opts: { crank?: boolean } = {}): Promise<{ coins: number; recorded: number; cranks: string[] }> {
  const lock = Number(((await db.query("SELECT value FROM kv WHERE key = 'fees_lock'"))[0]?.value as string) ?? 0);
  if (Date.now() - lock < 90_000) return { coins: 0, recorded: 0, cranks: ["skipped: a sync is running"] };
  await db.query("INSERT INTO kv (key, value) VALUES ('fees_lock', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [String(Date.now())]);
  const out = { coins: 0, recorded: 0, cranks: [] as string[] };
  try {
    const launches = (await db.query("SELECT * FROM launches WHERE status = 'confirmed' AND sharing_status = 'active' ORDER BY confirmed_at ASC LIMIT 100")).map(toLaunch);
    for (const l of launches) {
      out.coins++;
      try {
        if (opts.crank !== false) {
          const c = await crankLaunch(l, chain);
          if (c.sent) out.cranks.push(`${l.ticker}: ${c.sent}`);
          else if (c.error) out.cranks.push(`${l.ticker}: ${c.error}`);
        }
        out.recorded += await scanLaunch(db, l, chain);
      } catch {
        // RPC refused this coin; its cursor is unchanged and the next sync retries
      }
    }
    await db.query("INSERT INTO kv (key, value) VALUES ('fees_last', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [String(Date.now())]);
  } finally {
    await db.query("UPDATE kv SET value = '0' WHERE key = 'fees_lock'");
  }
  return out;
}

// ───────────────────────────── reads for pages

export interface DistributionRow {
  signature: string;
  mint: string;
  influencerId: string;
  totalLamports: bigint;
  creatorLamports: bigint;
  treasuryLamports: bigint;
  blockTime: number | null;
  createdAt: number;
}

export function toDistribution(r: Record<string, unknown>): DistributionRow {
  return {
    signature: String(r.signature),
    mint: String(r.mint),
    influencerId: String(r.influencer_id),
    totalLamports: big(r.total_lamports),
    creatorLamports: big(r.creator_lamports),
    treasuryLamports: big(r.treasury_lamports),
    blockTime: r.block_time === null || r.block_time === undefined ? null : num(r.block_time),
    createdAt: num(r.created_at),
  };
}

export async function distributionsOf(q: Q, influencerId: string, limit = 50): Promise<DistributionRow[]> {
  return (await q.query("SELECT * FROM distributions WHERE influencer_id = $1 ORDER BY created_at DESC LIMIT $2", [influencerId, limit])).map(toDistribution);
}

export async function allDistributions(q: Q, limit = 200): Promise<DistributionRow[]> {
  return (await q.query("SELECT * FROM distributions ORDER BY created_at DESC LIMIT $1", [limit])).map(toDistribution);
}
