/** Owner notifications (followers, comments, likes, fee distributions, coin milestones, replies). Idempotent by key. */
import type { Q } from "./db.ts";
import { num } from "./db.ts";

export type NotificationKind = "follow" | "comment" | "like" | "distribution" | "milestone" | "reply" | "post";

export interface NotificationInput {
  recipient: string;
  kind: NotificationKind;
  influencerId?: string | null;
  postId?: string | null;
  actor?: string | null;
  lamports?: bigint | null;
  text?: string;
  key: string;
}

export async function notify(q: Q, n: NotificationInput, now = Date.now()): Promise<void> {
  if (n.actor && n.actor === n.recipient && n.kind !== "distribution" && n.kind !== "milestone") return; // no self-notifications
  await q.query(
    `INSERT INTO notifications (recipient, kind, influencer_id, post_id, actor, lamports, text, idempotency_key, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING`,
    [n.recipient, n.kind, n.influencerId ?? null, n.postId ?? null, n.actor ?? null, n.lamports ?? null, (n.text ?? "").slice(0, 300), n.key, now],
  );
}

export interface NotificationRow {
  id: number;
  kind: NotificationKind;
  influencerId: string | null;
  postId: string | null;
  actor: string | null;
  lamports: string | null;
  text: string;
  createdAt: number;
}

export async function notificationsFor(q: Q, recipient: string, limit = 80): Promise<NotificationRow[]> {
  const rows = await q.query("SELECT * FROM notifications WHERE recipient = $1 ORDER BY created_at DESC, id DESC LIMIT $2", [recipient, limit]);
  return rows.map((r) => ({
    id: num(r.id),
    kind: r.kind as NotificationKind,
    influencerId: (r.influencer_id as string) ?? null,
    postId: (r.post_id as string) ?? null,
    actor: (r.actor as string) ?? null,
    lamports: r.lamports === null || r.lamports === undefined ? null : String(r.lamports),
    text: String(r.text ?? ""),
    createdAt: num(r.created_at),
  }));
}
