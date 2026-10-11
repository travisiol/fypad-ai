import { ctx, kickJob } from "@/server/app";
import { providers } from "@/server/ai";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { createDraft } from "@/server/influencers";
import { jobView, submitJob } from "@/server/jobs";

export const maxDuration = 300;

/** Describe → a draft influencer + its first generation job (persona, photo, three posts). */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { db, me } = await ctx();
    if (!me) throw new HttpError(401, "Sign in with your wallet first.");
    if (!providers().available) throw new HttpError(503, "Creating influencers is not open yet.");
    const body = await readJson<{ idea?: string; niches?: string[]; vibe?: string; key?: string }>(request);
    const key = String(body.key ?? "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new HttpError(400, "Missing request key.");
    const existing = await db.query("SELECT influencer_id FROM jobs WHERE owner = $1 AND idempotency_key = $2", [me, `create:${key}`]);
    const influencerId = existing[0] ? String(existing[0].influencer_id) : (await createDraft(db, me, body)).id;
    const { job } = await submitJob(db, me, { influencerId, kind: "create", idempotencyKey: `create:${key}` });
    kickJob(db, job.id);
    return Response.json({ influencerId, job: jobView(job) });
  });
}
