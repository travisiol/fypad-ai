"use client";

import Link from "next/link";
import { useState } from "react";
import { RingAvatar } from "@/components/social";
import { count, pct, usd } from "@/lib/show";
import type { InfluencerView } from "@/server/views";

type Key = "mcap" | "volume" | "change" | "holders" | "followers" | "posts";
const COLS: { key: Key; label: string }[] = [
  { key: "mcap", label: "Market cap" },
  { key: "volume", label: "24h volume" },
  { key: "change", label: "24h" },
  { key: "holders", label: "Holders" },
  { key: "followers", label: "Followers" },
  { key: "posts", label: "Posts" },
];

const value = (r: InfluencerView, k: Key): number | null => {
  const s = r.coin?.stats;
  switch (k) {
    case "mcap":
      return s?.mcapUsd ?? null;
    case "volume":
      return s?.volume24hUsd ?? null;
    case "change":
      return s?.change24h ?? null;
    case "holders":
      return s?.holders ?? null;
    case "followers":
      return r.followers;
    case "posts":
      return r.posts;
  }
};

/** The chart-topper list: every influencer with a coin, sortable by any column (rank follows the sort). */
export function RisingTable({ rows }: { rows: InfluencerView[] }) {
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "mcap", desc: true });
  const sorted = [...rows].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return sort.desc ? y - x : x - y;
  });
  return (
    <div className="scroll-x rounded-lg border" data-testid="rising-table">
      <table className="table min-w-[860px]">
        <thead>
          <tr>
            <th className="w-12">#</th>
            <th>Influencer</th>
            <th>Coin</th>
            {COLS.map((c) => (
              <th key={c.key}>
                <button type="button" className={`font-semibold ${sort.key === c.key ? "text-ink" : ""}`} onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                  {c.label} {sort.key === c.key ? (sort.desc ? "↓" : "↑") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, k) => {
            const s = r.coin?.stats;
            return (
              <tr key={r.id} data-testid="rising-row">
                <td className="num !text-left text-[16px] font-bold text-ink">{k + 1}</td>
                <td>
                  <Link href={`/${r.handle}`} className="flex items-center gap-3">
                    <RingAvatar src={r.avatar} size={36} influencerId={r.id} storyAt={r.storyAt} />
                    <span className="min-w-0">
                      <span className="handle block max-w-[180px] truncate">{r.handle}</span>
                      <span className="muted block max-w-[180px] truncate text-[12px]">{r.displayName}</span>
                    </span>
                  </Link>
                </td>
                <td className="!text-right">
                  <Link href={`/${r.handle}#coin`} className="font-semibold text-ink hover:opacity-60">
                    ${r.coin?.ticker}
                  </Link>
                </td>
                <td className="num font-semibold text-ink">{usd(s?.mcapUsd)}</td>
                <td className="num">{usd(s?.volume24hUsd)}</td>
                <td className={`num ${s?.change24h != null ? (s.change24h >= 0 ? "up" : "down") : ""}`}>{pct(s?.change24h)}</td>
                <td className="num">{s?.holders == null ? "—" : count(s.holders)}</td>
                <td className="num">{count(r.followers)}</td>
                <td className="num">{count(r.posts)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
