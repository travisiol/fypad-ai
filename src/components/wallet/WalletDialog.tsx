"use client";

import { useState } from "react";
import { short } from "@/lib/show";
import { LogoTile, Wordmark } from "../Logo";
import { Modal } from "../Modal";
import type { StandardWallet } from "./store";
import { closeWalletDialog, connectWallet, disconnectWallet, signIn, signOut, useWallet, walletErrorMessage } from "./store";

/** Connect (wallet-standard discovery, no adapter packages) → sign a message → session cookie. */
export function WalletDialog() {
  const wallet = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    closeWalletDialog();
  };
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const signedIn = wallet.address !== null && wallet.session === wallet.address;

  return (
    <Modal open={wallet.dialogOpen} onClose={close} width={380} testId="wallet-dialog">
      <div className="flex flex-col items-center px-8 pb-6 pt-8 text-center">
        <LogoTile size={56} id="wd" />
        <Wordmark className="mt-3 text-[40px]" />
        {wallet.address ? (
          <div className="mt-5 w-full space-y-3">
            <div className="card-box flex items-center gap-3 p-3 text-left">
              <span className="inline-block size-9 rounded-full" style={{ background: "var(--grad)" }} aria-hidden="true" />
              <div className="min-w-0">
                <p className="handle num" data-testid="wallet-address">
                  {short(wallet.address)}
                </p>
                <p className="hint">Connected with {wallet.walletName}</p>
              </div>
            </div>
            {signedIn ? (
              <p className="notice notice-good" data-testid="signed-in">
                Signed in as {short(wallet.address)}.
              </p>
            ) : (
              <>
                <p className="muted">Sign a short message to prove this wallet is yours. It is free and moves no funds.</p>
                <button type="button" className="btn btn-primary w-full" disabled={busy !== null} onClick={() => run("signin", signIn)} data-testid="sign-in">
                  {busy === "signin" ? <span className="spinner" /> : "Sign in"}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-soft w-full"
              onClick={() =>
                run("disconnect", async () => {
                  if (signedIn) await signOut();
                  disconnectWallet();
                  close();
                })
              }
            >
              {signedIn ? "Sign out" : "Disconnect"}
            </button>
          </div>
        ) : (
          <div className="mt-4 w-full">
            <p className="muted mb-4">Sign in with your Solana wallet to create influencers, follow, like and comment.</p>
            {wallet.wallets.length > 0 ? (
              <ul className="space-y-2">
                {wallet.wallets.map((candidate: StandardWallet) => (
                  <li key={candidate.name}>
                    <button type="button" disabled={busy !== null} onClick={() => run(candidate.name, () => connectWallet(candidate))} className="card-box wallet-option flex w-full items-center gap-3 p-3 text-left hover:bg-[var(--hover)]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI */}
                      <img src={candidate.icon} alt="" className="size-8 rounded-lg" />
                      <span className="handle flex-1">{candidate.name}</span>
                      {busy === candidate.name ? <span className="spinner" /> : <span className="hint">Detected</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="card-box p-4 text-left">
                <p className="handle">No Solana wallet found in this browser</p>
                <p className="hint mt-1">
                  Install{" "}
                  <a className="text-brand" href="https://phantom.com" target="_blank" rel="noreferrer">
                    Phantom
                  </a>
                  ,{" "}
                  <a className="text-brand" href="https://solflare.com" target="_blank" rel="noreferrer">
                    Solflare
                  </a>{" "}
                  or{" "}
                  <a className="text-brand" href="https://backpack.app" target="_blank" rel="noreferrer">
                    Backpack
                  </a>
                  , then reopen this window.
                </p>
              </div>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="notice notice-error mt-4 w-full">
            {error}
          </p>
        )}
        <p className="hint mt-5">FYPAD never asks for a seed phrase or a private key.</p>
      </div>
    </Modal>
  );
}
