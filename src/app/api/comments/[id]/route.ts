import { ctx } from "@/server/app";
import { assertSameOrigin, handle } from "@/server/http";
import { deleteComment } from "@/server/social";

/** Delete your own comment (or any comment on your influencer's post). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    await deleteComment(db, me, id);
    return Response.json({ ok: true });
  });
}
