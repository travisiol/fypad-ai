/**
 * AI jobs, serverless-safe: each job is a list of stages and one call advances ONE stage (one model
 * call), so no step outlives a function. queued → running (lease) → queued at the next stage … →
 * succeeded | failed. Kicked by after() on submit, by the creator's polling (GET /api/jobs/<id>),
 * by page-visit ticks and by the cron. A vanished worker's lease expires and the stage is retried.
 *
 *  create   persona → portrait → captions → image:0 → image:1 → image:2   (a draft's first generation)
 *  portrait portrait → image:0 → image:1 → image:2                        (new face, posts redrawn to match)
 *  posts    captions → image:0 → image:1 → image:2                        (three new first posts)
 *  post     write → image                                                  (one live post: auto or "post now")
 */
import { randomUUID } from "node:crypto";
import { CADENCE, GENERATIONS_PER_HOUR, INTRO_POSTS, JOB_LEASE_MS, MAX_JOB_ATTEMPTS } from "../config/fypad.ts";
import type { Img, Providers } from "./ai.ts";
import { ProviderError } from "./ai.ts";
import type { Db, Q } from "./db.ts";
import { num } from "./db.ts";
import { HttpError } from "./errors.ts";
import { spendForPost } from "./fees.ts";
import { compactUsd, stripInventedFigures } from "./figures.ts";
import type { InfluencerRow } from "./influencers.ts";
import { applyPersona, getInfluencer, ownedInfluencer, personaOf, postsOf } from "./influencers.ts";
import { activeLaunchFor } from "./launch.ts";
import { markMilestonesAnnounced, pendingMilestone, readStats } from "./market.ts";
import { getMedia, mediaBytes, putMedia } from "./media.ts";
import type { Facts } from "./personas.ts";
import {
  INTRO_POSTS_SCHEMA,
  PERSONA_SCHEMA,
  PERSONA_SYSTEM,
  POST_SCHEMA,
  factLines,
  introPostsPrompt,
  nextPostPrompt,
  personaPrompt,
  portraitPrompt,
  postImagePrompt,
  validateIntroPosts,
  validatePersona,
  validatePost,
} from "./personas.ts";

export type JobKind = "create" | "portrait" | "posts" | "post";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

const IMAGES = Array.from({ length: INTRO_POSTS }, (_, i) => `image:${i}`);
export const STAGES: Record<JobKind, string[]> = {
  create: ["persona", "portrait", "captions", ...IMAGES],
  portrait: ["portrait", ...IMAGES],
  posts: ["captions", ...IMAGES],
  post: ["write", "image"],
};

export interface JobRow {
  id: string;
  owner: string;
  influencerId: string;
  kind: JobKind;
  stage: string;
  status: JobStatus;
  attempts: number;
  payload: Record<string, unknown>;
  error: string | null;
  idempotencyKey: string;
  leaseUntil: number | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export function toJob(r: Record<string, unknown>): JobRow {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(String(r.payload ?? "{}"));
  } catch {
    payload = {};
  }
  return {
    id: String(r.id),
    owner: String(r.owner),
    influencerId: String(r.influencer_id),
    kind: r.kind as JobKind,
    stage: String(r.stage),
    status: r.status as JobStatus,
    attempts: num(r.attempts),
    payload,
    error: (r.error as string) ?? null,
    idempotencyKey: String(r.idempotency_key),
    leaseUntil: r.lease_until === null || r.lease_until === undefined ? null : num(r.lease_until),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    finishedAt: r.finished_at === null || r.finished_at === undefined ? null : num(r.finished_at),
  };
}

