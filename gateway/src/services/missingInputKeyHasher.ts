/**
 * Gateway mirror of the AMS `MissingInputKeyHasher` Java util.
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 5.4.
 *
 * Algorithm: `truncate(SHA-256(input_type + "|" + canonical_descriptor), 16 hex chars)`.
 * Canonical descriptors are LOWERCASED + TRIMMED before hashing so emit-time
 * (in AMS persistence path) and upload-time (in resolution-create / bulk-resolve
 * paths) keys line up for cross-story matching.
 *
 * The canonical source of truth for the algorithm lives in AMS
 * (`MissingInputKeyHasher.java`). This file is the gateway-side MIRROR --
 * it MUST produce identical 16-hex output for the same canonical inputs.
 * The parity is verified by a dedicated Jest test (see
 * `missingInputResolutionsRoute.test.ts`).
 *
 * Why a mirror at all (Task Group 5 deliberately does not write keys via
 * the gateway):
 *
 *   - Spec-emit-time key population happens AMS-side (Task 3.4); the gateway
 *     never writes to `missing_input_keys_json`. The mirror exists for the
 *     cost-preview gating path + any frontend-driven preview hashing
 *     (frontend can import the helpers from the gateway).
 *
 * Separator constants match AMS verbatim:
 *   - INPUT_TYPE_DESCRIPTOR_SEPARATOR = "|"
 *   - API_CONTRACT_SEPARATOR          = ":"
 *   - MAPPING_SEPARATOR               = "->"
 *
 * Null-safety: every public helper tolerates `null` / `undefined` by
 * substituting an empty string. The hash for "(null, null)" is therefore
 * deterministic but should never match a real row -- defence in depth.
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Algorithm constants (must mirror AMS verbatim)
// ---------------------------------------------------------------------------

/** Truncation length in hex characters. 16 hex = 64 bits. */
export const KEY_HEX_LENGTH = 16;

/** Separator between input type and canonical descriptor in the pre-image. */
export const INPUT_TYPE_DESCRIPTOR_SEPARATOR = '|';

/** Separator between service and operation name in the api_contract canonical descriptor. */
export const API_CONTRACT_SEPARATOR = ':';

/** Separator between source and target element ids in the mapping canonical descriptor. */
export const MAPPING_SEPARATOR = '->';

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Lower + trim a string, mapping null/undefined to "". Mirror of the Java
 * helper used inside every canonicaliser + {@link computeKey}.
 */
function safeLowerTrim(value: string | null | undefined): string {
  if (value == null) return '';
  return value.toLowerCase().trim();
}

/**
 * Produce the stable 16-hex-char key for an `(inputType, canonicalDescriptor)`
 * pair. The descriptor is lowercased + trimmed before hashing so callers that
 * bypass the per-type canonicaliser helpers still get a deterministic key
 * (defensive normalisation -- mirrors the AMS behaviour exactly).
 */
export function computeKey(
  inputType: string | null | undefined,
  canonicalDescriptor: string | null | undefined,
): string {
  const safeType = safeLowerTrim(inputType);
  const safeDesc = safeLowerTrim(canonicalDescriptor);
  const preImage = `${safeType}${INPUT_TYPE_DESCRIPTOR_SEPARATOR}${safeDesc}`;
  return sha256TruncatedHex(preImage, KEY_HEX_LENGTH);
}

/**
 * Canonical descriptor for an `api_contract` missing input.
 * Returns `"service:operation"` with both fields lowercased + trimmed.
 */
export function canonicalDescriptorForApiContract(
  serviceName: string | null | undefined,
  operationName: string | null | undefined,
): string {
  return (
    safeLowerTrim(serviceName) +
    API_CONTRACT_SEPARATOR +
    safeLowerTrim(operationName)
  );
}

/**
 * Canonical descriptor for a `mapping` missing input.
 * Returns `"sourceId->targetId"`. UUIDs are already canonical strings so this
 * helper does NOT lowercase the field-level UUIDs (matches AMS), but
 * {@link computeKey} still lowers + trims the combined descriptor as
 * defence-in-depth.
 */
export function canonicalDescriptorForMapping(
  sourceElementId: string | null | undefined,
  targetElementId: string | null | undefined,
): string {
  const safeSource = sourceElementId == null ? '' : sourceElementId.trim();
  const safeTarget = targetElementId == null ? '' : targetElementId.trim();
  return safeSource + MAPPING_SEPARATOR + safeTarget;
}

/**
 * Canonical descriptor for a `target_element` missing input: the logical
 * name, lowercased + trimmed. Matches AMS verbatim.
 */
export function canonicalDescriptorForArchElement(
  logicalName: string | null | undefined,
): string {
  return safeLowerTrim(logicalName);
}

/**
 * SHA-256 hash of the UTF-8 bytes of `preImage`, lowercased hex, truncated to
 * `hexLength` characters. Mirrors the Java `sha256TruncatedHex` helper.
 */
function sha256TruncatedHex(preImage: string, hexLength: number): string {
  const digest = createHash('sha256').update(preImage, 'utf8').digest('hex');
  return digest.slice(0, Math.min(hexLength, digest.length));
}
