"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme";

/**
 * Small client stores (useSyncExternalStore, no effects): the Create overlay, the theme (light by
 * default, dark only by explicit choice saved in localStorage) and which stories were seen.
 */

function store<T>(initial: T, server: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(v: T) {
      value = v;
      listeners.forEach((l) => l());
    },
    use(): T {
      return useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => value,
        () => server,
      );
    },
  };
}

// ───────────────────────────── create overlay

type CreateState = { open: boolean; influencerId: string | null; idea: string | null; n: number };
const createStore = store<CreateState>({ open: false, influencerId: null, idea: null, n: 0 }, { open: false, influencerId: null, idea: null, n: 0 });
export const useCreate = createStore.use;
/** Opens Create: for an existing influencer (resume / launch its coin) or prefilled with a one-sentence idea. */
export function openCreate(influencerId: string | null = null, idea: string | null = null) {
  createStore.set({ open: true, influencerId, idea, n: createStore.get().n + 1 });
}
export function closeCreate() {
  createStore.set({ ...createStore.get(), open: false });
}

// ───────────────────────────── theme

type Theme = "light" | "dark";
function savedTheme(): Theme {
  try {
    return typeof window !== "undefined" && localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
const themeStore = store<Theme>(savedTheme(), "light");
export const useTheme = themeStore.use;
export function setTheme(t: Theme) {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // not remembered
  }
  if (t === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  themeStore.set(t);
}

// ───────────────────────────── stories seen

const SEEN_KEY = "fypad.stories-seen";
function readSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
const seenStore = store<Record<string, number>>(typeof window !== "undefined" ? readSeen() : {}, {});
export const useSeen = seenStore.use;
export function markSeen(influencerId: string, at: number) {
  const next = { ...seenStore.get(), [influencerId]: Math.max(at, seenStore.get()[influencerId] ?? 0) };
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // not remembered
  }
  seenStore.set(next);
}
