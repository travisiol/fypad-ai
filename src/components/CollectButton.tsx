"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { api, b64ToBytes } from "@/lib/client";
import { short, sol } from "@/lib/show";
import { openWalletDialog, signAndSendTransaction, useWallet, walletErrorMessage } from "./wallet/store";

/**
 * Collect: builds the permissionless pump.fun transaction (sweep + distribute 80/20, or sweep + collect
 * when the split is not set), the creator's wallet signs it (network fee only), then FYPAD records
 * what the chain paid, once per signature.
 */
export function CollectButton({ influencerId, claimable }: { influencerId: string; claimable: string }) {
  const w = useWallet();
  const router = useRouter();
  const [phase, setPhase] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const collect = async () => {
    setMsg(null);
    if (!w.session) return openWalletDialog();
    if (w.address !== w.session) {
      setMsg({ ok: false, text: w.address ? `Switch to the wallet you signed in with (${short(w.session)}).` : "Connect the wallet you signed in with." });
      if (!w.address) openWalletDialog();
      return;
    }
    setPhase("Preparing");
    try {
      const r = await api<{ transaction: string }>(`/api/earnings/${influencerId}/collect`, { body: {} });
      setPhase("Approve in your wallet");
      let sig: string;
      try {
        sig = await signAndSendTransaction(VersionedTransaction.deserialize(b64ToBytes(r.transaction)).serialize());
      } catch (e) {
        setMsg({ ok: false, text: walletErrorMessage(e) });
        return;
      }
      setPhase("Confirming on Solana");
      const done = await api<{ status: string; creatorLamports?: string }>(`/api/earnings/${influencerId}/collected`, { body: { signature: sig } });
      if (done.status === "recorded") setMsg({ ok: true, text: `Collected: ${sol(done.creatorLamports ?? "0")} paid to your wallet.` });
      else if (done.status === "pending") setMsg({ ok: true, text: "Sent. It will show here once confirmed." });
      else setMsg({ ok: false, text: done.status === "failed" ? "The transaction failed on chain. Nothing moved." : "Nothing was paid out." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setPhase(null);
    }
  };
  return (
    <div>
      <button type="button" className="btn btn-primary" disabled={phase !== null || BigInt(claimable) <= BigInt(0)} onClick={collect} data-testid="collect">
        {phase ? (
          <>
            <span className="spinner" /> {phase}
          </>
        ) : (
          "Collect"
        )}
      </button>
      {msg && (
        <p className={`notice mt-2 ${msg.ok ? "notice-good" : "notice-error"}`} data-testid="collect-msg">
          {msg.text}
        </p>
      )}
    </div>
  );
}
