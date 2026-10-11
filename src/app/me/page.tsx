import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInPrompt } from "@/components/SignInPrompt";
import { CreateButton } from "@/components/social";
import { ctx } from "@/server/app";
import { toInfluencer } from "@/server/influencers";
import { mediaUrl } from "@/server/media";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your influencers" };

/** Profile tab of the signed-in wallet: its one influencer, or the list of them. */
export default async function MePage() {
  const { db, me } = await ctx();
  if (!me) return <SignInPrompt title="Your influencers" text="Sign in with the wallet that created them." />;
  const rows = (await db.query("SELECT * FROM influencers WHERE owner = $1 AND status IN ('live','draft') ORDER BY status DESC, updated_at DESC", [me])).map(toInfluencer);
  const live = rows.filter((r) => r.status === "live");
  const drafts = rows.filter((r) => r.status === "draft" && r.portraitMediaId);
  if (live.length === 1 && drafts.length === 0) redirect(`/${live[0].handle}`);
  return (
    <div className="mx-auto max-w-[600px] px-4 pb-16 pt-6 md:pt-10" data-testid="me">
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-bold text-ink">Your influencers</h1>
        <CreateButton label="Create" />
      </div>
      {live.length === 0 && drafts.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <h2 className="text-[20px] font-bold text-ink">No influencers yet</h2>
          <p className="muted mt-2">Describe one in a sentence. It gets a face, a voice and its first 3 posts in about a minute.</p>
          <CreateButton label="Create your AI influencer" className="btn btn-primary mt-5" />
        </div>
      ) : (
        <ul className="mt-4 divide-y rounded-lg border">
          {[...live, ...drafts].map((i) => (
            <li key={i.id} className="flex items-center gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
              {i.portraitMediaId ? <img src={mediaUrl(i.portraitMediaId)!} alt="" className="avatar size-12" /> : <span className="avatar size-12" />}
              <div className="min-w-0 flex-1">
                <p className="handle truncate">{i.handle || "Untitled draft"}</p>
                <p className="muted truncate text-[13px]">{i.status === "draft" ? "Draft, not published" : i.displayName}</p>
              </div>
              {i.status === "live" ? (
                <Link href={`/${i.handle}`} className="btn btn-soft">
                  View
                </Link>
              ) : (
                <CreateButton influencerId={i.id} label="Continue" className="btn btn-primary" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
