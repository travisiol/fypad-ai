import type { Metadata } from "next";
import Link from "next/link";
import { CollectButton } from "@/components/CollectButton";
import { SignInPrompt } from "@/components/SignInPrompt";
import { CreateButton } from "@/components/social";
import { FEE_SPLIT_BPS } from "@/config/fypad";
import { explorerUrl } from "@/config/solana";
import { dateTime, short, sol } from "@/lib/show";
import { ctx } from "@/server/app";
import { now } from "@/server/clock";
import type { Claimable } from "@/server/fees";
import { budgetOf, claimable, distributionsOf } from "@/server/fees";
import { toInfluencer } from "@/server/influencers";
import { activeLaunchFor } from "@/server/launch";
import { mediaUrl } from "@/server/media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Earnings" };

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export default async function EarningsPage() {
  const { db, me } = await ctx();
  if (!me) return <SignInPrompt title="Earnings" text="Sign in to see the creator fees your influencers' coins paid you, and collect what is waiting." />;
  const t = now();
  const rows = (await db.query("SELECT * FROM influencers WHERE owner = $1 AND status = 'live' ORDER BY published_at DESC", [me])).map(toInfluencer);
  const items = await Promise.all(
    rows.map(async (i) => {
      const l = await activeLaunchFor(db, i.id);
      const coin = l?.status === "confirmed" ? l : null;
      const history = await distributionsOf(db, i.id, 50);
      const claim: Claimable | null = coin ? await withTimeout(claimable(coin), 5000) : null;
      return { i, coin, launch: l, history, claim, budget: await budgetOf(db, i.id) };
    }),
  );
  const totalEarned = items.reduce((s, x) => s + x.history.reduce((a, d) => a + d.creatorLamports, BigInt(0)), BigInt(0));
  const totalWaiting = items.reduce((s, x) => s + (x.claim ? (x.claim.mode === "split" ? (x.claim.lamports * BigInt(FEE_SPLIT_BPS.creator)) / BigInt(10_000) : x.claim.lamports) : BigInt(0)), BigInt(0));

  return (
    <div className="mx-auto max-w-[760px] px-4 pb-16 pt-6 md:pt-10" data-testid="earnings">
      <h1 className="text-[24px] font-bold text-ink">Earnings</h1>
      <p className="muted mt-1">Creator fees are paid by pump.fun straight to your wallet. FYPAD records each payout and never holds your share.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="card-box p-4">
          <p className="muted text-[13px]">Earned (recorded)</p>
          <p className="num mt-1 text-[22px] font-bold text-ink" data-testid="total-earned">
            {sol(totalEarned)}
          </p>
        </div>
        <div className="card-box p-4">
          <p className="muted text-[13px]">Your share waiting on chain</p>
          <p className="num mt-1 text-[22px] font-bold text-ink">{sol(totalWaiting)}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <h2 className="text-[20px] font-bold text-ink">No influencers yet</h2>
          <p className="muted mt-2">Create one and launch its coin: every trade pays you {FEE_SPLIT_BPS.creator / 100}% of the creator fee.</p>
          <CreateButton label="Create an influencer" className="btn btn-primary mt-5" />
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {items.map(({ i, coin, launch, history, claim, budget }) => {
            const earned = history.reduce((a, d) => a + d.creatorLamports, BigInt(0));
            return (
              <section key={i.id} className="card-box overflow-hidden" data-testid="earnings-card">
                <div className="flex items-center gap-3 border-b p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                  {i.portraitMediaId ? <img src={mediaUrl(i.portraitMediaId)!} alt="" className="avatar size-11" /> : <span className="avatar size-11" />}
                  <div className="min-w-0 flex-1">
                    <Link href={`/${i.handle}`} className="handle block truncate">
                      {i.handle}
                    </Link>
                    <p className="muted text-[13px]">{coin ? `$${coin.ticker} · ${coin.sharingStatus === "active" ? `${FEE_SPLIT_BPS.creator / 100}/${FEE_SPLIT_BPS.treasury / 100} split active` : "split not set: 100% to you"}` : "No coin yet"}</p>
                  </div>
                  {!coin && <CreateButton influencerId={i.id} label={launch ? "Finish launch" : "Launch coin"} className="btn btn-primary" />}
                  {coin && coin.sharingStatus !== "active" && <CreateButton influencerId={i.id} label="Set 80/20 split" className="btn btn-soft" />}
                </div>
                {coin && (
                  <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
                    <div>
                      <div className="kv">
                        <span>Total creator fees earned</span>
                        <span className="num font-semibold" data-testid="earned">
                          {sol(earned)}
                        </span>
                      </div>
                      <div className="kv">
                        <span>Claimable now</span>
                        <span className="num">{claim ? `${sol(claim.lamports)}${claim.mode === "split" ? ` (your ${FEE_SPLIT_BPS.creator / 100}%: ${sol((claim.lamports * BigInt(FEE_SPLIT_BPS.creator)) / BigInt(10_000))})` : ""}` : "—"}</span>
                      </div>
                      <div className="kv">
                        <span>@{i.handle}&apos;s posting budget</span>
                        <span className="num">{sol(budget.balance)}</span>
                      </div>
                    </div>
                    <CollectButton influencerId={i.id} claimable={(claim?.lamports ?? BigInt(0)).toString()} />
                  </div>
                )}
                {history.length > 0 && (
                  <div className="border-t px-4 pb-2" data-testid="earnings-history">
                    <p className="muted pb-1 pt-3 text-[13px] font-semibold">History</p>
                    {history.map((d) => (
                      <div key={d.signature} className="kv text-[13px]" data-testid="distribution-row">
                        <span>{dateTime((d.blockTime ? d.blockTime * 1000 : d.createdAt) || t)}</span>
                        <span className="flex items-center gap-3">
                          <span className="num font-semibold text-ink">+{sol(d.creatorLamports)}</span>
                          {d.treasuryLamports > BigInt(0) && <span className="num muted">FYPAD {sol(d.treasuryLamports)}</span>}
                          <a className="num text-brand" href={explorerUrl("tx", d.signature, coin?.cluster === "devnet" ? "devnet" : "mainnet-beta")} target="_blank" rel="noreferrer">
                            {short(d.signature)} ↗
                          </a>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <p className="hint mt-6">
        Claimable now is read from the chain: fees waiting on the bonding curve plus the creator vault. Collect sends pump.fun&apos;s permissionless payout from your wallet (you pay the network fee only). Graduated coins (PumpSwap) are
        paid by pump.fun&apos;s own tools; FYPAD does not sweep them yet.
      </p>
    </div>
  );
}
