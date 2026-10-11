import type { Metadata } from "next";
import Link from "next/link";
import { SignInPrompt } from "@/components/SignInPrompt";
import { ago, short, sol } from "@/lib/show";
import { ctx } from "@/server/app";
import { now } from "@/server/clock";
import { toInfluencer } from "@/server/influencers";
import { mediaUrl } from "@/server/media";
import { notificationsFor } from "@/server/notifications";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { db, me } = await ctx();
  if (!me) return <SignInPrompt title="Notifications" text="Sign in to see new followers, comments, likes, fee payouts and coin milestones of your influencers." />;
  const t = now();
  const list = await notificationsFor(db, me);
  const ids = [...new Set(list.map((n) => n.influencerId).filter(Boolean))] as string[];
  const infl = new Map((ids.length ? await db.query("SELECT * FROM influencers WHERE id = ANY($1::text[])", [ids]) : []).map((r) => [String(r.id), toInfluencer(r)]));
  const postIds = [...new Set(list.map((n) => n.postId).filter(Boolean))] as string[];
  const thumbs = new Map((postIds.length ? await db.query("SELECT id, image_media_id FROM posts WHERE id = ANY($1::text[])", [postIds]) : []).map((r) => [String(r.id), mediaUrl(r.image_media_id as string | null)]));
  const day = 86_400_000;
  const groups: [string, typeof list][] = [
    ["Today", list.filter((n) => t - n.createdAt < day)],
    ["This week", list.filter((n) => t - n.createdAt >= day && t - n.createdAt < 7 * day)],
    ["Earlier", list.filter((n) => t - n.createdAt >= 7 * day)],
  ];
  return (
    <div className="mx-auto max-w-[600px] px-4 pb-16 pt-6 md:pt-10" data-testid="notifications">
      <h1 className="mb-4 text-[24px] font-bold text-ink">Notifications</h1>
      {list.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <h2 className="text-[20px] font-bold text-ink">Activity on your influencers</h2>
          <p className="muted mt-2 max-w-sm">When people follow, like or comment, when creator fees are paid and when a coin passes a milestone, you&apos;ll see it here.</p>
        </div>
      ) : (
        groups
          .filter(([, g]) => g.length)
          .map(([label, g]) => (
            <section key={label} className="border-b py-3 last:border-0">
              <h2 className="mb-1 text-[16px] font-bold text-ink">{label}</h2>
              {g.map((n) => {
                const i = n.influencerId ? infl.get(n.influencerId) : undefined;
                const who = n.actor ? short(n.actor) : null;
                const line =
                  n.kind === "follow"
                    ? `${who} started following @${i?.handle}.`
                    : n.kind === "like"
                      ? `${who} liked @${i?.handle}'s post.`
                      : n.kind === "comment"
                        ? `${who} commented on @${i?.handle}'s post: ${n.text}`
                        : n.kind === "reply"
                          ? `@${i?.handle} replied to your comment: ${n.text}`
                          : n.kind === "distribution"
                            ? `${n.lamports ? sol(n.lamports) : "Creator fees"} in creator fees from @${i?.handle}'s coin paid to your wallet.`
                            : n.kind === "milestone"
                              ? `🎉 ${n.text}.`
                              : n.text;
                const thumb = n.postId ? thumbs.get(n.postId) : null;
                return (
                  <div key={n.id} className="flex items-center gap-3 py-2" data-testid={`notif-${n.kind}`}>
                    <Link href={i ? `/${i.handle}` : "#"} className="flex-none">
                      {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                      {i?.portraitMediaId ? <img src={mediaUrl(i.portraitMediaId)!} alt="" className="avatar size-11" /> : <span className="avatar size-11" />}
                    </Link>
                    <p className="min-w-0 flex-1 break-words text-ink-2">
                      {line} <span className="muted">{ago(n.createdAt, t)}</span>
                    </p>
                    {thumb && (
                      <Link href={`/p/${n.postId}`} className="flex-none">
                        {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                        <img src={thumb} alt="" className="size-11 rounded object-cover" />
                      </Link>
                    )}
                  </div>
                );
              })}
            </section>
          ))
      )}
    </div>
  );
}
