/**
 * Format-twin deterministic mirror (2026-08-02).
 *
 * A dual-format route expands into per-format VARIANT operations
 * (`opId [format=application/json]` / `opId [format=application/xml]`,
 * see captureFormatExpansion.ts) and the happy-path gate demands BOTH.
 * The two variants' facts are identical except the wire format — so once
 * ONE variant lands its happy path, the sibling's request can be derived
 * DETERMINISTICALLY (same concrete path + query; body converted between
 * formats; Content-Type/Accept swapped) and SENT LIVE as a free first
 * attempt, saving a full LLM chain per endpoint per run. The mirrored
 * response is classified exactly like any capture — never assumed; on
 * failure the normal LLM attempts proceed unchanged.
 *
 * Ordering (user decision): XML variants attempt FIRST — XML→JSON
 * conversion is clean (parse), while JSON→XML must derive a root element
 * (single top-level key of the body when exactly one, else `request`) and
 * falls back honestly to the LLM when conversion fails.
 *
 * Caveat carried on purpose: the proven request body comes from the
 * REDACTED capture recording, so a body that contained secret-shaped
 * fields mirrors with placeholders and will likely fail — which routes to
 * the LLM as today. Auth is NEVER copied from recorded headers; the
 * execute primitive injects session auth itself.
 *
 * Pure module — no I/O; the orchestrator owns the send.
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

/** A parsed ` [format=<media>]` variant marker. */
export interface FormatVariantInfo {
  /** The base operation id (marker stripped) — the pairing key. */
  base: string;
  /** The variant's media type, lower-cased. */
  media: string;
}

const MARKER_RE = /^(.*) \[format=([^\]]+)\]$/;

export function parseFormatVariant(
  operationId: string | null | undefined,
): FormatVariantInfo | null {
  if (typeof operationId !== 'string') return null;
  const m = MARKER_RE.exec(operationId);
  if (!m) return null;
  const media = m[2].trim().toLowerCase();
  if (m[1].length === 0 || media.length === 0) return null;
  return { base: m[1], media };
}

export function isXmlMedia(media: string | null | undefined): boolean {
  return typeof media === 'string' && media.toLowerCase().includes('xml');
}

/**
 * Stable re-order so that within each variant pair the XML variant comes
 * FIRST (the clean mirror direction), anchored at the pair's original
 * first position. Non-variant operations and overall order are untouched.
 */
export function sortVariantsXmlFirst<T extends { operation_id?: unknown }>(
  ops: ReadonlyArray<T>,
): T[] {
  const indexed = ops.map((op, i) => ({
    op,
    i,
    variant: parseFormatVariant(
      typeof op.operation_id === 'string' ? op.operation_id : null,
    ),
  }));
  const firstIndexByBase = new Map<string, number>();
  for (const e of indexed) {
    if (e.variant && !firstIndexByBase.has(e.variant.base)) {
      firstIndexByBase.set(e.variant.base, e.i);
    }
  }
  return indexed
    .slice()
    .sort((a, b) => {
      const ga = a.variant ? firstIndexByBase.get(a.variant.base)! : a.i;
      const gb = b.variant ? firstIndexByBase.get(b.variant.base)! : b.i;
      if (ga !== gb) return ga - gb;
      const xa = a.variant && isXmlMedia(a.variant.media) ? 0 : 1;
      const xb = b.variant && isXmlMedia(b.variant.media) ? 0 : 1;
      if (xa !== xb) return xa - xb;
      return a.i - b.i;
    })
    .map((e) => e.op);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false,
  suppressEmptyNode: true,
});

/**
 * XML string -> JSON body (the CLEAN direction). Strips the single root
 * wrapper element (canonical inverse of {@link jsonToXmlBody}); returns
 * null when the input does not parse or yields nothing usable.
 */
export function xmlToJsonBody(xml: string): unknown | null {
  try {
    const parsed = parser.parse(xml) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const keys = Object.keys(parsed).filter((k) => k !== '?xml');
    if (keys.length === 0) return null;
    return keys.length === 1 ? parsed[keys[0]] : parsed;
  } catch {
    return null;
  }
}

/**
 * JSON body -> XML string. Root rule: an explicit `rootName` wins (steering
 * metadata, when a future hint exists); else a single top-level object key
 * becomes the root; else the body wraps in `<request>`. Returns null when
 * nothing serialisable results (the mirror then falls back to the LLM).
 */
export function jsonToXmlBody(
  body: unknown,
  rootName?: string | null,
): string | null {
  try {
    if (body === null || body === undefined) return null;
    let root = typeof rootName === 'string' && rootName.trim() !== '' ? rootName.trim() : null;
    let content: unknown = body;
    if (!root && body && typeof body === 'object' && !Array.isArray(body)) {
      const keys = Object.keys(body as Record<string, unknown>);
      if (keys.length === 1) {
        root = keys[0];
        content = (body as Record<string, unknown>)[keys[0]];
      }
    }
    if (!root) root = 'request';
    const xml = builder.build({ [root]: content }) as unknown;
    return typeof xml === 'string' && xml.length > 0
      ? `<?xml version="1.0" encoding="UTF-8"?>${xml}`
      : null;
  } catch {
    return null;
  }
}

/** The proven happy-path request facts stashed off the sibling's capture. */
export interface ProvenHappyPath {
  media: string;
  method: string;
  path: string;
  query: Record<string, unknown> | null;
  body: unknown;
}

/** The execute_http_request tool args for the mirrored attempt. */
export interface MirrorSendArgs {
  operationId: string;
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * Build the mirrored send for the TARGET variant from the sibling's proven
 * request. Returns null when the body cannot be converted deterministically
 * (the caller falls back to the LLM). A bodiless proven request mirrors
 * bodiless. Headers carry ONLY the target media (Content-Type when a body
 * exists + Accept) — session auth is the executor's job.
 */
export function buildMirrorArgs(
  proven: ProvenHappyPath,
  targetMedia: string,
  targetOperationId: string,
  rootName?: string | null,
): MirrorSendArgs | null {
  let body: unknown = null;
  const provenHasBody = proven.body !== null && proven.body !== undefined;
  if (provenHasBody) {
    const fromXml = isXmlMedia(proven.media);
    const toXml = isXmlMedia(targetMedia);
    if (fromXml && !toXml) {
      body =
        typeof proven.body === 'string' ? xmlToJsonBody(proven.body) : proven.body;
      if (body === null) return null;
    } else if (!fromXml && toXml) {
      body = jsonToXmlBody(proven.body, rootName);
      if (body === null) return null;
    } else {
      body = proven.body;
    }
  }
  const headers: Record<string, string> = { Accept: targetMedia };
  if (provenHasBody) headers['Content-Type'] = targetMedia;
  return {
    operationId: targetOperationId,
    method: proven.method,
    path: proven.path,
    ...(proven.query && Object.keys(proven.query).length > 0
      ? { query: proven.query }
      : {}),
    headers,
    ...(provenHasBody ? { body } : {}),
  };
}
