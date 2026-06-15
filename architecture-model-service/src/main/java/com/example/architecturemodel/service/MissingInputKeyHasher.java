package com.example.architecturemodel.service;

import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Deterministic SHA-256-based hasher producing 16-hex-char stable keys for the
 * Missing Input Resolver Flow (Spec 2026-05-20).
 *
 * <p>Algorithm: {@code truncate(SHA-256(input_type + "|" + canonical_descriptor), 16 hex)}.
 * Canonical descriptors are LOWERCASED + TRIMMED before hashing so emit-time
 * (in AMS persistence path) and upload-time (in resolution-create / bulk-resolve
 * paths) keys line up for cross-story matching.</p>
 *
 * <p>Single source of truth for the algorithm lives in AMS; the gateway mirror
 * (Task Group 5) consumes the same canonical descriptors and the same
 * truncation so the parity test stays green.</p>
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 1.</p>
 *
 * <p>The three v1 missing-input types each have a dedicated canonical-
 * descriptor helper:</p>
 * <ul>
 *   <li>{@code api_contract}   -- {@code (serviceName, operationName)} ->
 *                                  {@code "service:operation"} (both
 *                                  lowercased + trimmed).</li>
 *   <li>{@code mapping}        -- {@code (sourceElementId, targetElementId)} ->
 *                                  {@code "source->target"}. UUIDs are already
 *                                  canonical strings; no lowercase / trim is
 *                                  applied at the field level but the
 *                                  combined descriptor IS lowercased + trimmed
 *                                  inside {@link #computeKey(String, String)}
 *                                  so any caller passing a non-canonical UUID
 *                                  string still hashes deterministically.</li>
 *   <li>{@code target_element} -- {@code logicalName} -> lowercased + trimmed
 *                                  logical name.</li>
 * </ul>
 *
 * <p>Out-of-v1 missing-input types (decisions / baselines / etc.) are NEVER
 * hashed by this util -- the call sites filter on the v1-type list before
 * invoking the helpers, so out-of-v1 entries never produce a key entry in
 * {@code missing_input_keys_json}.</p>
 *
 * <p>Null-safety: every public method tolerates null inputs by substituting
 * an empty string. This keeps the hasher deterministic for partially-formed
 * inputs without throwing -- the cross-story matcher then simply won't find
 * a row that hashes to a "(null, null)" key.</p>
 */
@Component
public class MissingInputKeyHasher {

    /** Truncation length in hex characters. 16 hex = 64 bits = effectively
     *  collision-resistant for the per-project key space we care about. */
    public static final int KEY_HEX_LENGTH = 16;

    /** Separator between input type and canonical descriptor in the pre-image. */
    public static final String INPUT_TYPE_DESCRIPTOR_SEPARATOR = "|";

    /** Separator between service and operation name in the api_contract canonical descriptor. */
    public static final String API_CONTRACT_SEPARATOR = ":";

    /** Separator between source and target element ids in the mapping canonical descriptor. */
    public static final String MAPPING_SEPARATOR = "->";

    /**
     * Produce the stable 16-hex-char key for an {@code (inputType, canonicalDescriptor)}
     * pair. The descriptor is lowercased + trimmed before hashing so callers
     * that bypass the per-type canonicaliser helpers still get a deterministic
     * key (defensive normalisation).
     *
     * @param inputType            one of {@code api_contract}, {@code mapping},
     *                             {@code target_element} (never out-of-v1
     *                             types). Null tolerated -> empty string.
     * @param canonicalDescriptor  per-type canonical descriptor; already
     *                             lowercased + trimmed by the helpers below,
     *                             but lowercased + trimmed AGAIN here so a
     *                             direct caller still hashes deterministically.
     *                             Null tolerated -> empty string.
     * @return                     16 hex chars (lowercase).
     */
    public String computeKey(String inputType, String canonicalDescriptor) {
        String safeType = inputType == null ? "" : inputType.toLowerCase().trim();
        String safeDesc = canonicalDescriptor == null ? "" : canonicalDescriptor.toLowerCase().trim();
        String preImage = safeType + INPUT_TYPE_DESCRIPTOR_SEPARATOR + safeDesc;
        return sha256TruncatedHex(preImage, KEY_HEX_LENGTH);
    }

    /**
     * Canonical descriptor for an {@code api_contract} missing input:
     * {@code "service:operation"} -- both fields lowercased + trimmed
     * individually before joining so two different orderings of internal
     * whitespace cannot diverge.
     *
     * @param serviceName    service name (null tolerated -> empty string).
     * @param operationName  operation name (null tolerated -> empty string).
     * @return               canonical descriptor (already lowercased + trimmed).
     */
    public String canonicalDescriptorForApiContract(String serviceName, String operationName) {
        String safeService = serviceName == null ? "" : serviceName.toLowerCase().trim();
        String safeOperation = operationName == null ? "" : operationName.toLowerCase().trim();
        return safeService + API_CONTRACT_SEPARATOR + safeOperation;
    }

    /**
     * Canonical descriptor for a {@code mapping} missing input:
     * {@code "sourceId->targetId"}. UUIDs are already canonical strings; this
     * helper does NOT lowercase the field-level UUIDs (a UUID's canonical
     * form is already lowercase hex), but {@link #computeKey} still lowers +
     * trims the combined descriptor as defence-in-depth against callers
     * passing non-UUID identifier strings.
     *
     * @param sourceElementId  source element UUID-as-string (null tolerated).
     * @param targetElementId  target element UUID-as-string (null tolerated).
     * @return                 canonical descriptor.
     */
    public String canonicalDescriptorForMapping(String sourceElementId, String targetElementId) {
        String safeSource = sourceElementId == null ? "" : sourceElementId.trim();
        String safeTarget = targetElementId == null ? "" : targetElementId.trim();
        return safeSource + MAPPING_SEPARATOR + safeTarget;
    }

    /**
     * Canonical descriptor for a {@code target_element} missing input: the
     * logical name, lowercased + trimmed.
     *
     * @param logicalName  logical name of the target architecture element
     *                     (null tolerated -> empty string).
     * @return             canonical descriptor.
     */
    public String canonicalDescriptorForArchElement(String logicalName) {
        return logicalName == null ? "" : logicalName.toLowerCase().trim();
    }

    /**
     * SHA-256 hash of the UTF-8 bytes of {@code preImage}, lowercased hex,
     * truncated to {@code hexLength} characters.
     */
    private static String sha256TruncatedHex(String preImage, int hexLength) {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is mandatory in every JRE -- this branch is unreachable
            // on every supported platform.
            throw new IllegalStateException("SHA-256 algorithm not available", e);
        }
        byte[] hash = digest.digest(preImage.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            hex.append(String.format("%02x", b));
        }
        return hex.substring(0, Math.min(hexLength, hex.length()));
    }
}
