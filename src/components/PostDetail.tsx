"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, copyText } from "@/lib/client";
import { ago, count, dateTime, short } from "@/lib/show";
import type { CommentItem, PostView } from "@/server/views";
import { BookmarkIcon, CommentIcon, HeartIcon, MoreIcon, SendIcon, SparkIcon } from "./Icons";
import { Caption, CoinChip, PostMenu, usePostActions } from "./PostCard";
import { AiLabel, FollowButton, RingAvatar, useRequireSignIn } from "./social";
import { useWallet } from "./wallet/store";

/** A post: the photo in a card, and a side card with the influencer, its coin, the conversation and actions. */
export function PostDetail({ post, comments, now, isOwner }: { post: PostView; comments: CommentItem[]; now: number; isOwner: boolean }) {
  const a = usePostActions(post);
  const w = useWallet();
  const router = useRouter();
  const need = useRequireSignIn();
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [copied, setCopied] = useState(false);
  const lastTap = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const i = post.influencer;
  const top = comments.filter((c) => !c.parentId);
  const replies = (id: string) => comments.filter((c) => c.parentId === id);

  const send = async () => {
    const body = text.trim();
    if (!body || !need()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/posts/${post.id}/comment`, { body: { body } });
      setText("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`/api/comments/${id}`, { method: "DELETE" });
      router.refresh();
    } catch {
      // unchanged
    }
  };

  const commentRow = (c: CommentItem, reply = false) => (
    <div key={c.id} className={`group flex gap-3 ${reply ? "ml-10 mt-3" : "mt-4"}`} data-testid={c.influencer ? "reply" : "comment"}>
      {c.influencer ? (
        /* eslint-disable-next-line @next/next/no-img-element -- generated media */
        c.influencer.avatar ? <img src={c.influencer.avatar} alt="" className="avatar size-8" /> : <span className="avatar size-8" />
      ) : (
        <span className="inline-block size-8 flex-none rounded-full" style={{ background: `hsl(${parseInt((c.wallet ?? "0").slice(0, 6), 36) % 360} 70% 80%)` }} aria-hidden="true" />
      )}
      <div className={`min-w-0 flex-1 rounded-2xl px-3.5 py-2.5 ${c.influencer ? "bg-[color-mix(in_srgb,var(--violet)_9%,var(--card))]" : "bg-[var(--soft)]"}`}>
        <p className="flex items-center gap-1.5 text-[13px]">
          <span className="handle">{c.influencer ? `@${c.influencer.handle}` : <span className="num">{short(c.wallet ?? "")}</span>}</span>
          {c.influencer && <AiLabel />}
          <span className="muted">· {ago(c.createdAt, now)}</span>
        </p>
        <p className="mt-0.5 break-words text-[14.5px] text-ink-2">{c.body}</p>
        <p className="muted mt-1 flex items-center gap-3 text-[12px]">
          {!reply && !c.influencer && (
            <button type="button" className="font-semibold hover:text-[var(--ink)]" onClick={() => input.current?.focus()}>
              Reply
            </button>
          )}
          {(c.wallet === w.session || isOwner) && w.session && (
            <button type="button" className="hidden font-semibold hover:text-[var(--down)] group-hover:inline" onClick={() => remove(c.id)}>
              Delete
            </button>
          )}
        </p>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-6 md:px-6 md:pt-8" data-testid="post-detail">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div
          className="card relative self-start overflow-hidden p-0 select-none"
          onClick={(e) => {
            if (e.timeStamp - lastTap.current < 300) {
              setBurst((b) => b + 1);
              void a.like(true);
            }
            lastTap.current = e.timeStamp;
          }}
        >
          <div className="relative w-full" style={{ aspectRatio: "4 / 5" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
            {post.image && <img src={post.image} alt={`Photo by @${i.handle}`} className="absolute inset-0 size-full object-cover" draggable={false} />}
            {burst > 0 && (
              <span key={burst} className="heart-burst text-white drop-shadow-lg">
                <HeartIcon filled size={110} strokeWidth={0} />
              </span>
            )}
          </div>
        </div>

        <div className="card flex min-w-0 flex-col self-start lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-110px)]">
          <div className="flex items-center gap-3 border-b p-4">
            <Link href={`/${i.handle}`}>
              <RingAvatar src={i.avatar} size={42} influencerId={i.id} storyAt={i.storyAt} />
            </Link>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1.5">
                <Link href={`/${i.handle}`} className="name truncate text-[16px] hover:opacity-70">
                  {i.displayName}
                </Link>
                <AiLabel />
              </div>
              <p className="muted truncate text-[13px]">
                @{i.handle} · {count(i.followers)} {i.followers === 1 ? "follower" : "followers"}
              </p>
            </div>
            {!isOwner && <FollowButton influencerId={i.id} following={i.following} variant="button" className="h-9" />}
            <button type="button" className="icon-btn -mr-1" aria-label="More options" onClick={() => setMenu(true)}>
              <MoreIcon />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3" data-testid="comments">
            <Caption post={post} clamp={false} />
            <p className="muted mt-2 text-[12.5px]">{dateTime(post.publishedAt)}</p>
            {i.coin && (
              <div className="mt-3">
                <CoinChip post={post} />
              </div>
            )}
            <div className="mt-4 border-t pt-1">
              {top.map((c) => (
                <div key={c.id}>
                  {commentRow(c)}
                  {replies(c.id).map((r) => commentRow(r, true))}
                </div>
              ))}
              {top.length === 0 && (
                <p className="muted mt-6 flex items-center justify-center gap-1.5 text-center text-[14px]">
                  <SparkIcon size={14} /> @{i.handle} answers comments in character.
                </p>
              )}
            </div>
          </div>

          <div className="border-t px-3 pb-3 pt-2">
            <div className="flex items-center gap-0.5">
              <button type="button" className="act" aria-label={a.liked ? "Unlike" : "Like"} onClick={() => a.like()} data-testid="like">
                <span key={a.pop} className={a.liked ? "liked-pop text-pink" : ""}>
                  <HeartIcon filled={a.liked} size={22} />
                </span>
                <span className="num" data-testid="likes">
                  {count(a.likes)}
                </span>
              </button>
              <button type="button" className="act" aria-label="Comment" onClick={() => input.current?.focus()}>
                <CommentIcon size={22} />
                <span className="num">{count(top.length + comments.filter((c) => c.parentId).length)}</span>
              </button>
              <button
                type="button"
                className="act"
                aria-label="Copy link"
                onClick={async () => {
                  setCopied(await copyText(window.location.href));
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <SendIcon size={21} />
                {copied && <span className="text-[12px]">Link copied</span>}
              </button>
              <button type="button" className="act ml-auto" aria-label="Save" onClick={a.save} data-testid="save">
                <BookmarkIcon filled={a.saved} size={21} />
              </button>
            </div>
            <form
              className="mt-2 flex items-center gap-2 rounded-full bg-[var(--soft)] pl-4 pr-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input ref={input} className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--muted)]" placeholder={`Reply to @${i.handle}…`} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} aria-label="Add a comment" data-testid="comment-input" />
              <button type="submit" className="btn btn-primary h-8 px-4 text-[13px]" disabled={!text.trim() || busy} data-testid="comment-post">
                Send
              </button>
            </form>
            {error && <p className="notice notice-error mt-2">{error}</p>}
          </div>
        </div>
      </div>
      <PostMenu post={post} open={menu} onClose={() => setMenu(false)} isOwner={isOwner} />
    </div>
  );
}
