/**
 * Viewport Utility Functions
 * Task Group 1: Infrastructure Layer for Viewport-Centered Node Spawn
 *
 * Provides shared helper functions for calculating viewport center position.
 * Used by all node creation paths to spawn nodes at the visible center of the canvas.
 */

/**
 * ViewportInfo interface representing the visible region of the canvas.
 * This matches the interface exported from Canvas.tsx for consistency.
 */
export interface ViewportInfo {
  scrollX: number;  // Left edge of visible area in canvas coordinates
  scrollY: number;  // Top edge of visible area in canvas coordinates
  width: number;    // Width of visible area (adjusted for zoom)
  height: number;   // Height of visible area (adjusted for zoom)
}

/**
 * Default canvas center position used when viewport info is unavailable.
 * Based on default canvas size of 2000x2000 pixels.
 */
export const DEFAULT_CANVAS_CENTER = {
  x: 1000,
  y: 1000,
};

/**
 * Calculate the center point of the currently visible viewport.
 *
 * This is the single source of truth for determining where to spawn new nodes.
 * All node creation paths should use this function to ensure consistency.
 *
 * @param viewportInfo - The current viewport state, or null/undefined if unavailable
 * @returns The center point {x, y} where new nodes should be spawned
 *
 * @example
 * // With viewport info
 * const center = getViewportCenter({ scrollX: 100, scrollY: 200, width: 800, height: 600 });
 * // Returns { x: 500, y: 500 } (100 + 800/2, 200 + 600/2)
 *
 * @example
 * // Without viewport info (fallback)
 * const center = getViewportCenter(null);
 * // Returns { x: 1000, y: 1000 } (canvas center)
 */
export function getViewportCenter(
  viewportInfo: ViewportInfo | null | undefined
): { x: number; y: number } {
  // Fallback to canvas center when viewport info is unavailable
  if (!viewportInfo) {
    return { ...DEFAULT_CANVAS_CENTER };
  }

  // Calculate center of the visible viewport
  return {
    x: viewportInfo.scrollX + viewportInfo.width / 2,
    y: viewportInfo.scrollY + viewportInfo.height / 2,
  };
}

/**
 * Calculate viewport center with explicit zoom handling.
 * This variant accepts raw scroll/size values and a zoom scale,
 * computing the viewport info internally.
 *
 * @param scrollLeft - Raw scroll container scrollLeft value
 * @param scrollTop - Raw scroll container scrollTop value
 * @param clientWidth - Raw container clientWidth value
 * @param clientHeight - Raw container clientHeight value
 * @param zoomScale - Current zoom level (1.0 = 100%)
 * @returns The center point {x, y} in canvas coordinates
 */
export function getViewportCenterFromRaw(
  scrollLeft: number,
  scrollTop: number,
  clientWidth: number,
  clientHeight: number,
  zoomScale: number
): { x: number; y: number } {
  // Convert raw values to canvas coordinates by dividing by zoom scale
  const viewportInfo: ViewportInfo = {
    scrollX: scrollLeft / zoomScale,
    scrollY: scrollTop / zoomScale,
    width: clientWidth / zoomScale,
    height: clientHeight / zoomScale,
  };

  return getViewportCenter(viewportInfo);
}

/**
 * Type for a function that returns the current viewport center on-demand.
 * This is used to get fresh viewport data at the exact moment of a click,
 * avoiding stale state issues.
 */
export type GetViewportCenterFn = () => { x: number; y: number };
