package com.example.architecturemodel.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused JUnit tests for {@link MissingInputKeyHasher}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 1.</p>
 *
 * <p>Five focused tests cover the foundation's correctness contracts:</p>
 * <ol>
 *   <li>Hash determinism -- identical canonical descriptors produce identical
 *       16-hex-char keys across invocations.</li>
 *   <li>Case-insensitivity -- mixed-case canonical descriptors produce the
 *       same key as their lowercased equivalents (for all three v1 types).</li>
 *   <li>Whitespace-trim -- leading / trailing whitespace on canonical
 *       descriptors does not change the key (for all three v1 types).</li>
 *   <li>Type discrimination -- the same canonical descriptor produces
 *       different keys for different {@code inputType} values.</li>
 *   <li>Null-safety -- null inputs do not throw and still produce a
 *       deterministic 16-hex-char key.</li>
 * </ol>
 */
class MissingInputKeyHasherTest {

    private final MissingInputKeyHasher hasher = new MissingInputKeyHasher();

    @Test
    @DisplayName("computeKey: identical inputs -> identical 16-hex-char output (determinism)")
    void computeKey_deterministicForIdenticalInputs() {
        String descriptor = hasher.canonicalDescriptorForApiContract("PaymentsService", "createPayment");
        String key1 = hasher.computeKey("api_contract", descriptor);
        String key2 = hasher.computeKey("api_contract", descriptor);

        assertThat(key1)
            .isEqualTo(key2)
            .hasSize(16)
            .matches("[0-9a-f]{16}");
    }

    @Test
    @DisplayName("canonical descriptors: case-insensitive across all three v1 types")
    void canonicalDescriptors_areCaseInsensitive() {
        // api_contract: service + operation, both lowercased before joining
        String apiLower = hasher.canonicalDescriptorForApiContract("paymentsservice", "createpayment");
        String apiMixed = hasher.canonicalDescriptorForApiContract("PaymentsService", "CreatePayment");
        String apiUpper = hasher.canonicalDescriptorForApiContract("PAYMENTSSERVICE", "CREATEPAYMENT");
        assertThat(hasher.computeKey("api_contract", apiLower))
            .isEqualTo(hasher.computeKey("api_contract", apiMixed))
            .isEqualTo(hasher.computeKey("api_contract", apiUpper));

        // target_element: logical name lowercased
        String teLower = hasher.canonicalDescriptorForArchElement("customer-orders-service");
        String teMixed = hasher.canonicalDescriptorForArchElement("Customer-Orders-Service");
        String teUpper = hasher.canonicalDescriptorForArchElement("CUSTOMER-ORDERS-SERVICE");
        assertThat(hasher.computeKey("target_element", teLower))
            .isEqualTo(hasher.computeKey("target_element", teMixed))
            .isEqualTo(hasher.computeKey("target_element", teUpper));

        // mapping: UUIDs already canonical, but computeKey applies defensive lowercase too,
        // so a caller passing upper-case hex still hashes identically.
        String mapLower = hasher.canonicalDescriptorForMapping(
            "11111111-2222-3333-4444-555555555555",
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        String mapUpper = hasher.canonicalDescriptorForMapping(
            "11111111-2222-3333-4444-555555555555",
            "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE");
        assertThat(hasher.computeKey("mapping", mapLower))
            .isEqualTo(hasher.computeKey("mapping", mapUpper));
    }

    @Test
    @DisplayName("canonical descriptors: whitespace-trim across all three v1 types")
    void canonicalDescriptors_areWhitespaceTrimmed() {
        // api_contract: per-field trim
        String apiClean = hasher.canonicalDescriptorForApiContract("PaymentsService", "createPayment");
        String apiPadded = hasher.canonicalDescriptorForApiContract("  PaymentsService  ", "\tcreatePayment\n");
        assertThat(hasher.computeKey("api_contract", apiClean))
            .isEqualTo(hasher.computeKey("api_contract", apiPadded));

        // target_element: descriptor trim
        String teClean = hasher.canonicalDescriptorForArchElement("customer-orders-service");
        String tePadded = hasher.canonicalDescriptorForArchElement("   customer-orders-service\t");
        assertThat(hasher.computeKey("target_element", teClean))
            .isEqualTo(hasher.computeKey("target_element", tePadded));

        // mapping: per-field trim
        String mapClean = hasher.canonicalDescriptorForMapping("src-uuid", "tgt-uuid");
        String mapPadded = hasher.canonicalDescriptorForMapping(" src-uuid\n", "\ttgt-uuid ");
        assertThat(hasher.computeKey("mapping", mapClean))
            .isEqualTo(hasher.computeKey("mapping", mapPadded));
    }

    @Test
    @DisplayName("computeKey: different inputType produces different key even with identical descriptor")
    void computeKey_typeDiscriminates() {
        // Same canonical descriptor string passed in for both types -- the
        // inputType prefix MUST make the pre-image (and therefore the key)
        // different. This protects against cross-type collisions when the
        // same logical token (e.g. "orders:create") could plausibly appear
        // as both an api_contract canonical descriptor and as a contrived
        // target_element name.
        String descriptor = "orders:create";

        String apiKey = hasher.computeKey("api_contract", descriptor);
        String targetKey = hasher.computeKey("target_element", descriptor);
        String mappingKey = hasher.computeKey("mapping", descriptor);

        assertThat(apiKey).isNotEqualTo(targetKey);
        assertThat(apiKey).isNotEqualTo(mappingKey);
        assertThat(targetKey).isNotEqualTo(mappingKey);
    }

    @Test
    @DisplayName("computeKey + canonical helpers: null-safe (produce deterministic key for null inputs)")
    void hasher_isNullSafe() {
        // canonical descriptor helpers handle nulls -> empty string
        assertThat(hasher.canonicalDescriptorForApiContract(null, null))
            .isEqualTo(":");
        assertThat(hasher.canonicalDescriptorForApiContract(null, "op"))
            .isEqualTo(":op");
        assertThat(hasher.canonicalDescriptorForMapping(null, null))
            .isEqualTo("->");
        assertThat(hasher.canonicalDescriptorForArchElement(null))
            .isEqualTo("");

        // computeKey with null inputType / descriptor must not throw and must
        // produce a deterministic 16-hex-char key.
        String nullKey = hasher.computeKey(null, null);
        String nullKeyAgain = hasher.computeKey(null, null);
        assertThat(nullKey)
            .isEqualTo(nullKeyAgain)
            .hasSize(16)
            .matches("[0-9a-f]{16}");

        // null inputType with a real descriptor is still hashable
        String keyA = hasher.computeKey(null, "any-descriptor");
        String keyB = hasher.computeKey("", "any-descriptor");
        // null and "" both normalise to "" -> identical pre-image -> identical key
        assertThat(keyA).isEqualTo(keyB);
    }
}
