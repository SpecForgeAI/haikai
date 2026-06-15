package com.example.architecturemodel.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Cross-implementation parity test: the AMS Java {@link MissingInputKeyHasher}
 * must produce IDENTICAL 16-hex-char keys to the gateway TypeScript mirror
 * (`gateway/src/services/missingInputKeyHasher.ts`).
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 8.3.</p>
 *
 * <h2>Why this test exists</h2>
 * The gateway-side parity test in {@code missingInputResolutionsRoute.test.ts}
 * (test 8 in that suite) pins the gateway hasher to a set of hardcoded
 * 16-hex literals computed against the documented algorithm. Those literals
 * are the canonical contract between the two implementations. This test
 * pins the AMS hasher to the SAME literals -- so if either side's algorithm
 * or canonical-descriptor shape drifts, ONE of the two tests fails loudly,
 * not both.
 *
 * <p>Without this AMS-side counterpart, the gateway test could silently
 * pass while AMS drifted (the gateway test only verifies the gateway is
 * self-consistent against its own literals). The cross-story matcher
 * depends on the two sides producing IDENTICAL keys for the same canonical
 * inputs at emit time (AMS persistence path) and upload time (gateway
 * cost-preview / frontend preview), so a silent drift would break ready-
 * to-retry computation.</p>
 *
 * <h2>How to update if the algorithm INTENTIONALLY changes</h2>
 * Update BOTH the gateway literals (in the .test.ts file) and the AMS
 * literals (in this file) in the same commit. The two sets MUST stay
 * byte-for-byte identical or cross-story matching breaks in production.
 */
class MissingInputKeyHasherAmsGatewayParityTest {

    private final MissingInputKeyHasher hasher = new MissingInputKeyHasher();

    @Test
    @DisplayName("AMS hasher: api_contract / mapping / target_element keys match the gateway-pinned literals byte-for-byte")
    void amsHashesMatchGatewayLiteralsForAllThreeV1Types() {
        // -----------------------------------------------------------------
        // api_contract: ("PaymentsService", "createPayment") -> "509f93263c360e6a"
        // Gateway test asserts the same literal in test 8 sub-case 1.
        // Canonical descriptor: "paymentsservice:createpayment" (lowercased).
        // Pre-image: "api_contract|paymentsservice:createpayment".
        // -----------------------------------------------------------------
        String apiDescriptor = hasher.canonicalDescriptorForApiContract(
            "PaymentsService", "createPayment");
        assertThat(apiDescriptor)
            .as("api_contract canonical descriptor must match the gateway shape")
            .isEqualTo("paymentsservice:createpayment");
        String apiKey = hasher.computeKey("api_contract", apiDescriptor);
        assertThat(apiKey)
            .as("AMS api_contract key must match the gateway-pinned literal")
            .isEqualTo("509f93263c360e6a");

        // -----------------------------------------------------------------
        // mapping: two canonical UUIDs -> "17269b9cdfe8e831"
        // Gateway test asserts the same literal in test 8 sub-case 2.
        // Canonical descriptor:
        //   "11111111-...->aaaaaaaa-..." (UUIDs already canonical lowercase hex).
        // -----------------------------------------------------------------
        String mapDescriptor = hasher.canonicalDescriptorForMapping(
            "11111111-2222-3333-4444-555555555555",
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        assertThat(mapDescriptor)
            .as("mapping canonical descriptor must match the gateway shape")
            .isEqualTo(
                "11111111-2222-3333-4444-555555555555"
                + "->aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        String mapKey = hasher.computeKey("mapping", mapDescriptor);
        assertThat(mapKey)
            .as("AMS mapping key must match the gateway-pinned literal")
            .isEqualTo("17269b9cdfe8e831");

        // -----------------------------------------------------------------
        // target_element: "Customer-Orders-Service" -> "356dde0c82174ab5"
        // Gateway test asserts the same literal in test 8 sub-case 3.
        // Canonical descriptor: "customer-orders-service" (lowercased+trimmed).
        // -----------------------------------------------------------------
        String teDescriptor = hasher.canonicalDescriptorForArchElement(
            "Customer-Orders-Service");
        assertThat(teDescriptor)
            .as("target_element canonical descriptor must match the gateway shape")
            .isEqualTo("customer-orders-service");
        String teKey = hasher.computeKey("target_element", teDescriptor);
        assertThat(teKey)
            .as("AMS target_element key must match the gateway-pinned literal")
            .isEqualTo("356dde0c82174ab5");

        // All three keys are 16-hex-char strings as documented.
        assertThat(apiKey).matches("[0-9a-f]{16}");
        assertThat(mapKey).matches("[0-9a-f]{16}");
        assertThat(teKey).matches("[0-9a-f]{16}");
    }
}
