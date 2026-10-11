import { ctx, kickJob } from "@/server/app";
import { providers } from "@/server/ai";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { ownedInfluencer, publishInfluencer } from "@/server/influencers";
import { jobView, postNow, submitJob } from "@/server/jobs";
import { ownerView } from "@/server/owner-view";
import { setFollow } from "@/server/social";

export const maxDuration = 300;
type P = { params: Promise<{ id: string; action: string }> };

/** publish · regenerate · post-now · follow */
export async function POST(request: Request, { params }: P) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id, action } = await params;
    const { db, me } = await ctx();
    const body = await readJson<{ what?: string; key?: string; on?: boolean }>(request).catch(() => ({}) as { what?: string; key?: string; on?: boolean });
    switch (action) {
      case "publish": {
        await publishInfluencer(db, me, id);
        return Response.json({ influencer: await ownerView(db, me, id) });
      }
      case "regenerate": {
        if (!providers().available) throw new HttpError(503, "Generating is not open yet.");
        const i = await ownedInfluencer(db, me, id);
        const kind = body.what === "portrait" ? "portrait" : body.what === "posts" ? "posts" : "create";
        const key = String(body.key ?? "");
        if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new HttpError(400, "Missing request key.");
        const { job } = await submitJob(db, i.owner, { influencerId: i.id, kind, idempotencyKey: `${kind}:${key}` });
        kickJob(db, job.id);
        return Response.json({ job: jobView(job) });
      }
      case "post-now": {
        if (!providers().available) throw new HttpError(503, "Posting is not open yet.");
        const key = String(body.key ?? "");
        if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new HttpError(400, "Missing request key.");
        const job = await postNow(db, me, id, key);
        kickJob(db, job.id);
        return Response.json({ job: jobView(job) });
      }
      case "follow":
        return Response.json(await setFollow(db, me, id, body.on !== false));
      default:
        throw new HttpError(404, "Unknown action.");
    }
  });
}
