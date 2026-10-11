/**
 * How often an influencer posts by itself. Pure function, tested in tests/cadence.test.ts.
 *
 *  - Baseline: one free post per day during its first 14 days.
 *  - Budget (treasury 20 % share credited from recorded distributions) ≥ cost of a post: up to three
 *    posts a day (every 8 h); posts beyond the free allowance are paid from the budget.
 *  - After 14 days with no budget: one free post every three days.
 *  - Paused by its owner: never.
 */
import { CADENCE } from "../config/fypad.ts";

export interface CadenceInput {
  now: number;
  publishedAt: number;
  lastAutoPostAt: number | null;
  lastFreePostAt: number | null;
  budgetLamports: bigint;
  costLamports: bigint;
  paused: boolean;
}

export interface CadenceDecision {
  due: boolean;
  paid: boolean;
  intervalMs: number;
  nextAt: number | null;
  mode: "paused" | "baseline" | "funded" | "idle";
}

export function cadence(i: CadenceInput): CadenceDecision {
  const inBaseline = i.now - i.publishedAt < CADENCE.baselineDays * 86_400_000;
  const funded = i.budgetLamports >= i.costLamports && i.costLamports > BigInt(0);
  const freeInterval = inBaseline ? CADENCE.baselineIntervalMs : CADENCE.idleIntervalMs;
  const mode: CadenceDecision["mode"] = i.paused ? "paused" : funded ? "funded" : inBaseline ? "baseline" : "idle";
  if (i.paused) return { due: false, paid: false, intervalMs: freeInterval, nextAt: null, mode };
  const interval = funded ? CADENCE.fundedIntervalMs : freeInterval;
  const lastAuto = i.lastAutoPostAt ?? i.publishedAt;
  const lastFree = i.lastFreePostAt ?? i.publishedAt;
  const freeAt = lastFree + freeInterval;
  const spacingAt = lastAuto + interval;
  if (i.now < spacingAt) return { due: false, paid: false, intervalMs: interval, nextAt: funded ? spacingAt : Math.max(spacingAt, freeAt), mode };
  if (i.now >= freeAt) return { due: true, paid: false, intervalMs: interval, nextAt: i.now, mode };
  if (funded) return { due: true, paid: true, intervalMs: interval, nextAt: i.now, mode };
  return { due: false, paid: false, intervalMs: interval, nextAt: freeAt, mode };
}

/** Splits a treasury receipt between the influencer's posting budget (up to its cap) and the $FYPAD buyback. */
export function creditSplit(treasuryLamports: bigint, balance: bigint, capLamports: bigint): { budget: bigint; buyback: bigint } {
  const room = capLamports > balance ? capLamports - balance : BigInt(0);
  const budget = treasuryLamports < room ? treasuryLamports : room;
  return { budget, buyback: treasuryLamports - budget };
}
