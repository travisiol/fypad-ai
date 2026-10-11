import { ImageResponse } from "next/og";
import { db } from "@/server/db";
import { liveByHandle } from "@/server/influencers";
import { activeLaunchFor } from "@/server/launch";
import { readStats } from "@/server/market";
import { getMedia, mediaBytes } from "@/server/media";
import { usd } from "@/lib/show";

export const alt = "AI influencer on FYPAD";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share card for X: avatar, @handle, $TICKER and market cap (real figure or "—"). */
export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const d = await db();
  const i = await liveByHandle(d, decodeURIComponent(handle).toLowerCase()).catch(() => null);
  let avatar: string | null = null;
  let ticker: string | null = null;
  let mcap: number | null = null;
  if (i) {
    const m = i.portraitMediaId ? await getMedia(d, i.portraitMediaId) : null;
    const bytes = m ? await mediaBytes(m) : null;
    if (m && bytes && /png|jpeg/.test(m.mime)) avatar = `data:${m.mime};base64,${bytes.toString("base64")}`;
    const l = await activeLaunchFor(d, i.id);
    if (l?.status === "confirmed") {
      ticker = l.ticker;
      mcap = (await readStats(d, [l.mint])).get(l.mint)?.mcapUsd ?? null;
    }
  }
  const grad = "linear-gradient(135deg, #FF3D7F 0%, #7B61FF 100%)";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#F6F5F2", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: grad, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 40, fontWeight: 800 }}>f</div>
            <div style={{ fontSize: 40, fontWeight: 800, color: "#0F0F12", letterSpacing: -2 }}>fypad</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
            <div style={{ display: "flex", padding: 8, borderRadius: 999, background: grad }}>
              <div style={{ display: "flex", padding: 8, borderRadius: 999, background: "#fff" }}>
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img
                  <img src={avatar} width={260} height={260} style={{ borderRadius: 999, objectFit: "cover" }} alt="" />
                ) : (
                  <div style={{ width: 260, height: 260, borderRadius: 999, background: "#E6E4DF" }} />
                )}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 72, fontWeight: 800, color: "#000" }}>@{i?.handle ?? handle}</div>
              <div style={{ fontSize: 34, color: "#6B6B76" }}>{i ? `${i.displayName} · AI influencer` : "AI influencer on FYPAD"}</div>
              {ticker && (
                <div style={{ display: "flex", gap: 18, marginTop: 10 }}>
                  <div style={{ display: "flex", padding: "12px 26px", borderRadius: 16, background: grad, color: "#fff", fontSize: 38, fontWeight: 800 }}>${ticker}</div>
                  <div style={{ display: "flex", padding: "12px 26px", borderRadius: 16, background: "#FFFFFF", color: "#0F0F12", fontSize: 38, fontWeight: 700 }}>MC {usd(mcap)}</div>
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: 26, color: "#6B6B76" }}>Create your AI influencer. Give it a coin.</div>
        </div>
      </div>
    ),
    size,
  );
}
