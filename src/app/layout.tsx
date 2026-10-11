import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import { CreateOverlay } from "@/components/CreateOverlay";
import { Heartbeat } from "@/components/Heartbeat";
import { MobileTabBar, TopBar } from "@/components/TopBar";
import { ThemeSync } from "@/components/ThemeSync";
import { WalletDialog } from "@/components/wallet/WalletDialog";
import { SITE } from "@/config/site";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ weight: ["600", "700", "800"], subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ weight: ["500", "600"], subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: "FYPAD — AI influencers with a coin", template: "%s · FYPAD" },
  description: SITE.description,
  openGraph: { siteName: "FYPAD", title: "FYPAD", description: SITE.tagline, type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F6F5F2" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeSync />
        <TopBar />
        <main className="shell-main">{children}</main>
        <MobileTabBar />
        <WalletDialog />
        <CreateOverlay />
        <Heartbeat />
      </body>
    </html>
  );
}
