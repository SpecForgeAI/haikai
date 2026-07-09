/**
 * Raw-body persistence policy (Spec 2026-07-06-j — Parity Exactness &
 * First-Class SOAP).
 *
 * The STRICT comparison profile needs the response body's RAW wire text to
 * issue byte-level verdicts — but every persisted body in this service is
 * REDACTED, and a redacted raw string cannot be produced without
 * re-serialising (which destroys the byte fidelity the raw exists for).
 *
 * Resolution: RAW IS PERSISTED ONLY WHEN REDACTION IS A NO-OP ON THE BODY.
 *   - redaction changed something  -> raw = null ("raw unavailable"; the
 *     strict verdict degrades VISIBLY to `raw_unavailable`, never a false
 *     exact, and no secret ever reaches raw storage);
 *   - redaction changed nothing    -> the raw text is byte-faithful AND
 *     secret-free, so it persists verbatim.
 */

/**
 * The persistable raw body: `raw` verbatim iff redacting `parsed` changed
 * nothing (deep-compare via stable stringify of the SAME traversal), else
 * null. `redacted` is the already-computed redacted body — DO NOT redact
 * twice (the caller has it in hand for the capture row).
 */
export function persistableRawBody(
  raw: string | null | undefined,
  parsed: unknown,
  redacted: unknown,
): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.stringify(parsed) === JSON.stringify(redacted) ? raw : null;
  } catch {
    return null;
  }
}
