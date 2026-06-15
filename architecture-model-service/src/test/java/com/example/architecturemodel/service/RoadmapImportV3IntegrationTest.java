package com.example.architecturemodel.service;

import com.example.architecturemodel.model.parser.EpicNode;
import com.example.architecturemodel.model.parser.InitiativeNode;
import com.example.architecturemodel.util.RoadmapParser;
import com.example.architecturemodel.util.StableIdGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for Roadmap Import v3 feature.
 *
 * Tests end-to-end flow from parsing through ID generation
 * to verify the complete feature works correctly.
 */
class RoadmapImportV3IntegrationTest {

    private StableIdGenerator stableIdGenerator;
    private RoadmapParser roadmapParser;

    private static final String PROJECT_ID = "integration-test-project";

    @BeforeEach
    void setUp() {
        stableIdGenerator = new StableIdGenerator();
        roadmapParser = new RoadmapParser(stableIdGenerator);
    }

    // ========================================================================
    // Integration Test 1: Complete parsing and ID computation flow
    // ========================================================================

    /**
     * Test complete flow: parse markdown, compute IDs, verify determinism.
     */
    @Test
    void completeFlow_parseAndComputeIds_deterministicResults() {
        String markdown = """
            ## User Authentication
            - Login Flow
              - Implement OAuth2
            - Password Reset

            ## Payment Processing
            - Checkout Flow
            """;

        // Parse with project ID to enable v3 ID computation
        List<InitiativeNode> result = roadmapParser.parse(markdown, PROJECT_ID);

        // Verify structure
        assertThat(result).hasSize(2);

        // Initiative 1: User Authentication
        InitiativeNode userAuth = result.get(0);
        assertThat(userAuth.getTitle()).isEqualTo("User Authentication");
        assertThat(userAuth.getNormalizedTitle()).isEqualTo("user authentication");
        assertThat(userAuth.getComputedId()).isNotNull();
        assertThat(userAuth.getEpics()).hasSize(2);

        // Epic 1.1: Login Flow
        EpicNode loginFlow = userAuth.getEpics().get(0);
        assertThat(loginFlow.getTitle()).isEqualTo("Login Flow");
        assertThat(loginFlow.getNormalizedTitle()).isEqualTo("login flow");
        assertThat(loginFlow.getComputedId()).isNotNull();

        // Epic 1.2: Password Reset
        EpicNode passwordReset = userAuth.getEpics().get(1);
        assertThat(passwordReset.getTitle()).isEqualTo("Password Reset");
        assertThat(passwordReset.getNormalizedTitle()).isEqualTo("password reset");
        assertThat(passwordReset.getComputedId()).isNotNull();

        // Initiative 2: Payment Processing
        InitiativeNode payment = result.get(1);
        assertThat(payment.getTitle()).isEqualTo("Payment Processing");
        assertThat(payment.getNormalizedTitle()).isEqualTo("payment processing");
        assertThat(payment.getComputedId()).isNotNull();

        // Verify all IDs are unique
        assertThat(userAuth.getComputedId()).isNotEqualTo(payment.getComputedId());
        assertThat(loginFlow.getComputedId()).isNotEqualTo(passwordReset.getComputedId());
        assertThat(loginFlow.getComputedId()).isNotEqualTo(payment.getEpics().get(0).getComputedId());

        // Verify determinism: parse again and compare
        List<InitiativeNode> result2 = roadmapParser.parse(markdown, PROJECT_ID);
        assertThat(result2.get(0).getComputedId()).isEqualTo(userAuth.getComputedId());
        assertThat(result2.get(0).getEpics().get(0).getComputedId()).isEqualTo(loginFlow.getComputedId());
    }

    // ========================================================================
    // Integration Test 2: Format A (### headings) ID computation
    // ========================================================================

    /**
     * Test Format A (### headings) parsing with ID computation.
     */
    @Test
    void formatA_parseWithHeadingBasedEpics_computesIds() {
        String markdown = """
            ## API Development
            ### REST Endpoints
            Implement CRUD operations
            ### GraphQL Schema
            Define schema types
            """;

        List<InitiativeNode> result = roadmapParser.parse(markdown, PROJECT_ID);

        assertThat(result).hasSize(1);
        InitiativeNode initiative = result.get(0);

        assertThat(initiative.getTitle()).isEqualTo("API Development");
        assertThat(initiative.getNormalizedTitle()).isEqualTo("api development");
        assertThat(initiative.getComputedId()).isNotNull();

        assertThat(initiative.getEpics()).hasSize(2);

        EpicNode restEpic = initiative.getEpics().get(0);
        assertThat(restEpic.getTitle()).isEqualTo("REST Endpoints");
        assertThat(restEpic.getNormalizedTitle()).isEqualTo("rest endpoints");
        assertThat(restEpic.getComputedId()).isNotNull();
        assertThat(restEpic.getDescription()).contains("CRUD operations");

        EpicNode graphqlEpic = initiative.getEpics().get(1);
        assertThat(graphqlEpic.getTitle()).isEqualTo("GraphQL Schema");
        assertThat(graphqlEpic.getNormalizedTitle()).isEqualTo("graphql schema");
        assertThat(graphqlEpic.getComputedId()).isNotNull();
    }

