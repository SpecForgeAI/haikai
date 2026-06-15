package com.example.architecturemodel.util;

import com.example.architecturemodel.model.parser.EpicNode;
import com.example.architecturemodel.model.parser.InitiativeNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for RoadmapParser.
 *
 * Tests Format A (heading-based epics), Format B/C (list-based epics),
 * Format F (Initiatives section bullets), and Format E (table-based)
 * parsing, including title sanitization and format precedence logic.
 */
class RoadmapParserTest {

    private RoadmapParser parser;

    @BeforeEach
    void setUp() {
        parser = new RoadmapParser(new StableIdGenerator());
    }

    // ========================================================================
    // EXISTING V1 TESTS (Format A and Format B/C)
    // ========================================================================

    /**
     * Test Format A: initiatives from ## headings, epics from ### headings.
     */
    @Test
    void parse_formatA_initiativesFromH2_epicsFromH3() {
        String markdown = """
                # Roadmap

                ## Initiative One

                ### Epic A
                Details for Epic A

                ### Epic B
                Details for Epic B

                ## Initiative Two

                ### Epic C
                Details for Epic C
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(2);

        // First initiative
        assertThat(initiatives.get(0).getTitle()).isEqualTo("Initiative One");
        assertThat(initiatives.get(0).getSortOrder()).isEqualTo(0);
        assertThat(initiatives.get(0).getEpics()).hasSize(2);
        assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Epic A");
        assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("Epic B");

        // Second initiative
        assertThat(initiatives.get(1).getTitle()).isEqualTo("Initiative Two");
        assertThat(initiatives.get(1).getSortOrder()).isEqualTo(1);
        assertThat(initiatives.get(1).getEpics()).hasSize(1);
        assertThat(initiatives.get(1).getEpics().get(0).getTitle()).isEqualTo("Epic C");
    }

    /**
     * Test Format A: epic description collects content until next heading.
     */
    @Test
    void parse_formatA_epicDescriptionCollectsContent() {
        String markdown = """
                ## Initiative One

                ### Epic A
                First line of description
                - Bullet point 1
                - Bullet point 2

                More details here

                ### Epic B
                Different content
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(1);
        assertThat(initiatives.get(0).getEpics()).hasSize(2);

        EpicNode epicA = initiatives.get(0).getEpics().get(0);
        assertThat(epicA.getDescription()).contains("First line of description");
        assertThat(epicA.getDescription()).contains("Bullet point 1");
        assertThat(epicA.getDescription()).contains("More details here");

        EpicNode epicB = initiatives.get(0).getEpics().get(1);
        assertThat(epicB.getDescription()).contains("Different content");
    }

    /**
     * Test Format B/C: epics from unordered list items (- or *).
     */
    @Test
    void parse_formatBC_epicsFromUnorderedListItems() {
        String markdown = """
                ## Initiative One

                - Epic from dash
                  - Detail 1
                  - Detail 2

                * Epic from asterisk
                  * Detail A

                ## Initiative Two

                - Another Epic
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(2);

        // First initiative with 2 epics
        assertThat(initiatives.get(0).getEpics()).hasSize(2);
        assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Epic from dash");
        assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("Epic from asterisk");

        // Second initiative with 1 epic
        assertThat(initiatives.get(1).getEpics()).hasSize(1);
        assertThat(initiatives.get(1).getEpics().get(0).getTitle()).isEqualTo("Another Epic");
    }

    /**
     * Test Format B/C: epics from ordered list items (1. 2. etc).
     */
    @Test
    void parse_formatBC_epicsFromOrderedListItems() {
        String markdown = """
                ## Initiative One

                1. First Epic
                   - Sub-detail
                2. Second Epic
                3. Third Epic
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(1);
        assertThat(initiatives.get(0).getEpics()).hasSize(3);
        assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("First Epic");
        assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("Second Epic");
        assertThat(initiatives.get(0).getEpics().get(2).getTitle()).isEqualTo("Third Epic");
    }

