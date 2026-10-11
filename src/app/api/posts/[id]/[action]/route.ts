import { ctx } from "@/server/app";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { addComment, setLike, setSave } from "@/server/social";

type P = { params: Promise<{ id: string; action: string }> };

/** like · save · comment (signed-in wallets) */
export async function POST(request: Request, { params }: P) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id, action } = await params;
    const { db, me } = await ctx();
    const body = await readJson<{ on?: boolean; body?: string }>(request).catch(() => ({}) as { on?: boolean; body?: string });
    switch (action) {
      case "like":
        return Response.json(await setLike(db, me, id, body.on !== false));
      case "save":
        return Response.json(await setSave(db, me, id, body.on !== false));
      case "comment":
        return Response.json({ comment: await addComment(db, me, id, body.body) });
      default:
        throw new HttpError(404, "Unknown action.");
    }
  });
}