    // ========================================================================
    // Integration Test 3: Cross-project ID isolation
    // ========================================================================

    /**
     * Test that same markdown produces different IDs for different projects.
     */
    @Test
    void crossProject_sameMarkdownDifferentProjects_differentIds() {
        String markdown = "## Shared Initiative\n- Shared Epic";

        List<InitiativeNode> projectA = roadmapParser.parse(markdown, "project-a");
        List<InitiativeNode> projectB = roadmapParser.parse(markdown, "project-b");

        // Same normalized titles
        assertThat(projectA.get(0).getNormalizedTitle())
                .isEqualTo(projectB.get(0).getNormalizedTitle());

        // Different computed IDs
        assertThat(projectA.get(0).getComputedId())
                .isNotEqualTo(projectB.get(0).getComputedId());
        assertThat(projectA.get(0).getEpics().get(0).getComputedId())
                .isNotEqualTo(projectB.get(0).getEpics().get(0).getComputedId());
    }

    // ========================================================================
    // Integration Test 4: Epic scope isolation (same title, different parents)
    // ========================================================================

    /**
     * Test that same epic title under different initiatives produces different IDs.
     */
    @Test
    void epicScope_sameEpicTitleDifferentParents_differentIds() {
        String markdown = """
            ## Initiative A
            - Common Epic

            ## Initiative B
            - Common Epic
            """;

        List<InitiativeNode> result = roadmapParser.parse(markdown, PROJECT_ID);

        assertThat(result).hasSize(2);

        EpicNode epicA = result.get(0).getEpics().get(0);
        EpicNode epicB = result.get(1).getEpics().get(0);

        // Same epic title and normalized title
        assertThat(epicA.getTitle()).isEqualTo(epicB.getTitle());
        assertThat(epicA.getNormalizedTitle()).isEqualTo(epicB.getNormalizedTitle());

        // Different computed IDs (scoped to parent initiative)
        assertThat(epicA.getComputedId()).isNotEqualTo(epicB.getComputedId());
    }

    // ========================================================================
    // Integration Test 5: StableIdGenerator standalone verification
    // ========================================================================

    /**
     * Test StableIdGenerator produces valid UUIDs and is consistent.
     */
    @Test
    void stableIdGenerator_producesValidConsistentUUIDs() {
        String projectId = "test-proj";
        String initiativeTitle = "User  Authentication";  // Double space intentional
        String epicTitle = "  Login Flow  ";  // Extra whitespace

        // Normalize and generate IDs
        String normalizedInit = stableIdGenerator.normalizeTitle(initiativeTitle);
        String normalizedEpic = stableIdGenerator.normalizeTitle(epicTitle);

        UUID initiativeId1 = stableIdGenerator.generateInitiativeId(projectId, normalizedInit);
        UUID initiativeId2 = stableIdGenerator.generateInitiativeId(projectId, normalizedInit);

        UUID epicId1 = stableIdGenerator.generateEpicId(projectId, normalizedInit, normalizedEpic);
        UUID epicId2 = stableIdGenerator.generateEpicId(projectId, normalizedInit, normalizedEpic);

        // Verify normalization
        assertThat(normalizedInit).isEqualTo("user authentication");
        assertThat(normalizedEpic).isEqualTo("login flow");

        // Verify consistency
        assertThat(initiativeId1).isEqualTo(initiativeId2);
        assertThat(epicId1).isEqualTo(epicId2);

        // Verify uniqueness between types
        assertThat(initiativeId1).isNotEqualTo(epicId1);

        // Verify valid UUID format (version 3 - MD5)
        assertThat(initiativeId1.version()).isEqualTo(3);
        assertThat(epicId1.version()).isEqualTo(3);
    }

    // ========================================================================
    // Integration Test 6: Whitespace normalization edge cases
    // ========================================================================

    /**
     * Test various whitespace normalization edge cases in full flow.
     */
    @Test
    void whitespaceNormalization_variousEdgeCases_correctlyHandled() {
        // Test various whitespace scenarios
        String markdown1 = "## User Authentication\n- Login Flow";
        String markdown2 = "##   USER   AUTHENTICATION  \n-   Login   Flow  ";
        String markdown3 = "##\tUser\tAuthentication\n-\tLogin\tFlow";

        List<InitiativeNode> result1 = roadmapParser.parse(markdown1, PROJECT_ID);
        List<InitiativeNode> result2 = roadmapParser.parse(markdown2, PROJECT_ID);
        List<InitiativeNode> result3 = roadmapParser.parse(markdown3, PROJECT_ID);

        // All should produce same normalized titles
        assertThat(result1.get(0).getNormalizedTitle()).isEqualTo("user authentication");
        assertThat(result2.get(0).getNormalizedTitle()).isEqualTo("user authentication");
        assertThat(result3.get(0).getNormalizedTitle()).isEqualTo("user authentication");

        // All should produce same computed IDs
        assertThat(result1.get(0).getComputedId()).isEqualTo(result2.get(0).getComputedId());
        assertThat(result2.get(0).getComputedId()).isEqualTo(result3.get(0).getComputedId());

        // Epic IDs should also match
        assertThat(result1.get(0).getEpics().get(0).getComputedId())
                .isEqualTo(result2.get(0).getEpics().get(0).getComputedId());
    }
}
