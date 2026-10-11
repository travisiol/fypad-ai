import { providers } from "@/server/ai";
import { assertCron } from "@/server/app";
import { db } from "@/server/db";
import { handle } from "@/server/http";
import { runTick } from "@/server/tick";

export const maxDuration = 300;

/**
 * Cron (Bearer CRON_SECRET): one tick — coin stats, due auto-posts, job stages, replies.
 * Test rigs only: with FYPAD_ALLOW_CLOCK_OVERRIDE=1, `?at=<epoch ms>` runs the tick as if it were
 * that time (how `npm run play` proves "a day later the influencer posts by itself"). Never set it
 * in production.
 */
export async function GET(request: Request) {
  return handle(async () => {
    assertCron(request);
    const at = Number(new URL(request.url).searchParams.get("at"));
    const override = process.env["FYPAD_ALLOW_CLOCK_OVERRIDE"] === "1" && Number.isFinite(at) && at > 0;
    return Response.json(await runTick(await db(), override ? { prov: providers(), now: at, force: true } : { prov: providers() }));
  });
}
