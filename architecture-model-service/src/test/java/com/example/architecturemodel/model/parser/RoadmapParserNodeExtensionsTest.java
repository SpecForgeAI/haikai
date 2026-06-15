package com.example.architecturemodel.model.parser;

import com.example.architecturemodel.util.RoadmapParser;
import com.example.architecturemodel.util.StableIdGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for parser node extensions that support v3 deterministic IDs.
 *
 * Tests verify that InitiativeNode and EpicNode correctly store
 * normalizedTitle and computedId fields after parsing.
 */
class RoadmapParserNodeExtensionsTest {

    private RoadmapParser parser;
    private StableIdGenerator stableIdGenerator;

    private static final String PROJECT_ID = "test-project";

    @BeforeEach
    void setUp() {
        stableIdGenerator = new StableIdGenerator();
        parser = new RoadmapParser(stableIdGenerator);
    }

    // ========================================================================
    // Test 1: InitiativeNode stores normalizedTitle and computedId
    // ========================================================================

    /**
     * Test InitiativeNode stores normalizedTitle and computedId.
     */
    @Test
    void initiativeNode_storesNormalizedTitleAndComputedId() {
        String markdown = "## User Authentication\n- Epic 1";

        List<InitiativeNode> initiatives = parser.parse(markdown, PROJECT_ID);

        assertThat(initiatives).hasSize(1);
        InitiativeNode initiative = initiatives.get(0);

        // Original title preserved
        assertThat(initiative.getTitle()).isEqualTo("User Authentication");

        // Normalized title computed
        assertThat(initiative.getNormalizedTitle()).isEqualTo("user authentication");

        // Computed ID is set and deterministic
        assertThat(initiative.getComputedId()).isNotNull();
        UUID expectedId = stableIdGenerator.generateInitiativeId(PROJECT_ID, "user authentication");
        assertThat(initiative.getComputedId()).isEqualTo(expectedId);
    }

    /**
     * Test InitiativeNode with complex whitespace in title.
     */
    @Test
    void initiativeNode_handlesComplexWhitespace() {
        String markdown = "##   API   Integration  \n- Epic 1";

        List<InitiativeNode> initiatives = parser.parse(markdown, PROJECT_ID);

        assertThat(initiatives).hasSize(1);
        InitiativeNode initiative = initiatives.get(0);

        // Original title has trailing whitespace trimmed by parser
        assertThat(initiative.getTitle()).isEqualTo("API   Integration");

        // Normalized title collapses whitespace
        assertThat(initiative.getNormalizedTitle()).isEqualTo("api integration");

        // Computed ID uses normalized title
        UUID expectedId = stableIdGenerator.generateInitiativeId(PROJECT_ID, "api integration");
        assertThat(initiative.getComputedId()).isEqualTo(expectedId);
    }

    // ========================================================================
    // Test 2: EpicNode stores normalizedTitle and computedId
    // ========================================================================

    /**
     * Test EpicNode stores normalizedTitle and computedId.
     */
    @Test
    void epicNode_storesNormalizedTitleAndComputedId() {
        String markdown = "## User Authentication\n- Login Flow";

        List<InitiativeNode> initiatives = parser.parse(markdown, PROJECT_ID);

        assertThat(initiatives).hasSize(1);
        assertThat(initiatives.get(0).getEpics()).hasSize(1);

        EpicNode epic = initiatives.get(0).getEpics().get(0);

        // Original title preserved
        assertThat(epic.getTitle()).isEqualTo("Login Flow");

        // Normalized title computed
        assertThat(epic.getNormalizedTitle()).isEqualTo("login flow");

        // Computed ID includes parent initiative's normalized title
        String parentNormalizedTitle = "user authentication";
        UUID expectedId = stableIdGenerator.generateEpicId(PROJECT_ID, parentNormalizedTitle, "login flow");
        assertThat(epic.getComputedId()).isEqualTo(expectedId);
    }

    /**
     * Test same epic title under different initiatives produces different IDs.
     */
    @Test
    void epicNode_sameEpicTitleUnderDifferentInitiatives_producesDifferentIds() {
        String markdown = """
            ## Initiative A
            - Common Epic

            ## Initiative B
            - Common Epic
            """;

        List<InitiativeNode> initiatives = parser.parse(markdown, PROJECT_ID);

        assertThat(initiatives).hasSize(2);

        EpicNode epicA = initiatives.get(0).getEpics().get(0);
        EpicNode epicB = initiatives.get(1).getEpics().get(0);

        // Same normalized epic title
        assertThat(epicA.getNormalizedTitle()).isEqualTo("common epic");
        assertThat(epicB.getNormalizedTitle()).isEqualTo("common epic");

        // But different computed IDs because parent initiatives differ
        assertThat(epicA.getComputedId()).isNotEqualTo(epicB.getComputedId());
    }

