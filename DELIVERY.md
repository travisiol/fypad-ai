# FYPAD — delivery report (2026-10-11)

Project: `C:\Users\wowo2\Documents\GitHub\fypad-ai` (dev port 3919; play / capture / `next start` checks on 3929; fake
RPC on 8919). Nothing committed, pushed or deployed; no mainnet transaction; no real funds; no coin launched for real.
`data/` (local PGlite + media) and `shots/` are gitignored; the play databases were wiped after the runs.

## Design

The first build cloned Instagram web; the owner answered « je veux pas une copie de Instagram ». Redone per the brief's
"Design — UPDATE": sticky top bar (wordmark, search, "Create influencer" gradient pill, wallet) + floating mobile tab
bar; home hero with the one-sentence prompt and real counters, "Rising now" 9:16 portrait cards, 2-column body (20 px
post cards with coin chip + mini sparkline + Buy, sticky "Top movers"); profile with blurred-portrait cover, 128 px
ringed portrait, AI badge, stat cards, coin panel (DexScreener chart, Buy, CA, fee split) beside a 12 px-gap rounded grid;
post page as two cards. Palette #F6F5F2 / #FFFFFF / #0F0F12 / #6B6B76 / #E6E4DF, gradient #FF3D7F → #7B61FF, up #12B76A,
down #F04438; Bricolage Grotesque / Inter / JetBrains Mono (next/font). Light by default, dark only from the account menu
(localStorage). No IG camera glyph, no #0095F6, no #EFEFEF, no IG gradient, no script wordmark, no left sidebar.

## Done means — status

| # | Item | Status | Proof |
|---|---|---|---|
| 1 | `npm test` | **18/18 green** | persona schema + validation, figure stripping, cadence (baseline / funded / idle / paused), budget cap → buyback, fee split config 8000/2000, launch lifecycle on the fake RPC (401/403/503 "Launching is not open yet.", rejected, failed, expired, confirmed + read-back, one coin per influencer, split read back, Collect → distribution recorded once, declined → 100 %), generation stages + retry, tick (auto-post, paid post, live facts, milestones, replies, pause, manual 3/day), social counts + notifications, market refresh, auth nonce replay, OpenAI "no credits" → neutral failure without retry |
| 2 | lint / types / build | **clean** | `npx eslint .` 0 problems; `npx next typegen && npx tsc --noEmit` clean; `npx next build` OK (36 routes). Built while the owner's `next dev` ran on 3919 — no conflict. Cold `next start` on an empty data dir: `/ /explore /rising /create /docs /ledger /earnings /notifications /me /api/health` 200, unknown handle / post 404, `POST /api/influencers` signed out → 401 "Sign in with your wallet first." |
| 3 | `npm run play` | **27/27 green** | headless Chrome over CDP, 2 stub wallets (browser contexts), fake RPC, fake AI: cold home → sign-in by signed message → hero sentence opens Create prefilled → generate (persona + photo + 3 posts, 6 s) → draft survives refresh → publish → coin → wallet declines (nothing sent) → create_v2 + 0.1 SOL buy signed + confirmed after read-back → 80/20 split signed + verified → profile live (mcap read from the curve on chain) → auto-post tick a day later publishes post 4 → 2nd wallet likes / follows / comments → reply tick answers in character → fees accrue → Collect (sweep + distribute) → 0.04 SOL recorded on Earnings → Rising lists it → owner notifications (follow, like, comment, fee payout) → no horizontal overflow at 390 px on home, profile, post, rising, earnings, create |
| 4 | `npm run play:real` | **blocked: OpenAI account has no credits** | Run once with the real key (server env only, never written to the repo; log grep for `sk-` = 0): sign-in, prefilled Create OK, then OpenAI answered `429 insufficient_quota / credit_balance_exhausted` (also confirmed by one direct 2-token call). The UI showed the neutral "Generation is not available right now. Try again later." (`shots/real-no-credits-1536.png`). No real influencer exists, so no real screenshots. Recipe once credits are added: `npm run build && npm run play:real`, then `rm -rf data/play-real`. Its DB was wiped. |
| 5 | devnet simulation | **4/4 OK** | `npm run devnet-proof` against the real devnet programs (`docs/devnet-proof-2026-10-11.txt`): create_v2 (880 B, 100 k CU), create_v2 + ATA + 0.01 SOL buy (1224 B, 187 k CU), sweep + create_fee_sharing_config + update_fee_shares_v2 [80/20] (1011 B, 203 k CU), sweep + collect_creator_fee (612 B, 47 k CU). Faucet refused the airdrop ("Internal error"), so nothing was sent; simulation used an existing devnet creator as payer, signature verification off. |
| 6 | README + `.env.example` | done | mechanic table, keys and what they unlock, serverless notes, limits, commands |

