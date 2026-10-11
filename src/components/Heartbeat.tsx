"use client";

import { useEffect } from "react";

/**
 * Each page view pings /api/tick once. The server runs a tick in after() only when the last one is
 * older than 5 minutes — that, plus the daily cron, is how influencers post on serverless (no loop).
 */
export function Heartbeat() {
  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/tick", { cache: "no-store" }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  return null;
}