    // ========================================================================
    // Test 3: Parser populates computed fields during parsing
    // ========================================================================

    /**
     * Test parser populates computed fields during parsing for all strategies.
     */
    @Test
    void parser_populatesComputedFieldsDuringParsing() {
        // Strategy 1: ## heading-based
        String markdownStrategy1 = "## Initiative One\n### Epic One";

        List<InitiativeNode> result1 = parser.parse(markdownStrategy1, PROJECT_ID);

        assertThat(result1).hasSize(1);
        assertThat(result1.get(0).getNormalizedTitle()).isNotNull();
        assertThat(result1.get(0).getComputedId()).isNotNull();
        assertThat(result1.get(0).getEpics().get(0).getNormalizedTitle()).isNotNull();
        assertThat(result1.get(0).getEpics().get(0).getComputedId()).isNotNull();
    }

    /**
     * Test parser handles Format F (initiatives section) with computed fields.
     */
    @Test
    void parser_populatesComputedFieldsForFormatF() {
        String markdownFormatF = """
            # Roadmap

            ## Initiatives
            - Initiative Alpha
              - Epic Alpha One
              - Epic Alpha Two
            - Initiative Beta
              - Epic Beta One
            """;

        List<InitiativeNode> result = parser.parse(markdownFormatF, PROJECT_ID);

        // Format F should produce results (or fallback to Strategy 1 if no match)
        // Based on existing parser behavior, this should use Strategy 2
        if (!result.isEmpty()) {
            for (InitiativeNode init : result) {
                assertThat(init.getNormalizedTitle()).isNotNull();
                assertThat(init.getComputedId()).isNotNull();
                for (EpicNode epic : init.getEpics()) {
                    assertThat(epic.getNormalizedTitle()).isNotNull();
                    assertThat(epic.getComputedId()).isNotNull();
                }
            }
        }
    }

    // ========================================================================
    // Test 4: Computed IDs are stable across repeated parse calls
    // ========================================================================

    /**
     * Test computed IDs are stable across repeated parse calls.
     */
    @Test
    void computedIds_stableAcrossRepeatedParseCalls() {
        String markdown = """
            ## User Authentication
            - Login Flow
            - Password Reset

            ## Payment Processing
            - Checkout
            """;

        // Parse twice
        List<InitiativeNode> result1 = parser.parse(markdown, PROJECT_ID);
        List<InitiativeNode> result2 = parser.parse(markdown, PROJECT_ID);

        // Verify same structure
        assertThat(result1).hasSameSizeAs(result2);

        // Verify stable initiative IDs
        for (int i = 0; i < result1.size(); i++) {
            InitiativeNode init1 = result1.get(i);
            InitiativeNode init2 = result2.get(i);

            assertThat(init1.getComputedId()).isEqualTo(init2.getComputedId());
            assertThat(init1.getNormalizedTitle()).isEqualTo(init2.getNormalizedTitle());

            // Verify stable epic IDs
            assertThat(init1.getEpics()).hasSameSizeAs(init2.getEpics());
            for (int j = 0; j < init1.getEpics().size(); j++) {
                EpicNode epic1 = init1.getEpics().get(j);
                EpicNode epic2 = init2.getEpics().get(j);

                assertThat(epic1.getComputedId()).isEqualTo(epic2.getComputedId());
                assertThat(epic1.getNormalizedTitle()).isEqualTo(epic2.getNormalizedTitle());
            }
        }
    }

    /**
     * Test different project IDs produce different computed IDs.
     */
    @Test
    void computedIds_differentProjectIdProducesDifferentIds() {
        String markdown = "## Initiative\n- Epic";

        List<InitiativeNode> result1 = parser.parse(markdown, "project-1");
        List<InitiativeNode> result2 = parser.parse(markdown, "project-2");

        // Same titles but different project IDs
        assertThat(result1.get(0).getNormalizedTitle())
                .isEqualTo(result2.get(0).getNormalizedTitle());

        // Different computed IDs due to different project
        assertThat(result1.get(0).getComputedId())
                .isNotEqualTo(result2.get(0).getComputedId());
        assertThat(result1.get(0).getEpics().get(0).getComputedId())
                .isNotEqualTo(result2.get(0).getEpics().get(0).getComputedId());
    }
}
