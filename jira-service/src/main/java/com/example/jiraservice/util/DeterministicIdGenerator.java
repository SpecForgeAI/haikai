package com.example.jiraservice.util;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Utility class for generating deterministic UUIDv3 identifiers.
 *
 * <p>Uses {@link UUID#nameUUIDFromBytes(byte[])} (UUIDv3 / MD5) to produce
 * reproducible UUIDs from a combination of tool project ID and external key.
 * The same inputs always produce the same UUID across restarts, which is
 * critical for stable parentId references in WorkItemDto objects.</p>
 */
public final class DeterministicIdGenerator {

    private DeterministicIdGenerator() {
        // Utility class -- prevent instantiation
    }

    /**
     * Generates a deterministic UUIDv3 from the given tool project ID and external key.
     *
     * <p>The UUID is derived from the UTF-8 bytes of the string
     * {@code toolProjectId + ":" + externalKey}.</p>
     *
     * @param toolProjectId the tool project identifier (e.g., "my-project")
     * @param externalKey   the external system key (e.g., "PROJ-123")
     * @return a deterministic UUID that is stable for the same input pair
     * @throws IllegalArgumentException if either argument is null or blank
     */
    public static UUID generateId(String toolProjectId, String externalKey) {
        if (toolProjectId == null || toolProjectId.isBlank()) {
            throw new IllegalArgumentException("toolProjectId must not be null or blank");
        }
        if (externalKey == null || externalKey.isBlank()) {
            throw new IllegalArgumentException("externalKey must not be null or blank");
        }

        String input = toolProjectId + ":" + externalKey;
        return UUID.nameUUIDFromBytes(input.getBytes(StandardCharsets.UTF_8));
    }
}
