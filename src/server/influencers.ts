/**
 * Influencers and their posts: drafts (generated, editable), publication (draft → live with its three
 * first posts), owner controls (bio, pause, next post idea, delete a post).
 */
import { randomUUID } from "node:crypto";
import { BIO_MAX, CAPTION_MAX, INTRO_POSTS, NICHES } from "../config/fypad.ts";
import type { Db, Q } from "./db.ts";
import { num } from "./db.ts";
import { HttpError } from "./errors.ts";
import type { Persona } from "./personas.ts";
import { cleanHashtags, normalizeHandle, validHandle } from "./personas.ts";

export type InfluencerStatus = "draft" | "live" | "discarded";

export interface InfluencerRow {
  id: string;
  owner: string;
  status: InfluencerStatus;
  handle: string;
  displayName: string;
  idea: string;
  niches: string[];
  vibe: string;
  bio: string;
  personality: string;
  voice: string;
  themes: string[];
  look: string;
  portraitMediaId: string | null;
  paused: boolean;
  nextIdea: string;
  lastAutoPostAt: number | null;
  lastFreePostAt: number | null;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
}

export interface PostRow {
  id: string;
  influencerId: string;
  status: "draft" | "live" | "deleted";
  kind: "intro" | "auto" | "manual";
  slot: number;
  caption: string;
  hashtags: string[];
  scene: string;
  imageMediaId: string | null;
  mcapAt: number | null;
  paid: boolean;
  createdAt: number;
  publishedAt: number | null;
}

