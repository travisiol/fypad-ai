import { ctx } from "@/server/app";
import { HttpError } from "@/server/errors";
import { buildCollect, recordCollect } from "@/server/fees";
import { assertSameOrigin, handle, readJson } from "@/server/http";

export const maxDuration = 60;
type P = { params: Promise<{ id: string; action: string }> };

/** collect (build the permissionless sweep + distribute / collect transaction) · collected (record it once confirmed) */
export async function POST(request: Request, { params }: P) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id, action } = await params;
    const { db, me } = await ctx();
    if (action === "collect") return Response.json(await buildCollect(db, me, id));
    if (action === "collected") {
      const body = await readJson<{ signature?: string }>(request);
      return Response.json(await recordCollect(db, me, id, body.signature));
    }
    throw new HttpError(404, "Unknown action.");
  });
}