    /**
     * Test checkbox stripping ([ ] and [x]) from epic titles.
     */
    @Test
    void parse_stripsCheckboxesFromEpicTitles() {
        String markdown = """
                ## Initiative One

                - [ ] Unchecked Epic
                - [x] Checked Epic
                - [X] Uppercase Checked Epic
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(1);
        assertThat(initiatives.get(0).getEpics()).hasSize(3);
        assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Unchecked Epic");
        assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("Checked Epic");
        assertThat(initiatives.get(0).getEpics().get(2).getTitle()).isEqualTo("Uppercase Checked Epic");
    }

    /**
     * Test prefix stripping (Epic: and EPIC:) case-insensitive from epic titles.
     */
    @Test
    void parse_stripsEpicPrefixCaseInsensitive() {
        String markdown = """
                ## Initiative One

                - Epic: Lowercase Prefix
                - EPIC: Uppercase Prefix
                - epic: Mixed Case
                - No prefix here
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(1);
        assertThat(initiatives.get(0).getEpics()).hasSize(4);
        assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Lowercase Prefix");
        assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("Uppercase Prefix");
        assertThat(initiatives.get(0).getEpics().get(2).getTitle()).isEqualTo("Mixed Case");
        assertThat(initiatives.get(0).getEpics().get(3).getTitle()).isEqualTo("No prefix here");
    }

    /**
     * Test format precedence: Format A is used when ### headings exist, else Format B/C.
     */
    @Test
    void parse_formatPrecedence_usesFormatAWhenH3Exists() {
        // This initiative has both ### headings AND list items
        // Format A should take precedence, so list items should be ignored for epics
        String markdown = """
                ## Initiative One

                Some intro text
                - This list item should be ignored

                ### Real Epic from H3
                Details here

                - Another ignored list item
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(1);
        // Only the H3 epic should be captured
        assertThat(initiatives.get(0).getEpics()).hasSize(1);
        assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Real Epic from H3");
    }

    /**
     * Test initiative with zero epics is still created.
     */
    @Test
    void parse_initiativeWithZeroEpics_isCreated() {
        String markdown = """
                ## Initiative Without Epics

                Just some plain text here, no epics.

                ## Initiative With One Epic

                - Single Epic
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(2);

        // First initiative has no epics
        assertThat(initiatives.get(0).getTitle()).isEqualTo("Initiative Without Epics");
        assertThat(initiatives.get(0).getEpics()).isEmpty();

        // Second initiative has one epic
        assertThat(initiatives.get(1).getTitle()).isEqualTo("Initiative With One Epic");
        assertThat(initiatives.get(1).getEpics()).hasSize(1);
    }

    /**
     * Test content before first ## heading is ignored.
     */
    @Test
    void parse_ignoresContentBeforeFirstH2() {
        String markdown = """
                # Roadmap Title

                This is the intro text that should be ignored.

                - This list item is also ignored

                ## First Initiative

                - Epic One
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(1);
        assertThat(initiatives.get(0).getTitle()).isEqualTo("First Initiative");
    }

    /**
     * Test combined checkbox and prefix stripping.
     */
    @Test
    void parse_combinesCheckboxAndPrefixStripping() {
        String markdown = """
                ## Initiative

                - [ ] Epic: Combined Sanitization
                - [x] EPIC: Another Combined
                """;

        List<InitiativeNode> initiatives = parser.parse(markdown);

        assertThat(initiatives).hasSize(1);
        assertThat(initiatives.get(0).getEpics()).hasSize(2);
        assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Combined Sanitization");
        assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("Another Combined");
    }

    /**
     * Test empty markdown returns empty list.
     */
    @Test
    void parse_emptyMarkdown_returnsEmptyList() {
        List<InitiativeNode> initiatives = parser.parse("");
        assertThat(initiatives).isEmpty();
    }

    /**
     * Test null markdown returns empty list.
     */
    @Test
    void parse_nullMarkdown_returnsEmptyList() {
        List<InitiativeNode> initiatives = parser.parse(null);
        assertThat(initiatives).isEmpty();
    }

    // ========================================================================
    // TASK GROUP 1: FORMAT F TESTS (Initiatives Section Bullets)
    // ========================================================================
    @Nested
    @DisplayName("Format F: Initiatives Section Bullets")
    class FormatFTests {

        /**
         * Test 1.1.1: Initiatives section heading recognition (case-insensitive, any ATX level)
         * Format F is used when NO ## headings exist (Strategy 2)
         */
        @Test
        void parseFormatF_recognizesInitiativesSectionHeading_caseInsensitiveAnyLevel() {
            // Use ### to avoid triggering Strategy 1
            String markdown = """
                    # Document Title

                    Some intro content

                    ### Initiatives

                    - Platform Modernization
                    - Data Migration
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(2);
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Platform Modernization");
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Data Migration");
        }

