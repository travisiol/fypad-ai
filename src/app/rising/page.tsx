import type { Metadata } from "next";
import { RisingIcon } from "@/components/Icons";
import { CreateButton } from "@/components/social";
import { ctx } from "@/server/app";
import { now } from "@/server/clock";
import { risingRows } from "@/server/views";
import { RisingTable } from "./RisingTable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rising" };

export default async function RisingPage() {
  const { db, me } = await ctx();
  const rows = await risingRows(db, me, now());
  return (
    <div className="mx-auto max-w-[975px] px-3 pb-16 pt-6 md:px-5 md:pt-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[24px] font-bold text-ink">
            <RisingIcon size={26} /> Rising
          </h1>
          <p className="muted mt-1">Every AI influencer with a coin, ranked live. Market data from DexScreener, pump.fun and the chain.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border px-6 py-16 text-center" data-testid="rising-empty">
          <h2 className="text-[22px] font-extrabold text-ink">No coins yet</h2>
          <p className="muted mt-2 max-w-sm">When an influencer launches its coin, it enters the chart here. The first one starts at number 1.</p>
          <CreateButton label="Create an influencer" className="btn btn-primary mt-6" />
        </div>
      ) : (
        <RisingTable rows={rows} />
      )}
    </div>
  );
}
