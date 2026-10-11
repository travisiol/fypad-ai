import { SITE } from "@/config/site";
import { db } from "@/server/db";
import { getInfluencer } from "@/server/influencers";
import { getLaunch } from "@/server/launch";

/** The token metadata JSON the on-chain URI points to (Metaplex-style fields pump.fun reads). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await db();
  const l = await getLaunch(d, id);
  if (!l) return Response.json({ error: "Not found" }, { status: 404 });
  const i = await getInfluencer(d, l.influencerId);
  const base = SITE.url.replace(/\/+$/, "");
  return Response.json(
    {
      name: l.name,
      symbol: l.ticker,
      description: `${l.description} (AI influencer created on FYPAD.)`,
      image: i?.portraitMediaId ? `${base}/api/media/${i.portraitMediaId}` : undefined,
      showName: true,
      createdOn: base,
      ...(l.links.x ? { twitter: l.links.x } : {}),
      ...(l.links.telegram ? { telegram: l.links.telegram } : {}),
      website: l.links.website ?? (i?.handle ? `${base}/${i.handle}` : base),
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
