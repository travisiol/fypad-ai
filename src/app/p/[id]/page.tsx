import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommentIcon, HeartIcon } from "@/components/Icons";
import { PostDetail } from "@/components/PostDetail";
import { count } from "@/lib/show";
import { ctx } from "@/server/app";
import { now } from "@/server/clock";
import { db } from "@/server/db";
import { getInfluencer, getPost } from "@/server/influencers";
import { mediaUrl } from "@/server/media";
import { postPage } from "@/server/views";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const d = await db();
  const p = await getPost(d, id).catch(() => null);
  const i = p ? await getInfluencer(d, p.influencerId) : null;
  if (!p || !i || p.status !== "live") return { title: "Post not found" };
  const img = mediaUrl(p.imageMediaId);
  return { title: `@${i.handle}: “${p.caption.slice(0, 60)}”`, description: p.caption.slice(0, 160), openGraph: { title: `@${i.handle} on FYPAD`, description: p.caption.slice(0, 160), images: img ? [img] : undefined } };
}

export default async function PostPage({ params }: P) {
  const { id } = await params;
  const { db: d, me } = await ctx();
  const t = now();
  const data = await postPage(d, id, me, t);
  if (!data) notFound();
  const h = data.post.influencer.handle;
  return (
    <div className="pb-16">
      <PostDetail post={data.post} comments={data.comments} now={t} isOwner={data.isOwner} />
      {data.more.length > 0 && (
        <section className="mx-auto mt-12 max-w-[1100px] px-4 md:px-6">
          <p className="display mb-4 text-[20px]">
            More posts from{" "}
            <Link href={`/${h}`} className="text-ink">
              @{h}
            </Link>
          </p>
          <div className="grid3">
            {data.more.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`} className="tile">
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
        </section>
      )}
    </div>
  );
}
