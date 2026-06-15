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
 * Utility for computing canonical SHA-256 hashes of UserJourneyDiagramDto instances.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 1: Hash Utility and Sync Service
 *
 * Uses Jackson with deterministic serialization settings (sorted keys, ordered map entries)
 * to ensure identical DTO inputs always produce identical hash outputs.
 */
public final class UserJourneyDiagramHashUtil {

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
        try {
            String canonicalJson = CANONICAL_MAPPER.writeValueAsString(dto);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = digest.digest(canonicalJson.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hashBytes);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not available", e);
        } catch (Exception e) {
            throw new RuntimeException("Failed to compute canonical hash for UserJourneyDiagramDto", e);
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
