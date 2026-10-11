"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, copyText } from "@/lib/client";
import { ago, count, pct, usd } from "@/lib/show";
import type { PostView } from "@/server/views";
import { BookmarkIcon, CommentIcon, HeartIcon, MoreIcon, SendIcon } from "./Icons";
import { Modal } from "./Modal";
import { Sparkline } from "./Sparkline";
import { AiLabel, RingAvatar, useRequireSignIn } from "./social";
import { useWallet } from "./wallet/store";

/** Like / save state for one post, shared by the feed card and the post page. */
export function usePostActions(post: PostView) {
  const [liked, setLiked] = useState(post.liked);
  const [likes, setLikes] = useState(post.likes);
  const [saved, setSaved] = useState(post.saved);
  const [pop, setPop] = useState(0);
  const need = useRequireSignIn();
  const like = async (on = !liked) => {
    if (!need()) return;
    if (on === liked) return;
    setLiked(on);
    setLikes((n) => n + (on ? 1 : -1));
    if (on) setPop((p) => p + 1);
    try {
      const r = await api<{ liked: boolean; likes: number }>(`/api/posts/${post.id}/like`, { body: { on } });
      setLiked(r.liked);
      setLikes(r.likes);
    } catch {
      setLiked(!on);
      setLikes((n) => n + (on ? -1 : 1));
    }
  };
  const save = async () => {
    if (!need()) return;
    const on = !saved;
    setSaved(on);
    try {
      await api(`/api/posts/${post.id}/save`, { body: { on } });
    } catch {
      setSaved(!on);
    }
  };
  return { liked, likes, saved, pop, like, save };
}

export function Caption({ post, clamp = true }: { post: PostView; clamp?: boolean }) {
  const [open, setOpen] = useState(!clamp);
  const long = post.caption.length > 125 || post.caption.includes("\n");
  const text = open || !long ? post.caption : `${post.caption.split("\n")[0].slice(0, 120)}`;
  return (
    <div className="whitespace-pre-line break-words text-[14.5px] leading-[1.5] text-ink-2" data-testid="caption">
      {text}
      {!open && long && (
        <>
          …{" "}
          <button type="button" className="muted" onClick={() => setOpen(true)}>
            more
          </button>
        </>
      )}
      {(open || !long) && post.hashtags.length > 0 && (
        <span className="text-brand">
          {"\n"}
          {post.hashtags.map((h) => `#${h}`).join(" ")}
        </span>
      )}
    </div>
  );
}

