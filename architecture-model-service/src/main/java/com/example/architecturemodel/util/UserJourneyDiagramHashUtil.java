package com.example.architecturemodel.util;

import com.example.architecturemodel.model.dto.diagram.UserJourneyDiagramDto;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Utility for computing canonical SHA-256 hashes.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 1: Hash Utility and Sync Service
 *
 * Uses Jackson with deterministic serialization settings (sorted keys, ordered map entries)
 * to ensure identical inputs always produce identical hash outputs.
 *
 * <p>Extended: Baseline Integrity &amp; Provenance (2026-06-17) — Task Group 1.
 * The generic {@link #computeCanonicalHash(Object)} entry point exposes the SAME
 * canonical-mapper + {@code MessageDigest} SHA-256 + lowercase-hex {@code bytesToHex}
 * pipeline for the baseline content hash, so there is exactly ONE hashing
 * implementation and no new crypto dependency. See
 * {@code ApiBehaviourBaselineService} for the per-item canonical content form
 * that is fed into it.</p>
 */
public final class UserJourneyDiagramHashUtil {

    /**
     * Canonical Jackson mapper: object/record properties sorted alphabetically
     * AND map entries ordered by key (recursively), so the serialized form is
     * insertion-order- and key-order-independent.
     */
    private static final ObjectMapper CANONICAL_MAPPER = JsonMapper.builder()
        .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true)
        .configure(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY, true)
        .build();

    private UserJourneyDiagramHashUtil() {
        // Utility class -- no instantiation
    }

    /**
     * Computes a canonical SHA-256 hash of the given UserJourneyDiagramDto.
     *
     * The DTO is serialized to JSON with deterministic field ordering, then
     * the SHA-256 digest is computed and returned as a lowercase hex string.
     *
     * @param dto the diagram DTO to hash
     * @return lowercase hex-encoded SHA-256 hash string
     * @throws RuntimeException if serialization or hashing fails
     */
    public static String computeCanonicalHash(UserJourneyDiagramDto dto) {
        return computeCanonicalHash((Object) dto);
    }

    /**
     * Computes a canonical SHA-256 hash of an arbitrary serializable value.
     *
     * <p>The value is serialized to JSON via the canonical mapper (properties
     * sorted alphabetically, map entries ordered by key — recursively, so nested
     * objects/maps are stable regardless of insertion order), then SHA-256 over
     * the UTF-8 bytes, returned as lowercase hex.</p>
     *
     * <p>Reused by the baseline content hash (Baseline Integrity &amp;
     * Provenance, 2026-06-17): the caller assembles the canonical per-item
     * content structure (a {@code List}/{@code Map} tree) and passes it here so
     * the digest pipeline is not reimplemented.</p>
     *
     * @param value the value to hash (any Jackson-serializable object/collection)
     * @return lowercase hex-encoded SHA-256 hash string
     * @throws RuntimeException if serialization or hashing fails
     */
    public static String computeCanonicalHash(Object value) {
        try {
            String canonicalJson = CANONICAL_MAPPER.writeValueAsString(value);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = digest.digest(canonicalJson.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hashBytes);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not available", e);
        } catch (Exception e) {
            throw new RuntimeException("Failed to compute canonical hash", e);
        }
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
