/**
 * Launch lifecycle against the fake Solana RPC (which executes pump.fun's create_v2, fee sharing,
 * sweep, distribute and collect, and verifies signatures): the user signs everything, the launch row
 * exists before signing, rejected / failed / expired / confirmed paths, one coin per influencer, the
 * 80/20 split read back from chain, then Collect → a distribution recorded once (creator 80 %,
 * treasury 20 % credited to the posting budget), and the 100 % path when the split is declined.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { clearChainCache, connection } from "../src/server/chain.ts";
import type { Db } from "../src/server/db.ts";
import { budgetOf, buildCollect, claimable, distributionsOf, recordCollect, scanLaunch } from "../src/server/fees.ts";
import { confirmLaunch, confirmSharing, getLaunch, markRejected, markSharingRejected, markSharingSubmitted, markSubmitted, prepareLaunch, prepareSharing, verifySharing } from "../src/server/launch.ts";
import { notificationsFor } from "../src/server/notifications.ts";
import { parseBondingCurve, bondingCurvePda } from "../src/server/pump.ts";
import { SYSTEM, accrue, startFakeRpc } from "./fake-rpc.ts";
import { liveInfluencer, rig } from "./helpers.ts";

const TREASURY = Keypair.generate().publicKey.toBase58();

async function send(b64: string, signers: Keypair[]): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  tx.sign(signers);
  return connection().sendRawTransaction(tx.serialize(), { skipPreflight: true });
}

async function setup() {
  const fake = await startFakeRpc();
  process.env.SOLANA_RPC_URL = fake.url;
  process.env.SOLANA_CLUSTER = "devnet";
  process.env.NEXT_PUBLIC_SITE_URL = "https://fypad.example";
  process.env.FYPAD_TREASURY_WALLET = TREASURY;
  clearChainCache();
  const r = await rig();
  return { ...r, fake };
}

async function launchCoin(db: Db, user: Keypair, influencerId: string, ticker: string) {
  const mint = Keypair.generate();
  const p = await prepareLaunch(db, user.publicKey.toBase58(), { influencerId, mint: mint.publicKey.toBase58(), ticker, description: "An AI influencer on FYPAD." });
  const sig = await send(p.transaction, [user, mint]);
  await markSubmitted(db, user.publicKey.toBase58(), p.launch.id, sig);
  return { launch: await confirmLaunch(db, user.publicKey.toBase58(), p.launch.id), mint };
}

test("launch: signed by the user, confirmed only after read-back, one coin per influencer", async () => {
  const { ai, prov, db, fake } = await setup();
  try {
    const user = Keypair.generate();
    const me = user.publicKey.toBase58();
    fake.state.accounts.set(me, { lamports: 2_000_000_000, owner: SYSTEM });
    const i = await liveInfluencer(db, prov, me);
    const mint = Keypair.generate();
    const input = { influencerId: i.id, mint: mint.publicKey.toBase58(), ticker: "$mika", description: "Tokyo thrift queen, AI influencer." };

    await assert.rejects(prepareLaunch(db, null, input), /Sign in/);
    await assert.rejects(prepareLaunch(db, Keypair.generate().publicKey.toBase58(), input), /creator/);
    await assert.rejects(prepareLaunch(db, me, { ...input, ticker: "TOO-LONG-TICKER" }), /ticker/);
    process.env.FYPAD_TREASURY_WALLET = "";
    await assert.rejects(prepareLaunch(db, me, input), /Launching is not open yet\./);
    process.env.FYPAD_TREASURY_WALLET = TREASURY;

    // rejected in the wallet: nothing sent, the influencer can retry
    const p0 = await prepareLaunch(db, me, input);
    assert.equal(p0.launch.status, "prepared", "the row exists before anything is signed");
    assert.equal(p0.summary.creatorOfRecord, me);
    assert.equal((await markRejected(db, me, p0.launch.id, "declined")).status, "rejected");
    assert.equal(fake.state.sent.length, 0);

    // failed on chain
    const m1 = Keypair.generate();
    const p1 = await prepareLaunch(db, me, { ...input, mint: m1.publicKey.toBase58() });
    fake.state.failNext = true;
    await markSubmitted(db, me, p1.launch.id, await send(p1.transaction, [user, m1]));
    assert.equal((await confirmLaunch(db, me, p1.launch.id)).status, "failed");

    // never sent, blockhash expired
    const m2 = Keypair.generate();
    const p2 = await prepareLaunch(db, me, { ...input, mint: m2.publicKey.toBase58() });
    fake.state.slot += 200;
    assert.equal((await confirmLaunch(db, me, p2.launch.id)).status, "expired");

    // confirmed: mint + name/ticker + curve creator = the user
    const { launch } = await launchCoin(db, user, i.id, "MIKA");
    assert.equal(launch.status, "confirmed");
    assert.equal(launch.ticker, "MIKA");
    const curve = await connection().getAccountInfo(bondingCurvePda(new (await import("@solana/web3.js")).PublicKey(launch.mint)));
    assert.equal(parseBondingCurve(curve!.data).creator, me, "you are the coin's creator");
    await assert.rejects(prepareLaunch(db, me, { ...input, mint: Keypair.generate().publicKey.toBase58() }), /already launched/);

    // the 80/20 split: second signature, active only after read-back
    const s = await prepareSharing(db, me, launch.id);
    assert.deepEqual(
      s.shareholders.map((h) => h.bps),
      [8000, 2000],
    );
    assert.deepEqual(s.shareholders.map((h) => h.address), [me, TREASURY]);
    await markSharingSubmitted(db, me, launch.id, await send(s.transaction, [user]));
    const active = await confirmSharing(db, me, launch.id);
    assert.equal(active.sharingStatus, "active");
    const { rpcChain } = await import("../src/server/launch.ts");
    assert.equal(await verifySharing(active, rpcChain()), "active");

    // trades accrue fees on the curve → Collect (sweep + distribute) → recorded once
    accrue(fake.state, launch.mint, 10_000_000);
    const c = await claimable(active);
    assert.deepEqual([c.lamports, c.mode], [BigInt(10_000_000), "split"]);
    const col = await buildCollect(db, me, i.id);
    const sig = await send(col.transaction, [user]);
    const rec = await recordCollect(db, me, i.id, sig);
    assert.deepEqual(rec, { status: "recorded", creatorLamports: "8000000", treasuryLamports: "2000000" });
    assert.equal(fake.state.accounts.get(TREASURY)?.lamports, 2_000_000);
    const again = await recordCollect(db, me, i.id, sig);
    assert.equal(again.status, "recorded");
    assert.equal((await scanLaunch(db, (await getLaunch(db, launch.id))!, rpcChain())), 0, "the scanner sees the same signature: no double count");
    const dist = await distributionsOf(db, i.id);
    assert.equal(dist.length, 1);
    assert.equal(dist[0].creatorLamports, BigInt(8_000_000));
    assert.equal((await budgetOf(db, i.id)).balance, BigInt(2_000_000), "the treasury share funds this influencer's posts");
    assert.ok((await notificationsFor(db, me)).some((n) => n.kind === "distribution" && n.lamports === "8000000"));
    assert.equal((await claimable(active)).lamports, BigInt(0));
    await assert.rejects(buildCollect(db, me, i.id), /Nothing to collect/);
  } finally {
    await ai.close();
    await fake.close();
  }
});

test("declined split: the creator keeps 100 % and collects it directly", async () => {
  const { ai, prov, db, fake } = await setup();
  try {
    const user = Keypair.generate();
    const me = user.publicKey.toBase58();
    fake.state.accounts.set(me, { lamports: 2_000_000_000, owner: SYSTEM });
    const i = await liveInfluencer(db, prov, me);
    const { launch } = await launchCoin(db, user, i.id, "RON");
    const declined = await markSharingRejected(db, me, launch.id);
    assert.equal(declined.sharingStatus, "declined");
    accrue(fake.state, launch.mint, 4_000_000);
    const col = await buildCollect(db, me, i.id);
    assert.equal(col.mode, "creator");
    const rec = await recordCollect(db, me, i.id, await send(col.transaction, [user]));
    assert.deepEqual(rec, { status: "recorded", creatorLamports: "4000000", treasuryLamports: "0" });
    assert.equal((await budgetOf(db, i.id)).balance, BigInt(0));
  } finally {
    await ai.close();
    await fake.close();
  }
});
