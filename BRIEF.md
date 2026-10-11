# Brief — FYPAD (AI influencer launchpad, Solana) — 2026-10-11

Owner's words (FR, verbatim): « crée-moi un launchpad pour solana où les gens peuvent créer leur influenceur IA
directement et lier leur influenceur à un memecoin, comme ça si l'influenceur perce ils peuvent gagner de l'argent sur
solana avec les gens qui vont venir trade leur memecoin. Le nom sera fypad avec une DA du style Instagram. Tout en anglais. »

Folder: `C:\Users\wowo2\Documents\GitHub\fypad-ai` (NOT `GitHub/fypad`: that folder holds MINTV, another project — never
touch it). Port **3919** (dev + start), fake RPC **8919** when standalone. All UI copy in **English**.

## One sentence: what the user gets
You create an AI influencer in one minute, it gets its own pump.fun coin launched **from your wallet** (you are the coin's
creator of record), it posts on FYPAD every day by itself, and every trade of its coin pays you creator fees on chain.
If the influencer blows up, traders come, and you earn.

## Product

FYPAD is an Instagram-shaped social network where every profile is an AI influencer and every profile has a coin.

1. **Create** (Instagram "Create new post" modal, multi-step, sign-in required):
   1. Describe: one sentence ("a Tokyo street-style girl who only wears thrifted Y2K"), niche chips (Fashion, Fitness,
      Travel, Gaming, Crypto, Food, Music, Art, Comedy, Tech), optional vibe/visual style field.
   2. Generate → review: OpenAI writes a strict JSON-schema persona (display name, @handle, bio ≤150 chars like an IG
      bio with emoji, personality, voice, posting themes, look description used for every future image) + portrait
      (image model) + **the first 3 posts** (image in the same look + caption + hashtags). Edit any text, regenerate
      portrait / posts / everything. Drafts survive refresh (server + browser).
   3. Coin: name (default = display name), ticker (default from handle, validated against pump.fun create_v2 limits),
      description, optional X/Telegram/website, optional initial buy in SOL. Show before signing: network, what the
      wallet signs, pump.fun creation cost, the fee split (below), "You are the creator of this coin."
   4. Sign: user's wallet signs create_v2 (+ optional buy), mint keypair generated in the browser. Success only after
      confirmation + chain read-back (mint exists, curve creator = user). Then the second signature sets the fee split.
   5. Done screen: "@handle is live" + profile link + share-to-X button + copy CA.
   An influencer can also be saved without a coin and get one later (profile shows "Launch coin" to its owner only).

2. **Money (the reason to launch)** — reuse FABLE's verified pump.fun native creator fee sharing
   (`GitHub/fable`, README decision 1 + DELIVERY "Fee-sharing verification"): shareholders **creator 8000 bps /
   `FYPAD_TREASURY_WALLET` 2000 bps**, set once by the creator's second signature. pump.fun pays each share on chain at
   `distribute_creator_fees_v2` (permissionless) — FYPAD never custodies the creator's 80 %. The treasury 20 % pays the
   influencer's AI posting and $FYPAD buyback. If the creator declines the second signature, the coin keeps 100 % of fees
   for them and the influencer only posts its baseline (see 3). Put split values in one config file.
   - Creator dashboard ("Earnings" tab on your own profile / `/earnings`): per influencer — total creator fees earned
     (from recorded on-chain distributions per signature), claimable now (read from chain), a **Collect** button that
     builds + signs the permissionless sweep/distribute transaction, history with Solscan links.
   - Graduated coins (PumpSwap side): same limitation as FABLE — say it in README, don't fake it.

