"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ago } from "@/lib/show";
import type { StoryView } from "@/server/views";
import { CloseIcon } from "./Icons";
import { markSeen } from "./ui-store";

const STORY_MS = 5000;

/** Full-screen story viewer: the influencer's posts of the last 24 h, 5 s each, tap left / right. */
export function StoryViewer({ stories, start, now, onClose }: { stories: StoryView[]; start: number; now: number; onClose: () => void }) {
  const [pos, setPos] = useState({ s: start, i: 0 });
  const story = stories[pos.s];
  const item = story?.items[pos.i];

  const next = () => {
    const s = stories[pos.s];
    if (pos.i + 1 < s.items.length) setPos({ s: pos.s, i: pos.i + 1 });
    else if (pos.s + 1 < stories.length) setPos({ s: pos.s + 1, i: 0 });
    else onClose();
  };
  const prev = () => setPos(pos.i > 0 ? { s: pos.s, i: pos.i - 1 } : pos.s > 0 ? { s: pos.s - 1, i: 0 } : pos);

  useEffect(() => {
    if (!story || !item) return;
    markSeen(story.influencer.id, item.at);
    const t = setTimeout(next, STORY_MS);
    return () => clearTimeout(t);
    // the timer restarts on every item
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.s, pos.i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.s, pos.i]);

  if (!story || !item) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#1a1a1a] fade-in" data-testid="story-viewer">
      <button type="button" className="icon-btn absolute right-3 top-3 text-white" onClick={onClose} aria-label="Close">
        <CloseIcon size={28} />
      </button>
      <div className="relative h-full max-h-[calc(100vh-32px)] w-full max-w-[min(100vw,calc((100vh-32px)*9/16))] overflow-hidden bg-black sm:rounded-lg" style={{ aspectRatio: "9 / 16" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
        {item.image && <img src={item.image} alt="" className="absolute inset-0 size-full object-cover" />}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/50 to-transparent px-3 pb-8 pt-3">
          <div className="flex gap-1">
            {story.items.map((it, k) => (
              <span key={it.id} className="story-bar">
                <span style={k < pos.i ? { width: "100%" } : k === pos.i ? { width: "100%", animation: `storyfill ${STORY_MS}ms linear both` } : { width: 0 }} />
              </span>
            ))}
          </div>
          <Link href={`/${story.influencer.handle}`} className="mt-3 flex items-center gap-2 text-white" onClick={onClose}>
            {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
            {story.influencer.avatar && <img src={story.influencer.avatar} alt="" className="avatar size-8" />}
            <span className="text-[14px] font-semibold">{story.influencer.handle}</span>
            <span className="text-[14px] text-white/70">{ago(item.at, now)}</span>
          </Link>
        </div>
        <button type="button" className="absolute inset-y-0 left-0 w-1/3" aria-label="Previous" onClick={prev} />
        <button type="button" className="absolute inset-y-0 right-0 w-2/3" aria-label="Next" onClick={next} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-5 pt-10">
          <p className="line-clamp-3 text-[14px] text-white">{item.caption}</p>
          <Link href={`/p/${item.id}`} className="mt-2 inline-block text-[13px] font-semibold text-white underline-offset-2 hover:underline" onClick={onClose}>
            View post
          </Link>
        </div>
      </div>
      <style>{`@keyframes storyfill{from{width:0}to{width:100%}}`}</style>
    </div>,
    document.body,
  );
}
