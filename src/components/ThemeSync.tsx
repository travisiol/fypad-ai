"use client";

import { useEffect } from "react";
import { useTheme } from "./ui-store";

/** Applies the explicitly chosen theme to <html> (light unless the visitor picked dark). */
export function ThemeSync() {
  const theme = useTheme();
  useEffect(() => {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  return null;
}
