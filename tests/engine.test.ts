/**
 * The engine on an in-memory database with the fake OpenAI server behind the real adapter:
 * generation stages, publication, the tick (auto-post cadence, paid posts, figure stripping,
 * milestones, replies), owner controls, and the social layer's counts and notifications.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { num } from "../src/server/db.ts";
import { budgetOf, recordDistribution } from "../src/server/fees.ts";
import { createDraft, editDraft, editProfile, getInfluencer, postsOf, publishInfluencer } from "../src/server/influencers.ts";
import { postNow, runToEnd, submitJob } from "../src/server/jobs.ts";
import { readStats, refreshStats } from "../src/server/market.ts";
import { notificationsFor } from "../src/server/notifications.ts";
import { addComment, commentsOf, influencerStats, postStats, setFollow, setLike, setSave } from "../src/server/social.ts";
import { runTick } from "../src/server/tick.ts";
import { homeFeed, profile, risingRows, stories } from "../src/server/views.ts";
import { fixedMarket, liveInfluencer, rig, wallet } from "./helpers.ts";

const H = 3_600_000;
const D = 24 * H;

test("generation: persona → photo → 3 captions → 3 photos, as separate resumable stages", async () => {
  const { ai, prov, db } = await rig();
  try {
    const owner = wallet();
    const d = await createDraft(db, owner, { idea: "a Tokyo street-style girl who only wears thrifted Y2K", niches: ["Fashion", "Nope"], vibe: "" });
    assert.deepEqual(d.niches, ["Fashion"]);
    const { job, created } = await submitJob(db, owner, { influencerId: d.id, kind: "create", idempotencyKey: "create:one-1234" });
    assert.ok(created);
    const again = await submitJob(db, owner, { influencerId: d.id, kind: "create", idempotencyKey: "create:one-1234" });
    assert.equal(again.job.id, job.id, "same key = same job");
    await assert.rejects(submitJob(db, owner, { influencerId: d.id, kind: "create", idempotencyKey: "create:two-1234" }), /already running/);
    await assert.rejects(submitJob(db, wallet(), { influencerId: d.id, kind: "create", idempotencyKey: "create:x-123456" }), /creator/);
    const done = await runToEnd(db, job.id, prov);
    assert.equal(done?.status, "succeeded");
    const i = (await getInfluencer(db, d.id))!;
    assert.equal(i.handle, "mika.thrift");
    assert.ok(i.bio.length <= 150 && i.portraitMediaId);
    const drafts = await postsOf(db, i.id, "draft");
    assert.equal(drafts.length, 3);
    assert.ok(drafts.every((p) => p.imageMediaId && p.caption && p.hashtags.length));
    // the photo stages sent the portrait as reference (images/edits)
    assert.equal(ai.state.requests.filter((r) => r.path === "/images/edits").length, 3);
    assert.deepEqual(
      ai.state.requests.filter((r) => r.schema).map((r) => r.schema),
      ["influencer_persona", "first_posts"],
    );
    // a provider outage is retried, the stage is not lost
    const { job: j2 } = await submitJob(db, owner, { influencerId: d.id, kind: "portrait", idempotencyKey: "portrait:r-123456" });
    ai.state.failNext = 1;
    const j2done = await runToEnd(db, j2.id, prov);
    assert.equal(j2done?.status, "succeeded");
    // edits + publish
    await assert.rejects(editDraft(db, owner, d.id, { handle: "explore" }), /Usernames/);
    await editDraft(db, owner, d.id, { bio: "new bio ✨", posts: [{ id: drafts[0].id, caption: "edited caption", hashtags: ["x1"] }] });
    const live = await publishInfluencer(db, owner, d.id);
    assert.equal(live.status, "live");
    const posts = await postsOf(db, d.id, "live");
    assert.equal(posts.length, 3);
    assert.ok(posts.some((p) => p.caption === "edited caption"));
    assert.equal(posts[posts.length - 1].slot, 0, "the introduction is the oldest post");
    // another influencer cannot take a live handle
    const d2 = await createDraft(db, owner, { idea: "another thrift queen in Osaka streets" });
    await runToEnd(db, (await submitJob(db, owner, { influencerId: d2.id, kind: "create", idempotencyKey: "create:two-1234" })).job.id, prov);
    await assert.rejects(editDraft(db, owner, d2.id, { handle: "mika.thrift" }), /taken/);
  } finally {
    await ai.close();
  }
});

test("tick: baseline auto-post after a day, paid posts with budget, live figures only, milestones, replies", async () => {
  const { ai, prov, db } = await rig();
  try {
    const owner = wallet();
    const fan = wallet();
    const t0 = Date.now() - 2 * D;
    const i = await liveInfluencer(db, prov, owner, t0);
    const now = Date.now();

    // a confirmed coin so posts get live facts
    const mint = wallet();
    await db.query("INSERT INTO launches (id, influencer_id, owner, mint, cluster, status, name, ticker, uri, sharing_status, created_at, updated_at, confirmed_at) VALUES ('l_t', $1, $2, $3, 'devnet', 'confirmed', 'Mika', 'MIKA', 'u', 'active', $4, $4, $4)", [i.id, owner, mint, t0]);
    const market = fixedMarket(new Map([[mint, { mcapUsd: 104_200, change24h: 12.3, holders: 321 }]]));

    // tick 1: stats + milestones, schedules the baseline post and runs its two stages
    ai.state.nextCaption = "gm fam ☀️ $MIKA just passed $100K!\nnext stop $1M, this is a 100x.\nlove you all 💖";
    const r1 = await runTick(db, { prov, market, now, force: true });
    assert.equal(r1.stats, 1);
    assert.equal(r1.milestones, 4, "10K, 25K, 50K and 100K crossed");
    assert.equal(r1.scheduled, 1);
    let posts = await postsOf(db, i.id, "live");
    assert.equal(posts.length, 4);
    const auto = posts[0];
    assert.equal(auto.kind, "auto");
    assert.equal(auto.caption, "gm fam ☀️ $MIKA just passed $100K!\nlove you all 💖", "invented $1M / 100x removed");
    assert.equal(auto.paid, false);
    assert.equal(auto.mcapAt, 104_200);
    const factsPrompt = ai.state.requests.filter((r) => r.schema === "post").pop()!.body;
    assert.match(factsPrompt, /\$104\.2K/);
    assert.match(factsPrompt, /passed \$100K/);
    assert.equal(num((await db.query("SELECT COUNT(*) AS n FROM milestones WHERE announced = 1"))[0].n), 4);
    assert.ok((await notificationsFor(db, owner)).some((n) => n.kind === "milestone" && n.text.includes("$100K")));

    // tick 2 right after: nothing due (one a day, no budget)
    const r2 = await runTick(db, { prov, market, now: now + 60_000, force: true });
    assert.equal(r2.scheduled, 0);

    // budget from a recorded distribution: a paid post 8 h later
    await recordDistribution(db, { signature: "sig-dist-1", mint, influencerId: i.id, creatorLamports: BigInt(40_000_000), treasuryLamports: BigInt(10_000_000) });
    assert.equal((await budgetOf(db, i.id)).balance, BigInt(10_000_000));
    const r3 = await runTick(db, { prov, market, now: now + 8 * H, force: true });
    assert.equal(r3.scheduled, 1);
    posts = await postsOf(db, i.id, "live");
    assert.equal(posts.length, 5);
    assert.equal(posts[0].paid, true);
    assert.equal((await budgetOf(db, i.id)).spent, BigInt(3_000_000));

    // replies: a fan comments, the next tick answers in character, once
    const c = await addComment(db, fan, posts[0].id, "love this fit!!");
    await runTick(db, { prov, market, now: now + 8 * H + 60_000, force: true });
    await runTick(db, { prov, market, now: now + 8 * H + 120_000, force: true });
    const thread = await commentsOf(db, posts[0].id);
    const replies = thread.filter((x) => x.parentId === c.id);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].influencerId, i.id);
    assert.ok((await notificationsFor(db, fan)).some((n) => n.kind === "reply"));

    // paused: nothing scheduled even when due
    await editProfile(db, owner, i.id, { paused: true });
    const r4 = await runTick(db, { prov, market, now: now + 3 * D, force: true });
    assert.equal(r4.scheduled, 0);
    await editProfile(db, owner, i.id, { paused: false, nextIdea: "a rainy Shibuya mirror selfie" });

    // manual posts: three a day, the fourth refused; the next idea is used then cleared
    const m1 = await postNow(db, owner, i.id, "m-aaaaaaaa1");
    await runToEnd(db, m1.id, prov);
    assert.match(ai.state.requests.filter((r) => r.schema === "post").pop()!.body, /rainy Shibuya/);
    assert.equal((await getInfluencer(db, i.id))!.nextIdea, "");
    await runToEnd(db, (await postNow(db, owner, i.id, "m-aaaaaaaa2")).id, prov);
    await runToEnd(db, (await postNow(db, owner, i.id, "m-aaaaaaaa3")).id, prov);
    await assert.rejects(postNow(db, owner, i.id, "m-aaaaaaaa4"), /3 manual posts a day/);
    await assert.rejects(postNow(db, fan, i.id, "m-bbbbbbbb1"), /creator/);

    // views read it all back
    const s = (await readStats(db, [mint])).get(mint)!;
    assert.equal(s.holders, 321);
    const prof = (await profile(db, i.handle, owner))!;
    assert.equal(prof.isOwner, true);
    assert.equal(prof.influencer.coin?.ticker, "MIKA");
    assert.equal(prof.influencer.posts, 8);
    assert.ok((await stories(db, null)).length >= 1);
    assert.equal((await risingRows(db, null))[0].id, i.id);
  } finally {
    await ai.close();
  }
});

test("social: likes, saves, follows and comments are counted once per wallet and notify the owner", async () => {
  const { ai, prov, db } = await rig();
  try {
    const owner = wallet();
    const fan = wallet();
    const i = await liveInfluencer(db, prov, owner);
    const [p] = await postsOf(db, i.id, "live");
    await assert.rejects(setLike(db, null, p.id, true), /Sign in/);
    assert.equal((await setLike(db, fan, p.id, true)).likes, 1);
    assert.equal((await setLike(db, fan, p.id, true)).likes, 1, "idempotent");
    assert.equal((await setLike(db, owner, p.id, true)).likes, 2);
    assert.equal((await setLike(db, owner, p.id, false)).likes, 1);
    await setSave(db, fan, p.id, true);
    assert.equal((await setFollow(db, fan, i.id, true)).followers, 1);
    assert.equal((await setFollow(db, fan, i.id, true)).followers, 1);
    await addComment(db, fan, p.id, "first!");
    await assert.rejects(addComment(db, fan, p.id, "   "), /Write a comment/);
    const stats = (await postStats(db, [p.id], fan)).get(p.id)!;
    assert.deepEqual(stats, { likes: 1, comments: 1, liked: true, saved: true });
    const is = (await influencerStats(db, [i.id], fan)).get(i.id)!;
    assert.deepEqual(is, { followers: 1, posts: 3, following: true });
    const kinds = (await notificationsFor(db, owner)).map((n) => n.kind).sort();
    assert.deepEqual(kinds, ["comment", "follow", "like"], "no notification for the owner's own like");
    // the follower's home feed starts with the followed influencer
    const feed = await homeFeed(db, fan);
    assert.equal(feed[0].influencer.id, i.id);
    assert.equal(feed[0].influencer.following, true);
    assert.equal((await setFollow(db, fan, i.id, false)).followers, 0);
  } finally {
    await ai.close();
  }
});

test("market: refresh stores stats, snapshots and milestones once", async () => {
  const { ai, db } = await rig();
  try {
    const mint = wallet();
    const src = fixedMarket(new Map([[mint, { mcapUsd: 26_000, change24h: -3, holders: 12 }]]));
    const a = await refreshStats(db, [mint], src, { now: 1_000_000 });
    assert.deepEqual(a.milestones.map((m) => m.level), [10_000, 25_000]);
    const b = await refreshStats(db, [mint], src, { now: 2_000_000 });
    assert.equal(b.milestones.length, 0, "a milestone is reached once");
    const s = (await readStats(db, [mint])).get(mint)!;
    assert.deepEqual([s.mcapUsd, s.change24h, s.holders, s.curveProgress], [26_000, -3, 12, 0.12]);
  } finally {
    await ai.close();
  }
});

test("an OpenAI account without credits fails the job at once with a neutral message (no retries)", async () => {
  const { ai, prov, db } = await rig();
  try {
    const owner = wallet();
    const d = await createDraft(db, owner, { idea: "a minimalist climber living in a van" });
    ai.state.quota = true;
    const { job } = await submitJob(db, owner, { influencerId: d.id, kind: "create", idempotencyKey: "create:quota-1234" });
    const done = await runToEnd(db, job.id, prov);
    assert.equal(done?.status, "failed");
    assert.equal(done?.error, "Generation is not available right now. Try again later.");
    assert.equal(ai.state.requests.filter((r) => r.path === "/chat/completions").length, 1, "not retried");
  } finally {
    await ai.close();
  }
});
