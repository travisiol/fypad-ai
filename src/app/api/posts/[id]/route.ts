import { ctx } from "@/server/app";
import { assertSameOrigin, handle } from "@/server/http";
import { deletePost } from "@/server/influencers";

/** The influencer's owner deletes a post. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    await deletePost(db, me, id);
    return Response.json({ ok: true });
  });
}
