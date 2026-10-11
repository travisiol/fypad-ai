"use client";

import Link from "next/link";
import { useState } from "react";
import { pct, usd } from "@/lib/show";
import type { InfluencerView, StoryView } from "@/server/views";
import { SparkIcon } from "./Icons";
import { RingAvatar } from "./social";
import { StoryViewer } from "./Stories";
import { openCreate } from "./ui-store";

const IDEAS = ["a Tokyo street-style girl who only wears thrifted Y2K", "a retired astronaut who reviews ramen in Osaka", "a golden retriever who is always bullish"];

/** Hero prompt: one sentence here opens Create with it prefilled. */
export function HeroPrompt() {
  const [idea, setIdea] = useState("");
  const go = () => openCreate(null, idea.trim() || null);
  return (
    <div>
      <form
        className="flex items-center gap-2 rounded-full border bg-[var(--card)] p-1.5 pl-5 shadow-[var(--shadow)] focus-within:border-[var(--violet)]"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <SparkIcon size={18} className="flex-none text-[var(--violet)]" />
        <input
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          maxLength={300}
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--muted)]"
          placeholder="Describe your influencer…"
          aria-label="Describe your influencer in one sentence"
          data-testid="hero-idea"
        />
        <button type="submit" className="btn btn-primary h-11 px-5" data-testid="hero-create">
          Create
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {IDEAS.map((x) => (
          <button key={x} type="button" className="chip h-8 text-[13px] font-medium" onClick={() => openCreate(null, x)}>
            {x}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Rising now": tall portrait cards. The ring opens the story when there is one; the card opens the profile. */
export function RisingNow({ items, stories, now }: { items: InfluencerView[]; stories: StoryView[]; now: number }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="scroll-x -mx-4 flex snap-x gap-3 px-4 pb-2 md:mx-0 md:px-0" data-testid="rising-now">
        {items.map((v) => {
          const story = stories.findIndex((s) => s.influencer.id === v.id);
          const ch = v.coin?.stats?.change24h;
          return (
            <div key={v.id} className="relative w-[164px] flex-none snap-start overflow-hidden rounded-[20px] bg-[var(--soft)] shadow-[var(--shadow)] md:w-[180px]" style={{ aspectRatio: "9 / 16" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
              {v.avatar && <img src={v.avatar} alt="" className="absolute inset-0 size-full object-cover" />}
              <Link href={`/${v.handle}`} className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-black/20" aria-label={`@${v.handle}`} />
              <button type="button" className="absolute left-2.5 top-2.5 rounded-full" onClick={() => story >= 0 && setOpen(story)} aria-label={story >= 0 ? `Story by @${v.handle}` : `@${v.handle}`}>
                <RingAvatar src={v.avatar} size={34} influencerId={v.id} storyAt={v.storyAt} />
              </button>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-white">
                <p className="truncate font-[family-name:var(--font-display)] text-[15px] font-bold leading-tight">@{v.handle}</p>
                {v.coin ? (
                  <div className="mt-1.5 flex items-center justify-between gap-1 text-[12px]">
                    <span className="rounded-full bg-white/20 px-2 py-0.5 font-semibold backdrop-blur-sm">${v.coin.ticker}</span>
                    <span className="num">{usd(v.coin.stats?.mcapUsd)}</span>
                  </div>
                ) : (
                  <p className="mt-1 text-[12px] text-white/75">{v.displayName}</p>
                )}
                {v.coin && <p className={`num mt-1 text-right text-[12px] font-semibold ${ch == null ? "text-white/70" : ch >= 0 ? "text-[#5be4a6]" : "text-[#ff8a80]"}`}>{pct(ch)}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {open !== null && <StoryViewer stories={stories} start={open} now={now} onClose={() => setOpen(null)} />}
    </>
  );
}
