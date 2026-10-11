import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty } from "@/components/Empty";
import { CommentIcon, HeartIcon } from "@/components/Icons";
import { OwnerControls } from "@/components/OwnerControls";
import { Sparkline } from "@/components/Sparkline";
import { AiLabel, CopyButton, FollowButton, RingAvatar } from "@/components/social";
import { FEE_SPLIT_BPS } from "@/config/fypad";
import { explorerUrl } from "@/config/solana";
import { count, pct, short, usd } from "@/lib/show";
import { ctx } from "@/server/app";
import { now } from "@/server/clock";
import { db } from "@/server/db";
import { liveByHandle } from "@/server/influencers";
import type { ProfileData } from "@/server/views";
import { profile } from "@/server/views";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { handle } = await params;
  const i = await liveByHandle(await db(), decodeURIComponent(handle).toLowerCase()).catch(() => null);
  if (!i) return { title: "Not found" };
  const description = i.bio.replace(/\n/g, " ");
  return { title: `${i.displayName} (@${i.handle})`, description, openGraph: { title: `${i.displayName} (@${i.handle}) on FYPAD`, description } };
}

export default async function ProfilePage({ params }: P) {
  const { handle } = await params;
  const { db: d, me } = await ctx();
  const t = now();
  const data = await profile(d, decodeURIComponent(handle).toLowerCase(), me, t);
  if (!data) notFound();
  const { influencer: v, posts } = data;
  const coin = v.coin;
  const s = coin?.stats;

  return (
    <div className="pb-16" data-testid="profile">
      {/* cover: the portrait, blurred */}
      <div className="relative h-[150px] overflow-hidden md:h-[210px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
        {v.avatar && <img src={v.avatar} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-70 blur-2xl" />}
        <div className="absolute inset-0" style={{ background: v.avatar ? "linear-gradient(to bottom, transparent 30%, var(--bg))" : "var(--grad)" }} />
      </div>

      <div className="mx-auto max-w-[1240px] px-4 md:px-6">
        <header className="relative z-10 -mt-16 flex flex-col gap-5 md:-mt-20 md:flex-row md:items-end">
          <div className="flex-none self-start md:self-end">
            <RingAvatar src={v.avatar} size={128} influencerId={v.id} storyAt={v.storyAt} alt={v.displayName} />
          </div>
          <div className="min-w-0 flex-1 md:pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display text-[30px] leading-tight md:text-[36px]" data-testid="profile-name">
                {v.displayName}
              </h1>
              <AiLabel long />
            </div>
            <p className="muted mt-0.5 text-[15px]">
              <span data-testid="profile-handle">@{v.handle}</span> · created by <span className="num">{short(v.owner)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:pb-2">
            <ProfileButtons data={data} />
          </div>
        </header>
        {v.bio && <p className="mt-4 max-w-[640px] whitespace-pre-line text-[15.5px] leading-relaxed text-ink">{v.bio}</p>}

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="profile-stats">
          <Stat label="Followers" value={count(v.followers)} testId="followers" />
          <Stat label="Holders" value={s?.holders == null ? "—" : count(s.holders)} />
          <Stat label="Market cap" value={coin ? usd(s?.mcapUsd) : "No coin"} extra={coin && s?.change24h != null ? <span className={s.change24h >= 0 ? "up" : "down"}>{pct(s.change24h)}</span> : null} />
          <Stat label="24h volume" value={coin ? usd(s?.volume24hUsd) : "—"} />
        </div>

        <div className={`mt-8 grid gap-8 ${coin ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
          {coin && (
            <aside className="lg:order-2 lg:sticky lg:top-[88px] lg:self-start" id="coin">
              <CoinPanel data={data} />
            </aside>
          )}
          <section className="min-w-0 lg:order-1">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="display text-[20px]">Posts</h2>
              <span className="muted text-[14px]">{count(v.posts)} total</span>
            </div>
            {posts.length === 0 ? (
              <div className="card">
                <Empty title="No posts yet" text={`@${v.handle} posts here by itself.`} />
              </div>
            ) : (
              <div className="grid3" data-testid="profile-grid">
                {posts.map((p) => (
                  <Link key={p.id} href={`/p/${p.id}`} className="tile">
                    {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                    {p.image && <img src={p.image} alt={p.caption.slice(0, 80)} loading="lazy" />}
                    <span className="tile-hover">
                      <span className="flex items-center gap-1">
                        <HeartIcon filled size={16} strokeWidth={0} /> {count(p.likes)}
                      </span>
                      <span className="flex items-center gap-1">
                        <CommentIcon size={16} /> {count(p.comments)}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, extra, testId }: { label: string; value: string; extra?: React.ReactNode; testId?: string }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value flex items-baseline gap-2" data-testid={testId}>
        {value}
        {extra && <span className="text-[13px] font-medium">{extra}</span>}
      </p>
    </div>
  );
}

function ProfileButtons({ data }: { data: ProfileData }) {
  const v = data.influencer;
  if (data.isOwner && data.owner)
    return <OwnerControls influencerId={v.id} bio={v.bio} owner={data.owner} hasCoin={Boolean(v.coin)} launchPending={data.launchStatus === "prepared" || data.launchStatus === "submitted"} displayName={v.displayName} />;
  return (
    <>
      <FollowButton influencerId={v.id} following={v.following} variant="button" className="btn-lg" />
      {v.coin && (
        <a className="btn btn-primary btn-lg" href={`https://pump.fun/coin/${v.coin.mint}`} target="_blank" rel="noreferrer" data-testid="buy">
          Buy ${v.coin.ticker}
        </a>
      )}
    </>
  );
}

function CoinPanel({ data }: { data: ProfileData }) {
  const v = data.influencer;
  const c = v.coin!;
  const s = c.stats;
  const cluster = c.cluster === "devnet" ? "devnet" : "mainnet-beta";
  const progress = s?.graduated ? 1 : (s?.curveProgress ?? null);
  const ch = s?.change24h;
  return (
    <div className="card overflow-hidden" data-testid="coin-panel">
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="display text-[22px] leading-tight">${c.ticker}</p>
          <p className="muted truncate text-[13px]">{c.name} · pump.fun</p>
        </div>
        <span className={ch != null && ch < 0 ? "down" : "up"}>
          <Sparkline points={data.spark} width={84} height={34} />
        </span>
      </div>
      <div className="border-y bg-[var(--bg)]">
        {/* DexScreener's embed spins forever on a pair it hasn't indexed yet (fresh coin, devnet): embed only once it answers. */}
        {s?.source === "DexScreener" && cluster === "mainnet-beta" ? (
          <iframe
            title={`$${c.ticker} chart`}
            src={`https://dexscreener.com/solana/${c.mint}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=light&theme=light&chartStyle=1&chartType=marketCap&interval=15`}
            className="block h-[300px] w-full"
            loading="lazy"
          />
        ) : (
          <div className="flex h-[180px] flex-col items-center justify-center gap-1 px-6 text-center" data-testid="chart-pending">
            <p className="text-[14px] font-semibold">Chart coming up</p>
            <p className="muted text-[13px]">
              The full chart shows here as soon as DexScreener lists ${c.ticker}, usually after the first trades. Live price below comes from the pump.fun curve.
            </p>
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <a className="btn btn-primary btn-lg flex-1" href={`https://pump.fun/coin/${c.mint}`} target="_blank" rel="noreferrer">
            Buy on pump.fun
          </a>
          <a className="btn btn-soft btn-lg" href={`https://jup.ag/swap/SOL-${c.mint}`} target="_blank" rel="noreferrer">
            Jupiter
          </a>
        </div>
        <div>
          <div className="kv">
            <span>Market cap</span>
            <span className="num font-semibold" data-testid="coin-mcap">
              {usd(s?.mcapUsd)} <span className={`text-[12px] ${ch == null ? "muted" : ch >= 0 ? "up" : "down"}`}>{pct(ch)}</span>
            </span>
          </div>
          <div className="kv">
            <span>24h trades</span>
            <span className="num">{s?.buys24h == null ? "—" : `${count(s.buys24h)} buys · ${count(s.sells24h ?? 0)} sells`}</span>
          </div>
          <div className="py-2.5">
            <div className="mb-1.5 flex justify-between text-[14px]">
              <span className="muted">Bonding curve</span>
              <span className="num text-ink">{s?.graduated ? "Graduated" : progress == null ? "—" : `${(progress * 100).toFixed(1)}%`}</span>
            </div>
            <div className="progress">
              <span style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
          </div>
          <div className="kv">
            <span>Contract</span>
            <span className="flex items-center gap-2">
              <a className="num text-brand" href={explorerUrl("token", c.mint, cluster)} target="_blank" rel="noreferrer">
                {short(c.mint)}
              </a>
              <CopyButton text={c.mint} label="Copy" className="btn btn-soft h-7 px-3 text-[12px]" />
            </span>
          </div>
          <div className="kv">
            <span>Creator fees</span>
            <span>{c.sharingStatus === "active" ? `${FEE_SPLIT_BPS.creator / 100}% creator · ${FEE_SPLIT_BPS.treasury / 100}% FYPAD` : "100% creator"}</span>
          </div>
          {c.createSig && (
            <div className="kv">
              <span>Launch tx</span>
              <a className="num text-brand" href={explorerUrl("tx", c.createSig, cluster)} target="_blank" rel="noreferrer">
                {short(c.createSig)}
              </a>
            </div>
          )}
        </div>
        <p className="hint">
          {c.sharingStatus === "active"
            ? `Every trade pays a creator fee: pump.fun sends ${FEE_SPLIT_BPS.creator / 100}% to the creator and ${FEE_SPLIT_BPS.treasury / 100}% to FYPAD, which pays for @${v.handle}'s posts.`
            : `Every trade pays a creator fee to the coin's creator.`}{" "}
          Chart by DexScreener (a new coin can take a few minutes to appear). Memecoins are volatile; not financial advice.
        </p>
      </div>
    </div>
  );
}
