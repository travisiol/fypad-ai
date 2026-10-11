/**
 * Never let an influencer invent a number about money. A caption may only cite the market cap, the
 * 24 h change, a milestone and the holder count it was given; every sentence that carries any other
 * "$<number>", "<number>%" or "<number>x" figure is removed. Tickers like "$NOVA" are kept.
 * Pure module (tests import it directly).
 */
import type { Facts } from "./personas.ts";

/** "$12.3K" style, as everywhere on FYPAD. */
export function compactUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${v.toFixed(0)}`;
}

const norm = (s: string) => s.replace(/[\s,]/g, "").toLowerCase();

/** Every spelling of a dollar figure the model may legitimately use. */
export function allowedDollarFigures(f: Pick<Facts, "mcapUsd" | "milestoneUsd">): Set<string> {
  const out = new Set<string>();
  for (const v of [f.mcapUsd, f.milestoneUsd]) {
    if (v == null || !Number.isFinite(v)) continue;
    const c = compactUsd(v);
    out.add(norm(c));
    out.add(norm(`$${Math.round(v)}`));
    // "$100K" also written "$100k" / "$100,000"
    if (v >= 1e3) out.add(norm(`$${(v / 1e3).toFixed(0)}k`));
    if (v >= 1e6) out.add(norm(`$${(v / 1e6).toFixed(1).replace(/\.0$/, "")}m`));
  }
  return out;
}

const DOLLAR = /\$\s?\d[\d,]*(?:\.\d+)?\s?[kmb]?(?![a-z])/gi;
const PERCENT = /[+-]?\d+(?:[.,]\d+)?\s?%/g;
const MULT = /(?<![\w$])(?:\d+(?:\.\d+)?\s?x(?![a-z0-9])|x\s?\d+(?:\.\d+)?(?![\d%]))/gi;

/** True when every figure in `sentence` comes from the facts. */
export function sentenceIsClean(sentence: string, f: Pick<Facts, "mcapUsd" | "milestoneUsd" | "change24h">): boolean {
  const dollars = allowedDollarFigures(f);
  for (const m of sentence.match(DOLLAR) ?? []) if (!dollars.has(norm(m))) return false;
  for (const m of sentence.match(PERCENT) ?? []) {
    const n = Math.abs(Number(m.replace(/[\s%+]/g, "").replace(",", ".")));
    if (f.change24h == null || Math.abs(n - Math.abs(f.change24h)) > 0.06) return false;
  }
  if ((sentence.match(MULT) ?? []).length) return false;
  return true;
}

/** Removes every sentence holding an invented figure; line breaks and emoji are kept. */
export function stripInventedFigures(text: string, f: Pick<Facts, "mcapUsd" | "milestoneUsd" | "change24h">): string {
  return text
    .split("\n")
    .map((line) => ({
      was: line.trim().length > 0,
      now: line
        .split(/(?<=[.!?…])\s+/)
        .filter((s) => sentenceIsClean(s, f))
        .join(" ")
        .trim(),
    }))
    .filter((l) => l.now.length > 0 || !l.was)
    .map((l) => l.now)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