3. **The influencer lives on its own** (serverless-safe job runner like FABLE: `after()` + cron + lease, never a loop):
   - Baseline: 1 auto-post per day for every influencer for its first 14 days, free.
   - Then cadence scales with its treasury budget (20 % share credited per influencer from recorded distributions):
     up to 3 posts/day while budget ≥ cost per post (`FYPAD_COST_PER_POST_LAMPORTS`). After 14 days with zero budget:
     1 post every 3 days.
   - Each post: caption in its voice, aware of **live coin data** (mcap, 24h change, holders, milestones like "we just
     passed 100K mcap") but never inventing figures (strip `$`/`%`/`x` numbers not from data — IDOL's poster does this),
     image in its look (portrait passed as reference when the image API supports it), hashtags.
   - Replies: on each tick the influencer replies in character to up to 3 new top comments on its posts.
   - Owner controls (on own profile, "Edit profile" + "Manage"): pause auto-posting, write a "next post idea" prompt that
     the next post follows, post now (rate limited: 3 manual posts/day), delete a post, edit bio.
   - Stories: posts from the last 24 h appear as the stories ring (gradient ring = unseen, grey = seen, localStorage).
   - Reels: optional — only if FABLE's Veo adapter can be reused with `GEMINI_API_KEY`; otherwise no Reels tab at all
     (a tab that can never be filled is cut, not simulated).

4. **Social layer** (signed-in wallets, off-chain in the DB): follow, like (double-tap on image + heart icon), comment,
   save, share (copy link / X intent). Counts are real. Notifications page for the owner: new followers, comments,
   likes, fee distributions received, coin milestones.

5. **Pages / Instagram shell**
   - Desktop: left sidebar (wordmark, Home, Search, Explore, Rising, Create, Notifications, Profile, More → theme
     toggle, Docs, Ledger, sign out). ≤1263 px: icon rail. Mobile: top bar (wordmark, heart) + bottom tab bar.
   - `/` Home feed: stories row on top, posts from followed influencers then everyone (newest first), right column
     "Rising coins" (Suggested-for-you style: avatar, @handle, $TICKER · mcap · 24h %, Follow) + footer links.
     Signed-out visitors see the same feed (everyone's posts) with a slim "Create your AI influencer" card at the top.
   - `/explore`: IG explore grid of posts + search (handle, name, $TICKER, CA).
   - `/rising`: leaderboard table — rank, influencer, $TICKER, mcap, 24h volume, 24h %, holders, followers, posts.
     Sortable. This is how influencers "blow up": make it look like a chart-topper list.
   - `/[handle]` profile (exact IG profile layout): 150 px avatar with gradient ring (if story), @handle + Follow
     (blue #0095F6) + Message-style secondary button replaced by **"Buy $TICKER"** (gradient), ⋯ menu; stats row
     **posts · followers · holders**; display name, bio, "AI influencer" label, created by `wal…let` (owner); highlights
     row = **coin highlight** (mcap, 24h %, sparkline); tabs POSTS / COIN (/ REELS if any). COIN tab: chart
     (GeckoTerminal or DexScreener embed by mint — think as a trader: no buy without a chart), mcap, volume, holders,
     bonding-curve progress (from chain), copy CA, Buy on pump.fun / Jupiter links, creator fee split, recent trades if
     cheaply available. Owner sees Edit profile / Manage / Earnings.
   - `/p/[id]` post page (IG post modal layout on desktop: image left, comments right), each post's header line under
     the handle = coin chip `$TICKER · $42.1K` (like IG's location line).
   - `/create` (the modal flow, also opened as overlay from the sidebar), `/earnings`, `/notifications`, `/docs` (how it
     works, fee split, what's on chain vs off chain, risks), `/ledger` (every FYPAD-side transfer + recorded
     distributions with Solscan links), `/api/health`.
   - Per-profile **OpenGraph image** (avatar, @handle, $TICKER, mcap) so shares on X look good.

6. **Platform token $FYPAD**: `NEXT_PUBLIC_MINT` unset → nothing invented; the treasury buyback part is held and shown as
   held on `/ledger`. Note: a "FYPAD" ticker already existed on pump.fun on 2026-10-07 — owner's naming choice, report it.

## Design — UPDATE 2026-10-11 (owner: « je veux pas une copie de Instagram ») — this section REPLACES the one below
Instagram-*flavoured*, not an Instagram copy. Keep only the social codes people know: story rings, photo-first posts,
double-tap heart, profile with a post grid, follow/like/comment. Everything else is FYPAD's own:
- **Banned** (all IG-identifying): left sidebar nav, the 470 px feed column + "Suggested for you" right column, system
  font stack, Grand Hotel/any script wordmark, IG sunset gradient (#FEDA75…#4F5BD5), #0095F6 blue buttons, #EFEFEF grey
  buttons, IG camera glyph (also in empty states), "N likes" + uppercase timestamp post anatomy, IG profile header copy.
- **Layout**: sticky top bar (wordmark left, search centre, "Create influencer" gradient pill + wallet right); mobile =
  top bar + our own bottom tab bar. Home: hero "Create an AI influencer. Give it a coin." with the one-sentence prompt
  input inline (→ opens Create prefilled) + real counters (influencers, coins, fees paid to creators); "Rising now" row
  of large 9:16 portrait cards (portrait, ring, @handle, $TICKER, mcap, 24h %); then a 2-column body: post feed (rounded
  20 px cards, image 4:5, coin chip with mini sparkline + Buy on every post) + sticky "Top movers" leaderboard on the
  right. Profile: soft blurred-portrait cover band, 128 px portrait with ring, name, @handle, "AI" badge, bio, stat cards
  (followers, holders, mcap, 24h volume), coin panel (chart + Buy + CA + fee split) beside/above a 3-column post grid
  (12 px gaps, rounded tiles). Post page: image + side panel, but in our card style.
- **Palette**: bg `#F6F5F2` (warm paper), cards `#FFFFFF`, ink `#0F0F12`, muted `#6B6B76`, lines `#E6E4DF`; brand
  gradient `#FF3D7F → #7B61FF` (rings, primary pills, logo); up `#12B76A`, down `#F04438`, like heart `#FF3D7F`.
  Dark mode only by explicit toggle: bg `#0E0E11`, cards `#17171C`, lines `#26262E`, ink `#F4F4F6`, muted `#9A9AA6`.
- **Type**: display **Bricolage Grotesque** 700–800 (headlines, names, wordmark), body **Inter**, numbers **JetBrains
  Mono**. Wordmark: lowercase "fypad" in Bricolage 800 with a small gradient sparkle dot.
- Shapes: radius 16–24, pill buttons, soft shadows; own icon set (rounded 2 px outline). Logo/favicon: gradient
  rounded tile with a white "f" + sparkle — redraw icon.svg accordingly.

## Design — Instagram style (SUPERSEDED by the update above; keep only what doesn't conflict)
Look like Instagram web, not "inspired by": same density, same metrics, same component shapes. Light by default (dark
only by explicit toggle in More, saved in localStorage — never inferred from the system).
- Colours: bg `#FFFFFF`, secondary bg `#FAFAFA`, separators `#DBDBDB`, text `#000000` / `#262626`, secondary text
  `#737373`, primary button / link `#0095F6` (hover `#1877F2`), secondary button `#EFEFEF`, like red `#FF3040`.
  Brand gradient (story ring, Buy buttons, logo tile): `#FEDA75 → #FA7E1E → #D62976 → #962FBF → #4F5BD5`.
  Dark mode: bg `#000`, elevated `#121212`, separators `#262626`, text `#F5F5F5`, secondary `#A8A8A8`.
- Type: system stack like Instagram (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
  sans-serif`), 14 px base, 600 for handles. Wordmark "fypad" in a script face (Google Font **Grand Hotel**).
- Icons: outline 24 px, 2 px stroke (draw our own SVGs: home, search, compass, chart-up for Rising, plus-square,
  heart, user, menu, comment, share/paper-plane, bookmark). Never Instagram's logo or camera glyph.
- Logo / favicon: rounded-square tile with the brand gradient and a white bold rounded "f" with a small sparkle (AI).
  Generate a banner 1500×500 (X header) with `node ../factory/src/gpt.mjs` (read its usage first), wordmark + three
  phone-shaped profile cards; save to `brand/`.
- Every post card: 470 px column, header 54 px (32 px avatar with ring, handle bold, `· 2h`, coin chip line, ⋯), media
  4:5, action row (heart, comment, share | bookmark), "N likes", caption with bold handle, "View all N comments",
  comment input. Profile grid: 3 columns, 4 px gaps (1:1 or 3:4 tiles), hover shows ♥ count + 💬 count.
- "AI influencer" disclosure is a small grey label on profile and post header (honesty + it fits IG's "Meta AI" tags).
- Empty states real and IG-like: "No posts yet", "When people follow @x, they'll appear here". **No demo mode, no
  "pre-launch"/"not configured" banners, no disabled buttons for missing config**: a click on an action that can't run
  answers a neutral sentence ("Launching is not open yet."). Missing keys go in README, never in the UI.
  No fake influencers, no fake numbers, no sample content in the shipped DB.

## Stack + what to reuse (read before writing code)
- Next 16 (read `node_modules/next/dist/docs/` for anything you're unsure of — AGENTS.md rule), React 19, Tailwind 4.
- **Start from FABLE** (`GitHub/fable`): copy its persistence (Postgres `DATABASE_URL` + PGlite fallback, migrations),
  media (Vercel Blob / disk), jobs with leases, auth (signed message → cookie), wallet-standard dialog (no adapter
  packages), `pump.ts` / `launch.ts` (create_v2 signed by the user + native fee sharing + chain read-back),
  `scripts/devnet-proof.ts`, fake RPC tests, CDP play script. Read its README, DELIVERY.md, BRIEF.md.
- From **IDOL** (`GitHub/idol`): `personas.ts` (JSON-schema persona + portrait), `poster.ts` (posts from persona + live
  coin data, figure stripping), market-data.
- Market data: pump.fun `frontend-api-v3.pump.fun/coins-v2/<mint>` (browser UA, cached) with DexScreener fallback, and
  curve state from chain — as FABLE/CLIPR do.
- OpenAI key for real-run verification: `../factory/.env` (`OPENAI_API_KEY`) — load it into the server env only for a
  local `play:real` run, never write it into this repo. Calling OpenAI for testing is allowed.

## Engineering rules (from past projects — read these memory files first)
`C:\Users\wowo2\.claude\projects\C--Users-wowo2-Documents-GitHub-dustland\memory\`:
`tailwind-layer-trap.md`, `react-19-lint-rules.md`, `next-usesearchparams-bailout.md`, `vercel-serverless-first.md`,
`headless-chrome-capture.md`, `gitbash-taskkill-pathconv.md`, `bash-heredoc-limit.md`, `no-prelaunch-labels.md`,
`think-as-the-user.md`, `first-look-is-light-and-simple.md`, `fable-project.md`.
- Everything must run on Vercel serverless (he hosts there): `vercel.json` with daily crons, `after()` + `maxDuration`,
  test cold in `next build` + `next start` with an empty data dir.
- `.gitignore` before `npm install` (`node_modules/`, `.next/`, data dirs, `.env*` except `.env.example`).
- No `git init`, no commit, no push, no deploy, no mainnet transaction, no real funds.
- Add a `fypad` entry to `C:\Users\wowo2\Documents\GitHub\dustland\.claude\launch.json` (re-read it right before writing;
  other sessions write to it): `npm --prefix ../fypad-ai run dev`, port 3919. Check `netstat -ano` before starting a
  server; if 3919 is taken by another process, pick another non-round port and say so.

## Done means (prove each, write results in `DELIVERY.md`)
1. `npm test` green (fake RPC + fake AI): persona schema, poster figure stripping, cadence/budget rules, fee split
   config, launch row lifecycle, social counts, auth.
2. `npx eslint .`, `npx next typegen && npx tsc --noEmit`, `npx next build` clean.
3. `npm run play` (headless Chrome via CDP, stub wallet, fake RPC, fake AI): sign in → create influencer → review →
   coin → sign create → sign split → profile live → auto-post tick creates a post → like/comment/follow from a second
   wallet → reply tick → earnings tab shows a recorded distribution → rising shows it. Screenshots 1536 + 390 of home,
   profile, post, create steps, rising, earnings into `shots/`.
4. `npm run play:real` once with the real OpenAI key: one real influencer generated (portrait + 3 posts) — keep those
   screenshots; then wipe that local DB so nothing ships seeded.
5. Devnet simulation of the 2 transactions (create_v2 [+buy] and split 8000/2000) against the real programs, like
   FABLE's `devnet-proof`.
6. README (mechanic table, keys and what they unlock, serverless notes, commands) + `.env.example` documented.
Report at the end: what is real, what is proven how, what's missing (keys, $FYPAD mint, treasury wallet, graduated-coin
fee sweep), and the decisions you took.
