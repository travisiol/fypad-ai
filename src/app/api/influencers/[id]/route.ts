import { ctx } from "@/server/app";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import type { DraftEdit, ProfileEdit } from "@/server/influencers";
import { discardDraft, editDraft, editProfile, ownedInfluencer } from "@/server/influencers";
import { ownerView } from "@/server/owner-view";

type P = { params: Promise<{ id: string }> };

/** The creator's view of one influencer (draft or live). */
export async function GET(_: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params;
    const { db, me } = await ctx();
    return Response.json({ influencer: await ownerView(db, me, id) }, { headers: { "cache-control": "no-store" } });
  });
}

/** Edit: any text of a draft; bio / pause / next post idea of a live influencer. */
export async function PATCH(request: Request, { params }: P) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    const body = await readJson<DraftEdit & ProfileEdit>(request);
    const i = await ownedInfluencer(db, me, id);
    if (i.status === "draft") await editDraft(db, me, id, body);
    else await editProfile(db, me, id, body);
    return Response.json({ influencer: await ownerView(db, me, id) });
  });
}

/** Discard a draft. */
export async function DELETE(request: Request, { params }: P) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    await discardDraft(db, me, id);
    return Response.json({ ok: true });
  });
}