## Decisions taken

1. **Engine = FABLE's** (persistence, media, auth, wallet-standard dialog, `pump.ts`, `launch.ts`, fake RPC, CDP play),
   adapted: shareholders creator 8000 / `FYPAD_TREASURY_WALLET` 2000 (one config file: `src/config/fypad.ts`).
2. **Declined split** is a real state (`declined`): 100 % to the creator, baseline posting only; the split can still be
   signed later from Earnings.
3. **Collect** is signed by the creator (pays network fee only): split → `sweep + distribute_creator_fees_v2`; declined →
   `sweep + collect_creator_fee` (instruction from the owner's donchain engine, devnet-simulated). The fee cron also scans
   each sharing config, so anyone's distribution is recorded (once per signature).
4. **Budget**: the treasury 20 % of each distribution is credited to that influencer's posting budget up to 90 posts
   (`FYPAD_BUDGET_CAP_POSTS`), the overflow is "held for $FYPAD buyback" on /ledger. Cost per post 0.003 SOL
   (`FYPAD_COST_PER_POST_LAMPORTS`). Manual "Post now" is free (3/day).
5. **Jobs are staged** (one model call per stage) so nothing outlives a serverless function; posts kicked by `after()`,
   polling, a page-view heartbeat (`/api/tick`, ≥ 5 min apart, DB lease) and daily crons.
6. **Market data**: pump.fun's `/coins/` endpoint is gone (404) — `coins-v2` + `coins/top-holders` (holder count) +
   DexScreener batch + the curve from chain; stored in `coin_stats` with snapshots for sparklines and milestones.
   Recent trades: pump.fun's trades endpoint refuses public calls → DexScreener 24 h buys/sells instead.
7. **Reels cut**: needs `GEMINI_API_KEY` (absent), a tab that can never be filled is not shown.
8. **Clock override for tests only**: `/api/cron/tick?at=` works only with `FYPAD_ALLOW_CLOCK_OVERRIDE=1` + the cron
   secret (how the play proves "a day later it posts by itself").
9. **OpenAI out of credits** → jobs fail at once with a neutral message (not retried).
10. **Banner**: `node ../factory/src/gpt.mjs image` refused (same exhausted OpenAI account). `brand/banner-1500x500.png`
    is rendered from `brand/banner.html` (wordmark + three phone-shaped profile cards, no figures), headless Chrome.

## What is missing (owner)

- **OpenAI credits** on the key in `factory/.env` (generation, auto-posts, replies, banner art), then one `npm run play:real`.
- `FYPAD_TREASURY_WALLET` and `NEXT_PUBLIC_SITE_URL` (launching), `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`,
  `SESSION_SECRET`, `CRON_SECRET`, a keyed `SOLANA_RPC_URL`; optional `OPERATOR_SECRET_KEY`.
- **$FYPAD mint** (`NEXT_PUBLIC_MINT`): unset → nothing invented, buyback held. Note: a "FYPAD" ticker already existed on
  pump.fun on 2026-10-07.
- **Graduated coins (PumpSwap) fee sweep**: not implemented (said in README / Earnings).
- A real devnet send: put a throwaway funded devnet key in `DEVNET_SECRET` and run `npm run devnet-proof -- --send`.

## Unsure

- Anchor "None" encoding for `create_fee_sharing_config`'s optional pool accounts passed simulation; never sent on chain.
- Whether pump.fun lists coins whose metadata URI is self-hosted JSON (valid Metaplex JSON, same as FABLE).
- DexScreener's embed for a brand-new curve can take minutes to show the pair (the panel says so).

## Screenshots (`shots/`)

Fake play: `fake-home-1536.png`, `fake-home-1536-full.png`, `fake-home-empty-1536.png`, `fake-create-1-describe-1536.png`
… `fake-create-6-done-1536.png`, `fake-profile-1536.png`, `fake-profile-1536-full.png`, `fake-post-1536.png`,
`fake-post-owner-1536.png`, `fake-rising-1536.png`, `fake-earnings-1536.png`, `fake-notifications-1536.png`, and 390 px:
`fake-{home,profile,post,rising,earnings,create}-390.png`. Real run: `real-home-empty-1536.png`,
`real-create-1-describe-1536.png`, `real-no-credits-1536.png`. Fake-AI photos are generated gradient placeholders (test
only, never shipped).
