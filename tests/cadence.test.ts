/** Posting cadence and budget rules (pure), plus the fee split config. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cadence, creditSplit } from "../src/server/cadence.ts";
import { FEE_SPLIT_BPS, splitFees, tickerFromHandle } from "../src/config/fypad.ts";

const H = 3_600_000;
const D = 24 * H;
const T0 = 1_800_000_000_000;
const COST = BigInt(3_000_000);
const base = { publishedAt: T0, lastAutoPostAt: T0, lastFreePostAt: T0, budgetLamports: BigInt(0), costLamports: COST, paused: false };

test("baseline: one free post a day for the first 14 days", () => {
  assert.equal(cadence({ ...base, now: T0 + 23 * H }).due, false);
  const d = cadence({ ...base, now: T0 + 24 * H });
  assert.deepEqual([d.due, d.paid, d.mode], [true, false, "baseline"]);
  // the post went out at day 1: nothing before day 2
  assert.equal(cadence({ ...base, now: T0 + 30 * H, lastAutoPostAt: T0 + D, lastFreePostAt: T0 + D }).due, false);
});

test("funded: up to 3 posts a day, beyond the free one paid from the budget", () => {
  const funded = { ...base, budgetLamports: COST * BigInt(2) };
  assert.equal(cadence({ ...funded, now: T0 + 7 * H }).due, false);
  const d = cadence({ ...funded, now: T0 + 8 * H });
  assert.deepEqual([d.due, d.paid, d.mode], [true, true, "funded"]);
  // after 24 h the free post is available again: not charged
  const f = cadence({ ...funded, now: T0 + 24 * H, lastAutoPostAt: T0 + 16 * H, lastFreePostAt: T0 });
  assert.deepEqual([f.due, f.paid], [true, false]);
  // budget below one post = not funded
  assert.equal(cadence({ ...base, budgetLamports: COST - BigInt(1), now: T0 + 8 * H }).due, false);
});

test("after 14 days with no budget: one post every 3 days; paused: never", () => {
  const old = { ...base, lastAutoPostAt: T0 + 20 * D, lastFreePostAt: T0 + 20 * D };
  assert.equal(cadence({ ...old, now: T0 + 22 * D }).due, false);
  const d = cadence({ ...old, now: T0 + 23 * D });
  assert.deepEqual([d.due, d.paid, d.mode], [true, false, "idle"]);
  assert.equal(cadence({ ...old, now: T0 + 40 * D, paused: true }).due, false);
  assert.equal(cadence({ ...old, now: T0 + 40 * D, paused: true }).mode, "paused");
});

test("treasury credit fills the posting budget up to its cap, the rest is held for buyback", () => {
  assert.deepEqual(creditSplit(BigInt(100), BigInt(0), BigInt(1000)), { budget: BigInt(100), buyback: BigInt(0) });
  assert.deepEqual(creditSplit(BigInt(100), BigInt(950), BigInt(1000)), { budget: BigInt(50), buyback: BigInt(50) });
  assert.deepEqual(creditSplit(BigInt(100), BigInt(1200), BigInt(1000)), { budget: BigInt(0), buyback: BigInt(100) });
});

test("fee split config: 80 % creator / 20 % treasury, sums to 10 000 bps, dust to the creator", () => {
  assert.equal(FEE_SPLIT_BPS.creator, 8000);
  assert.equal(FEE_SPLIT_BPS.treasury, 2000);
  assert.equal(FEE_SPLIT_BPS.creator + FEE_SPLIT_BPS.treasury, 10_000);
  assert.deepEqual(splitFees(BigInt(1_000_003)), { creator: BigInt(800_003), treasury: BigInt(200_000) });
  assert.equal(tickerFromHandle("mika.thrift"), "MIKATHRIFT");
  assert.equal(tickerFromHandle("x"), "XAI");
});
