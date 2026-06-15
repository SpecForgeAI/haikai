/**
 * OAS signature detector for the `specFileLinker` scanner sub-module.
 *
 * Spec: agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/spec.md
 *
 * Pure, side-effect-free OAS / Swagger signature detection over a
 * (filePath, content, format?) tuple. The caller (orchestrator
 * `index.ts`) has already loaded the file content via the walker;
 * the detector only parses and inspects shape.
 *
 * Public API:
 *   isOasSpecFile(filePath, contents, format?) -> { kind, parsed? }
 *
 * Recognised `kind` values:
 *  - `'openapi-3'`   -- top-level `openapi:` key with a 3.x string value.
 *  - `'swagger-2'`   -- top-level `swagger: '2.0'` key.
 *  - `'shape-based'` -- no explicit version key but the file has the
 *                      `info.title` + `info.version` + `paths` shape
 *                      (springdoc commonly emits this when configured
 *                      to skip the version sentinel).
 *  - `null`          -- not recognised as an OAS spec.
 *
 * Parsing (P-15):
 *  - YAML is parsed via `js-yaml` (registered as a direct dependency
 *    by Phase 3 Task Group 1).
 *  - JSON is parsed via `JSON.parse`.
 *  - BOTH parse paths are wrapped in a `try / catch` so that malformed
 *    YAML / JSON returns `{ kind: null }` -- the detector NEVER throws.
 *    A single bad file must not abort the scanner.
 *
 * Side effects: NONE. No I/O. No global state.
 *
 * Design-point references: P-15 (`js-yaml` for YAML parsing; soft-fail
 * parse semantics).
 */

import * as yaml from 'js-yaml';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type OasSignatureKind = 'openapi-3' | 'swagger-2' | 'shape-based' | null;

export interface DetectionResult {
  kind: OasSignatureKind;
  /** Parsed object when `kind != null`; undefined otherwise. */
  parsed?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function parseContent(
  content: string,
  format: 'yaml' | 'json',
): Record<string, unknown> | null {
  try {
    const parsed = format === 'json' ? JSON.parse(content) : yaml.load(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Test if a value is a string starting with `3.` (any 3.x version). */
function isOpenApi3Version(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return v.startsWith('3.');
}

/** Test if a value equals the swagger 2.0 string. */
function isSwagger2Version(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return v === '2.0';
}

/**
 * Shape-based detection: `info.title` + `info.version` + `paths` all
 * present, with `info` being an object and `paths` being an object.
 */
function hasInfoPathsShape(obj: Record<string, unknown>): boolean {
  const info = obj.info;
  const paths = obj.paths;
  if (!info || typeof info !== 'object' || Array.isArray(info)) return false;
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return false;
  const infoRec = info as Record<string, unknown>;
  if (typeof infoRec.title !== 'string') return false;
  if (typeof infoRec.version !== 'string') return false;
  return true;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Inspect a file's content + format and decide whether it qualifies as
 * an OpenAPI / Swagger spec under one of the three documented heuristics.
 *
 * Pure: no I/O, no global state. Soft-fail: malformed YAML / JSON
 * returns `{ kind: null }` instead of throwing.
 */
export function isOasSpecFile(
  filePath: string,
  content: string,
  format?: 'yaml' | 'json',
): DetectionResult {
  // Infer format from extension when not supplied.
  let effectiveFormat: 'yaml' | 'json';
  if (format) {
    effectiveFormat = format;
  } else {
    const lower = filePath.toLowerCase();
    effectiveFormat = lower.endsWith('.json') ? 'json' : 'yaml';
  }

  const parsed = parseContent(content, effectiveFormat);
  if (!parsed) return { kind: null };

  // Priority 1: explicit `openapi: 3.x`.
  if (isOpenApi3Version(parsed.openapi)) {
    return { kind: 'openapi-3', parsed };
  }
  // Priority 2: explicit `swagger: '2.0'`.
  if (isSwagger2Version(parsed.swagger)) {
    return { kind: 'swagger-2', parsed };
  }
  // Priority 3: shape-based (info.title + info.version + paths).
  if (hasInfoPathsShape(parsed)) {
    return { kind: 'shape-based', parsed };
  }

  return { kind: null };
}
