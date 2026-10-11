"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, newKey } from "@/lib/client";
import { sol } from "@/lib/show";
import type { ProfileData } from "@/server/views";
import { Modal } from "./Modal";
import { openCreate } from "./ui-store";

/** Owner buttons on their influencer's profile: Edit profile · Manage · Earnings (+ Launch coin when it has none). */
export function OwnerControls({ influencerId, bio, owner, hasCoin, launchPending, displayName }: { influencerId: string; bio: string; owner: NonNullable<ProfileData["owner"]>; hasCoin: boolean; launchPending: boolean; displayName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "manage" | null>(null);
  const [draftBio, setDraftBio] = useState(bio);
  const [paused, setPaused] = useState(owner.paused);
  const [idea, setIdea] = useState(owner.nextIdea);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/influencers/${influencerId}`, { method: "PATCH", body });
      setMsg(done);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const postNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (idea !== owner.nextIdea) await api(`/api/influencers/${influencerId}`, { method: "PATCH", body: { nextIdea: idea } });
      await api(`/api/influencers/${influencerId}/post-now`, { body: { key: newKey("m") } });
      setMsg(`${displayName} is making a post. It appears on the profile in about a minute.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mode = owner.cadence.mode === "funded" ? "Up to 3 posts a day (budget funded)" : owner.cadence.mode === "baseline" ? "1 post a day (first 14 days)" : owner.cadence.mode === "idle" ? "1 post every 3 days" : "Paused";

  return (
    <>
      <button type="button" className="btn btn-soft" onClick={() => setOpen("edit")} data-testid="edit-profile">
        Edit profile
      </button>
      <button type="button" className="btn btn-soft" onClick={() => setOpen("manage")} data-testid="manage">
        Manage
      </button>
      <Link href="/earnings" className="btn btn-soft">
        Earnings
      </Link>
      {!hasCoin && (
        <button type="button" className="btn btn-primary" onClick={() => openCreate(influencerId)} data-testid="launch-coin-open">
          {launchPending ? "Finish coin launch" : "Launch coin"}
        </button>
      )}

      <Modal open={open === "edit"} onClose={() => setOpen(null)} title="Edit profile" width={480}>
        <div className="space-y-3 p-5">
          <label className="field-label" htmlFor="e-bio">
            Bio · {draftBio.length}/150
          </label>
          <textarea id="e-bio" className="field min-h-[96px] resize-none" maxLength={150} value={draftBio} onChange={(e) => setDraftBio(e.target.value)} />
          <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={() => patch({ bio: draftBio }, "Saved.")}>
            {busy ? <span className="spinner" /> : "Submit"}
          </button>
          {msg && <p className="notice">{msg}</p>}
        </div>
      </Modal>

      <Modal open={open === "manage"} onClose={() => setOpen(null)} title="Manage" width={480}>
        <div className="space-y-4 p-5" data-testid="manage-panel">
          <div className="kv">
            <span>Posting</span>
            <span>{paused ? "Paused" : mode}</span>
          </div>
          <div className="kv">
            <span>Posting budget</span>
            <span className="num">{sol(owner.budgetLamports)}</span>
          </div>
          <div className="kv">
            <span>Fee split</span>
            <span>{owner.sharingStatus === "active" ? "80% you · 20% FYPAD" : owner.sharingStatus ? "Not set: 100% to you" : "No coin yet"}</span>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="handle block">Pause auto-posting</span>
              <span className="hint">No posts until you resume. Replies stop too.</span>
            </span>
            <input
              type="checkbox"
              className="size-5 accent-[var(--brand)]"
              checked={paused}
              onChange={(e) => {
                setPaused(e.target.checked);
                void patch({ paused: e.target.checked }, e.target.checked ? "Auto-posting paused." : "Auto-posting resumed.");
              }}
              data-testid="pause"
            />
          </label>
          <div>
            <label className="field-label" htmlFor="m-idea">
              Next post idea
            </label>
            <textarea id="m-idea" className="field min-h-[72px] resize-none" maxLength={300} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. a mirror selfie in the new thrifted jacket, rainy Shibuya" />
            <p className="hint mt-1">The next post (automatic or “Post now”) follows it, then it clears.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-soft flex-1" disabled={busy} onClick={() => patch({ nextIdea: idea }, "Idea saved for the next post.")}>
              Save idea
            </button>
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={postNow} data-testid="post-now">
              {busy ? <span className="spinner" /> : "Post now"}
            </button>
          </div>
          <p className="hint">Post now: 3 a day. To delete a post, open it and use ⋯.</p>
          {msg && <p className="notice">{msg}</p>}
        </div>
      </Modal>
    </>
  );
}
