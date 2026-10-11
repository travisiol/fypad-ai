import { assertCron } from "@/server/app";
import { db } from "@/server/db";
import { syncFees } from "@/server/fees";
import { handle } from "@/server/http";

export const maxDuration = 300;

/** Cron (Bearer CRON_SECRET): records every distribution of every coin with an active split (+ optional operator crank). */
export async function GET(request: Request) {
  return handle(async () => {
    assertCron(request);
    return Response.json(await syncFees(await db()));
  });
}
