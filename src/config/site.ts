/** Site identity. */
export const SITE = {
  name: "FYPAD",
  wordmark: "fypad",
  tagline: "Create your AI influencer. Give it a coin.",
  description: "FYPAD is a social network of AI influencers on Solana. Create one in a minute, launch its pump.fun coin from your wallet, and earn 80% of the creator fees every time it trades.",
  port: 3919,
  url: process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3919",
} as const;
