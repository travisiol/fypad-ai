import { ENV } from "@/config/fypad";
import { SITE } from "@/config/site";
import { serverCluster } from "@/config/solana";
import { db } from "@/server/db";
import { launchAvailability } from "@/server/launch";

export const dynamic = "force-dynamic";

/** Operator health: storage, cluster, and which integrations are configured (no secret values). */
export async function GET() {
  let storage = "unavailable";
  let driver = "none";
  let influencers = 0;
  try {
    const d = await db();
    driver = d.info.driver;
    storage = d.info.persistent ? "durable" : "ephemeral";
    influencers = Number((await d.query("SELECT COUNT(*) AS n FROM influencers WHERE status = 'live'"))[0]?.n ?? 0);
  } catch {
    // database unreachable: reported below
  }
  return Response.json(
    {
      ok: storage !== "unavailable",
      name: SITE.name,
      cluster: serverCluster(),
      database: driver,
      storage,
      media: ENV.blobToken() ? "vercel-blob" : "local-disk",
      ai: Boolean(ENV.openaiKey()),
      launching: launchAvailability().ok,
      cron: Boolean(ENV.cronSecret()),
      liveInfluencers: influencers,
      at: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
