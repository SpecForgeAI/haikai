/**
 * Live Run theme — "Orchid Blueprint": a purple/lilac pack (user-picked).
 *
 * ONE palette drives everything: page chrome, node kinds, lifecycle states,
 * edges, minimap. Deep-violet darks, lilac lights; semantic colors chosen as
 * purple-family harmonies (teal-mint pass, rose fail, orchid repair) so
 * every hue sits with the theme instead of fighting it.
 */

export const CHROME = {
  bg: "#0e0a1f",        // deep violet-black canvas
  panel: "#171030",     // sidebar / cards
  panelBorder: "#2b2150",
  canvasDot: "#2b2150",
  text: "#ede9fe",      // lavender-white
  textMuted: "#8b7fb8",
  accent: "#a78bfa",    // primary lilac
  accentHi: "#c4b5fd",
  selection: "#4c1d95",
};

/** node_kind → hue (all purple-family, dark→light across the hierarchy) */
export const KIND = {
  run: "#7c3aed",
  command: "#a78bfa",
  group: "#8b5cf6",
  ci: "#d946ef",
  cell: "#818cf8",
  gate: "#c4b5fd",
  repair: "#f0abfc",
  attempt: "#ddd6fe",
} as const;

/** lifecycle state → color (harmonized semantics) */
export const STATE = {
  pending: "#6b6394",
  ready: "#9d8fd6",
  running: "#c4b5fd",
  pass: "#5eead4",
  fail: "#fb7185",
  skipped: "#7d759e",
  timeout: "#fdba74",
  cancelled: "#7d759e",
  escalated: "#e879f9",
} as const;

export const STATE_GLYPH: Record<string, string> = {
  pending: "○", ready: "◍", running: "◐", pass: "✓", fail: "✗",
  skipped: "⤼", timeout: "⏱", cancelled: "⊘", escalated: "⚠",
};

export const EDGE: Record<string, { stroke: string; dash?: string }> = {
  sequence: { stroke: "#6d5fa8" },
  depends_on: { stroke: "#fdba74" },
  spawns: { stroke: "#d946ef", dash: "6 3" },
  repair_of: { stroke: "#fb7185", dash: "4 3" },
  binds: { stroke: "#a78bfa", dash: "2 3" },
  contains: { stroke: "#443a6d", dash: "1 4" },
};

export const stateColor = (s: string) =>
  STATE[s as keyof typeof STATE] ?? STATE.pending;
export const kindColor = (k: string) =>
  KIND[k as keyof typeof KIND] ?? CHROME.accent;

/** hex + alpha → rgba() for tinted fills */
export function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
