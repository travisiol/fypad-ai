"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { short, usd } from "@/lib/show";
import { BellIcon, CoinIcon, CompassIcon, DocIcon, HomeIcon, LedgerIcon, LogoutIcon, MenuIcon, MoonIcon, PlusIcon, RisingIcon, SearchIcon, SparkIcon, UserIcon, WalletIcon } from "./Icons";
import { Wordmark } from "./Logo";
import { openCreate, setTheme, useTheme } from "./ui-store";
import { openWalletDialog, signOut, useWallet } from "./wallet/store";

interface SearchHit {
  handle: string;
  displayName: string;
  avatar: string | null;
  ticker: string | null;
  mcapUsd: number | null;
  change24h?: number | null;
}

function Search({ onDone, autoFocus = false }: { onDone?: () => void; autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const t = setTimeout(() => {
      api<{ people: SearchHit[] }>(`/api/search?q=${encodeURIComponent(term)}`)
        .then((j) => setHits(j.people))
        .catch(() => setHits([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
          onDone?.();
          router.push(`/explore?q=${encodeURIComponent(q.trim())}`);
        }}
        className="flex h-10 items-center gap-2 rounded-full border bg-[var(--card)] px-4 focus-within:border-[var(--violet)]"
      >
        <SearchIcon size={17} className="flex-none text-[var(--muted)]" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--muted)]"
          placeholder="Search influencers, $TICKER or CA"
          aria-label="Search"
          data-testid="search"
        />
      </form>
      {open && q.trim() && (
        <div className="menu absolute inset-x-0 top-12 z-50 max-h-[420px] overflow-y-auto fade-in" data-testid="search-results">
          {hits === null ? (
            <p className="muted px-3 py-4 text-center text-[14px]">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="muted px-3 py-4 text-center text-[14px]">No influencer matches “{q.trim()}”.</p>
          ) : (
            hits.map((h) => (
              <Link
                key={h.handle}
                href={`/${h.handle}`}
                onClick={() => {
                  setOpen(false);
                  onDone?.();
                }}
                className="menu-item"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                {h.avatar ? <img src={h.avatar} alt="" className="avatar size-9" /> : <span className="avatar size-9" />}
                <span className="min-w-0 flex-1">
                  <span className="name block truncate text-[14px]">{h.displayName}</span>
                  <span className="muted block truncate text-[12.5px]">@{h.handle}</span>
                </span>
                {h.ticker && (
                  <span className="text-right text-[12px]">
                    <span className="block font-semibold text-ink">${h.ticker}</span>
                    <span className="num muted block">{usd(h.mcapUsd)}</span>
                  </span>
                )}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AccountMenu({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const w = useWallet();
  return (
    <div className="menu absolute right-0 top-12 z-50 w-[250px] fade-in" data-testid="account-menu">
      {w.session && (
        <>
          <Link href="/me" className="menu-item" onClick={onClose}>
            <UserIcon size={19} /> Your influencers
          </Link>
          <Link href="/earnings" className="menu-item" onClick={onClose}>
            <CoinIcon size={19} /> Earnings
          </Link>
          <Link href="/notifications" className="menu-item md:hidden" onClick={onClose}>
            <BellIcon size={19} /> Notifications
          </Link>
        </>
      )}
      <button type="button" className="menu-item" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} data-testid="theme-toggle">
        <MoonIcon size={19} /> {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>
      <Link href="/docs" className="menu-item" onClick={onClose}>
        <DocIcon size={19} /> How it works
      </Link>
      <Link href="/ledger" className="menu-item" onClick={onClose}>
        <LedgerIcon size={19} /> Ledger
      </Link>
      <div className="mx-2 my-1 h-px bg-[var(--line)]" />
      {w.session ? (
        <button
          type="button"
          className="menu-item"
          onClick={async () => {
            await signOut();
            onClose();
          }}
        >
          <LogoutIcon size={19} /> Sign out
        </button>
      ) : (
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            openWalletDialog();
            onClose();
          }}
        >
          <WalletIcon size={19} /> Sign in with a wallet
        </button>
      )}
    </div>
  );
}

function WalletButton() {
  const w = useWallet();
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative">
      {w.session ? (
        <button type="button" className="flex h-10 items-center gap-2 rounded-full border bg-[var(--card)] pl-1.5 pr-3 hover:bg-[var(--soft)]" onClick={() => setMenu((m) => !m)} data-testid="wallet-button">
          <span className="inline-block size-7 rounded-full" style={{ background: "var(--grad)" }} aria-hidden="true" />
          <span className="num hidden text-[13px] font-semibold text-ink sm:inline">{short(w.session)}</span>
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ink h-10" onClick={openWalletDialog} data-testid="connect">
            Sign in
          </button>
          <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setMenu((m) => !m)}>
            <MenuIcon size={20} />
          </button>
        </div>
      )}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} aria-hidden="true" />
          <AccountMenu onClose={() => setMenu(false)} />
        </>
      )}
    </div>
  );
}

/** Sticky top bar: wordmark + sections left, search centre, Create + notifications + wallet right. */
export function TopBar() {
  const path = usePathname();
  const [search, setSearch] = useState(false);
  const is = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <header className="topbar">
      <div className="mx-auto flex h-full max-w-[1240px] items-center gap-3 px-4 md:gap-5 md:px-6">
        <Link href="/" aria-label="FYPAD home" className="flex-none">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Sections">
          <Link href="/" className="navlink" data-active={is("/")}>
            Home
          </Link>
          <Link href="/explore" className="navlink" data-active={is("/explore")}>
            Explore
          </Link>
          <Link href="/rising" className="navlink" data-active={is("/rising")}>
            Rising
          </Link>
        </nav>
        <div className="mx-auto hidden w-full max-w-[420px] md:block">
          <Search />
        </div>
        <div className="ml-auto flex items-center gap-1.5 md:ml-0 md:gap-2">
          <button type="button" className="icon-btn md:hidden" aria-label="Search" onClick={() => setSearch((s) => !s)}>
            <SearchIcon size={20} />
          </button>
          <button type="button" className="btn btn-primary hidden h-10 md:inline-flex" onClick={() => openCreate()} data-testid="nav-create">
            <SparkIcon size={16} /> Create influencer
          </button>
          <Link href="/notifications" className="icon-btn hidden md:inline-flex" aria-label="Notifications" data-active={is("/notifications")}>
            <BellIcon size={20} />
          </Link>
          <WalletButton />
        </div>
      </div>
      {search && (
        <div className="border-b bg-[var(--bg)] px-4 py-3 md:hidden">
          <Search autoFocus onDone={() => setSearch(false)} />
        </div>
      )}
    </header>
  );
}

/** Phone: a floating tab bar with Create in the middle. */
export function MobileTabBar() {
  const path = usePathname();
  const w = useWallet();
  const is = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="tabbar" aria-label="Tabs">
      <Link href="/" className="tab" data-active={is("/")}>
        <HomeIcon size={22} filled={is("/")} />
        Home
      </Link>
      <Link href="/explore" className="tab" data-active={is("/explore")}>
        <CompassIcon size={22} filled={is("/explore")} />
        Explore
      </Link>
      <button type="button" className="tab" onClick={() => openCreate()} aria-label="Create influencer">
        <span className="-mt-1 inline-flex size-11 items-center justify-center rounded-full text-white shadow-[0_8px_18px_-6px_rgba(123,97,255,0.7)]" style={{ background: "var(--grad)" }}>
          <PlusIcon size={22} />
        </span>
      </button>
      <Link href="/rising" className="tab" data-active={is("/rising")}>
        <RisingIcon size={22} />
        Rising
      </Link>
      {w.session ? (
        <Link href="/me" className="tab" data-active={is("/me")}>
          <UserIcon size={22} />
          You
        </Link>
      ) : (
        <button type="button" className="tab" onClick={openWalletDialog}>
          <UserIcon size={22} />
          Sign in
        </button>
      )}
    </nav>
  );
}

