"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { FEE_SPLIT_BPS, MAX_INITIAL_BUY_LAMPORTS, NICHES, TICKER_RE, TOKEN_LIMITS, tickerFromHandle } from "@/config/fypad";
import { explorerUrl } from "@/config/solana";
import { api, b64ToBytes, copyText, newKey, readLocalDraft, sleep, writeLocalDraft } from "@/lib/client";
import { short, sol } from "@/lib/show";
import type { JobView } from "@/server/jobs";
import type { LaunchView } from "@/server/launch";
import type { OwnerInfluencer } from "@/server/owner-view";
import { BackIcon, CheckIcon, CopyIcon, ImageIcon, SparkIcon } from "../Icons";
import { openWalletDialog, signAndSendTransaction, useWallet, walletErrorMessage } from "../wallet/store";

type Step = "describe" | "generating" | "review" | "coin" | "split" | "done";

interface Summary {
  network: string;
  payer: string;
  mint: string;
  instructions: string[];
  estimatedNetworkFeeLamports: string;
  estimatedRentLamports: string;
}

const EXAMPLES = ["a Tokyo street-style girl who only wears thrifted Y2K", "a retired astronaut who now reviews ramen in Osaka", "a golden retriever who trades memecoins and is always bullish", "a minimalist climber living in a van in Patagonia"];
const RENT_ESTIMATE = BigInt(22_000_000);
const isRejection = (e: unknown) => {
  const x = e as { code?: number; message?: string };
  return x?.code === 4001 || /reject|declin|cancel|denied/i.test(x?.message ?? "");
};

