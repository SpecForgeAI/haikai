# Specification: Roadmap Import v2 - Parser Enhancement for Format F and Format E

## Goal
Extend the existing RoadmapParser to support two additional markdown formats (Format F: nested bullets under an "Initiatives" section, Format E: tables with Initiatives/Epics columns) while preserving backward compatibility with v1 Format A/B/C parsing.

## User Stories
- As a product manager, I want to import roadmap files that use nested bullet lists under an "Initiatives" heading so that I can organize my initiatives and epics in a natural outline format.
- As a product manager, I want to import roadmap files that use markdown tables with Initiatives and Epics columns so that I can visualize work items in tabular form and have them automatically parsed.

## Specific Requirements

**Strategy Selection Precedence**
- Apply parsing strategies in strict order: Strategy 1 (v1 heading-based), then Strategy 2 (Initiatives section bullets), then Strategy 3 (table-based)
- Select the FIRST strategy that produces >= 1 initiative; do not merge results from multiple strategies
- Strategy 1 is chosen when at least one "## " initiative heading exists in the document
- Strategy 2 is chosen when no "## " headings exist OR an explicit "Initiatives" section heading is present
- Strategy 3 is chosen when neither Strategy 1 nor 2 produces initiatives AND a qualifying table exists
- Add debug logging when a strategy is chosen (not user-facing)

**Format F: Initiatives Section Recognition**
- Accept ANY ATX heading level (# through ######) whose trimmed text matches "Initiatives" or "Initiative" (case-insensitive)
- Define the Initiatives section as content from that heading until the next heading of SAME or HIGHER level, or EOF
- Example accepted headings: "# Initiatives", "### initiative", "## Initiative"
- Content outside the recognized Initiatives section boundary is ignored for Format F parsing

**Format F: Initiative and Epic Extraction**
- First-level bullets (lines starting with "- " or "* " at column 0, no leading whitespace) are initiatives
- Second-level bullets (indented by at least 2 spaces OR a tab under an initiative bullet) are epics
- Epic title normalization: strip leading checkbox markers "[ ] " or "[x] " (x case-insensitive), strip "Epic:" or "EPIC:" prefix (case-insensitive), then trim
- Do NOT interpret checkbox state as status (preserve v1 rule)
- Initiative description remains null for v2 (do not infer from content)

**Format F: Epic Description from Detail Bullets**
- For each epic bullet, capture following lines until: next epic bullet at same indentation, next initiative bullet, or section end
- Include third-level bullets (further indented) and indented wrapped text lines under the epic bullet
- Store captured lines as markdown in epic.description, preserving bullet characters and relative indentation
- Trim trailing spaces from captured description content

**Format E: Table Recognition**
- A table qualifies if its header row contains BOTH: a column named "Initiatives" or "Initiative" (case-insensitive) AND a column named "Epics" or "Epic" (case-insensitive)
- Parse standard GitHub-flavored markdown tables: header row "| A | B |", separator row "|---|---|", data rows "| ... | ... |"
- Tables may include additional columns (Notes, Target, Owner, etc.)

**Format E: Row-to-Items Mapping**
- For each data row: extract initiativeCell (trim) and epicCell (trim) from respective columns
- If initiativeCell is non-empty: create/start new initiative group for this title
- If initiativeCell is empty: treat as "same as previous initiative" within the same table
- If no previous initiative context exists for a row, skip the row with a debug warning
- If epicCell is empty: skip row (no epic produced)
- Semicolon multi-epic support: if epicCell contains ";" then split into multiple epics (trim each); do NOT split on comma

**Format E: Epic Description from Extra Columns**
- If table has columns beyond Initiatives/Epics, append a markdown bullet list to epic.description for non-empty extra cells
- Format: "- ColumnName: value" for each non-empty extra column cell
- Preserve original cell text (trimmed)

**Format E: Multiple Tables and Initiative Merging**
- If multiple qualifying tables exist and Strategy 3 is selected: process tables in document order
- Initiatives with identical titles (case-sensitive match after trimming) are treated as the same initiative within the import run
- Epics from subsequent table rows are merged under the existing initiative with that title

**Sort Order Assignment**
- Initiatives: appearance order within the chosen strategy (section bullet order OR table row order), starting at 0
- Epics within an initiative: appearance order under that initiative within the chosen strategy, starting at 0
- Sort order increments sequentially per entity type within its parent context

## Visual Design
No visual assets provided. This is a backend-only specification with no UI changes.

## Existing Code to Leverage

**RoadmapParser.java (com.example.architecturemodel.util)**
- Contains the core parsing logic with format detection (Format A vs B/C) and section identification
- Reuse the sanitizeTitle() method for epic title normalization (checkbox and "Epic:" prefix stripping)
- Extend identifyInitiativeSections() to detect Initiatives section headings for Format F
- Add new parsing methods for Format F (parseInitiativesSectionBullets) and Format E (parseQualifyingTables)

**InitiativeNode.java and EpicNode.java (com.example.architecturemodel.model.parser)**
- Existing intermediate models for parsed initiatives and epics
- No changes needed; epic.description field already supports storing markdown content
- Continue using the builder pattern for constructing parsed nodes

**RoadmapImportService.java (com.example.architecturemodel.service)**
- Orchestrates file reading, artifact storage, safety checks (409 if FEATURE/STORY exist), and work item persistence
- No changes needed for v2; the service delegates parsing entirely to RoadmapParser
- persistWorkItems() already handles initiatives with epics and sets sort_order correctly

**RoadmapParserTest.java (existing test class)**
- Contains test patterns for Format A and B/C parsing, title sanitization, format precedence, and edge cases
- Follow the same test structure: use text block markdown inputs, assert on initiative/epic counts and titles
- Add new test methods for Format F and Format E while keeping existing tests unchanged

**WorkItemEntity.java (com.example.architecturemodel.model.entity)**
- JPA entity with title, description (nullable String), sortOrder, type, and parentId fields
- No schema changes needed; epic.description field can store markdown content of any length

## Out of Scope
- No UI changes or frontend modifications
- No new REST endpoints (existing import endpoint unchanged)
- No changes to artifact storage behavior or versioning
- No modification to import blocking semantics (409 CONFLICT when FEATURE/STORY exist remains unchanged)
- No status mapping from checkbox state or any other source
- No markdown export generation
- No deep cycle detection in parsed structures
- No parsing of arbitrary heading levels beyond the explicit Initiatives section support
- No initiative.description inference (remains null for v2)
- No support for splitting epic cells on commas (only semicolons)