export async function getJob(q: Q, id: string): Promise<JobRow | null> {
  const rows = await q.query("SELECT * FROM jobs WHERE id = $1", [id]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function openJobFor(q: Q, influencerId: string, kinds: JobKind[]): Promise<JobRow | null> {
  const rows = await q.query("SELECT * FROM jobs WHERE influencer_id = $1 AND kind = ANY($2::text[]) AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1", [influencerId, kinds]);
  return rows[0] ? toJob(rows[0]) : null;
}

/** Progress of a job for the UI: stage index / total. */
export function progressOf(j: JobRow): { step: number; total: number; label: string } {
  const stages = STAGES[j.kind];
  const idx = j.status === "succeeded" ? stages.length : Math.max(0, stages.indexOf(j.stage));
  const label =
    j.status === "succeeded"
      ? "Done"
      : j.stage === "persona"
        ? "Writing the persona"
        : j.stage === "portrait"
          ? "Shooting the profile photo"
          : j.stage === "captions" || j.stage === "write"
            ? "Writing captions"
            : j.stage.startsWith("image")
              ? `Shooting post ${j.kind === "post" ? "" : `${Number(j.stage.split(":")[1] ?? 0) + 1} of ${INTRO_POSTS}`}`.trim()
              : j.stage;
  return { step: idx, total: stages.length, label };
}

// ───────────────────────────── submit

export interface SubmitInput {
  influencerId: string;
  kind: JobKind;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

/** Creates a job (or returns the one with the same key). Generation jobs are rate-limited per wallet. */
export async function submitJob(db: Db, owner: string, input: SubmitInput, now = Date.now()): Promise<{ job: JobRow; created: boolean }> {
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(input.idempotencyKey ?? "")) throw new HttpError(400, "Missing request key.");
  const existing = await db.query("SELECT * FROM jobs WHERE owner = $1 AND idempotency_key = $2", [owner, input.idempotencyKey]);
  if (existing[0]) return { job: toJob(existing[0]), created: false };
  const i = await getInfluencer(db, input.influencerId);
  if (!i || i.status === "discarded") throw new HttpError(404, "Influencer not found.");
  if (i.owner !== owner) throw new HttpError(403, "Only this influencer's creator can do this.");
  if (input.kind === "post") {
    if (i.status !== "live") throw new HttpError(409, "Publish the influencer first.");
  } else {
    if (i.status !== "draft") throw new HttpError(409, "This influencer is already live.");
    const recent = num((await db.query("SELECT COUNT(*) AS n FROM jobs WHERE owner = $1 AND kind <> 'post' AND created_at > $2", [owner, now - 3_600_000]))[0]?.n);
    if (recent >= GENERATIONS_PER_HOUR) throw new HttpError(429, `Up to ${GENERATIONS_PER_HOUR} generations an hour. Try again a little later.`);
  }
  const open = await openJobFor(db, i.id, input.kind === "post" ? ["post"] : ["create", "portrait", "posts"]);
  if (open) {
    if (input.kind === "post") throw new HttpError(409, "A post is already being made. Give it a minute.");
    throw new HttpError(409, "A generation is already running for this influencer.");
  }
  if (input.kind !== "post" && input.kind !== "create" && !i.portraitMediaId) throw new HttpError(409, "Generate the influencer first.");
  const id = `j_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  try {
    await db.query(
      `INSERT INTO jobs (id, owner, influencer_id, kind, stage, status, payload, idempotency_key, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$8)`,
      [id, owner, i.id, input.kind, STAGES[input.kind][0], JSON.stringify(input.payload ?? {}), input.idempotencyKey, now],
    );
  } catch {
    const again = await db.query("SELECT * FROM jobs WHERE owner = $1 AND idempotency_key = $2", [owner, input.idempotencyKey]);
    if (again[0]) return { job: toJob(again[0]), created: false };
    throw new HttpError(409, "Another request started at the same time.");
  }
  return { job: (await getJob(db, id))!, created: true };
}

/** "Post now": the owner's manual posts, three per influencer per day. */
export async function postNow(db: Db, owner: string | null, influencerId: string, key: string, now = Date.now()): Promise<JobRow> {
  const i = await ownedInfluencer(db, owner, influencerId);
  if (i.status !== "live") throw new HttpError(409, "Publish the influencer first.");
  const manual = num((await db.query("SELECT COUNT(*) AS n FROM jobs WHERE influencer_id = $1 AND kind = 'post' AND idempotency_key LIKE 'manual:%' AND status <> 'failed' AND created_at > $2", [i.id, now - 86_400_000]))[0]?.n);
  if (manual >= CADENCE.manualPerDay) throw new HttpError(429, `${CADENCE.manualPerDay} manual posts a day. Try again tomorrow.`);
  const { job } = await submitJob(db, i.owner, { influencerId: i.id, kind: "post", idempotencyKey: `manual:${key}`.slice(0, 100), payload: { mode: "manual", paid: false } }, now);
  return job;
}

// ───────────────────────────── running

async function claim(db: Db, id: string, now: number): Promise<JobRow | null> {
  const rows = await db.query(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_until = $2, updated_at = $3
     WHERE id = $1 AND (status = 'queued' OR (status = 'running' AND lease_until < $3))
     RETURNING *`,
    [id, now + JOB_LEASE_MS, now],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

async function advance(db: Db, job: JobRow, payload: Record<string, unknown>, now: number) {
  const stages = STAGES[job.kind];
  const next = stages[stages.indexOf(job.stage) + 1];
  if (next) {
    await db.query("UPDATE jobs SET status = 'queued', stage = $2, attempts = 0, payload = $3, error = NULL, lease_until = NULL, updated_at = $4 WHERE id = $1 AND status = 'running'", [job.id, next, JSON.stringify(payload), now]);
  } else {
    await db.query("UPDATE jobs SET status = 'succeeded', payload = $2, error = NULL, lease_until = NULL, finished_at = $3, updated_at = $3 WHERE id = $1 AND status = 'running'", [job.id, JSON.stringify(payload), now]);
  }
}

async function fail(db: Db, job: JobRow, message: string, now: number) {
  const rows = await db.query("UPDATE jobs SET status = 'failed', error = $2, lease_until = NULL, finished_at = $3, updated_at = $3 WHERE id = $1 AND status IN ('queued','running') RETURNING id", [job.id, message.slice(0, 300), now]);
  if (rows.length && job.kind === "post" && typeof job.payload.postId === "string") await db.query("UPDATE posts SET status = 'deleted' WHERE id = $1 AND status = 'draft'", [job.payload.postId]);
}

async function portraitRef(db: Db, i: InfluencerRow): Promise<Img> {
  const m = i.portraitMediaId ? await getMedia(db, i.portraitMediaId) : null;
  const bytes = m ? await mediaBytes(m) : null;
  if (!m || !bytes) throw new ProviderError("The profile photo file is missing.", false);
  return { mime: m.mime, bytes };
}

/** The live facts a post may cite (coin data from coin_stats, never invented). */
export async function factsFor(db: Db, i: InfluencerRow): Promise<{ facts: Facts; mint: string | null }> {
  const l = await activeLaunchFor(db, i.id);
  const facts: Facts = { ticker: null, mcapUsd: null, change24h: null, holders: null, milestoneUsd: null };
  if (!l || l.status !== "confirmed") return { facts, mint: null };
  facts.ticker = l.ticker;
  const s = (await readStats(db, [l.mint])).get(l.mint);
  if (s) {
    facts.mcapUsd = s.mcapUsd;
    facts.change24h = s.change24h;
    facts.holders = s.holders;
  }
  facts.milestoneUsd = await pendingMilestone(db, l.mint);
  return { facts, mint: l.mint };
}

async function stage(db: Db, job: JobRow, prov: Providers, now: number): Promise<Record<string, unknown>> {
  const i = await getInfluencer(db, job.influencerId);
  if (!i || i.status === "discarded") throw new HttpError(404, "The influencer no longer exists.");
  const payload = { ...job.payload };
  if (!prov.available) throw new ProviderError("Generation is not available right now.", false);

  if (job.stage === "persona") {
    const persona = validatePersona(await prov.json(PERSONA_SYSTEM, personaPrompt({ idea: i.idea, niches: i.niches, vibe: i.vibe }), "influencer_persona", PERSONA_SCHEMA));
    await applyPersona(db, i.id, persona, now);
    return payload;
  }
  if (job.stage === "portrait") {
    const img = await prov.image(portraitPrompt(personaOf(i), i.vibe), [], "1024x1024");
    const media = await putMedia(db, { bytes: img.bytes, mime: img.mime, kind: "image", characterId: i.id, jobId: job.id });
    await db.query("UPDATE influencers SET portrait_media_id = $2, updated_at = $3 WHERE id = $1 AND status = 'draft'", [i.id, media.id, now]);
    return payload;
  }
  if (job.stage === "captions") {
    const { system, user } = introPostsPrompt(personaOf(i));
    const posts = validateIntroPosts(await prov.json(system, user, "first_posts", INTRO_POSTS_SCHEMA));
    const none = { mcapUsd: null, milestoneUsd: null, change24h: null };
    await db.tx(async (q) => {
      await q.query("UPDATE posts SET status = 'deleted' WHERE influencer_id = $1 AND status = 'draft'", [i.id]);
      for (let k = 0; k < posts.length; k++) {
        const caption = stripInventedFigures(posts[k].caption, none) || posts[k].caption.replace(/[$%]/g, "");
        await q.query("INSERT INTO posts (id, influencer_id, status, kind, slot, caption, hashtags, scene, created_at) VALUES ($1,$2,'draft','intro',$3,$4,$5,$6,$7)", [
          `p_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          i.id,
          k,
          caption,
          JSON.stringify(posts[k].hashtags),
          posts[k].scene,
          now,
        ]);
      }
    });
    return payload;
  }
  if (job.stage.startsWith("image:")) {
    const slot = Number(job.stage.split(":")[1]);
    const post = (await postsOf(db, i.id, "draft", 10)).find((p) => p.slot === slot);
    if (!post) throw new HttpError(409, "The post to illustrate is gone.");
    const img = await prov.image(postImagePrompt(personaOf(i), post.scene, i.vibe), [await portraitRef(db, i)], "1024x1536");
    const media = await putMedia(db, { bytes: img.bytes, mime: img.mime, kind: "image", characterId: i.id, jobId: job.id });
    await db.query("UPDATE posts SET image_media_id = $2 WHERE id = $1", [post.id, media.id]);
    return payload;
  }
  if (job.stage === "write") {
    const { facts, mint } = await factsFor(db, i);
    const recent = (await postsOf(db, i.id, "live", 4)).map((p) => p.caption.slice(0, 140));
    const idea = i.nextIdea;
    const { system, user } = nextPostPrompt(personaOf(i), factLines(facts, compactUsd), idea, recent);
    const draft = validatePost(await prov.json(system, user, "post", POST_SCHEMA));
    const caption = stripInventedFigures(draft.caption, facts);
    if (!caption) throw new ProviderError("The caption only held figures that were not in the data.", true);
    const id = typeof payload.postId === "string" ? payload.postId : `p_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await db.query("DELETE FROM posts WHERE id = $1 AND status = 'draft'", [id]);
    await db.query("INSERT INTO posts (id, influencer_id, status, kind, caption, hashtags, scene, mcap_at, paid, created_at) VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9)", [
      id,
      i.id,
      payload.mode === "manual" ? "manual" : "auto",
      caption,
      JSON.stringify(draft.hashtags),
      draft.scene,
      facts.mcapUsd,
      payload.paid ? 1 : 0,
      now,
    ]);
    if (idea) await db.query("UPDATE influencers SET next_idea = '' WHERE id = $1 AND next_idea = $2", [i.id, idea]);
    if (mint && facts.milestoneUsd != null && caption.toLowerCase().includes(compactUsd(facts.milestoneUsd).toLowerCase())) await markMilestonesAnnounced(db, mint);
    payload.postId = id;
    return payload;
  }
  if (job.stage === "image") {
    const postId = String(payload.postId ?? "");
    const post = (await db.query("SELECT * FROM posts WHERE id = $1", [postId]))[0];
    if (!post) throw new HttpError(409, "The post to illustrate is gone.");
    const img = await prov.image(postImagePrompt(personaOf(i), String(post.scene), i.vibe), [await portraitRef(db, i)], "1024x1536");
    const media = await putMedia(db, { bytes: img.bytes, mime: img.mime, kind: "image", characterId: i.id, jobId: job.id });
    let paid = Boolean(payload.paid);
    if (paid) paid = await spendForPost(db, i.id, postId, undefined, now);
    await db.query("UPDATE posts SET image_media_id = $2, paid = $3, status = 'live', published_at = $4 WHERE id = $1 AND status = 'draft'", [postId, media.id, paid ? 1 : 0, now]);
    return payload;
  }
  throw new HttpError(500, `Unknown stage ${job.stage}.`);
}

/** Advances one stage of a job. Safe to call concurrently and repeatedly. */
export async function runJob(db: Db, id: string, prov: Providers, now = Date.now()): Promise<JobRow | null> {
  const job = await claim(db, id, now);
  if (!job) return getJob(db, id);
  try {
    const payload = await stage(db, job, prov, now);
    await advance(db, job, payload, Date.now());
  } catch (e) {
    const message = e instanceof ProviderError || e instanceof HttpError ? e.message : "The generation failed unexpectedly.";
    const retryable = e instanceof ProviderError ? e.retryable : !(e instanceof HttpError);
    if (retryable && job.attempts < MAX_JOB_ATTEMPTS) {
      await db.query("UPDATE jobs SET status = 'queued', error = $2, lease_until = NULL, updated_at = $3 WHERE id = $1 AND status = 'running'", [job.id, `${message} Retrying.`, Date.now()]);
    } else await fail(db, job, message, Date.now());
  }
  return getJob(db, id);
}

/** Runs a job to the end (tests, scripts). */
export async function runToEnd(db: Db, id: string, prov: Providers, maxSteps = 20): Promise<JobRow | null> {
  let j: JobRow | null = null;
  for (let k = 0; k < maxSteps; k++) {
    j = await runJob(db, id, prov);
    if (!j || j.status === "succeeded" || j.status === "failed" || j.status === "cancelled") break;
  }
  return j;
}

/** Advances up to `limit` due stages (queued, or running with an expired lease), oldest first. */
export async function tickJobs(db: Db, prov: Providers, limit = 3, now = Date.now()): Promise<number> {
  let steps = 0;
  for (; steps < limit; steps++) {
    const rows = await db.query("SELECT id FROM jobs WHERE status = 'queued' OR (status = 'running' AND lease_until < $1) ORDER BY updated_at ASC LIMIT 1", [Math.max(now, Date.now())]);
    if (!rows[0]) break;
    await runJob(db, String(rows[0].id), prov);
  }
  return steps;
}

// ───────────────────────────── views

export interface JobView {
  id: string;
  influencerId: string;
  kind: JobKind;
  status: JobStatus;
  stage: string;
  step: number;
  total: number;
  label: string;
  error: string | null;
  postId: string | null;
}

export function jobView(j: JobRow): JobView {
  const p = progressOf(j);
  return { id: j.id, influencerId: j.influencerId, kind: j.kind, status: j.status, stage: j.stage, step: p.step, total: p.total, label: p.label, error: j.error, postId: typeof j.payload.postId === "string" ? j.payload.postId : null };
}
