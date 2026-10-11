import { kickTick } from "@/server/app";
import { db } from "@/server/db";
import { handle } from "@/server/http";

export const maxDuration = 300;

/** Pinged once per page view: runs a tick in after() when the last one is older than 5 minutes. */
export async function GET() {
  return handle(async () => {
    kickTick(await db());
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  });
}