export default function CreateFlow({ initialInfluencerId = null, initialIdea = null, onClose }: { initialInfluencerId?: string | null; initialIdea?: string | null; onClose?: () => void }) {
  const router = useRouter();
  const w = useWallet();
  const [local] = useState(() => (initialInfluencerId ? null : initialIdea ? { idea: initialIdea, niches: [], vibe: "", influencerId: null } : readLocalDraft()));
  const [step, setStep] = useState<Step>("describe");
  const [loading, setLoading] = useState<boolean>(Boolean(initialInfluencerId || local?.influencerId));
  const [inf, setInf] = useState<OwnerInfluencer | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [idea, setIdea] = useState(local?.idea ?? "");
  const [niches, setNiches] = useState<string[]>(local?.niches ?? []);
  const [vibe, setVibe] = useState(local?.vibe ?? "");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(0);
  const [coin, setCoin] = useState({ name: "", ticker: "", description: "", x: "", telegram: "", website: "", initialBuySol: "0" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [launch, setLaunch] = useState<LaunchView | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const influencerId = inf?.id ?? initialInfluencerId ?? local?.influencerId ?? null;
  const signedIn = Boolean(w.session);

  // ── routing a loaded influencer to the right step
  const route = useCallback((i: OwnerInfluencer) => {
    setInf(i);
    setJob(i.job);
    setLaunch(i.launch);
    setCoin((c) => ({
      ...c,
      name: c.name || i.displayName.slice(0, TOKEN_LIMITS.name),
      ticker: c.ticker || tickerFromHandle(i.handle),
      description: c.description || i.bio.replace(/\n/g, " ").slice(0, 300) || `${i.displayName}, an AI influencer on FYPAD.`,
    }));
    if (i.status === "draft") {
      if (i.job && (i.job.status === "queued" || i.job.status === "running")) return setStep("generating");
      if (i.avatar && i.posts.length >= 3 && i.posts.every((p) => p.image)) return setStep("review");
      if (i.job?.status === "failed") setError(i.job.error ?? "The generation failed. Try again.");
      return setStep(i.avatar ? "review" : "describe");
    }
    const l = i.launch;
    if (l?.status === "confirmed") return setStep(l.sharingStatus === "active" || l.sharingStatus === "declined" ? "done" : "split");
    return setStep("coin");
  }, []);

  useEffect(() => {
    if (!influencerId || inf) return;
    let live = true;
    api<{ influencer: OwnerInfluencer }>(`/api/influencers/${influencerId}`)
      .then((j) => {
        if (!live) return;
        if (j.influencer.status === "discarded") {
          writeLocalDraft(null);
          return;
        }
        route(j.influencer);
      })
      .catch(() => {
        if (live && !initialInfluencerId) writeLocalDraft(null);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [influencerId, inf, route, initialInfluencerId]);

  // ── polling a running generation
  const jobId = step === "generating" ? job?.id : undefined;
  useEffect(() => {
    if (!jobId) return;
    let live = true;
    const poll = async () => {
      for (let k = 0; live && k < 600; k++) {
        try {
          const j = await api<{ job: JobView; influencer: OwnerInfluencer }>(`/api/jobs/${jobId}`);
          if (!live) return;
          setInf(j.influencer);
          setJob(j.job);
          if (j.job.status === "succeeded") {
            setStep("review");
            return;
          }
          if (j.job.status === "failed" || j.job.status === "cancelled") {
            setError(j.job.error ?? "The generation failed. Try again.");
            setStep(j.influencer.avatar && j.influencer.posts.length >= 3 ? "review" : "describe");
            return;
          }
        } catch {
          // network hiccup: keep polling
        }
        await sleep(1500);
      }
    };
    void poll();
    return () => {
      live = false;
    };
  }, [jobId]);

  // keep the browser copy of the draft
  useEffect(() => {
    if (initialInfluencerId) return;
    if (step === "done") writeLocalDraft(null);
    else writeLocalDraft({ idea, niches, vibe, influencerId: inf?.id ?? null, step });
  }, [idea, niches, vibe, inf?.id, step, initialInfluencerId]);

  const needSignIn = () => {
    if (signedIn) return false;
    openWalletDialog();
    return true;
  };

  // ── 1. describe → generate
  const generate = async () => {
    if (needSignIn()) return;
    setError(null);
    setPhase("Starting");
    try {
      const r = await api<{ influencerId: string; job: JobView }>("/api/influencers", { body: { idea, niches, vibe, key: newKey("c") } });
      setJob(r.job);
      const j = await api<{ influencer: OwnerInfluencer }>(`/api/influencers/${r.influencerId}`);
      setInf(j.influencer);
      setStep("generating");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };

  const regenerate = async (what: "portrait" | "posts" | "all") => {
    if (!inf) return;
    setError(null);
    setPhase("Starting");
    try {
      await saveEdits();
      const r = await api<{ job: JobView }>(`/api/influencers/${inf.id}/regenerate`, { body: { what, key: newKey("r") } });
      setJob(r.job);
      setEdit({});
      setCaptions({});
      setStep("generating");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };

  // ── 2. review
  const val = (k: keyof OwnerInfluencer) => edit[k] ?? String(inf?.[k] ?? "");
  const setVal = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEdit((x) => ({ ...x, [k]: e.target.value }));
  const saveEdits = async () => {
    if (!inf || (Object.keys(edit).length === 0 && Object.keys(captions).length === 0)) return inf;
    const body: Record<string, unknown> = { ...edit };
    if (Object.keys(captions).length) body.posts = inf.posts.map((p) => ({ id: p.id, caption: captions[p.id] ?? p.caption, hashtags: p.hashtags }));
    const r = await api<{ influencer: OwnerInfluencer }>(`/api/influencers/${inf.id}`, { method: "PATCH", body });
    setInf(r.influencer);
    setEdit({});
    setCaptions({});
    return r.influencer;
  };
  const publish = async (withCoin: boolean) => {
    if (!inf) return;
    setError(null);
    setPhase(withCoin ? "Publishing" : "Saving");
    try {
      await saveEdits();
      const r = await api<{ influencer: OwnerInfluencer }>(`/api/influencers/${inf.id}/publish`, { body: {} });
      route(r.influencer);
      if (!withCoin) {
        writeLocalDraft(null);
        onClose?.();
        router.push(`/${r.influencer.handle}`);
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };

  // ── 3. coin → sign create_v2 (+ buy)
  const ticker = coin.ticker.replace(/^\$/, "").toUpperCase();
  const solOk = /^\d+(\.\d{1,9})?$/.test(coin.initialBuySol || "0");
  const buyLamports = solOk ? BigInt(Math.round(Number(coin.initialBuySol || "0") * 1e9)) : BigInt(0);
  const coinValid = TICKER_RE.test(ticker) && coin.name.trim().length >= 2 && coin.description.trim().length >= 10 && solOk && buyLamports <= MAX_INITIAL_BUY_LAMPORTS;
  const mintRef = useRef<Keypair | null>(null);

  const pollLaunch = async (id: string, action: "confirm" | "sharing-confirm") => {
    for (let k = 0; k < 90; k++) {
      const { launch: l } = await api<{ launch: LaunchView }>(`/api/launch/${id}/${action}`, { body: {} });
      setLaunch(l);
      if (action === "confirm" && l.status !== "submitted" && l.status !== "prepared") return l;
      if (action === "sharing-confirm" && l.sharingStatus !== "submitted" && l.sharingStatus !== "prepared") return l;
      await sleep(2000);
    }
    return null;
  };

  const walletReady = () => {
    if (!w.session) {
      openWalletDialog();
      return false;
    }
    if (!w.address) {
      setError("Connect the wallet you signed in with to sign this transaction.");
      openWalletDialog();
      return false;
    }
    if (w.address !== w.session) {
      setError(`Switch to the wallet you signed in with (${short(w.session)}).`);
      return false;
    }
    return true;
  };

  const launchCoin = async () => {
    if (!inf || !walletReady()) return;
    setError(null);
    setPhase("Preparing the transaction");
    let prepared: { launch: LaunchView; transaction: string; summary: Summary };
    try {
      if (!mintRef.current) mintRef.current = Keypair.generate();
      prepared = await api("/api/launch/prepare", { body: { influencerId: inf.id, mint: mintRef.current.publicKey.toBase58(), ...coin, ticker } });
      setLaunch(prepared.launch);
      setSummary(prepared.summary);
    } catch (e) {
      setError((e as Error).message);
      setPhase(null);
      return;
    }
    setPhase("Approve in your wallet");
    let signature: string;
    try {
      const tx = VersionedTransaction.deserialize(b64ToBytes(prepared.transaction));
      tx.sign([mintRef.current!]);
      signature = await signAndSendTransaction(tx.serialize());
    } catch (e) {
      if (isRejection(e)) {
        await api(`/api/launch/${prepared.launch.id}/rejected`, { body: { reason: "The signature request was declined in the wallet." } }).catch(() => null);
        mintRef.current = null;
        setError("You declined in your wallet. Nothing was sent and nothing was charged.");
      } else setError(walletErrorMessage(e));
      setPhase(null);
      return;
    }
    setPhase("Confirming on Solana");
    try {
      await api(`/api/launch/${prepared.launch.id}/submitted`, { body: { signature } });
      const l = await pollLaunch(prepared.launch.id, "confirm");
      if (l?.status === "confirmed") {
        setStep("split");
      } else {
        mintRef.current = null;
        setError(l?.error ?? "The launch was not confirmed. Nothing was created.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };

  // ── 4. fee split (second signature)
  const signSplit = async () => {
    if (!launch || !walletReady()) return;
    setError(null);
    setPhase("Preparing the fee split");
    try {
      const r = await api<{ launch: LaunchView; transaction: string }>(`/api/launch/${launch.id}/sharing`, { body: {} });
      setPhase("Approve in your wallet");
      let sig: string;
      try {
        sig = await signAndSendTransaction(VersionedTransaction.deserialize(b64ToBytes(r.transaction)).serialize());
      } catch (e) {
        if (isRejection(e)) {
          await api(`/api/launch/${launch.id}/sharing-rejected`, { body: {} }).catch(() => null);
          setError("You declined the fee split. You can sign it later from Earnings.");
        } else setError(walletErrorMessage(e));
        return;
      }
      setPhase("Confirming on Solana");
      await api(`/api/launch/${launch.id}/sharing-submitted`, { body: { signature: sig } });
      const l = await pollLaunch(launch.id, "sharing-confirm");
      if (l?.sharingStatus === "active") setStep("done");
      else setError(l?.error ?? "The fee split could not be verified on chain yet.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };
  const skipSplit = async () => {
    if (!launch) return;
    setPhase("Saving");
    try {
      const r = await api<{ launch: LaunchView }>(`/api/launch/${launch.id}/sharing-rejected`, { body: {} });
      setLaunch(r.launch);
      setStep("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };

  const back = () => {
    setError(null);
    if (step === "review") setStep("describe");
  };

  // ───────────────────────────── render
  const title =
    step === "describe" ? "Create new influencer" : step === "generating" ? "Generating…" : step === "review" ? "Review" : step === "coin" ? "Launch its coin" : step === "split" ? "Share the fees" : "Live";
  const headRight =
    step === "review" ? (
      <button type="button" className="btn-text btn text-[14px]" disabled={phase !== null} onClick={() => publish(true)} data-testid="review-next">
        Next
      </button>
    ) : null;

  return (
    <div className="flex flex-col" data-testid="create-flow" data-step={step}>
      <div className="modal-head">
        {step === "review" && (
          <button type="button" className="icon-btn absolute left-2" onClick={back} aria-label="Back">
            <BackIcon size={22} />
          </button>
        )}
        <span>{title}</span>
        <span className="absolute right-4">{headRight}</span>
      </div>

      {loading ? (
        <div className="flex h-80 items-center justify-center">
          <span className="spinner text-[var(--muted)]" />
        </div>
      ) : step === "describe" ? (
        <div className="space-y-5 p-5 sm:p-6">
          {!signedIn && (
            <div className="notice flex flex-wrap items-center justify-between gap-3">
              <span>Sign in with your wallet to create an influencer.</span>
              <button type="button" className="btn btn-primary" onClick={openWalletDialog}>
                Sign in
              </button>
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="c-idea">
              Describe your influencer in one sentence
            </label>
            <textarea id="c-idea" className="field min-h-[96px] resize-none text-[15px] leading-[22px]" maxLength={300} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={`e.g. ${EXAMPLES[0]}`} />
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {EXAMPLES.slice(1).map((ex) => (
                <button key={ex} type="button" className="hint hover:text-[var(--ink)]" onClick={() => setIdea(ex)}>
                  “{ex}”
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="field-label">Niche</p>
            <div className="flex flex-wrap gap-2">
              {NICHES.map((n) => (
                <button key={n} type="button" className="chip" aria-pressed={niches.includes(n)} onClick={() => setNiches((x) => (x.includes(n) ? x.filter((y) => y !== n) : x.length < 3 ? [...x, n] : x))}>
                  {n}
                </button>
              ))}
            </div>
            <p className="hint mt-2">Up to three.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="c-vibe">
              Vibe or visual style <span className="muted font-normal">(optional)</span>
            </label>
            <input id="c-vibe" className="field" maxLength={160} value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="e.g. 35mm film, warm tones, night city" />
          </div>
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={phase !== null || idea.trim().length < 8} onClick={generate} data-testid="generate">
            {phase ? <span className="spinner" /> : (
              <>
                <SparkIcon size={18} /> Generate influencer
              </>
            )}
          </button>
          <p className="hint text-center">AI writes the persona and shoots a profile photo plus the first 3 posts. About a minute.</p>
        </div>
      ) : step === "generating" ? (
        <Generating inf={inf} job={job} />
      ) : step === "review" && inf ? (
        <div className="grid gap-0 md:grid-cols-[1fr_1fr]">
          <div className="border-b p-5 md:border-b-0 md:border-r">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
              {inf.avatar ? <img src={inf.avatar} alt="" className="avatar size-[77px]" /> : <span className="avatar size-[77px]" />}
              <div className="min-w-0">
                <p className="handle truncate text-[16px]">{val("handle")}</p>
                <p className="truncate text-ink">{val("displayName")}</p>
                <p className="ai-badge mt-1">
                  <SparkIcon size={12} /> AI influencer
                </p>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-line text-ink">{val("bio")}</p>
            <div className="grid3 mt-4">
              {inf.posts.map((p, k) => (
                <button key={p.id} type="button" className="tile" onClick={() => setSelected(k)} style={{ outline: selected === k ? "2px solid var(--brand)" : "none", outlineOffset: -2 }} aria-label={`Post ${k + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                  {p.image && <img src={p.image} alt="" />}
                </button>
              ))}
            </div>
            {inf.posts[selected] && (
              <div className="mt-3">
                <label className="field-label" htmlFor="r-caption">
                  Caption of post {selected + 1}
                </label>
                <textarea
                  id="r-caption"
                  className="field min-h-[88px] resize-none"
                  value={captions[inf.posts[selected].id] ?? inf.posts[selected].caption}
                  onChange={(e) => setCaptions((c) => ({ ...c, [inf.posts[selected].id]: e.target.value }))}
                />
                {inf.posts[selected].hashtags.length > 0 && <p className="mt-1 text-[13px] text-brand">{inf.posts[selected].hashtags.map((h) => `#${h}`).join(" ")}</p>}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn btn-soft" disabled={phase !== null} onClick={() => regenerate("portrait")}>
                New photo
              </button>
              <button type="button" className="btn btn-soft" disabled={phase !== null} onClick={() => regenerate("posts")}>
                New posts
              </button>
              <button type="button" className="btn btn-soft" disabled={phase !== null} onClick={() => regenerate("all")}>
                Regenerate all
              </button>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <Field label="Name" id="r-name">
              <input id="r-name" className="field" maxLength={28} value={val("displayName")} onChange={setVal("displayName")} />
            </Field>
            <Field label="Username" id="r-handle">
              <div className="relative">
                <span className="muted absolute left-3 top-1/2 -translate-y-1/2">@</span>
                <input id="r-handle" className="field pl-7" maxLength={24} value={val("handle")} onChange={setVal("handle")} />
              </div>
            </Field>
            <Field label={`Bio · ${val("bio").length}/150`} id="r-bio">
              <textarea id="r-bio" className="field min-h-[72px] resize-none" maxLength={150} value={val("bio")} onChange={setVal("bio")} />
            </Field>
            <Field label="Personality" id="r-personality">
              <textarea id="r-personality" className="field min-h-[60px] resize-none" maxLength={240} value={val("personality")} onChange={setVal("personality")} />
            </Field>
            <Field label="Voice" id="r-voice">
              <textarea id="r-voice" className="field min-h-[60px] resize-none" maxLength={220} value={val("voice")} onChange={setVal("voice")} />
            </Field>
            <Field label="Look (used for every future photo)" id="r-look">
              <textarea id="r-look" className="field min-h-[72px] resize-none" maxLength={400} value={val("look")} onChange={setVal("look")} />
            </Field>
            {inf.themes.length > 0 && (
              <div>
                <p className="field-label">Posts about</p>
                <div className="flex flex-wrap gap-1.5">
                  {inf.themes.map((t) => (
                    <span key={t} className="rounded-full bg-[var(--soft)] px-2.5 py-1 text-[12px] text-ink">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 pt-2">
              <button type="button" className="btn btn-primary btn-lg w-full" disabled={phase !== null} onClick={() => publish(true)} data-testid="publish-next">
                {phase ? <span className="spinner" /> : "Next: launch its coin"}
              </button>
              <button type="button" className="btn btn-soft w-full" disabled={phase !== null} onClick={() => publish(false)} data-testid="save-no-coin">
                Publish without a coin
              </button>
              <p className="hint text-center">Publishing makes @{val("handle")} public with these 3 posts. It keeps posting by itself.</p>
            </div>
          </div>
        </div>
      ) : step === "coin" && inf ? (
        <div className="grid md:grid-cols-[1fr_1fr]">
          <div className="border-b p-5 md:border-b-0 md:border-r">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
              {inf.avatar && <img src={inf.avatar} alt="" className="avatar size-14" />}
              <div className="min-w-0">
                <p className="handle truncate text-[16px]">${ticker || "TICKER"}</p>
                <p className="muted truncate">{coin.name || inf.displayName} · @{inf.handle}</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border p-4">
              <p className="handle mb-1">Before you sign</p>
              <div className="kv">
                <span>Network</span>
                <span>{inf.launching.cluster === "devnet" ? "Solana devnet" : "Solana mainnet"}</span>
              </div>
              <div className="kv">
                <span>Creator of record</span>
                <span className="num">{w.session ? `${short(w.session)} (you)` : "Your wallet"}</span>
              </div>
              <div className="kv">
                <span>pump.fun creation cost</span>
                <span className="num">≈ {sol(RENT_ESTIMATE)} + network fee</span>
              </div>
              <div className="kv">
                <span>Initial buy</span>
                <span className="num">{buyLamports > BigInt(0) ? sol(buyLamports) : "None"}</span>
              </div>
              <div className="kv">
                <span>Creator fees</span>
                <span>
                  {FEE_SPLIT_BPS.creator / 100}% you · {FEE_SPLIT_BPS.treasury / 100}% FYPAD
                </span>
              </div>
              <p className="handle mb-1 mt-4">Your wallet signs</p>
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink">
                {(summary?.instructions ?? ["Set the compute budget", "Create the coin on pump.fun (create_v2), you as creator", ...(buyLamports > BigInt(0) ? ["Open your token account", `Initial buy of ${sol(buyLamports)}`] : [])]).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ol>
              <p className="mt-2 text-[13px] text-ink">Then a second signature registers the fee split on pump.fun: {FEE_SPLIT_BPS.creator / 100}% of every trade&apos;s creator fee to you, {FEE_SPLIT_BPS.treasury / 100}% to the FYPAD treasury, which pays {inf.displayName}&apos;s AI posts. pump.fun pays both directly. FYPAD never holds your share.</p>
              <p className="handle mt-3 flex items-center gap-1.5">
                <CheckIcon size={16} /> You are the creator of this coin.
              </p>
            </div>
          </div>
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (coinValid && phase === null) void launchCoin();
            }}
          >
            <div className="grid grid-cols-[1fr_0.7fr] gap-3">
              <Field label="Coin name" id="k-name">
                <input id="k-name" className="field" maxLength={TOKEN_LIMITS.name} value={coin.name} onChange={(e) => setCoin((c) => ({ ...c, name: e.target.value }))} />
              </Field>
              <Field label="Ticker" id="k-ticker">
                <input id="k-ticker" className="field uppercase" maxLength={11} value={coin.ticker} onChange={(e) => setCoin((c) => ({ ...c, ticker: e.target.value }))} />
              </Field>
            </div>
            {coin.ticker && !TICKER_RE.test(ticker) && <p className="hint text-down">The ticker is 2 to 10 letters or digits.</p>}
            <Field label="Description" id="k-desc">
              <textarea id="k-desc" className="field min-h-[72px] resize-none" maxLength={TOKEN_LIMITS.description} value={coin.description} onChange={(e) => setCoin((c) => ({ ...c, description: e.target.value }))} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="X (optional)" id="k-x">
                <input id="k-x" className="field" value={coin.x} onChange={(e) => setCoin((c) => ({ ...c, x: e.target.value }))} placeholder="https://x.com/…" />
              </Field>
              <Field label="Telegram (optional)" id="k-tg">
                <input id="k-tg" className="field" value={coin.telegram} onChange={(e) => setCoin((c) => ({ ...c, telegram: e.target.value }))} placeholder="https://t.me/…" />
              </Field>
              <Field label="Website (optional)" id="k-web">
                <input id="k-web" className="field" value={coin.website} onChange={(e) => setCoin((c) => ({ ...c, website: e.target.value }))} placeholder="https://…" />
              </Field>
            </div>
            <Field label="Initial buy in SOL (optional)" id="k-buy">
              <input id="k-buy" className="field num" inputMode="decimal" value={coin.initialBuySol} onChange={(e) => setCoin((c) => ({ ...c, initialBuySol: e.target.value }))} />
            </Field>
            {(!solOk || buyLamports > MAX_INITIAL_BUY_LAMPORTS) && <p className="hint text-down">0 for none, up to 5 SOL, bought in the same transaction.</p>}
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={!coinValid || phase !== null} data-testid="launch-coin">
              {phase ? (
                <>
                  <span className="spinner" /> {phase}
                </>
              ) : (
                `Launch $${ticker || "TICKER"}`
              )}
            </button>
            <button
              type="button"
              className="btn btn-soft w-full"
              disabled={phase !== null}
              onClick={() => {
                writeLocalDraft(null);
                onClose?.();
                router.push(`/${inf.handle}`);
                router.refresh();
              }}
            >
              Not now, view @{inf.handle}
            </button>
          </form>
        </div>
      ) : step === "split" && inf && launch ? (
        <div className="mx-auto max-w-[460px] space-y-4 p-6 text-center">
          <p className="notice notice-good" data-testid="launch-confirmed">
            ${launch.ticker} is live on pump.fun. You are its creator.
          </p>
          <h3 className="text-[20px] font-semibold text-ink">One more signature: the fee split</h3>
          <p className="text-[15px] leading-[21px] text-ink">
            pump.fun will pay every creator fee of ${launch.ticker} straight to two wallets: <b>{FEE_SPLIT_BPS.creator / 100}% to you</b> and {FEE_SPLIT_BPS.treasury / 100}% to the FYPAD treasury, which funds {inf.displayName}&apos;s posts (up to 3 a day) and the $FYPAD buyback. It is set once and cannot be changed.
          </p>
          <p className="hint">If you skip it, the coin keeps 100% of its creator fees for you and @{inf.handle} posts once a day for 14 days, then every 3 days.</p>
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={phase !== null} onClick={signSplit} data-testid="sign-split">
            {phase ? (
              <>
                <span className="spinner" /> {phase}
              </>
            ) : (
              "Sign the 80/20 fee split"
            )}
          </button>
          <button type="button" className="btn btn-soft w-full" disabled={phase !== null} onClick={skipSplit} data-testid="skip-split">
            Skip, keep 100%
          </button>
        </div>
      ) : step === "done" && inf ? (
        <div className="mx-auto flex max-w-[420px] flex-col items-center p-8 text-center" data-testid="create-done">
          <span className="ring" data-ring="unseen">
            <span>
              {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
              {inf.avatar && <img src={inf.avatar} alt="" className="avatar size-24" />}
            </span>
          </span>
          <h3 className="mt-4 text-[22px] font-semibold text-ink">@{inf.handle} is live</h3>
          {launch?.status === "confirmed" && (
            <p className="muted mt-1">
              ${launch.ticker} · {launch.sharingStatus === "active" ? "80/20 fee split active" : "100% of creator fees to you"}
            </p>
          )}
          <div className="mt-6 flex w-full flex-col gap-2">
            <Link
              href={`/${inf.handle}`}
              className="btn btn-primary btn-lg w-full"
              onClick={() => {
                writeLocalDraft(null);
                onClose?.();
              }}
              data-testid="view-profile"
            >
              View profile
            </Link>
            <a
              className="btn btn-soft w-full"
              target="_blank"
              rel="noreferrer"
              href={`https://x.com/intent/post?text=${encodeURIComponent(`Meet @${inf.handle}, my AI influencer on FYPAD${launch?.status === "confirmed" ? ` — $${launch.ticker}` : ""}`)}&url=${encodeURIComponent(`${typeof window !== "undefined" ? window.location.origin : ""}/${inf.handle}`)}`}
            >
              Share on X
            </a>
            {launch?.status === "confirmed" && (
              <button
                type="button"
                className="btn btn-soft w-full"
                onClick={async () => {
                  if (await copyText(launch.mint)) setCopied(true);
                }}
              >
                <CopyIcon size={16} /> {copied ? "Copied" : `Copy CA ${short(launch.mint)}`}
              </button>
            )}
            {launch?.createSig && (
              <a className="hint mt-2 hover:text-[var(--ink)]" href={explorerUrl("tx", launch.createSig, launch.cluster === "devnet" ? "devnet" : "mainnet-beta")} target="_blank" rel="noreferrer">
                View the launch transaction on Solscan
              </a>
            )}
          </div>
        </div>
      ) : null}

      {error && (
        <div className="px-5 pb-5">
          <p role="alert" className="notice notice-error" data-testid="create-error">
            {error}
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label text-[13px]" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Generating({ inf, job }: { inf: OwnerInfluencer | null; job: JobView | null }) {
  const pctDone = job ? Math.round((job.step / Math.max(1, job.total)) * 100) : 5;
  return (
    <div className="p-6" data-testid="generating">
      <div className="progress">
        <span style={{ width: `${Math.max(6, pctDone)}%` }} />
      </div>
      <p className="mt-3 text-center text-ink" data-testid="job-status">
        {job?.label ?? "Starting"}…
      </p>
      {job?.error && <p className="hint mt-1 text-center">{job.error}</p>}
      <div className="mx-auto mt-6 max-w-[420px]">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
          {inf?.avatar ? <img src={inf.avatar} alt="" className="avatar size-[77px] fade-in" /> : <span className="avatar skeleton size-[77px]" />}
          <div className="min-w-0 flex-1 space-y-2">
            {inf?.handle ? <p className="handle text-[16px]">{inf.handle}</p> : <span className="skeleton block h-4 w-32 rounded" />}
            {inf?.displayName ? <p className="text-ink">{inf.displayName}</p> : <span className="skeleton block h-3 w-24 rounded" />}
          </div>
        </div>
        {inf?.bio ? <p className="mt-3 whitespace-pre-line text-ink">{inf.bio}</p> : <span className="skeleton mt-3 block h-10 w-full rounded" />}
        <div className="grid3 mt-4">
          {[0, 1, 2].map((k) => {
            const p = inf?.posts.find((x) => x.slot === k);
            return (
              <div key={k} className={`tile ${p?.image ? "" : "skeleton"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                {p?.image ? <img src={p.image} alt="" className="fade-in" /> : <span className="absolute inset-0 flex items-center justify-center text-[var(--muted)]"><ImageIcon size={22} /></span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