export function PostMenu({ post, open, onClose, isOwner }: { post: PostView; open: boolean; onClose: () => void; isOwner: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const url = () => `${window.location.origin}/p/${post.id}`;
  return (
    <Modal open={open} onClose={onClose} width={400}>
      <div className="flex flex-col p-2 text-center text-[14px]">
        {isOwner && (
          <button
            type="button"
            className="menu-item justify-center font-bold text-[var(--down)]"
            onClick={async () => {
              try {
                await api(`/api/posts/${post.id}`, { method: "DELETE" });
                onClose();
                router.refresh();
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}
            data-testid="delete-post"
          >
            Delete
          </button>
        )}
        <Link href={`/p/${post.id}`} className="menu-item justify-center" onClick={onClose}>
          Go to post
        </Link>
        <a className="menu-item justify-center" href={`https://x.com/intent/post?text=${encodeURIComponent(`@${post.influencer.handle} on FYPAD`)}&url=${encodeURIComponent(`${typeof window !== "undefined" ? window.location.origin : ""}/p/${post.id}`)}`} target="_blank" rel="noreferrer">
          Share to X
        </a>
        <button
          type="button"
          className="menu-item justify-center"
          onClick={async () => {
            setMsg((await copyText(url())) ? "Link copied." : "Copy failed.");
          }}
        >
          {msg ?? "Copy link"}
        </button>
        <Link href={`/${post.influencer.handle}`} className="menu-item justify-center" onClick={onClose}>
          About this account
        </Link>
        <button type="button" className="menu-item justify-center" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}


/** The coin line on every post: mini sparkline, $TICKER, market cap, 24 h change, and Buy. */
export function CoinChip({ post, buy = true }: { post: Pick<PostView, "influencer">; buy?: boolean }) {
  const c = post.influencer.coin;
  if (!c) return null;
  const ch = c.stats?.change24h;
  return (
    <div className="flex items-center gap-2" data-testid="coin-chip">
      <Link href={`/${post.influencer.handle}#coin`} className="coin-chip min-w-0 flex-1 hover:bg-[var(--soft-hover)]">
        <span className={ch != null && ch < 0 ? "down" : "up"}>
          <Sparkline points={c.spark} width={42} height={18} strokeWidth={1.8} />
        </span>
        <span className="font-semibold">${c.ticker}</span>
        <span className="num muted ml-auto">{usd(c.stats?.mcapUsd)}</span>
        <span className={`num text-[12px] ${ch == null ? "muted" : ch >= 0 ? "up" : "down"}`}>{pct(ch)}</span>
      </Link>
      {buy && (
        <a className="btn btn-primary h-[34px] px-4 text-[13px]" href={`https://pump.fun/coin/${c.mint}`} target="_blank" rel="noreferrer" data-testid="buy">
          Buy
        </a>
      )}
    </div>
  );
}

export function PostCard({ post, now }: { post: PostView; now: number }) {
  const a = usePostActions(post);
  const w = useWallet();
  const need = useRequireSignIn();
  const [menu, setMenu] = useState(false);
  const [burst, setBurst] = useState(0);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState(post.comments);
  const [mine, setMine] = useState<string[]>([]);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const lastTap = useRef(0);
  const i = post.influencer;

  const onTap = (t: number) => {
    if (t - lastTap.current < 300) {
      setBurst((b) => b + 1);
      void a.like(true);
    }
    lastTap.current = t;
  };
  const send = async () => {
    const body = comment.trim();
    if (!body || !need()) return;
    try {
      await api(`/api/posts/${post.id}/comment`, { body: { body } });
      setMine((m) => [...m, body]);
      setComments((n) => n + 1);
      setComment("");
    } catch {
      // kept in the field
    }
  };

  return (
    <article className="post-card rise" data-testid="post-card" data-post={post.id}>
      <header className="mb-3 flex items-center gap-3">
        <Link href={`/${i.handle}`}>
          <RingAvatar src={i.avatar} size={38} influencerId={i.id} storyAt={i.storyAt} />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <Link href={`/${i.handle}`} className="name truncate text-[15px] hover:opacity-70">
              {i.displayName}
            </Link>
            <AiLabel />
          </div>
          <div className="muted truncate text-[13px]">
            <Link href={`/${i.handle}`} className="hover:text-[var(--ink)]">
              @{i.handle}
            </Link>{" "}
            ·{" "}
            <Link href={`/p/${post.id}`} className="hover:text-[var(--ink)]">
              {ago(post.publishedAt, now)}
            </Link>
          </div>
        </div>
        <button type="button" className="icon-btn -mr-1" aria-label="More options" onClick={() => setMenu(true)}>
          <MoreIcon />
        </button>
      </header>
      <div className="post-media select-none" onClick={(e) => onTap(e.timeStamp)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
        {post.image && <img src={post.image} alt={`Photo by @${i.handle}`} loading="lazy" draggable={false} />}
        {burst > 0 && (
          <span key={burst} className="heart-burst text-white drop-shadow-lg">
            <HeartIcon filled size={96} strokeWidth={0} />
          </span>
        )}
      </div>
      {i.coin && (
        <div className="mt-3">
          <CoinChip post={post} />
        </div>
      )}
      <div className="mt-2 flex items-center gap-0.5">
        <button type="button" className="act -ml-2" aria-label={a.liked ? "Unlike" : "Like"} onClick={() => a.like()} data-testid="like">
          <span key={a.pop} className={a.liked ? "liked-pop text-pink" : ""}>
            <HeartIcon filled={a.liked} size={22} />
          </span>
          <span className="num" data-testid="likes">
            {count(a.likes)}
          </span>
        </button>
        <Link href={`/p/${post.id}`} className="act" aria-label="Comments">
          <CommentIcon size={22} />
          <span className="num">{count(comments)}</span>
        </Link>
        <button
          type="button"
          className="act"
          aria-label="Share"
          onClick={async () => {
            setShareMsg((await copyText(`${window.location.origin}/p/${post.id}`)) ? "Link copied" : null);
            setTimeout(() => setShareMsg(null), 1500);
          }}
        >
          <SendIcon size={21} />
          {shareMsg && <span className="text-[12px] font-medium">{shareMsg}</span>}
        </button>
        <button type="button" className="act -mr-2 ml-auto" aria-label={a.saved ? "Remove from saved" : "Save"} onClick={a.save} data-testid="save">
          <BookmarkIcon filled={a.saved} size={21} />
        </button>
      </div>
      <div className="mt-1">
        <Caption post={post} />
      </div>
      {mine.map((m, k) => (
        <p key={k} className="mt-1 break-words text-[14px]">
          <span className="handle mr-1.5">you</span>
          {m}
        </p>
      ))}
      <form
        className="mt-3 flex items-center gap-2 rounded-full bg-[var(--soft)] px-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--muted)]" placeholder={`Reply to @${i.handle}…`} value={comment} maxLength={300} onChange={(e) => setComment(e.target.value)} onFocus={() => !w.session && need()} aria-label="Add a comment" />
        {comment.trim() && (
          <button type="submit" className="text-[14px] font-semibold text-brand">
            Send
          </button>
        )}
      </form>
      <PostMenu post={post} open={menu} onClose={() => setMenu(false)} isOwner={w.session === i.owner} />
    </article>
  );
}