        /**
         * Test 1.1.2: Section boundary detection (same/higher level heading or EOF)
         */
        @Test
        void parseFormatF_sectionBoundaryDetection_stopsAtSameOrHigherLevelHeading() {
            String markdown = """
                    ### Initiatives

                    - Initiative A
                    - Initiative B

                    ### Other Section

                    - This should not be parsed
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(2);
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Initiative A");
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Initiative B");
        }

        /**
         * Test 1.1.3: First-level bullet extraction as initiatives (- and * at column 0)
         * When using Format F directly (no ## headings in document)
         */
        @Test
        void parseFormatF_firstLevelBullets_parsedAsInitiatives() {
            // Use ### to trigger Strategy 2 (Format F) instead of Strategy 1
            String markdown = """
                    ### Initiatives

                    - Dash Initiative
                    * Asterisk Initiative
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(2);
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Dash Initiative");
            assertThat(initiatives.get(0).getSortOrder()).isEqualTo(0);
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Asterisk Initiative");
            assertThat(initiatives.get(1).getSortOrder()).isEqualTo(1);
        }

        /**
         * Test 1.1.4: Second-level bullet extraction as epics (2+ spaces or tab indented)
         */
        @Test
        void parseFormatF_secondLevelBullets_parsedAsEpics() {
            String markdown = """
                    # Initiatives

                    - Platform Modernization
                      - Microservices Migration
                      - API Gateway Setup
                    - Data Migration
                    	- Schema Redesign
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(2);

            // First initiative with 2 epics
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Platform Modernization");
            assertThat(initiatives.get(0).getEpics()).hasSize(2);
            assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Microservices Migration");
            assertThat(initiatives.get(0).getEpics().get(0).getSortOrder()).isEqualTo(0);
            assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("API Gateway Setup");
            assertThat(initiatives.get(0).getEpics().get(1).getSortOrder()).isEqualTo(1);

            // Second initiative with 1 epic (tab-indented)
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Data Migration");
            assertThat(initiatives.get(1).getEpics()).hasSize(1);
            assertThat(initiatives.get(1).getEpics().get(0).getTitle()).isEqualTo("Schema Redesign");
        }

        /**
         * Test 1.1.5: Epic title normalization (checkbox and "Epic:" prefix stripping)
         */
        @Test
        void parseFormatF_epicTitleNormalization_stripsCheckboxAndPrefix() {
            // Use # (single hash) to NOT trigger Strategy 1 (## headings)
            String markdown = """
                    # Initiative

                    - Project Alpha
                      - [ ] Epic: Unchecked With Prefix
                      - [x] EPIC: Checked With Prefix
                      - Regular Epic Title
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(1);
            assertThat(initiatives.get(0).getEpics()).hasSize(3);
            assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Unchecked With Prefix");
            assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("Checked With Prefix");
            assertThat(initiatives.get(0).getEpics().get(2).getTitle()).isEqualTo("Regular Epic Title");
        }

