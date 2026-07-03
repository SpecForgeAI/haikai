/**
 * Live Run theme — "Orchid Blueprint": a purple/lilac pack (user-picked),
 * in TWO modes. DEFAULT IS LIGHT (user decision); a toggle flips to dark.
 * One palette object owns every color — chrome, node kinds, lifecycle
 * states, edges — so both modes stay in the same family: lavender-white
 * lights, deep-violet darks, and purple-harmonized semantics (teal pass,
 * rose fail, orchid repair).
 */

export interface LiveTheme {
  name: "light" | "dark";
  chrome: {
    bg: string; panel: string; panelBorder: string; canvasDot: string;
    text: string; textMuted: string; accent: string; accentHi: string;
    nodeBg: string; badgeText: string; shadow: string;
  };
  kind: Record<string, string>;
  state: Record<string, string>;
  edge: Record<string, { stroke: string; dash?: string }>;
}

export const LIGHT: LiveTheme = {
  name: "light",
  chrome: {
    bg: "#f6f4fb",         // lavender-white canvas
    panel: "#ffffff",
    panelBorder: "#e3ddf3",
    canvasDot: "#d8d0ee",
    text: "#2e2454",       // deep-violet ink
    textMuted: "#7d729e",
    accent: "#7c3aed",
    accentHi: "#6d28d9",
    nodeBg: "#ffffff",
    badgeText: "#ffffff",
    shadow: "rgba(76,29,149,0.14)",
  },
  kind: {
    run: "#6d28d9", command: "#8b5cf6", group: "#7c3aed", ci: "#c026d3",
    cell: "#6366f1", gate: "#9d7bea", repair: "#d946ef", attempt: "#a78bfa",
  },
  state: {
    pending: "#a49bc4", ready: "#8b7fd6", running: "#7c3aed",
    pass: "#0d9488", fail: "#e11d48", skipped: "#a49bc4",
    timeout: "#d97706", cancelled: "#a49bc4", escalated: "#c026d3",
  },
  edge: {
    sequence: { stroke: "#b3a7de" },
    depends_on: { stroke: "#d97706" },
    spawns: { stroke: "#c026d3", dash: "6 3" },
    repair_of: { stroke: "#e11d48", dash: "4 3" },
    binds: { stroke: "#7c3aed", dash: "2 3" },
    contains: { stroke: "#d8d0ee", dash: "1 4" },
  },
};

export const DARK: LiveTheme = {
  name: "dark",
  chrome: {
    bg: "#0e0a1f",         // deep violet-black canvas
    panel: "#171030",
    panelBorder: "#2b2150",
    canvasDot: "#2b2150",
    text: "#ede9fe",       // lavender-white ink
    textMuted: "#8b7fb8",
    accent: "#a78bfa",
    accentHi: "#c4b5fd",
    nodeBg: "#171030",
    badgeText: "#0e0a1f",
    shadow: "rgba(0,0,0,0.45)",
  },
  kind: {
    run: "#7c3aed", command: "#a78bfa", group: "#8b5cf6", ci: "#d946ef",
    cell: "#818cf8", gate: "#c4b5fd", repair: "#f0abfc", attempt: "#ddd6fe",
  },
  state: {
    pending: "#6b6394", ready: "#9d8fd6", running: "#c4b5fd",
    pass: "#5eead4", fail: "#fb7185", skipped: "#7d759e",
    timeout: "#fdba74", cancelled: "#7d759e", escalated: "#e879f9",
  },
  edge: {
    sequence: { stroke: "#6d5fa8" },
    depends_on: { stroke: "#fdba74" },
    spawns: { stroke: "#d946ef", dash: "6 3" },
    repair_of: { stroke: "#fb7185", dash: "4 3" },
    binds: { stroke: "#a78bfa", dash: "2 3" },
    contains: { stroke: "#443a6d", dash: "1 4" },
  },
};

export const THEMES = { light: LIGHT, dark: DARK } as const;
export const DEFAULT_MODE: keyof typeof THEMES = "light";

export const STATE_GLYPH: Record<string, string> = {
  pending: "○", ready: "◍", running: "◐", pass: "✓", fail: "✗",
  skipped: "⤼", timeout: "⏱", cancelled: "⊘", escalated: "⚠",
};

export const stateColor = (t: LiveTheme, s: string) =>
  t.state[s] ?? t.state.pending;
export const kindColor = (t: LiveTheme, k: string) =>
  t.kind[k] ?? t.chrome.accent;

/** hex + alpha → rgba() for tinted fills */
export function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
