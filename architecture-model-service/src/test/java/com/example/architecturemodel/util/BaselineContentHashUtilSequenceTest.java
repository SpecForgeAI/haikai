package com.example.architecturemodel.util;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused tests for the {@code sequence_json} integrity-hash fold (Stateful
 * Sequence Scenarios, 2026-06-18 — Task Group 1, R7).
 *
 * <p>The fold is ADDITIVE + NULL-OMITTED and must NOT bump
 * {@code CANONICAL_VERSION} (stays 1). Two load-bearing invariants:</p>
 *
 * <ol>
 *   <li><b>Omit-when-null regression (Spec C protection).</b> An item with
 *       {@code sequence_json == null} (every existing baseline + every
 *       single-shot item) hashes BYTE-IDENTICAL to today's pre-sequence 7-field
 *       canonical form — the {@code sequence_json} key is OMITTED entirely, not
 *       serialized as {@code null}. Proven by recomputing the literal pre-change
 *       7-field canonical envelope independently (via the same
 *       {@link UserJourneyDiagramHashUtil} pipeline) and asserting the digests
 *       match. A version bump or {@code sequence_json: null} would change this
 *       digest and false-mismatch already-stamped baselines.</li>
 *   <li><b>Include-when-present (tamper-evidence).</b> Two items differing ONLY
 *       by {@code sequence_json} hash DIFFERENTLY — the pinned chain is folded
 *       into the digest when present.</li>
 * </ol>
 */
class BaselineContentHashUtilSequenceTest {

    private ApiBehaviourBaselineItemEntity item(
            String method, String path, String scenario,
            Map<String, Object> sequenceJson) {
        Map<String, Object> requestJson = new LinkedHashMap<>();
        requestJson.put("query", Map.of("page", 1));
        Map<String, Object> responseJson = new LinkedHashMap<>();
        responseJson.put("headers", Map.of("content-type", "application/json"));
        responseJson.put("body", Map.of("ok", true));
        return ApiBehaviourBaselineItemEntity.builder()
            .id(UUID.randomUUID())
            .baselineId(UUID.randomUUID())
            .captureId(UUID.randomUUID())
            .operationId(UUID.randomUUID())
            .scenarioId(UUID.randomUUID())
            .method(method)
            .path(path)
            .scenarioName(scenario)
            .requestJson(requestJson)
            .responseStatus(200)
            .responseJson(responseJson)
            .volatilePathsJson(null)
            .sequenceJson(sequenceJson)
            .build();
    }

    /**
     * Independently re-builds the EXACT pre-sequence (v1) canonical envelope:
     * canonical_version 1 + one item with the seven fields method/path/
     * scenario_name/request_json/response_status/response_json/
     * volatile_paths_json and NO sequence_json key, hashed through the same
     * pipeline {@link BaselineContentHashUtil} delegates to. This is the
     * byte-for-byte form every existing baseline was stamped under.
     */
    private String preChangeSevenFieldHash(ApiBehaviourBaselineItemEntity it) {
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("method", it.getMethod());
        content.put("path", it.getPath());
        content.put("scenario_name", it.getScenarioName());
        content.put("request_json", it.getRequestJson());
        content.put("response_status", it.getResponseStatus());
        content.put("response_json", it.getResponseJson());
        content.put("volatile_paths_json", it.getVolatilePathsJson());
        // NB: NO sequence_json key — exactly the pre-change v1 per-item form.

        List<Object> items = new ArrayList<>();
        items.add(content);
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("canonical_version", 1);
        envelope.put("items", items);
        return UserJourneyDiagramHashUtil.computeCanonicalHash(envelope);
    }

    @Test
    @DisplayName("(b) omit-when-null: a sequence_json=null item hashes BYTE-IDENTICAL to the pre-change 7-field canonical form (Spec C protection)")
    void nullSequenceHashesByteIdenticalToSevenFieldForm() {
        ApiBehaviourBaselineItemEntity nullSeq = item("GET", "/a", "happy", null);

        String actual = BaselineContentHashUtil.computeContentHash(List.of(nullSeq));
        String expectedSevenField = preChangeSevenFieldHash(nullSeq);

        assertThat(actual).matches("[0-9a-f]{64}");
        assertThat(actual)
            .as("sequence_json=null must OMIT the key -> digest identical to the pre-sequence 7-field form")
            .isEqualTo(expectedSevenField);
        assertThat(BaselineContentHashUtil.CANONICAL_VERSION)
            .as("CANONICAL_VERSION must stay 1 (Spec C verify is not version-dispatched)")
            .isEqualTo(1);
    }

    @Test
    @DisplayName("(c) include-when-present: two items differing ONLY by sequence_json hash DIFFERENTLY (tamper-evidence of the pinned chain)")
    void presentSequenceChangesHash() {
        Map<String, Object> sequence = new LinkedHashMap<>();
        Map<String, Object> step = new LinkedHashMap<>();
        step.put("index", 0);
        step.put("role", "act");
        step.put("kind", "http");
        step.put("request", Map.of("method", "POST", "path", "/filters", "body", Map.of("name", "x")));
        step.put("expected_status", 201);
        step.put("response_refs", List.of());
        sequence.put("steps", List.of(step));
        sequence.put("act_step_index", 0);
        sequence.put("cleanup_best_effort", true);

        String hashNull = BaselineContentHashUtil.computeContentHash(
            List.of(item("POST", "/filters", "create", null)));
        String hashWithSequence = BaselineContentHashUtil.computeContentHash(
            List.of(item("POST", "/filters", "create", sequence)));

        assertThat(hashWithSequence)
            .as("a present sequence_json is folded into the hash (tamper-evidence) -> differs from the null-sequence digest")
            .isNotEqualTo(hashNull);
    }

    @Test
    @DisplayName("(c2) two non-null sequences differing in ONE pinned step field hash differently (chain tamper-evidence)")
    void differingSequencesHashDifferently() {
        Map<String, Object> seqA = new LinkedHashMap<>();
        seqA.put("steps", List.of(Map.of(
            "index", 0, "role", "act", "kind", "http",
            "request", Map.of("method", "POST", "path", "/filters"),
            "expected_status", 201, "response_refs", List.of())));
        seqA.put("act_step_index", 0);
        seqA.put("cleanup_best_effort", true);

        Map<String, Object> seqB = new LinkedHashMap<>();
        seqB.put("steps", List.of(Map.of(
            "index", 0, "role", "act", "kind", "http",
            "request", Map.of("method", "POST", "path", "/filters"),
            "expected_status", 200, // the ONLY difference: expected_status 200 vs 201
            "response_refs", List.of())));
        seqB.put("act_step_index", 0);
        seqB.put("cleanup_best_effort", true);

        String hashA = BaselineContentHashUtil.computeContentHash(
            List.of(item("POST", "/filters", "create", seqA)));
        String hashB = BaselineContentHashUtil.computeContentHash(
            List.of(item("POST", "/filters", "create", seqB)));

        assertThat(hashB)
            .as("changing a pinned step field changes the oracle -> must change the hash")
            .isNotEqualTo(hashA);
    }
}
