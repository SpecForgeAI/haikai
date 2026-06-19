/**
 * AMS stores `request_body_json` / `response_body_json` (on captures) as a
 * Jackson `Map<String, Object>` (jsonb). A target API that returns an HTML
 * error page (Tomcat 415 / 500) or plain text yields a RAW STRING (or an
 * array / number / boolean) body, which Jackson cannot bind into a Map ->
 * `CreateApiBehaviourCaptureRequest` is rejected HTTP 400, silently dropping
 * that capture.
 *
 * `normaliseBodyForAms` is the SINGLE source of truth for making any body
 * AMS-safe: a plain object passes through unchanged; `null`/`undefined`
 * collapse to `null`; anything else (string / array / number / boolean) is
 * wrapped in a `{ _raw, _type }` envelope so the shape is always a Map AMS can
 * persist. `_type` records the original runtime type so a reader/diff can tell
 * a wrapped string from a wrapped array.
 *
 * Shared by `execute_http_request` (current-state captures), `targetReplayRunner`
 * and `sequenceReplayRunner` (target-state replay captures) so all three wrap
 * IDENTICALLY -- a source capture and its replayed target capture must carry
 * the same envelope shape or the reconcile diff would flag a spurious change.
 *
 * Spec: 2026-05-16 API Behaviour Capture Fixes (Issue 2, non-JSON body).
 */
export function normaliseBodyForAms(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { _raw: value, _type: Array.isArray(value) ? 'array' : typeof value };
}
