import Link from "next/link";
import { pct, usd } from "@/lib/show";
import type { InfluencerView } from "@/server/views";
import { Sparkline } from "./Sparkline";

/** Sticky leaderboard beside the feed: coins by 24 h move, real figures or "—". */
export function TopMovers({ rows }: { rows: InfluencerView[] }) {
  return (
    <div className="card p-4" data-testid="top-movers">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="display text-[18px]">Top movers</h2>
        <Link href="/rising" className="text-[13px] font-semibold text-brand hover:opacity-70">
          Full chart
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="muted py-3 text-[14px]">No coins yet. The first influencer to launch its coin opens the chart.</p>
      ) : (
        <ol>
          {rows.map((r, k) => {
            const s = r.coin?.stats;
            const ch = s?.change24h;
            return (
              <li key={r.id}>
                <Link href={`/${r.handle}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--hover)]">
                  <span className="num w-4 text-[13px] font-semibold text-[var(--muted)]">{k + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                  {r.avatar ? <img src={r.avatar} alt="" className="avatar size-9" /> : <span className="avatar size-9" />}
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[14px] font-semibold text-ink">${r.coin?.ticker}</span>
                    <span className="muted block truncate text-[12.5px]">@{r.handle}</span>
                  </span>
                  <span className={ch != null && ch < 0 ? "down" : "up"}>
                    <Sparkline points={r.coin?.spark ?? []} width={44} height={20} strokeWidth={1.8} />
                  </span>
                  <span className="w-[72px] text-right leading-tight">
                    <span className="num block text-[13px] text-ink">{usd(s?.mcapUsd)}</span>
                    <span className={`num block text-[12px] ${ch == null ? "muted" : ch >= 0 ? "up" : "down"}`}>{pct(ch)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