        /**
         * Test 1.1.6: Epic description capture from third-level bullets and wrapped text
         */
        @Test
        void parseFormatF_epicDescription_capturesThirdLevelBulletsAndWrappedText() {
            // Use ### to trigger Format F
            String markdown = """
                    ### Initiatives

                    - Platform Modernization
                      - Microservices Migration
                        - Phase 1: Assessment
                        - Phase 2: Implementation
                        Wrapped text under epic
                      - API Gateway Setup
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(1);
            assertThat(initiatives.get(0).getEpics()).hasSize(2);

            EpicNode firstEpic = initiatives.get(0).getEpics().get(0);
            assertThat(firstEpic.getTitle()).isEqualTo("Microservices Migration");
            assertThat(firstEpic.getDescription()).isNotNull();
            assertThat(firstEpic.getDescription()).contains("Phase 1: Assessment");
            assertThat(firstEpic.getDescription()).contains("Phase 2: Implementation");
            assertThat(firstEpic.getDescription()).contains("Wrapped text under epic");

            // Second epic should have no description
            EpicNode secondEpic = initiatives.get(0).getEpics().get(1);
            assertThat(secondEpic.getTitle()).isEqualTo("API Gateway Setup");
            assertThat(secondEpic.getDescription()).isNull();
        }
    }

    // ========================================================================
    // TASK GROUP 2: FORMAT E TESTS (Table-Based)
    // ========================================================================
    @Nested
    @DisplayName("Format E: Table-Based Parsing")
    class FormatETests {

        /**
         * Test 2.1.1: Table header recognition (Initiatives/Initiative + Epics/Epic columns)
         */
        @Test
        void parseFormatE_tableHeaderRecognition_detectsQualifyingTable() {
            String markdown = """
                    | Initiative | Epic | Notes |
                    |------------|------|-------|
                    | Platform Modernization | Microservices Migration | Q1 2024 |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(1);
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Platform Modernization");
            assertThat(initiatives.get(0).getEpics()).hasSize(1);
            assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Microservices Migration");
        }

        /**
         * Test 2.1.2: Standard GFM table parsing (header, separator, data rows)
         */
        @Test
        void parseFormatE_gfmTableParsing_parsesHeaderSeparatorAndDataRows() {
            String markdown = """
                    | Initiatives | Epics |
                    |-------------|-------|
                    | Initiative A | Epic One |
                    | Initiative B | Epic Two |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(2);
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Initiative A");
            assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Epic One");
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Initiative B");
            assertThat(initiatives.get(1).getEpics().get(0).getTitle()).isEqualTo("Epic Two");
        }

        /**
         * Test 2.1.3: Row-to-initiative mapping (non-empty initiativeCell creates new initiative)
         * Within a single table, same initiative name merges epics (per spec)
         */
        @Test
        void parseFormatE_rowToInitiativeMapping_sameNameMergesInSingleTable() {
            String markdown = """
                    | Initiative | Epic |
                    |------------|------|
                    | Platform Modernization | Epic A |
                    | Platform Modernization | Epic B |
                    | Data Migration | Epic C |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            // Same initiative name in single table should merge (per Format E spec)
            assertThat(initiatives).hasSize(2);

            // Platform Modernization should have 2 epics
            InitiativeNode platformMod = initiatives.stream()
                    .filter(i -> i.getTitle().equals("Platform Modernization"))
                    .findFirst()
                    .orElseThrow();
            assertThat(platformMod.getEpics()).hasSize(2);
        }

        /**
         * Test 2.1.4: Row continuation (empty initiativeCell uses previous initiative)
         */
        @Test
        void parseFormatE_rowContinuation_emptyCellUsesPreviousInitiative() {
            String markdown = """
                    | Initiative | Epic |
                    |------------|------|
                    | Platform Modernization | Epic A |
                    | | Epic B |
                    | | Epic C |
                    | Data Migration | Epic D |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(2);

            // Platform Modernization with 3 epics (from continuation rows)
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Platform Modernization");
            assertThat(initiatives.get(0).getEpics()).hasSize(3);
            assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Epic A");
            assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("Epic B");
            assertThat(initiatives.get(0).getEpics().get(2).getTitle()).isEqualTo("Epic C");

            // Data Migration with 1 epic
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Data Migration");
            assertThat(initiatives.get(1).getEpics()).hasSize(1);
            assertThat(initiatives.get(1).getEpics().get(0).getTitle()).isEqualTo("Epic D");
        }

        /**
         * Test 2.1.5: Semicolon multi-epic splitting (do NOT split on comma)
         */
        @Test
        void parseFormatE_semicolonMultiEpicSplitting_splitsOnSemicolonNotComma() {
            String markdown = """
                    | Initiative | Epic |
                    |------------|------|
                    | Platform Modernization | Epic A; Epic B; Epic C |
                    | Data Migration | Epic with, comma inside |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(2);

            // First initiative should have 3 epics (split on semicolon)
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Platform Modernization");
            assertThat(initiatives.get(0).getEpics()).hasSize(3);
            assertThat(initiatives.get(0).getEpics().get(0).getTitle()).isEqualTo("Epic A");
            assertThat(initiatives.get(0).getEpics().get(1).getTitle()).isEqualTo("Epic B");
            assertThat(initiatives.get(0).getEpics().get(2).getTitle()).isEqualTo("Epic C");

            // Second initiative should have 1 epic (comma NOT split)
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Data Migration");
            assertThat(initiatives.get(1).getEpics()).hasSize(1);
            assertThat(initiatives.get(1).getEpics().get(0).getTitle()).isEqualTo("Epic with, comma inside");
        }

