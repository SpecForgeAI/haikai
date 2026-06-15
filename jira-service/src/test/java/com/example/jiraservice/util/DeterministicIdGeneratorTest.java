package com.example.jiraservice.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link DeterministicIdGenerator}.
 *
 * Verifies deterministic UUID generation, stability across calls,
 * uniqueness for different inputs, and defensive null/blank handling.
 */
class DeterministicIdGeneratorTest {

    @Test
    @DisplayName("Same inputs produce the same UUID on every call")
    void sameInputsProduceSameUuid() {
        UUID first = DeterministicIdGenerator.generateId("my-project", "PROJ-123");
        UUID second = DeterministicIdGenerator.generateId("my-project", "PROJ-123");
        UUID third = DeterministicIdGenerator.generateId("my-project", "PROJ-123");

        assertNotNull(first);
        assertEquals(first, second, "Same inputs must produce identical UUIDs");
        assertEquals(second, third, "Same inputs must produce identical UUIDs across multiple calls");
    }

    @Test
    @DisplayName("Different inputs produce different UUIDs")
    void differentInputsProduceDifferentUuids() {
        UUID id1 = DeterministicIdGenerator.generateId("project-a", "KEY-1");
        UUID id2 = DeterministicIdGenerator.generateId("project-a", "KEY-2");
        UUID id3 = DeterministicIdGenerator.generateId("project-b", "KEY-1");

        assertNotEquals(id1, id2, "Different externalKeys must produce different UUIDs");
        assertNotEquals(id1, id3, "Different toolProjectIds must produce different UUIDs");
        assertNotEquals(id2, id3, "Both inputs differ, UUIDs must differ");
    }

    @Test
    @DisplayName("Null or empty input handling throws IllegalArgumentException")
    void nullOrEmptyInputHandling() {
        // Null toolProjectId
        assertThrows(IllegalArgumentException.class,
            () -> DeterministicIdGenerator.generateId(null, "KEY-1"),
            "Null toolProjectId should throw IllegalArgumentException");

        // Null externalKey
        assertThrows(IllegalArgumentException.class,
            () -> DeterministicIdGenerator.generateId("project", null),
            "Null externalKey should throw IllegalArgumentException");

        // Blank toolProjectId
        assertThrows(IllegalArgumentException.class,
            () -> DeterministicIdGenerator.generateId("", "KEY-1"),
            "Empty toolProjectId should throw IllegalArgumentException");

        // Blank externalKey
        assertThrows(IllegalArgumentException.class,
            () -> DeterministicIdGenerator.generateId("project", ""),
            "Empty externalKey should throw IllegalArgumentException");

        // Whitespace-only toolProjectId
        assertThrows(IllegalArgumentException.class,
            () -> DeterministicIdGenerator.generateId("   ", "KEY-1"),
            "Whitespace-only toolProjectId should throw IllegalArgumentException");

        // Whitespace-only externalKey
        assertThrows(IllegalArgumentException.class,
            () -> DeterministicIdGenerator.generateId("project", "   "),
            "Whitespace-only externalKey should throw IllegalArgumentException");
    }
}
