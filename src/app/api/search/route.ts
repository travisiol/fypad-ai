import { ctx } from "@/server/app";
import { handle } from "@/server/http";
import { explore } from "@/server/views";

/** Search influencers by @handle, name, $TICKER or contract address. */
export async function GET(request: Request) {
  return handle(async () => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 64);
    const { db, me } = await ctx();
    const { people } = await explore(db, me, q);
    return Response.json(
      { people: people.map((p) => ({ handle: p.handle, displayName: p.displayName, avatar: p.avatar, ticker: p.coin?.ticker ?? null, mcapUsd: p.coin?.stats?.mcapUsd ?? null })) },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
