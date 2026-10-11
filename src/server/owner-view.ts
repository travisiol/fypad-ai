/** The creator's own view of one influencer (create flow, manage panel): every field, posts, jobs, coin. */
import type { Db } from "./db.ts";
import type { InfluencerRow } from "./influencers.ts";
import { ownedInfluencer, postsOf } from "./influencers.ts";
import type { JobView } from "./jobs.ts";
import { jobView, openJobFor, toJob } from "./jobs.ts";
import type { LaunchView } from "./launch.ts";
import { activeLaunchFor, launchAvailability, launchView } from "./launch.ts";
import { mediaUrl } from "./media.ts";

export interface OwnerInfluencer {
  id: string;
  status: InfluencerRow["status"];
  handle: string;
  displayName: string;
  idea: string;
  niches: string[];
  vibe: string;
  bio: string;
  personality: string;
  voice: string;
  themes: string[];
  look: string;
  avatar: string | null;
  paused: boolean;
  nextIdea: string;
  posts: { id: string; slot: number; caption: string; hashtags: string[]; image: string | null; status: string }[];
  job: JobView | null;
  launch: LaunchView | null;
  launching: { ok: boolean; cluster: string };
}

export async function ownerView(db: Db, me: string | null, id: string): Promise<OwnerInfluencer> {
  const i = await ownedInfluencer(db, me, id);
  const posts = await postsOf(db, i.id, i.status === "draft" ? "draft" : "live", 12);
  let job = await openJobFor(db, i.id, ["create", "portrait", "posts", "post"]);
  if (!job) {
    const last = await db.query("SELECT * FROM jobs WHERE influencer_id = $1 AND kind <> 'post' ORDER BY created_at DESC LIMIT 1", [i.id]);
    job = last[0] ? toJob(last[0]) : null;
  }
  const l = await activeLaunchFor(db, i.id);
  const a = launchAvailability();
  return {
    id: i.id,
    status: i.status,
    handle: i.handle,
    displayName: i.displayName,
    idea: i.idea,
    niches: i.niches,
    vibe: i.vibe,
    bio: i.bio,
    personality: i.personality,
    voice: i.voice,
    themes: i.themes,
    look: i.look,
    avatar: mediaUrl(i.portraitMediaId),
    paused: i.paused,
    nextIdea: i.nextIdea,
    posts: posts.map((p) => ({ id: p.id, slot: p.slot, caption: p.caption, hashtags: p.hashtags, image: mediaUrl(p.imageMediaId), status: p.status })),
    job: job ? jobView(job) : null,
    launch: l ? launchView(l) : null,
    launching: { ok: a.ok, cluster: a.cluster },
  };
}
