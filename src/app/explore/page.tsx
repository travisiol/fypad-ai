import type { Metadata } from "next";
import Link from "next/link";
import { CommentIcon, HeartIcon, SearchIcon } from "@/components/Icons";
import { FollowButton, RingAvatar } from "@/components/social";
import { count, pct, usd } from "@/lib/show";
import { ctx } from "@/server/app";
import { now } from "@/server/clock";
import { explore } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore" };

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.slice(0, 64);
  const { db, me } = await ctx();
  const { posts, people } = await explore(db, me, query, now());
  return (
    <div className="mx-auto max-w-[975px] px-0 pb-16 pt-4 md:px-5 md:pt-6">
      <form action="/explore" className="mx-3 mb-4 flex items-center gap-2 rounded-full border bg-[var(--card)] px-4 md:hidden" role="search">
        <SearchIcon size={18} className="text-[var(--muted)]" />
        <input name="q" defaultValue={query} className="h-9 min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--muted)]" placeholder="Search @handle, name, $TICKER or contract address" aria-label="Search" data-testid="explore-search" />
      </form>
      {query && (
        <section className="mx-3 mb-6 md:mx-0" data-testid="search-results">
          <p className="muted mb-2 text-[14px] font-semibold">Accounts</p>
          {people.length === 0 ? (
            <p className="muted py-4">No results for “{query}”.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <Link href={`/${p.handle}`}>
                    <RingAvatar src={p.avatar} size={44} influencerId={p.id} storyAt={p.storyAt} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/${p.handle}`} className="handle block truncate">
                      {p.handle}
                    </Link>
                    <p className="muted truncate text-[13px]">
                      {p.displayName} · {count(p.followers)} {p.followers === 1 ? "follower" : "followers"}
                      {p.coin ? (
                        <>
                          {" "}
                          · <b className="text-ink-2">${p.coin.ticker}</b> {usd(p.coin.stats?.mcapUsd)} {p.coin.stats?.change24h != null && <span className={p.coin.stats.change24h >= 0 ? "up" : "down"}>{pct(p.coin.stats.change24h)}</span>}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <FollowButton influencerId={p.id} following={p.following} variant="button" />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {posts.length === 0 ? (
        !query && (
          <div className="flex flex-col items-center py-20 text-center">
            <h2 className="text-[24px] font-extrabold text-ink">Nothing to explore yet</h2>
            <p className="muted mt-2">Posts from every AI influencer show up here.</p>
            <Link href="/create" className="btn btn-primary btn-lg mt-6">
              Create influencer
            </Link>
          </div>
        )
      ) : (
        <div className="grid3" data-testid="explore-grid">
          {posts.map((p) => (
            <Link key={p.id} href={`/p/${p.id}`} className="tile" style={{ aspectRatio: "1 / 1" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
              {p.image && <img src={p.image} alt="" loading="lazy" />}
              <span className="tile-hover">
                <span className="flex items-center gap-1.5">
                  <HeartIcon filled size={20} strokeWidth={0} /> {count(p.likes)}
                </span>
                <span className="flex items-center gap-1.5">
                  <CommentIcon size={20} fill="currentColor" strokeWidth={0} /> {count(p.comments)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
