package com.example.architecturemodel.util;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for StableIdGenerator utility class.
 *
 * Tests title normalization and deterministic UUID generation for
 * INITIATIVE and EPIC work items during roadmap import.
 */
class StableIdGeneratorTest {

    private StableIdGenerator stableIdGenerator;

    private static final String PROJECT_ID = "test-project";

    @BeforeEach
    void setUp() {
        stableIdGenerator = new StableIdGenerator();
    }

    // ========================================================================
    // Test 1: Title Normalization - Whitespace Handling
    // ========================================================================

    /**
     * Test title normalization: trims whitespace, collapses consecutive spaces, converts to lowercase.
     */
    @Test
    void normalizeTitle_trimsWhitespaceAndCollapsesConsecutiveSpaces() {
        // Leading and trailing whitespace
        assertThat(stableIdGenerator.normalizeTitle("  Initiative Title  "))
                .isEqualTo("initiative title");

        // Multiple consecutive spaces
        assertThat(stableIdGenerator.normalizeTitle("Initiative    Title"))
                .isEqualTo("initiative title");

        // Tabs converted to single space
        assertThat(stableIdGenerator.normalizeTitle("Initiative\tTitle"))
                .isEqualTo("initiative title");

        // Mixed whitespace
        assertThat(stableIdGenerator.normalizeTitle("  Initiative  \t  Title  "))
                .isEqualTo("initiative title");

        // Lowercase conversion
        assertThat(stableIdGenerator.normalizeTitle("INITIATIVE Title"))
                .isEqualTo("initiative title");

        // Already normalized
        assertThat(stableIdGenerator.normalizeTitle("initiative title"))
                .isEqualTo("initiative title");

        // Single word
        assertThat(stableIdGenerator.normalizeTitle("Initiative"))
                .isEqualTo("initiative");

        // Empty string
        assertThat(stableIdGenerator.normalizeTitle(""))
                .isEqualTo("");

        // Null handling
        assertThat(stableIdGenerator.normalizeTitle(null))
                .isNull();
    }

    // ========================================================================
    // Test 2: Title Normalization - Preserves Punctuation
    // ========================================================================

    /**
     * Test title normalization preserves punctuation (e.g., "Auth - v2.0" normalizes correctly).
     */
    @Test
    void normalizeTitle_preservesPunctuation() {
        // Hyphens preserved
        assertThat(stableIdGenerator.normalizeTitle("Auth - v2.0"))
                .isEqualTo("auth - v2.0");

        // Underscores preserved
        assertThat(stableIdGenerator.normalizeTitle("User_Authentication"))
                .isEqualTo("user_authentication");

        // Colons preserved
        assertThat(stableIdGenerator.normalizeTitle("Epic: Login Flow"))
                .isEqualTo("epic: login flow");

        // Parentheses preserved
        assertThat(stableIdGenerator.normalizeTitle("Feature (Beta)"))
                .isEqualTo("feature (beta)");

        // Special chars preserved
        assertThat(stableIdGenerator.normalizeTitle("API v3.0 - OAuth2/OIDC Integration"))
                .isEqualTo("api v3.0 - oauth2/oidc integration");

        // Numbers preserved
        assertThat(stableIdGenerator.normalizeTitle("Q1 2024 Roadmap"))
                .isEqualTo("q1 2024 roadmap");
    }

    // ========================================================================
    // Test 3: Initiative UUID Generation - Consistency
    // ========================================================================

    /**
     * Test initiative UUID generation produces consistent IDs across calls.
     */
    @Test
    void generateInitiativeId_producesConsistentIdAcrossCalls() {
        String normalizedTitle = "user authentication";

        // Generate ID multiple times
        UUID id1 = stableIdGenerator.generateInitiativeId(PROJECT_ID, normalizedTitle);
        UUID id2 = stableIdGenerator.generateInitiativeId(PROJECT_ID, normalizedTitle);
        UUID id3 = stableIdGenerator.generateInitiativeId(PROJECT_ID, normalizedTitle);

        // All should be identical
        assertThat(id1).isEqualTo(id2);
        assertThat(id2).isEqualTo(id3);
        assertThat(id1).isNotNull();

        // Different title produces different ID
        UUID differentTitleId = stableIdGenerator.generateInitiativeId(PROJECT_ID, "different title");
        assertThat(differentTitleId).isNotEqualTo(id1);

        // Different project produces different ID
        UUID differentProjectId = stableIdGenerator.generateInitiativeId("other-project", normalizedTitle);
        assertThat(differentProjectId).isNotEqualTo(id1);
    }

    // ========================================================================
    // Test 4: Epic UUID Generation - Includes Parent Initiative Title
    // ========================================================================

    /**
     * Test epic UUID generation includes parent initiative title in key.
     */
    @Test
    void generateEpicId_includesParentInitiativeTitleInKey() {
        String parentNormalizedTitle = "user authentication";
        String epicNormalizedTitle = "login flow";

        // Generate ID multiple times
        UUID id1 = stableIdGenerator.generateEpicId(PROJECT_ID, parentNormalizedTitle, epicNormalizedTitle);
        UUID id2 = stableIdGenerator.generateEpicId(PROJECT_ID, parentNormalizedTitle, epicNormalizedTitle);

        // Same inputs produce same ID
        assertThat(id1).isEqualTo(id2);
        assertThat(id1).isNotNull();

        // Same epic title under DIFFERENT parent produces different ID
        String differentParent = "api integration";
        UUID differentParentId = stableIdGenerator.generateEpicId(PROJECT_ID, differentParent, epicNormalizedTitle);
        assertThat(differentParentId).isNotEqualTo(id1);

        // Different epic title under SAME parent produces different ID
        UUID differentEpicId = stableIdGenerator.generateEpicId(PROJECT_ID, parentNormalizedTitle, "logout flow");
        assertThat(differentEpicId).isNotEqualTo(id1);

        // Different project produces different ID
        UUID differentProjectId = stableIdGenerator.generateEpicId("other-project", parentNormalizedTitle, epicNormalizedTitle);
        assertThat(differentProjectId).isNotEqualTo(id1);

        // Epic ID is different from initiative ID with same title
        UUID initiativeId = stableIdGenerator.generateInitiativeId(PROJECT_ID, epicNormalizedTitle);
        assertThat(id1).isNotEqualTo(initiativeId);
    }
}
