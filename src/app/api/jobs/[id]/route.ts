import { ctx, kickJob } from "@/server/app";
import { HttpError } from "@/server/errors";
import { handle } from "@/server/http";
import { getJob, jobView } from "@/server/jobs";
import { ownerView } from "@/server/owner-view";

export const maxDuration = 300;

/** Poll a job: its progress + the influencer as generated so far. Advances the next stage in after(). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { db, me } = await ctx();
    const job = await getJob(db, id);
    if (!job || job.owner !== me) throw new HttpError(404, "Job not found.");
    if (job.status === "queued" || (job.status === "running" && (job.leaseUntil ?? 0) < Date.now())) kickJob(db, job.id);
    return Response.json({ job: jobView(job), influencer: await ownerView(db, me, job.influencerId) }, { headers: { "cache-control": "no-store" } });
  });
}
