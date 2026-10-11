"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, copyText } from "@/lib/client";
import { SparkIcon } from "./Icons";
import { openCreate, useSeen } from "./ui-store";
import { openWalletDialog, useWallet } from "./wallet/store";

/** True when signed in; otherwise opens the wallet dialog and returns false. */
export function useRequireSignIn() {
  const w = useWallet();
  return () => {
    if (w.session) return true;
    openWalletDialog();
    return false;
  };
}

export function FollowButton({ influencerId, following: initial, variant = "text", className = "" }: { influencerId: string; following: boolean; variant?: "text" | "button"; className?: string }) {
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const need = useRequireSignIn();
  const toggle = async () => {
    if (!need()) return;
    setBusy(true);
    try {
      const r = await api<{ following: boolean }>(`/api/influencers/${influencerId}/follow`, { body: { on: !following } });
      setFollowing(r.following);
      router.refresh();
    } catch {
      // unchanged
    } finally {
      setBusy(false);
    }
  };
  if (variant === "text")
    return (
      <button type="button" className={`text-[12px] font-semibold ${following ? "text-ink" : "text-brand hover:opacity-70"} ${className}`} disabled={busy} onClick={toggle} data-testid="follow">
        {following ? "Following" : "Follow"}
      </button>
    );
  return (
    <button type="button" className={`btn ${following ? "btn-soft" : "btn-ink"} ${className}`} disabled={busy} onClick={toggle} data-testid="follow">
      {following ? "Following" : "Follow"}
    </button>
  );
}

/** Avatar with the story ring: gradient = unseen story (last 24 h), grey = seen, none = no story. */
export function RingAvatar({ src, size, influencerId, storyAt, alt = "" }: { src: string | null; size: number; influencerId: string; storyAt: number | null; alt?: string }) {
  const seen = useSeen();
  const state = storyAt === null ? "none" : (seen[influencerId] ?? 0) >= storyAt ? "seen" : "unseen";
  return (
    <span className="ring" data-ring={state}>
      <span>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
        {src ? <img src={src} alt={alt} className="avatar" style={{ width: size, height: size }} /> : <span className="avatar" style={{ width: size, height: size }} />}
      </span>
    </span>
  );
}

/** The disclosure on every influencer: a small "AI" badge. */
export function AiLabel({ className = "", long = false }: { className?: string; long?: boolean }) {
  return (
    <span className={`ai-badge ${className}`} title="AI influencer: an AI-generated, fictional character">
      <SparkIcon size={10} strokeWidth={2.5} />
      {long ? "AI influencer" : "AI"}
    </span>
  );
}

export function CreateButton({ label = "Create", className = "btn btn-primary", influencerId = null }: { label?: string; className?: string; influencerId?: string | null }) {
  return (
    <button type="button" className={className} onClick={() => openCreate(influencerId)} data-testid={influencerId ? "launch-coin-open" : undefined}>
      {label}
    </button>
  );
}

export function CopyButton({ text, label, className = "btn btn-soft" }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function HandleLink({ handle, className = "handle hover:opacity-60" }: { handle: string; className?: string }) {
  return (
    <Link href={`/${handle}`} className={className}>
      {handle}
    </Link>
  );
}