const arr = (v: unknown): string[] => {
  try {
    const a = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};
const optNum = (v: unknown) => (v === null || v === undefined ? null : num(v));

export function toInfluencer(r: Record<string, unknown>): InfluencerRow {
  return {
    id: String(r.id),
    owner: String(r.owner),
    status: r.status as InfluencerStatus,
    handle: String(r.handle ?? ""),
    displayName: String(r.display_name ?? ""),
    idea: String(r.idea ?? ""),
    niches: arr(r.niches),
    vibe: String(r.vibe ?? ""),
    bio: String(r.bio ?? ""),
    personality: String(r.personality ?? ""),
    voice: String(r.voice ?? ""),
    themes: arr(r.themes),
    look: String(r.look ?? ""),
    portraitMediaId: (r.portrait_media_id as string) ?? null,
    paused: num(r.paused) === 1,
    nextIdea: String(r.next_idea ?? ""),
    lastAutoPostAt: optNum(r.last_auto_post_at),
    lastFreePostAt: optNum(r.last_free_post_at),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    publishedAt: optNum(r.published_at),
  };
}

export function toPost(r: Record<string, unknown>): PostRow {
  return {
    id: String(r.id),
    influencerId: String(r.influencer_id),
    status: r.status as PostRow["status"],
    kind: r.kind as PostRow["kind"],
    slot: num(r.slot),
    caption: String(r.caption ?? ""),
    hashtags: arr(r.hashtags),
    scene: String(r.scene ?? ""),
    imageMediaId: (r.image_media_id as string) ?? null,
    mcapAt: r.mcap_at === null || r.mcap_at === undefined ? null : Number(r.mcap_at),
    paid: num(r.paid) === 1,
    createdAt: num(r.created_at),
    publishedAt: optNum(r.published_at),
  };
}

export const personaOf = (i: InfluencerRow): Persona => ({ displayName: i.displayName, handle: i.handle, bio: i.bio, personality: i.personality, voice: i.voice, themes: i.themes, look: i.look });

export async function getInfluencer(q: Q, id: string): Promise<InfluencerRow | null> {
  const rows = await q.query("SELECT * FROM influencers WHERE id = $1", [id]);
  return rows[0] ? toInfluencer(rows[0]) : null;
}

export async function liveByHandle(q: Q, handle: string): Promise<InfluencerRow | null> {
  const rows = await q.query("SELECT * FROM influencers WHERE handle = $1 AND status = 'live'", [handle.toLowerCase()]);
  return rows[0] ? toInfluencer(rows[0]) : null;
}

export async function getPost(q: Q, id: string): Promise<PostRow | null> {
  const rows = await q.query("SELECT * FROM posts WHERE id = $1", [id]);
  return rows[0] ? toPost(rows[0]) : null;
}

export async function postsOf(q: Q, influencerId: string, status: PostRow["status"] = "live", limit = 60): Promise<PostRow[]> {
  const order = status === "draft" ? "slot ASC" : "published_at DESC";
  return (await q.query(`SELECT * FROM posts WHERE influencer_id = $1 AND status = $2 ORDER BY ${order} LIMIT $3`, [influencerId, status, limit])).map(toPost);
}

export async function ownedInfluencer(q: Q, owner: string | null, id: string): Promise<InfluencerRow> {
  if (!owner) throw new HttpError(401, "Sign in with your wallet first.");
  const i = await getInfluencer(q, String(id ?? ""));
  if (!i || i.status === "discarded") throw new HttpError(404, "Influencer not found.");
  if (i.owner !== owner) throw new HttpError(403, "Only this influencer's creator can do this.");
  return i;
}

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const clipLines = (v: unknown, max: number) =>
  String(v ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);

// ───────────────────────────── drafts

export interface BriefInput {
  idea?: unknown;
  niches?: unknown;
  vibe?: unknown;
}

export function cleanBrief(input: BriefInput) {
  const idea = clip(input.idea, 300);
  if (idea.length < 8) throw new HttpError(400, "Describe your influencer in one sentence.");
  const niches = (Array.isArray(input.niches) ? input.niches : []).map(String).filter((n) => (NICHES as readonly string[]).includes(n)).slice(0, 3);
  return { idea, niches, vibe: clip(input.vibe, 160) };
}

export async function createDraft(q: Q, owner: string, input: BriefInput, now = Date.now()): Promise<InfluencerRow> {
  const b = cleanBrief(input);
  const id = `i_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await q.query("INSERT INTO influencers (id, owner, status, idea, niches, vibe, created_at, updated_at) VALUES ($1,$2,'draft',$3,$4,$5,$6,$6)", [id, owner, b.idea, JSON.stringify(b.niches), b.vibe, now]);
  return (await getInfluencer(q, id))!;
}

/** Applies a persona (from the model) to a draft, with a handle that is free among live influencers. */
export async function applyPersona(q: Q, id: string, p: Persona, now = Date.now()) {
  const handle = await freeHandle(q, p.handle, id);
  await q.query(
    "UPDATE influencers SET display_name = $2, handle = $3, bio = $4, personality = $5, voice = $6, themes = $7, look = $8, updated_at = $9 WHERE id = $1 AND status = 'draft'",
    [id, p.displayName, handle, p.bio, p.personality, p.voice, JSON.stringify(p.themes), p.look, now],
  );
}

export async function handleTaken(q: Q, handle: string, exceptId: string | null = null): Promise<boolean> {
  const rows = await q.query("SELECT id FROM influencers WHERE handle = $1 AND status = 'live'", [handle]);
  return rows.some((r) => String(r.id) !== exceptId);
}

export async function freeHandle(q: Q, wanted: string, exceptId: string | null): Promise<string> {
  let base = normalizeHandle(wanted);
  if (!validHandle(base)) base = normalizeHandle(`${base}.ai`);
  if (!validHandle(base)) base = "influencer";
  if (!(await handleTaken(q, base, exceptId))) return base;
  for (let i = 2; i < 500; i++) {
    const h = `${base.slice(0, 20)}${i}`;
    if (validHandle(h) && !(await handleTaken(q, h, exceptId))) return h;
  }
  return `${base.slice(0, 14)}${Date.now().toString(36).slice(-6)}`;
}

export interface DraftEdit {
  displayName?: unknown;
  handle?: unknown;
  bio?: unknown;
  personality?: unknown;
  voice?: unknown;
  look?: unknown;
  themes?: unknown;
  posts?: { id?: unknown; caption?: unknown; hashtags?: unknown }[];
}

/** The owner edits any text of a draft (and the captions of its draft posts). */
export async function editDraft(db: Db, owner: string | null, id: string, e: DraftEdit, now = Date.now()): Promise<InfluencerRow> {
  const i = await ownedInfluencer(db, owner, id);
  if (i.status !== "draft") throw new HttpError(409, "This influencer is already live.");
  const next = {
    displayName: e.displayName !== undefined ? clip(e.displayName, 28) : i.displayName,
    handle: e.handle !== undefined ? normalizeHandle(e.handle) : i.handle,
    bio: e.bio !== undefined ? clipLines(e.bio, BIO_MAX) : i.bio,
    personality: e.personality !== undefined ? clip(e.personality, 240) : i.personality,
    voice: e.voice !== undefined ? clip(e.voice, 220) : i.voice,
    look: e.look !== undefined ? clip(e.look, 400) : i.look,
    themes: Array.isArray(e.themes) ? e.themes.map((t) => clip(t, 60)).filter(Boolean).slice(0, 5) : i.themes,
  };
  if (e.displayName !== undefined && next.displayName.length < 2) throw new HttpError(400, "The name needs at least 2 characters.");
  if (e.handle !== undefined) {
    if (!validHandle(next.handle)) throw new HttpError(400, "Usernames are 3–24 lowercase letters, numbers, dots or underscores.");
    if (await handleTaken(db, next.handle, i.id)) throw new HttpError(409, `@${next.handle} is taken. Try another username.`);
  }
  await db.query("UPDATE influencers SET display_name = $2, handle = $3, bio = $4, personality = $5, voice = $6, look = $7, themes = $8, updated_at = $9 WHERE id = $1", [
    i.id,
    next.displayName,
    next.handle,
    next.bio,
    next.personality,
    next.voice,
    next.look,
    JSON.stringify(next.themes),
    now,
  ]);
  for (const p of e.posts ?? []) {
    const caption = clipLines(p.caption, CAPTION_MAX);
    if (!caption) continue;
    await db.query("UPDATE posts SET caption = $3, hashtags = $4 WHERE id = $1 AND influencer_id = $2 AND status = 'draft'", [String(p.id ?? ""), i.id, caption, JSON.stringify(cleanHashtags(p.hashtags))]);
  }
  return (await getInfluencer(db, i.id))!;
}

/** Draft → live: the handle is checked again, the three first posts go live. Idempotent for a live influencer. */
export async function publishInfluencer(db: Db, owner: string | null, id: string, now = Date.now()): Promise<InfluencerRow> {
  const i = await ownedInfluencer(db, owner, id);
  if (i.status === "live") return i;
  if (!i.portraitMediaId || i.displayName.length < 2) throw new HttpError(409, "Generate the influencer first.");
  const drafts = await postsOf(db, i.id, "draft", 10);
  if (drafts.length < INTRO_POSTS || drafts.some((p) => !p.imageMediaId)) throw new HttpError(409, "Wait for the first posts to finish.");
  if (!validHandle(i.handle)) throw new HttpError(400, "Choose a valid username first.");
  try {
    await db.tx(async (q) => {
      if (await handleTaken(q, i.handle, i.id)) throw new HttpError(409, `@${i.handle} is taken. Choose another username.`);
      await q.query("UPDATE influencers SET status = 'live', published_at = $2, last_auto_post_at = $2, last_free_post_at = $2, updated_at = $2 WHERE id = $1 AND status = 'draft'", [i.id, now]);
      for (const p of drafts) await q.query("UPDATE posts SET status = 'live', published_at = $2 WHERE id = $1", [p.id, now - (drafts.length - 1 - p.slot) * 60_000]);
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(409, `@${i.handle} was just taken. Choose another username.`);
  }
  return (await getInfluencer(db, i.id))!;
}

export async function discardDraft(db: Db, owner: string | null, id: string, now = Date.now()) {
  const i = await ownedInfluencer(db, owner, id);
  if (i.status !== "draft") throw new HttpError(409, "Only a draft can be discarded.");
  await db.query("UPDATE influencers SET status = 'discarded', updated_at = $2 WHERE id = $1", [i.id, now]);
}

// ───────────────────────────── owner controls (live)

export interface ProfileEdit {
  bio?: unknown;
  paused?: unknown;
  nextIdea?: unknown;
}

export async function editProfile(db: Db, owner: string | null, id: string, e: ProfileEdit, now = Date.now()): Promise<InfluencerRow> {
  const i = await ownedInfluencer(db, owner, id);
  if (i.status !== "live") throw new HttpError(409, "Publish the influencer first.");
  const bio = e.bio !== undefined ? clipLines(e.bio, BIO_MAX) : i.bio;
  if (bio.length < 2) throw new HttpError(400, "The bio cannot be empty.");
  const paused = e.paused !== undefined ? Boolean(e.paused) : i.paused;
  const nextIdea = e.nextIdea !== undefined ? clip(e.nextIdea, 300) : i.nextIdea;
  await db.query("UPDATE influencers SET bio = $2, paused = $3, next_idea = $4, updated_at = $5 WHERE id = $1", [i.id, bio, paused ? 1 : 0, nextIdea, now]);
  return (await getInfluencer(db, i.id))!;
}

export async function deletePost(db: Db, owner: string | null, postId: string): Promise<void> {
  const p = await getPost(db, String(postId ?? ""));
  if (!p || p.status === "deleted") throw new HttpError(404, "Post not found.");
  const i = await ownedInfluencer(db, owner, p.influencerId);
  await db.query("UPDATE posts SET status = 'deleted' WHERE id = $1 AND influencer_id = $2", [p.id, i.id]);
}

export async function liveInfluencers(q: Q, limit = 500): Promise<InfluencerRow[]> {
  return (await q.query("SELECT * FROM influencers WHERE status = 'live' ORDER BY published_at DESC LIMIT $1", [limit])).map(toInfluencer);
}
