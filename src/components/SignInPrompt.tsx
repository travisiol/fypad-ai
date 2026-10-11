"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { openWalletDialog, useWallet } from "./wallet/store";

/** Shown on private pages to a visitor without a session; reloads the page once they sign in. */
export function SignInPrompt({ title, text }: { title: string; text: string }) {
  const w = useWallet();
  const router = useRouter();
  useEffect(() => {
    if (w.session) router.refresh();
  }, [w.session, router]);
  return (
    <div className="mx-auto flex max-w-[420px] flex-col items-center px-6 py-20 text-center" data-testid="signin-prompt">
      <h1 className="text-[24px] font-extrabold text-ink">{title}</h1>
      <p className="muted mt-2">{text}</p>
      <button type="button" className="btn btn-primary mt-6" onClick={openWalletDialog}>
        Sign in with your wallet
      </button>
    </div>
  );
}