        /**
         * Test 2.1.6: Epic description from extra columns (markdown bullet list format)
         */
        @Test
        void parseFormatE_epicDescriptionFromExtraColumns_formatsAsBulletList() {
            String markdown = """
                    | Initiative | Epic | Target | Owner |
                    |------------|------|--------|-------|
                    | Platform Modernization | Microservices Migration | Q1 2024 | Team Alpha |
                    | Data Migration | Schema Redesign | | Team Beta |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(2);

            // First epic should have description with both extra columns
            EpicNode firstEpic = initiatives.get(0).getEpics().get(0);
            assertThat(firstEpic.getDescription()).isNotNull();
            assertThat(firstEpic.getDescription()).contains("- Target: Q1 2024");
            assertThat(firstEpic.getDescription()).contains("- Owner: Team Alpha");

            // Second epic should have description with only non-empty Owner column
            EpicNode secondEpic = initiatives.get(1).getEpics().get(0);
            assertThat(secondEpic.getDescription()).isNotNull();
            assertThat(secondEpic.getDescription()).contains("- Owner: Team Beta");
            assertThat(secondEpic.getDescription()).doesNotContain("Target");
        }
    }

    // ========================================================================
    // TASK GROUP 3: STRATEGY ORCHESTRATION TESTS
    // ========================================================================
    @Nested
    @DisplayName("Strategy Orchestration")
    class StrategyOrchestrationTests {

        /**
         * Test 3.1.1: Strategy precedence order (Strategy 1 -> 2 -> 3)
         * When ## headings exist, Strategy 1 wins
         */
        @Test
        void strategyPrecedence_strategy1TakesPriorityOverStrategy2And3() {
            // Document has ## headings (Strategy 1 should win)
            String markdown = """
                    ## Initiative from H2

                    - Epic via list

                    ## Second Initiative

                    - Another Epic

                    | Initiative | Epic |
                    |------------|------|
                    | Table Initiative | Table Epic |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            // Strategy 1 (v1 heading-based) should be used
            assertThat(initiatives).hasSize(2);
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Initiative from H2");
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Second Initiative");
        }

        /**
         * Test 3.1.2: First-match selection - Strategy 2 is used when no ## headings
         */
        @Test
        void strategySelection_strategy2UsedWhenNoH2Headings() {
            // Document with ### Initiatives section (Strategy 2) and table (Strategy 3)
            // No ## headings, so Strategy 2 should be used
            String markdown = """
                    # Roadmap Overview

                    ### Initiatives

                    - Section Initiative A
                      - Section Epic 1
                    - Section Initiative B

                    | Initiative | Epic |
                    |------------|------|
                    | Table Initiative | Table Epic |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            // Strategy 2 produces initiatives, so Strategy 3 should not be used
            assertThat(initiatives).hasSize(2);
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Section Initiative A");
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Section Initiative B");
        }

        /**
         * Test 3.1.3: Multiple table processing in document order (Strategy 3)
         */
        @Test
        void strategyThree_multipleTablesProcessed_inDocumentOrder() {
            String markdown = """
                    First table:

                    | Initiative | Epic |
                    |------------|------|
                    | Initiative A | Epic 1 |
                    | Initiative B | Epic 2 |

                    Second table:

                    | Initiative | Epic |
                    |------------|------|
                    | Initiative C | Epic 3 |
                    | Initiative D | Epic 4 |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(4);
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Initiative A");
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Initiative B");
            assertThat(initiatives.get(2).getTitle()).isEqualTo("Initiative C");
            assertThat(initiatives.get(3).getTitle()).isEqualTo("Initiative D");
        }

