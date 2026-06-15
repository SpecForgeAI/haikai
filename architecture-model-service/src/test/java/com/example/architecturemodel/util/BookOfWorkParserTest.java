package com.example.architecturemodel.util;

import com.example.architecturemodel.model.parser.FeatureNode;
import com.example.architecturemodel.model.parser.InitiativeNode;
import com.example.architecturemodel.model.parser.EpicNode;
import com.example.architecturemodel.model.parser.StoryNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for BookOfWorkParser.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 1.1: Tests for BookOfWorkParser functionality
 *
 * Tests heading level mapping:
 * - H2 (##) = INITIATIVE
 * - H3 (###) = EPIC
 * - H4 (####) = FEATURE
 * - H5 (#####) = STORY
 */
class BookOfWorkParserTest {

    private BookOfWorkParser parser;
    private StableIdGenerator stableIdGenerator;

    @BeforeEach
    void setUp() {
        stableIdGenerator = new StableIdGenerator();
        parser = new BookOfWorkParser(stableIdGenerator);
    }

    @Test
    @DisplayName("H2 heading parsed as INITIATIVE with correct title extraction")
    void testH2HeadingParsedAsInitiative() {
        String markdown = """
            ## Customer Portal Initiative

            This is the description of the initiative.
            """;

        List<InitiativeNode> result = parser.parse(markdown, "test-project");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getTitle()).isEqualTo("Customer Portal Initiative");
        assertThat(result.get(0).getComputedId()).isNotNull();
        assertThat(result.get(0).getNormalizedTitle()).isEqualTo("customer portal initiative");
    }

    @Test
    @DisplayName("H3 heading parsed as EPIC with parent linkage to nearest prior INITIATIVE")
    void testH3HeadingParsedAsEpicWithParentLinkage() {
        String markdown = """
            ## Initiative One

            Initiative description.

            ### Epic One

            Epic description.

            ### Epic Two

            Another epic.
            """;

        List<InitiativeNode> result = parser.parse(markdown, "test-project");

        assertThat(result).hasSize(1);
        InitiativeNode initiative = result.get(0);
        assertThat(initiative.getTitle()).isEqualTo("Initiative One");
        assertThat(initiative.getEpics()).hasSize(2);

        EpicNode epic1 = initiative.getEpics().get(0);
        assertThat(epic1.getTitle()).isEqualTo("Epic One");
        assertThat(epic1.getDescription()).contains("Epic description");
        assertThat(epic1.getComputedId()).isNotNull();

        EpicNode epic2 = initiative.getEpics().get(1);
        assertThat(epic2.getTitle()).isEqualTo("Epic Two");
    }

    @Test
    @DisplayName("H4 heading parsed as FEATURE with parent linkage to nearest prior EPIC")
    void testH4HeadingParsedAsFeatureWithParentLinkage() {
        String markdown = """
            ## Initiative One

            ### Epic One

            #### Feature One

            Feature description.

            #### Feature Two

            Another feature.
            """;

        List<InitiativeNode> result = parser.parse(markdown, "test-project");

        assertThat(result).hasSize(1);
        InitiativeNode initiative = result.get(0);
        assertThat(initiative.getEpics()).hasSize(1);

        EpicNode epic = initiative.getEpics().get(0);
        assertThat(epic.getTitle()).isEqualTo("Epic One");
        assertThat(epic.getFeatures()).hasSize(2);

        FeatureNode feature1 = epic.getFeatures().get(0);
        assertThat(feature1.getTitle()).isEqualTo("Feature One");
        assertThat(feature1.getDescription()).contains("Feature description");
        assertThat(feature1.getComputedId()).isNotNull();

        FeatureNode feature2 = epic.getFeatures().get(1);
        assertThat(feature2.getTitle()).isEqualTo("Feature Two");
    }

    @Test
    @DisplayName("H5 heading parsed as STORY with parent linkage to nearest prior FEATURE")
    void testH5HeadingParsedAsStoryWithParentLinkage() {
        String markdown = """
            ## Initiative One

            ### Epic One

            #### Feature One

            ##### Story One

            Story description.

            ##### Story Two

            Another story.
            """;

        List<InitiativeNode> result = parser.parse(markdown, "test-project");

        assertThat(result).hasSize(1);
        InitiativeNode initiative = result.get(0);
        assertThat(initiative.getEpics()).hasSize(1);

        EpicNode epic = initiative.getEpics().get(0);
        assertThat(epic.getFeatures()).hasSize(1);

        FeatureNode feature = epic.getFeatures().get(0);
        assertThat(feature.getTitle()).isEqualTo("Feature One");
        assertThat(feature.getStories()).hasSize(2);

        StoryNode story1 = feature.getStories().get(0);
        assertThat(story1.getTitle()).isEqualTo("Story One");
        assertThat(story1.getDescription()).contains("Story description");
        assertThat(story1.getComputedId()).isNotNull();

        StoryNode story2 = feature.getStories().get(1);
        assertThat(story2.getTitle()).isEqualTo("Story Two");
    }

    @Test
    @DisplayName("Incomplete hierarchy (Initiative with no children) parses successfully")
    void testIncompleteHierarchyParsesSuccessfully() {
        String markdown = """
            ## Initiative With No Children

            This initiative has no epics, features, or stories.

            ## Another Initiative

            ### Epic Only

            This epic has no features.
            """;

        List<InitiativeNode> result = parser.parse(markdown, "test-project");

        assertThat(result).hasSize(2);

        // First initiative has no children
        InitiativeNode initiative1 = result.get(0);
        assertThat(initiative1.getTitle()).isEqualTo("Initiative With No Children");
        assertThat(initiative1.getEpics()).isEmpty();

        // Second initiative has an epic but no features
        InitiativeNode initiative2 = result.get(1);
        assertThat(initiative2.getTitle()).isEqualTo("Another Initiative");
        assertThat(initiative2.getEpics()).hasSize(1);
        assertThat(initiative2.getEpics().get(0).getFeatures()).isEmpty();
    }

    @Test
    @DisplayName("File with zero valid headings (H2-H5) throws appropriate error")
    void testFileWithNoValidHeadingsThrowsError() {
        String markdown = """
            # This is H1 - not valid

            Some text without valid headings.

            Just plain content.
            """;

        assertThatThrownBy(() -> parser.parse(markdown, "test-project"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("No valid headings");
    }

    @Test
    @DisplayName("Complete 4-level hierarchy parses correctly with all parent/child relationships")
    void testComplete4LevelHierarchy() {
        String markdown = """
            ## Platform Modernization

            Modernize the platform infrastructure.

            ### User Authentication

            Implement secure authentication.

            #### OAuth Integration

            Add OAuth 2.0 support.

            ##### Configure OAuth Providers

            Set up Google, GitHub providers.

            ##### Implement Token Refresh

            Handle token refresh flow.

            #### Session Management

            Manage user sessions.

            ### Data Migration

            Migrate legacy data.
            """;

        List<InitiativeNode> result = parser.parse(markdown, "test-project");

        assertThat(result).hasSize(1);
        InitiativeNode initiative = result.get(0);
        assertThat(initiative.getTitle()).isEqualTo("Platform Modernization");
        assertThat(initiative.getEpics()).hasSize(2);

        // First epic: User Authentication
        EpicNode epic1 = initiative.getEpics().get(0);
        assertThat(epic1.getTitle()).isEqualTo("User Authentication");
        assertThat(epic1.getFeatures()).hasSize(2);

        // OAuth Integration feature with 2 stories
        FeatureNode feature1 = epic1.getFeatures().get(0);
        assertThat(feature1.getTitle()).isEqualTo("OAuth Integration");
        assertThat(feature1.getStories()).hasSize(2);
        assertThat(feature1.getStories().get(0).getTitle()).isEqualTo("Configure OAuth Providers");
        assertThat(feature1.getStories().get(1).getTitle()).isEqualTo("Implement Token Refresh");

        // Session Management feature with no stories
        FeatureNode feature2 = epic1.getFeatures().get(1);
        assertThat(feature2.getTitle()).isEqualTo("Session Management");
        assertThat(feature2.getStories()).isEmpty();

        // Second epic: Data Migration with no features
        EpicNode epic2 = initiative.getEpics().get(1);
        assertThat(epic2.getTitle()).isEqualTo("Data Migration");
        assertThat(epic2.getFeatures()).isEmpty();
    }
}
