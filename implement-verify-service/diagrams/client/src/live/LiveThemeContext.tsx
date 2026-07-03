/** Theme mode context for the Live Run view — default LIGHT (user decision),
 * persisted to localStorage under "liverun-theme". */
import { createContext, useContext } from "react";
import { DEFAULT_MODE, THEMES, type LiveTheme } from "./theme";

export const LiveThemeContext = createContext<LiveTheme>(THEMES[DEFAULT_MODE]);
export const useLiveTheme = () => useContext(LiveThemeContext);

export function loadThemeMode(): keyof typeof THEMES {
  try {
    const saved = window.localStorage.getItem("liverun-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* SSR / privacy mode */ }
  return DEFAULT_MODE;
}

export function saveThemeMode(mode: keyof typeof THEMES): void {
  try { window.localStorage.setItem("liverun-theme", mode); } catch { /* noop */ }
}
