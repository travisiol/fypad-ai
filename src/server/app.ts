/** Route/page glue: the database, the signed-in wallet, the after() kicks, cron auth. */
import "server-only";
import { after } from "next/server";
import { ENV } from "../config/fypad.ts";
import { providers } from "./ai.ts";
import { db } from "./db.ts";
import type { Db } from "./db.ts";
import { HttpError } from "./errors.ts";
import { runJob } from "./jobs.ts";
import { currentAddress } from "./session.ts";
import { runTick, tickDue } from "./tick.ts";

export async function ctx(): Promise<{ db: Db; me: string | null }> {
  const [d, me] = await Promise.all([db(), currentAddress()]);
  return { db: d, me };
}

/** Advances one stage of a job after the response is sent (bounded by the route's maxDuration). */
export function kickJob(d: Db, id: string) {
  after(async () => {
    try {
      await runJob(d, id, providers());
    } catch {
      // the next poll or tick retries
    }
  });
}

/** Runs a tick after the response when the last one is old enough (page visits, never a loop). */
export function kickTick(d: Db) {
  after(async () => {
    try {
      if (await tickDue(d)) await runTick(d, { prov: providers() });
    } catch {
      // the cron or the next visit retries
    }
  });
}

/** Cron routes: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends it). */
export function assertCron(request: Request) {
  const secret = ENV.cronSecret();
  const got = request.headers.get("authorization") ?? "";
  if (!secret || got !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorised.");
}
