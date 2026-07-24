/**
 * Per-format capture expansion (Spec 2026-07-24).
 *
 * A dual-format route is ONE architecture endpoint (an OAS would not duplicate
 * it either) whose discovered name carries the media-type discriminator, e.g.
 * `POST /x/{id} [consumes=APPLICATION_JSON,APPLICATION_XML;produces=...]`.
 * But from a CAPTURE / spec / reconciliation perspective both wire formats
 * must be baselined. Multiplicity therefore lives where multiplicity already
 * lives — capture OPERATIONS (session work items), never architecture rows:
 *
 *   one endpoint row  →  one parsed spec operation  →  N format-variant
 *   operations (`opId [format=application/json]`, `opId [format=application/xml]`),
 *   each steered with its own Content-Type/Accept.
 *
 * Everything downstream is per-operation already, so coverage, the happy-path
 * gate (which therefore DEMANDS both formats — user decision, option a),
 * closure, exclusion and baseline items all work per-format with no further
 * change. The `[format=...]` suffix deliberately does NOT match the
 * reconciliation discriminator grammar (consumes|produces|headers|params), so
 * variant operations key BARE and account their single endpoint row.
 *
 * Also owns the Java-constant → media-type translation: discovery folds
 * annotation CONSTANTS (`APPLICATION_JSON`) into the name suffix, which are
 * not valid wire media types (`application/json`).
 */
import type { ParsedOasInventory, ParsedOasOperation } from '../types/oas';
import {
  restDiscriminator,
  parseContentDiscriminator,
} from '../routes/addOperationSupport';

/** Jakarta/JAX-RS MediaType constant names → real media types. */
const MEDIA_TYPE_CONSTANTS: Record<string, string> = {
  APPLICATION_JSON: 'application/json',
  APPLICATION_XML: 'application/xml',
  TEXT_XML: 'text/xml',
  TEXT_PLAIN: 'text/plain',
  TEXT_HTML: 'text/html',
  APPLICATION_ATOM_XML: 'application/atom+xml',
  APPLICATION_XHTML_XML: 'application/xhtml+xml',
  APPLICATION_SVG_XML: 'application/svg+xml',
  APPLICATION_FORM_URLENCODED: 'application/x-www-form-urlencoded',
  MULTIPART_FORM_DATA: 'multipart/form-data',
  APPLICATION_OCTET_STREAM: 'application/octet-stream',
  WILDCARD: '*/*',
};

/**
 * Normalise a declared media type: real types (`application/json`) pass
 * through lower-cased; annotation constants (`APPLICATION_JSON`,
 * `MediaType.APPLICATION_XML`) translate; anything unrecognised → null
 * (dropped — never invent a wire value).
 */
export function normaliseMediaType(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let v = raw.trim();
  if (v.length === 0) return null;
  const dot = v.lastIndexOf('.');
  if (dot >= 0) v = v.slice(dot + 1); // MediaType.APPLICATION_JSON → APPLICATION_JSON
  if (v.includes('/')) return v.toLowerCase();
  const mapped = MEDIA_TYPE_CONSTANTS[v.toUpperCase()];
  return mapped ?? null;
}

/** The declared request/response media types off an endpoint NAME suffix. */
export function endpointDeclaredFormats(name: string | null | undefined): {
  consumes: string[];
  produces: string[];
} {
  const parsed = parseContentDiscriminator(restDiscriminator(name ?? null));
  const norm = (list: string[]) => {
    const out: string[] = [];
    for (const m of list) {
      const n = normaliseMediaType(m);
      if (n && !out.includes(n)) out.push(n);
    }
    return out;
  };
  return { consumes: norm(parsed.consumes), produces: norm(parsed.produces) };
}

/** Template identity with positional params: `/a/{x}` ≡ `/a/{y}`. */
function normalisePathTemplate(path: string): string {
  return path.replace(/\{[^}]*\}/g, '{}');
}

/** Minimal endpoint slice the expansion reads (AMS snake_case model rows). */
export interface FormatExpansionEndpoint {
  name?: unknown;
  operation_verb?: unknown;
  path_or_address?: unknown;
}

/**
 * Expand a parsed inventory's operations per declared endpoint format. Pure.
 *
 * For each inventory operation whose verb+path (positional-param identity)
 * matches EXACTLY ONE committed endpoint declaring ≥2 distinct media types
 * (produces preferred, else consumes), the single operation is replaced by one
 * variant per format. Guards (each leaves the operation untouched):
 *   - multiple inventory operations already share the route (the spec already
 *     splits formats — never multiply an existing split);
 *   - zero or ambiguous (>1) endpoint matches for the route;
 *   - fewer than 2 distinct normalised media types.
 */
export function expandInventoryOperationsForFormats(
  inventory: ParsedOasInventory,
  endpoints: ReadonlyArray<FormatExpansionEndpoint>,
): ParsedOasInventory {
  // Route → endpoints on it (positional identity).
  const endpointsByRoute = new Map<string, FormatExpansionEndpoint[]>();
  for (const ep of endpoints) {
    const verb = typeof ep.operation_verb === 'string' ? ep.operation_verb.trim().toUpperCase() : '';
    const path = typeof ep.path_or_address === 'string' ? ep.path_or_address.trim() : '';
    if (!verb || !path) continue;
    const key = `${verb} ${normalisePathTemplate(path)}`;
    const list = endpointsByRoute.get(key) ?? [];
    list.push(ep);
    endpointsByRoute.set(key, list);
  }

  // Route → inventory-operation count (skip expansion on already-split routes).
  const opCountByRoute = new Map<string, number>();
  for (const op of inventory.operations) {
    const key = `${op.method.toUpperCase()} ${normalisePathTemplate(op.path)}`;
    opCountByRoute.set(key, (opCountByRoute.get(key) ?? 0) + 1);
  }

  const expanded: ParsedOasOperation[] = [];
  for (const op of inventory.operations) {
    const key = `${op.method.toUpperCase()} ${normalisePathTemplate(op.path)}`;
    const matches = endpointsByRoute.get(key) ?? [];
    if (matches.length !== 1 || (opCountByRoute.get(key) ?? 0) > 1) {
      expanded.push(op);
      continue;
    }
    const declared = endpointDeclaredFormats(
      typeof matches[0].name === 'string' ? (matches[0].name as string) : null,
    );
    const formats = declared.produces.length >= 2 ? declared.produces : declared.consumes;
    if (formats.length < 2) {
      expanded.push(op);
      continue;
    }
    for (const format of formats) {
      // Request media type: the same format when the endpoint consumes it,
      // else its first declared consumes (else the format itself).
      const contentType = declared.consumes.includes(format)
        ? format
        : declared.consumes[0] ?? format;
      const baseOas = (op.oasOperation ?? {}) as Record<string, unknown>;
      expanded.push({
        ...op,
        operationId: `${op.operationId} [format=${format}]`,
        summary: op.summary ? `${op.summary} (${format})` : `(${format})`,
        oasOperation: {
          ...baseOas,
          operationId: `${op.operationId} [format=${format}]`,
          requestBody: { content: { [contentType]: {} } },
          'x-amvs-content': { consumes: [contentType], produces: [format] },
          'x-amvs-format-of': op.operationId,
        } as unknown as ParsedOasOperation['oasOperation'],
      });
    }
  }
  return { ...inventory, operations: expanded };
}
