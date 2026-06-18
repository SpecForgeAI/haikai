package com.example.architecturemodel.util;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Cross-layer gap-fill tests for the Baseline Integrity &amp; Provenance spec
 * (2026-06-17) — Task Group 4.
 *
 * <p>The Task-Group-1 service test ({@code ApiBehaviourBaselineIntegrityServiceTest})
 * proves item-ordering and JSON-key-ordering determinism over
 * {@code request_json} / {@code response_json}, but it never exercises the one
 * field the spec singles out as easy to overlook: {@code volatile_paths_json} is
 * PINNED CONTENT inside the content hash. The spec stresses two distinct
 * invariants for that field that the TG1-3 suites do not cover:</p>
 *
 * <ol>
 *   <li><b>Tamper-evidence of declared volatile paths.</b> Changing which paths
 *       are flagged volatile changes the pinned oracle, so it MUST change the
 *       content hash. (This is SEPARATE from reconcile-time volatile tolerance;
 *       the util only records the declared envelope, but the hash must reflect
 *       it.)</li>
 *   <li><b>Canonical stability of the volatile envelope.</b> Reordering the keys
 *       inside {@code volatile_paths_json} (same logical content) must NOT change
 *       the hash — the canonical mapper sorts nested keys recursively.</li>
 * </ol>
 *
 * <p>These run against the pure {@link BaselineContentHashUtil} (no Spring
 * context) — the same canonical pipeline that both stamp-at-activate and the
 * verify endpoint delegate to, so the invariants hold end-to-end.</p>
 */
class BaselineContentHashUtilVolatileTest {

    private ApiBehaviourBaselineItemEntity item(
            String method, String path, String scenario,
            Map<String, Object> volatilePaths) {
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
            .volatilePathsJson(volatilePaths)
            .build();
    }

    @Test
    @DisplayName("volatile_paths_json IS part of the hash: changing the declared volatile paths changes the content hash (tamper-evident)")
    void changingDeclaredVolatilePathsChangesHash() {
        Map<String, Object> volatileA = new LinkedHashMap<>();
        volatileA.put("body", List.of("$.created_at"));
        Map<String, Object> volatileB = new LinkedHashMap<>();
        volatileB.put("body", List.of("$.created_at", "$.id")); // an extra path flagged volatile

        String hashA = BaselineContentHashUtil.computeContentHash(
            List.of(item("GET", "/a", "happy", volatileA)));
        String hashB = BaselineContentHashUtil.computeContentHash(
            List.of(item("GET", "/a", "happy", volatileB)));

        assertThat(hashA).matches("[0-9a-f]{64}");
        assertThat(hashB)
            .as("declared volatile paths are pinned content — changing them MUST change the hash")
            .isNotEqualTo(hashA);
    }

    @Test
    @DisplayName("a null volatile envelope hashes differently from a declared one (declaring volatility is itself tamper-evident)")
    void nullVsDeclaredVolatileEnvelopeDiffer() {
        Map<String, Object> declared = new LinkedHashMap<>();
        declared.put("body", List.of("$.created_at"));

        String hashNull = BaselineContentHashUtil.computeContentHash(
            List.of(item("GET", "/a", "happy", null)));
        String hashDeclared = BaselineContentHashUtil.computeContentHash(
            List.of(item("GET", "/a", "happy", declared)));

        assertThat(hashDeclared)
            .as("flagging a path volatile changes the pinned oracle vs no declaration")
            .isNotEqualTo(hashNull);
    }

    @Test
    @DisplayName("volatile_paths_json key order does NOT change the hash: canonical stability extends to the volatile envelope")
    void volatileEnvelopeKeyOrderIsStable() {
        // Same logical envelope, keys inserted in two different orders.
        Map<String, Object> orderA = new LinkedHashMap<>();
        orderA.put("headers", List.of("$.date"));
        orderA.put("body", List.of("$.created_at", "$.id"));

        Map<String, Object> orderB = new LinkedHashMap<>();
        orderB.put("body", List.of("$.created_at", "$.id"));
        orderB.put("headers", List.of("$.date"));

        String hashA = BaselineContentHashUtil.computeContentHash(
            List.of(item("GET", "/a", "happy", orderA)));
        String hashB = BaselineContentHashUtil.computeContentHash(
            List.of(item("GET", "/a", "happy", orderB)));

        assertThat(hashB)
            .as("recursive key sorting makes the volatile envelope order-independent")
            .isEqualTo(hashA);
    }
}
