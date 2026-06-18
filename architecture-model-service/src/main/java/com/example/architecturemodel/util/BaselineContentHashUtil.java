package com.example.architecturemodel.util;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Computes the deterministic, tamper-evident content hash for an API-behaviour
 * baseline's item set.
 *
 * <h2>Canonical content form (canonical_version: 1)</h2>
 * <p>The hash is a SHA-256 (lowercase hex) over a canonical serialization of the
 * baseline's item set. The form is precise and STABLE so the same item set —
 * in ANY insertion order and with JSON object keys in ANY order — always
 * produces the IDENTICAL hash:</p>
 * <ul>
 *   <li><b>Items are sorted</b> by the stable key
 *       {@code (method, path, scenario_name)} before serialization. Reordering
 *       the items (e.g. a different DB insertion order) does NOT change the
 *       hash.</li>
 *   <li><b>Per item the hashed content</b> is exactly:
 *       {@code method}, {@code path}, {@code scenario_name},
 *       {@code request_json}, {@code response_status}, {@code response_json},
 *       and {@code volatile_paths_json} — PLUS {@code sequence_json}
 *       <b>only when it is non-null</b> (see "Sequence fold" below). Whatever
 *       {@code {headers, body}} envelope shape Spec B (Reconcile Full-Response
 *       Fidelity) left on {@code response_json} is hashed AS-IS.</li>
 *   <li><b>JSON object keys are sorted recursively</b> by the canonical Jackson
 *       mapper ({@code ORDER_MAP_ENTRIES_BY_KEYS} +
 *       {@code SORT_PROPERTIES_ALPHABETICALLY}) so nested map key order does not
 *       affect the digest.</li>
 *   <li><b>UTF-8</b> encoding; SHA-256; lowercase hex.</li>
 *   <li>The envelope carries {@code canonical_version: 1} so a future format
 *       change is detectable.</li>
 * </ul>
 *
 * <h2>Volatile pinning vs reconcile-time tolerance — IMPORTANT</h2>
 * <p>{@code volatile_paths_json} IS part of the hash because the declared
 * volatile envelope is PINNED CONTENT: changing which paths are flagged volatile
 * changes the pinned oracle and MUST be tamper-evident. This pinning is
 * <b>SEPARATE</b> from reconcile-time volatile TOLERANCE — the hash merely
 * RECORDS the declared paths; it does NOT change {@code expected_volatile} or
 * how the diff engine tolerates volatile values at reconcile. The two concerns
 * never interact: this util only reads/serializes the declared envelope.</p>
 *
 * <h2>Sequence fold (sequence_json) — ADDITIVE, NULL-OMITTED</h2>
 * <p>The pinned ordered HTTP chain {@code sequence_json} (Stateful Sequence
 * Scenarios, 2026-06-18) IS part of the hash when present — the steps + the
 * inter-step references are PINNED ORACLE CONTENT and tampering with the chain
 * MUST be detectable, exactly like {@code volatile_paths_json}.</p>
 *
 * <p><b>It is OMITTED ENTIRELY (the key is not added) when {@code sequence_json}
 * is null.</b> Every existing baseline and every single-shot item has a null
 * {@code sequence_json}, so omitting the key means their canonical per-item
 * content is BYTE-IDENTICAL to today's v1 form — the digest of an existing
 * baseline is unchanged and {@code verifyIntegrity} keeps verifying them.
 * Serializing {@code sequence_json: null} (rather than omitting the key) would
 * have changed every existing digest and false-mismatched every already-stamped
 * baseline.</p>
 *
 * <p><b>{@code CANONICAL_VERSION} deliberately STAYS 1.</b> This omit-when-null
 * design is the explicit OVERRIDE of any "bump the canonical version to v2"
 * suggestion: Spec C's {@code verifyIntegrity} is NOT version-dispatched, so a
 * version bump would recompute every existing v1 baseline under v2 and
 * false-mismatch it. Omit-when-null keeps every existing {@code content_hash}
 * valid with no version-aware verify, while still tamper-protecting the pinned
 * chain when it is present.</p>
 *
 * <p>Hashing is delegated to {@link UserJourneyDiagramHashUtil#computeCanonicalHash(Object)}
 * (the single canonical-mapper + SHA-256 + lowercase-hex pipeline) so the digest
 * is not reimplemented and no new crypto dependency is introduced.</p>
 *
 * <p>Spec: Baseline Integrity &amp; Provenance (2026-06-17) — Task Group 1.
 * Extended: Stateful Sequence Scenarios (2026-06-18) — Task Group 1
 * ({@code sequence_json} additive, null-omitted fold).</p>
 */
public final class BaselineContentHashUtil {

    /** Hash-algorithm tag carried into provenance. */
    public static final String HASH_ALGO = "sha256";

    /**
     * Canonical-form version tag. Bump if the per-item field set or sort key
     * ever changes so an old hash is recognizably stale rather than silently
     * mismatching.
     *
     * <p><b>Stays 1 across the sequence_json fold (Stateful Sequence Scenarios,
     * 2026-06-18) ON PURPOSE.</b> The fold is ADDITIVE + NULL-OMITTED: for the
     * null-sequence items that make up every pre-existing baseline the canonical
     * form is unchanged, so the version must NOT bump (Spec C's verify is not
     * version-dispatched — a bump would false-mismatch existing baselines).</p>
     */
    public static final int CANONICAL_VERSION = 1;

    private BaselineContentHashUtil() {
        // utility — no instances
    }

    /**
     * Compute the canonical content hash over the given baseline items.
     *
     * @param items the baseline's persisted items (any order; may be empty)
     * @return lowercase hex SHA-256 over the canonical form (never null)
     */
    public static String computeContentHash(List<ApiBehaviourBaselineItemEntity> items) {
        return UserJourneyDiagramHashUtil.computeCanonicalHash(buildCanonicalForm(items));
    }

    /**
     * Build the canonical content structure (the exact thing that gets hashed).
     * Exposed package-internal shape: an envelope
     * {@code { canonical_version, items: [ <per-item content> ... ] }} with the
     * items sorted by the stable key {@code (method, path, scenario_name)}.
     *
     * <p>The canonical Jackson mapper sorts map keys recursively, so building
     * the per-item map with any key order is fine — only the ITEM ordering needs
     * to be deterministic here (maps are sorted by the mapper).</p>
     */
    private static Map<String, Object> buildCanonicalForm(
            List<ApiBehaviourBaselineItemEntity> items) {
        List<ApiBehaviourBaselineItemEntity> sorted = new ArrayList<>(
            items == null ? List.of() : items);
        sorted.sort(
            Comparator
                .comparing((ApiBehaviourBaselineItemEntity i) -> nullSafe(i.getMethod()))
                .thenComparing(i -> nullSafe(i.getPath()))
                .thenComparing(i -> nullSafe(i.getScenarioName())));

        List<Object> itemForms = new ArrayList<>(sorted.size());
        for (ApiBehaviourBaselineItemEntity item : sorted) {
            itemForms.add(itemContent(item));
        }

        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("canonical_version", CANONICAL_VERSION);
        envelope.put("items", itemForms);
        return envelope;
    }

    /**
     * The per-item hashed content: method, path, scenario_name, request_json,
     * response_status, response_json, volatile_paths_json, and — ONLY when it is
     * non-null — sequence_json. The JSONB maps are passed through as-is; the
     * canonical mapper sorts their keys recursively.
     *
     * <p><b>sequence_json is OMITTED ENTIRELY (the key is not put) when null.</b>
     * Every existing baseline + single-shot item has a null sequence_json, so
     * omitting the key keeps their canonical content BYTE-IDENTICAL to today's
     * v1 form (and {@code CANONICAL_VERSION} stays 1). Putting
     * {@code sequence_json: null} would change every existing digest and
     * false-mismatch already-stamped baselines under Spec C's
     * (non-version-dispatched) {@code verifyIntegrity}.</p>
     */
    private static Map<String, Object> itemContent(ApiBehaviourBaselineItemEntity item) {
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("method", item.getMethod());
        content.put("path", item.getPath());
        content.put("scenario_name", item.getScenarioName());
        content.put("request_json", item.getRequestJson());
        content.put("response_status", item.getResponseStatus());
        content.put("response_json", item.getResponseJson());
        content.put("volatile_paths_json", item.getVolatilePathsJson());
        // sequence_json participates in the hash ONLY when present (tamper-
        // evidence of the pinned chain). Omit the key entirely when null so
        // existing baselines + single-shot items hash byte-identical to v1.
        if (item.getSequenceJson() != null) {
            content.put("sequence_json", item.getSequenceJson());
        }
        return content;
    }

    private static String nullSafe(String s) {
        return s == null ? "" : s;
    }
}
