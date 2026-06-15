# Task Breakdown: Roadmap Import v2 - Parser Enhancement for Format F and Format E

## Overview
Total Tasks: 18

This feature extends RoadmapParser.java to support two additional markdown formats while preserving backward compatibility with existing v1 parsing (Format A/B/C).

**Key Files:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/util/RoadmapParser.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/util/RoadmapParserTest.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/InitiativeNode.java` (no changes)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/EpicNode.java` (no changes)

## Task List

### Parser Layer - Format F (Initiatives Section Bullets)

#### Task Group 1: Format F - Section Recognition and Bullet Parsing
**Dependencies:** None

- [x] 1.0 Complete Format F parser implementation
  - [x] 1.1 Write 6 focused tests for Format F parsing
    - Test Initiatives section heading recognition (case-insensitive, any ATX level)
    - Test section boundary detection (same/higher level heading or EOF)
    - Test first-level bullet extraction as initiatives (- and * at column 0)
    - Test second-level bullet extraction as epics (2+ spaces or tab indented)
    - Test epic title normalization (checkbox and "Epic:" prefix stripping)
    - Test epic description capture from third-level bullets and wrapped text
  - [x] 1.2 Add Initiatives section heading detection pattern
    - Pattern matches "Initiatives" or "Initiative" (case-insensitive)
    - Accept any ATX heading level (# through ######)
    - Store heading level for boundary detection
    - File: `RoadmapParser.java`
  - [x] 1.3 Implement section boundary identification for Format F
    - Find content from Initiatives heading until next same/higher level heading or EOF
    - Extract section lines for bullet parsing
    - Ignore content outside recognized Initiatives section
    - File: `RoadmapParser.java`
  - [x] 1.4 Implement first-level bullet parsing for initiatives
    - Match lines starting with "- " or "* " at column 0 (no leading whitespace)
    - Create InitiativeNode for each matched bullet
    - Assign sequential sortOrder starting at 0
    - File: `RoadmapParser.java`
  - [x] 1.5 Implement second-level bullet parsing for epics
    - Match lines indented by 2+ spaces or tab under initiative bullet
    - Apply existing sanitizeTitle() for checkbox and "Epic:" prefix removal
    - Create EpicNode with sequential sortOrder within parent initiative
    - File: `RoadmapParser.java`
  - [x] 1.6 Implement epic description capture from detail bullets
    - Capture third-level bullets (further indented) as epic.description
    - Capture indented wrapped text lines under epic bullet
    - Preserve bullet characters and relative indentation in markdown format
    - Trim trailing spaces from captured description
    - Stop capture at: next epic bullet, next initiative bullet, or section end
    - File: `RoadmapParser.java`
  - [x] 1.7 Ensure Format F tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify section recognition and bullet extraction work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 1.1 pass
- Initiatives section heading detected at any ATX level (case-insensitive)
- Section boundaries correctly identified
- First-level bullets parsed as initiatives
- Second-level bullets parsed as epics with title normalization
- Epic descriptions captured from nested content with markdown preserved

---

### Parser Layer - Format E (Table-Based)

#### Task Group 2: Format E - Table Recognition and Row Parsing
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete Format E parser implementation
  - [x] 2.1 Write 6 focused tests for Format E parsing
    - Test table header recognition (Initiatives/Initiative + Epics/Epic columns)
    - Test standard GFM table parsing (header, separator, data rows)
    - Test row-to-initiative mapping (non-empty initiativeCell creates new initiative)
    - Test row continuation (empty initiativeCell uses previous initiative)
    - Test semicolon multi-epic splitting (do NOT split on comma)
    - Test epic description from extra columns (markdown bullet list format)
  - [x] 2.2 Implement table header detection and column indexing
    - Identify tables with both Initiatives/Initiative AND Epics/Epic columns
    - Store column indices for initiative, epic, and extra columns
    - Handle case-insensitive column name matching
    - File: `RoadmapParser.java`
  - [x] 2.3 Implement GFM table row parsing
    - Parse header row "| A | B |" format
    - Skip separator row "|---|---|"
    - Extract cell values from data rows, trim whitespace
    - Handle tables with varying column counts
    - File: `RoadmapParser.java`
  - [x] 2.4 Implement row-to-initiative mapping logic
    - Non-empty initiativeCell: create/start new initiative group
    - Empty initiativeCell: use previous initiative context
    - Skip row with debug warning if no previous initiative context exists
    - Assign sequential sortOrder to initiatives
    - File: `RoadmapParser.java`
  - [x] 2.5 Implement epic extraction from table rows
    - Skip row if epicCell is empty
    - Split epicCell on semicolon ";" for multi-epic support (trim each)
    - Do NOT split on comma (preserve commas in epic titles)
    - Create EpicNode with sequential sortOrder within initiative
    - File: `RoadmapParser.java`
  - [x] 2.6 Implement epic description from extra columns
    - For columns beyond Initiatives/Epics, append to epic.description
    - Format: "- ColumnName: value" for each non-empty extra cell
    - Build markdown bullet list for description content
    - Preserve original cell text (trimmed)
    - File: `RoadmapParser.java`
  - [x] 2.7 Ensure Format E tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify table recognition and row parsing work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- Qualifying tables detected by header column names
- GFM table format parsed correctly
- Row-to-initiative mapping handles continuation rows
- Semicolon multi-epic splitting works correctly
- Extra column content formatted as markdown description

---

### Parser Layer - Strategy Orchestration

#### Task Group 3: Strategy Selection and Multi-Table Merging
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete strategy orchestration implementation
  - [x] 3.1 Write 4 focused tests for strategy selection and merging
    - Test strategy precedence order (Strategy 1 -> 2 -> 3)
    - Test first-match selection (do not merge results from multiple strategies)
    - Test multiple table processing in document order (Strategy 3)
    - Test initiative merging by identical title (case-sensitive) across tables
  - [x] 3.2 Refactor parse() method to implement strategy orchestration
    - Try Strategy 1 (existing v1 heading-based) first
    - If Strategy 1 produces 0 initiatives, try Strategy 2 (Format F)
    - If Strategy 2 produces 0 initiatives, try Strategy 3 (Format E)
    - Select FIRST strategy that produces >= 1 initiative
    - Add debug logging when strategy is chosen
    - File: `RoadmapParser.java`
  - [x] 3.3 Implement multiple table processing for Format E
    - Process all qualifying tables in document order
    - Merge initiatives with identical titles (case-sensitive match after trim)
    - Append epics from subsequent table rows to existing initiative
    - Maintain correct sortOrder for merged epics
    - File: `RoadmapParser.java`
  - [x] 3.4 Ensure strategy orchestration tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify strategy selection precedence works correctly
    - Verify initiative merging across multiple tables
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- Strategy selection follows strict precedence order
- First successful strategy is used exclusively (no merging across strategies)
- Multiple tables processed in document order
- Initiatives with identical titles merged correctly

---

### Testing Layer

#### Task Group 4: Test Review, Backward Compatibility, and Gap Analysis
**Dependencies:** Task Groups 1, 2, and 3

- [x] 4.0 Review existing tests and ensure backward compatibility
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 6 Format F tests from Task 1.1
    - Review the 6 Format E tests from Task 2.1
    - Review the 4 strategy orchestration tests from Task 3.1
    - Total existing new tests: 16 tests
  - [x] 4.2 Verify all existing v1 tests still pass
    - Run existing RoadmapParserTest.java tests (Format A, Format B/C)
    - Confirm no regression in v1 parsing behavior
    - Verify sanitizeTitle() still works correctly for all formats
  - [x] 4.3 Analyze test coverage gaps for v2 feature only
    - Identify critical edge cases lacking coverage
    - Focus on boundary conditions and error scenarios
    - Prioritize integration between Format F/E and existing formats
  - [x] 4.4 Write up to 4 additional strategic tests if needed
    - Test edge case: document with no matching format returns empty list
    - Test edge case: mixed content (headings + Initiatives section + tables)
    - Test edge case: malformed table (missing columns) is skipped
    - Test edge case: deeply nested bullets beyond third level
  - [x] 4.5 Run complete feature test suite
    - Run ALL RoadmapParser tests (v1 + v2)
    - Expected total: approximately 16-20 new tests + existing tests
    - Verify all tests pass with no regressions

**Acceptance Criteria:**
- All 16 tests from Task Groups 1-3 pass
- All existing v1 tests pass (backward compatibility verified)
- No more than 4 additional edge case tests added
- Complete test suite runs successfully with zero failures
- Coverage includes critical integration scenarios between formats

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Format F Parser** (independent)
   - Can start immediately
   - Focus: Initiatives section recognition and bullet parsing

2. **Task Group 2: Format E Parser** (independent, parallel with Group 1)
   - Can start immediately, parallel with Task Group 1
   - Focus: Table recognition and row-to-item mapping

3. **Task Group 3: Strategy Orchestration** (depends on Groups 1 and 2)
   - Must wait for Groups 1 and 2 to complete
   - Focus: Strategy selection precedence and multi-table merging

4. **Task Group 4: Test Review and Backward Compatibility** (depends on Group 3)
   - Must wait for Group 3 to complete
   - Focus: Backward compatibility verification and edge case coverage

## Notes

- **No changes needed** to InitiativeNode.java, EpicNode.java, RoadmapImportService.java, or WorkItemEntity.java
- **Reuse existing** sanitizeTitle() method for epic title normalization in both Format F and Format E
- **Follow existing test patterns** in RoadmapParserTest.java (text block markdown inputs, AssertJ assertions)
- **Debug logging only** for strategy selection (not user-facing)
- **Preserve v1 behavior** - Strategy 1 (existing heading-based parsing) must remain the first choice