        /**
         * Test 3.1.4: Initiative merging by identical title (case-sensitive) across tables
         */
        @Test
        void strategyThree_initiativeMerging_caseSensitiveByTitle() {
            String markdown = """
                    First table:

                    | Initiative | Epic |
                    |------------|------|
                    | Platform Modernization | Epic A |
                    | Data Migration | Epic B |

                    Second table:

                    | Initiative | Epic |
                    |------------|------|
                    | Platform Modernization | Epic C |
                    | platform modernization | Epic D |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            // "Platform Modernization" appears twice, should be merged (case-sensitive)
            // "platform modernization" is different (lowercase), should be separate
            assertThat(initiatives).hasSize(3);

            // Find Platform Modernization initiative
            InitiativeNode platformMod = initiatives.stream()
                    .filter(i -> i.getTitle().equals("Platform Modernization"))
                    .findFirst()
                    .orElseThrow();
            assertThat(platformMod.getEpics()).hasSize(2);
            assertThat(platformMod.getEpics().get(0).getTitle()).isEqualTo("Epic A");
            assertThat(platformMod.getEpics().get(1).getTitle()).isEqualTo("Epic C");

            // lowercase version should be separate
            InitiativeNode lowercasePlatformMod = initiatives.stream()
                    .filter(i -> i.getTitle().equals("platform modernization"))
                    .findFirst()
                    .orElseThrow();
            assertThat(lowercasePlatformMod.getEpics()).hasSize(1);
            assertThat(lowercasePlatformMod.getEpics().get(0).getTitle()).isEqualTo("Epic D");
        }
    }

    // ========================================================================
    // TASK GROUP 4: EDGE CASE AND BACKWARD COMPATIBILITY TESTS
    // ========================================================================
    @Nested
    @DisplayName("Edge Cases and Backward Compatibility")
    class EdgeCaseTests {

        /**
         * Test 4.4.1: Document with no matching format returns empty list
         */
        @Test
        void parse_noMatchingFormat_returnsEmptyList() {
            String markdown = """
                    # Just a title

                    Some paragraph text without any structure.

                    More text here.
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).isEmpty();
        }

        /**
         * Test 4.4.2: Mixed content with headings - v1 heading-based wins
         */
        @Test
        void parse_mixedContent_v1HeadingsWin() {
            String markdown = """
                    ## Regular Initiative

                    - Epic from regular section

                    ## Another Initiative

                    - Another Epic

                    | Initiative | Epic |
                    |------------|------|
                    | Table Initiative | Table Epic |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            // Strategy 1 wins because ## headings exist
            assertThat(initiatives).hasSize(2);
            assertThat(initiatives.get(0).getTitle()).isEqualTo("Regular Initiative");
            assertThat(initiatives.get(1).getTitle()).isEqualTo("Another Initiative");
        }

        /**
         * Test 4.4.3: Malformed table (missing required columns) is skipped
         */
        @Test
        void parseFormatE_malformedTable_missingRequiredColumns_skipped() {
            String markdown = """
                    | Initiative | Notes |
                    |------------|-------|
                    | Platform Modernization | Some note |
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            // Table missing Epics column, so it should be skipped
            assertThat(initiatives).isEmpty();
        }

        /**
         * Test 4.4.4: Deeply nested bullets beyond third level are included in description
         */
        @Test
        void parseFormatF_deeplyNestedBullets_includedInDescription() {
            // Use ### to trigger Format F
            String markdown = """
                    ### Initiatives

                    - Platform Modernization
                      - Microservices Migration
                        - Phase 1
                          - Sub-task 1.1
                            - Detail 1.1.1
                        - Phase 2
                    """;

            List<InitiativeNode> initiatives = parser.parse(markdown);

            assertThat(initiatives).hasSize(1);
            assertThat(initiatives.get(0).getEpics()).hasSize(1);

            EpicNode epic = initiatives.get(0).getEpics().get(0);
            assertThat(epic.getTitle()).isEqualTo("Microservices Migration");
            assertThat(epic.getDescription()).isNotNull();
            assertThat(epic.getDescription()).contains("Phase 1");
            assertThat(epic.getDescription()).contains("Sub-task 1.1");
            assertThat(epic.getDescription()).contains("Detail 1.1.1");
            assertThat(epic.getDescription()).contains("Phase 2");
        }
    }
}
