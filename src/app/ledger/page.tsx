import type { Metadata } from "next";
import Link from "next/link";
import { ENV, serverFypadMint } from "@/config/fypad";
import { explorerUrl, serverCluster } from "@/config/solana";
import { dateTime, short, sol } from "@/lib/show";
import { big, db } from "@/server/db";
import { allDistributions } from "@/server/fees";
import { toInfluencer } from "@/server/influencers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ledger" };

export default async function LedgerPage() {
  const d = await db();
  const cluster = serverCluster();
  const dist = await allDistributions(d, 200);
  const sums = await d.query("SELECT kind, COALESCE(SUM(lamports), 0) AS s FROM budget_entries GROUP BY kind");
  const sum = (k: string) => big(sums.find((r) => r.kind === k)?.s ?? 0);
  const entries = await d.query("SELECT * FROM budget_entries ORDER BY created_at DESC LIMIT 100");
  const ids = [...new Set([...dist.map((x) => x.influencerId), ...entries.map((e) => String(e.influencer_id))])];
  const handles = new Map((ids.length ? await d.query("SELECT * FROM influencers WHERE id = ANY($1::text[])", [ids]) : []).map((r) => [String(r.id), toInfluencer(r).handle]));
  const treasuryIn = dist.reduce((s, x) => s + x.treasuryLamports, BigInt(0));
  const creatorsIn = dist.reduce((s, x) => s + x.creatorLamports, BigInt(0));
  const mint = serverFypadMint();
  const treasury = ENV.treasuryWallet();

  return (
    <div className="mx-auto max-w-[860px] px-4 pb-16 pt-6 md:pt-10" data-testid="ledger">
      <h1 className="text-[24px] font-bold text-ink">Ledger</h1>
      <p className="muted mt-1">Every amount on FYPAD&apos;s side: creator-fee distributions recorded from the chain, what the treasury share paid for, and the $FYPAD buyback reserve.</p>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Paid to creators", creatorsIn],
          ["Treasury received", treasuryIn],
          ["Spent on AI posts", sum("spend")],
          ["Held for $FYPAD buyback", sum("buyback")],
        ].map(([label, v]) => (
          <div key={String(label)} className="card-box p-4">
            <p className="muted text-[12px]">{String(label)}</p>
            <p className="num mt-1 text-[18px] font-bold text-ink">{sol(v as bigint)}</p>
          </div>
        ))}
      </div>
      <p className="hint mt-3">
        Treasury wallet: {treasury ? <a className="num text-brand" href={explorerUrl("account", treasury, cluster)} target="_blank" rel="noreferrer">{short(treasury)}</a> : "—"} · $FYPAD:{" "}
        {mint ? <a className="num text-brand" href={explorerUrl("token", mint, cluster)} target="_blank" rel="noreferrer">{short(mint)}</a> : "not launched yet, the buyback share is held"} · Posting budgets credited: {sol(sum("credit"))}
      </p>

      <h2 className="mb-2 mt-8 text-[16px] font-bold text-ink">Distributions</h2>
      {dist.length === 0 ? (
        <p className="muted rounded-lg border p-6 text-center">No distribution recorded yet. Each payout of a coin&apos;s creator fees appears here with its Solana transaction.</p>
      ) : (
        <div className="scroll-x rounded-lg border">
          <table className="table min-w-[640px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Influencer</th>
                <th>Creator</th>
                <th>Treasury</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {dist.map((x) => (
                <tr key={`${x.signature}:${x.mint}`} data-testid="ledger-row">
                  <td className="muted text-[13px]">{dateTime(x.blockTime ? x.blockTime * 1000 : x.createdAt)}</td>
                  <td>
                    <Link href={`/${handles.get(x.influencerId) ?? ""}`} className="handle">
                      {handles.get(x.influencerId) ?? "—"}
                    </Link>
                  </td>
                  <td className="num">{sol(x.creatorLamports)}</td>
                  <td className="num">{sol(x.treasuryLamports)}</td>
                  <td>
                    <a className="num text-brand" href={explorerUrl("tx", x.signature, cluster)} target="_blank" rel="noreferrer">
                      {short(x.signature)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 mt-8 text-[16px] font-bold text-ink">Treasury share, by use</h2>
      {entries.length === 0 ? (
        <p className="muted rounded-lg border p-6 text-center">Nothing yet.</p>
      ) : (
        <div className="scroll-x rounded-lg border">
          <table className="table min-w-[560px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Influencer</th>
                <th>Use</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={String(e.id)}>
                  <td className="muted text-[13px]">{dateTime(Number(e.created_at))}</td>
                  <td className="handle">{handles.get(String(e.influencer_id)) ?? "—"}</td>
                  <td>{e.kind === "credit" ? "Posting budget credited" : e.kind === "spend" ? "AI post paid" : "Held for $FYPAD buyback"}</td>
                  <td className="num">{sol(big(e.lamports))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
