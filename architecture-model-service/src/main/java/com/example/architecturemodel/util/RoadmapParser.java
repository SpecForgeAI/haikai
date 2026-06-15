package com.example.architecturemodel.util;

import com.example.architecturemodel.model.parser.EpicNode;
import com.example.architecturemodel.model.parser.InitiativeNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parser for roadmap markdown files.
 *
 * Supports multiple parsing strategies with strict precedence:
 * - Strategy 1 (v1): Initiatives from ## headings, Epics from ### headings or list items (Format A/B/C)
 * - Strategy 2 (v2): Initiatives from bullets under an "Initiatives" section heading (Format F)
 * - Strategy 3 (v2): Initiatives from tables with Initiative/Epic columns (Format E)
 *
 * Strategy selection: Use the FIRST strategy that produces >= 1 initiative.
 *
 * V3 additions:
 * - parse(content, projectId) computes deterministic IDs for each initiative/epic
 * - Uses StableIdGenerator for normalized title and UUID computation
 */
@Component
@Slf4j
public class RoadmapParser {

    private final StableIdGenerator stableIdGenerator;

    // Pattern for ## headings (initiatives in Strategy 1)
    private static final Pattern H2_PATTERN = Pattern.compile("^##\\s+(.+)$");

    // Pattern for ### headings (Format A epics)
    private static final Pattern H3_PATTERN = Pattern.compile("^###\\s+(.+)$");

    // Pattern for unordered list items (- or *)
    private static final Pattern UNORDERED_LIST_PATTERN = Pattern.compile("^[-*]\\s+(.+)$");

    // Pattern for ordered list items (1. 2. etc)
    private static final Pattern ORDERED_LIST_PATTERN = Pattern.compile("^\\d+\\.\\s+(.+)$");

    // Pattern for checkbox syntax [ ] or [x] or [X]
    private static final Pattern CHECKBOX_PATTERN = Pattern.compile("^\\s*\\[[xX ]\\]\\s*");

    // Pattern for Epic: prefix (case-insensitive)
    private static final Pattern EPIC_PREFIX_PATTERN = Pattern.compile("^(?i)epic:\\s*");

    // Pattern for any ATX heading level (# through ######)
    private static final Pattern ATX_HEADING_PATTERN = Pattern.compile("^(#{1,6})\\s+(.+)$");

    // Pattern for Initiatives/Initiative section heading (case-insensitive)
    private static final Pattern INITIATIVES_HEADING_PATTERN = Pattern.compile("^(#{1,6})\\s+initiatives?\\s*$", Pattern.CASE_INSENSITIVE);

    // Pattern for first-level bullet (at column 0, no leading whitespace)
    private static final Pattern FIRST_LEVEL_BULLET_PATTERN = Pattern.compile("^[-*]\\s+(.+)$");

    // Pattern for indented bullet (2+ spaces or tab)
    private static final Pattern INDENTED_BULLET_PATTERN = Pattern.compile("^(\\s{2,}|\\t)[-*]\\s+(.+)$");

    // Pattern for table row
    private static final Pattern TABLE_ROW_PATTERN = Pattern.compile("^\\|(.+)\\|\\s*$");

    // Pattern for table separator row
    private static final Pattern TABLE_SEPARATOR_PATTERN = Pattern.compile("^\\|[\\s\\-:|]+\\|\\s*$");

    /**
     * Constructor with StableIdGenerator injection.
     *
     * @param stableIdGenerator the ID generator for v3 deterministic IDs
     */
    public RoadmapParser(StableIdGenerator stableIdGenerator) {
        this.stableIdGenerator = stableIdGenerator;
    }

    /**
     * Parse roadmap markdown content into a list of InitiativeNodes.
     * This is the v1/v2 compatible method that does NOT compute deterministic IDs.
     *
     * @param markdownContent the raw markdown content
     * @return list of parsed initiatives with their epics
     */
    public List<InitiativeNode> parse(String markdownContent) {
        return parse(markdownContent, null);
    }

    /**
     * Parse roadmap markdown content into a list of InitiativeNodes with v3 deterministic IDs.
     * When projectId is provided, computes normalizedTitle and computedId for each initiative/epic.
     *
     * @param markdownContent the raw markdown content
     * @param projectId the project ID for deterministic ID generation (null for v1/v2 compatibility)
     * @return list of parsed initiatives with their epics
     */
    public List<InitiativeNode> parse(String markdownContent, String projectId) {
        if (markdownContent == null || markdownContent.isBlank()) {
            log.debug("Empty or null markdown content provided");
            return new ArrayList<>();
        }

        String[] lines = markdownContent.split("\\r?\\n");

        // Strategy 1: v1 heading-based parsing (Format A/B/C)
        List<InitiativeNode> strategy1Result = parseStrategy1(lines);
        if (!strategy1Result.isEmpty()) {
            log.debug("Strategy 1 (v1 heading-based) selected: produced {} initiatives", strategy1Result.size());
            computeDeterministicIds(strategy1Result, projectId);
            return strategy1Result;
        }

        // Strategy 2: Format F - Initiatives section bullets
        List<InitiativeNode> strategy2Result = parseStrategy2FormatF(lines);
        if (!strategy2Result.isEmpty()) {
            log.debug("Strategy 2 (Format F section bullets) selected: produced {} initiatives", strategy2Result.size());
            computeDeterministicIds(strategy2Result, projectId);
            return strategy2Result;
        }

        // Strategy 3: Format E - Table-based parsing
        List<InitiativeNode> strategy3Result = parseStrategy3FormatE(lines);
        if (!strategy3Result.isEmpty()) {
            log.debug("Strategy 3 (Format E table-based) selected: produced {} initiatives", strategy3Result.size());
            computeDeterministicIds(strategy3Result, projectId);
            return strategy3Result;
        }

        log.debug("No strategy produced initiatives");
        return new ArrayList<>();
    }

    /**
     * Compute deterministic IDs for all parsed initiatives and epics.
     * Only computes if projectId is provided (v3 mode).
     *
     * @param initiatives the list of parsed initiatives
     * @param projectId the project ID (null to skip ID computation)
     */
    private void computeDeterministicIds(List<InitiativeNode> initiatives, String projectId) {
        if (projectId == null || stableIdGenerator == null) {
            return;
        }

        for (InitiativeNode initiative : initiatives) {
            // Compute normalized title and ID for initiative
            String normalizedInitiativeTitle = stableIdGenerator.normalizeTitle(initiative.getTitle());
            initiative.setNormalizedTitle(normalizedInitiativeTitle);
            initiative.setComputedId(stableIdGenerator.generateInitiativeId(projectId, normalizedInitiativeTitle));

            // Compute normalized title and ID for each epic under this initiative
            for (EpicNode epic : initiative.getEpics()) {
                String normalizedEpicTitle = stableIdGenerator.normalizeTitle(epic.getTitle());
                epic.setNormalizedTitle(normalizedEpicTitle);
                epic.setComputedId(stableIdGenerator.generateEpicId(projectId, normalizedInitiativeTitle, normalizedEpicTitle));
            }
        }
    }

    // ========================================================================
    // STRATEGY 1: V1 HEADING-BASED PARSING (FORMAT A/B/C)
    // ========================================================================

    /**
     * Parse using Strategy 1 (v1 heading-based): initiatives from ## headings.
     */
    private List<InitiativeNode> parseStrategy1(String[] lines) {
        List<InitiativeNode> initiatives = new ArrayList<>();

        // First pass: identify initiative boundaries
        List<InitiativeSection> sections = identifyInitiativeSections(lines);

        // Second pass: parse each initiative section
        int initiativeOrder = 0;
        for (InitiativeSection section : sections) {
            InitiativeNode initiative = parseInitiativeSection(section, initiativeOrder++);
            initiatives.add(initiative);
        }

        return initiatives;
    }

    /**
     * Identify initiative sections by finding ## headings and their content boundaries.
     */
    private List<InitiativeSection> identifyInitiativeSections(String[] lines) {
        List<InitiativeSection> sections = new ArrayList<>();
        int currentStart = -1;
        String currentTitle = null;

        for (int i = 0; i < lines.length; i++) {
            Matcher h2Matcher = H2_PATTERN.matcher(lines[i].trim());
            if (h2Matcher.matches()) {
                // Close previous section
                if (currentStart >= 0) {
                    InitiativeSection section = new InitiativeSection(currentTitle, currentStart, i);
                    section.setSourceLines(lines);
                    sections.add(section);
                }
                // Start new section
                currentTitle = h2Matcher.group(1).trim();
                currentStart = i + 1;
            }
        }

        // Close final section
        if (currentStart >= 0) {
            InitiativeSection section = new InitiativeSection(currentTitle, currentStart, lines.length);
            section.setSourceLines(lines);
            sections.add(section);
        }

        return sections;
    }

    /**
     * Parse a single initiative section into an InitiativeNode.
     */
    private InitiativeNode parseInitiativeSection(InitiativeSection section, int sortOrder) {
        InitiativeNode initiative = InitiativeNode.builder()
                .title(section.title)
                .sortOrder(sortOrder)
                .epics(new ArrayList<>())
                .build();

        // Determine format by checking for ### headings
        boolean hasH3 = false;
        String[] lines = section.getLines();
        for (String line : lines) {
            if (H3_PATTERN.matcher(line.trim()).matches()) {
                hasH3 = true;
                break;
            }
        }

        if (hasH3) {
            // Format A: Parse epics from ### headings
            parseFormatAEpics(initiative, lines);
        } else {
            // Format B/C: Parse epics from list items
            parseFormatBCEpics(initiative, lines);
        }

        return initiative;
    }

    /**
     * Parse epics using Format A (### headings).
     */
    private void parseFormatAEpics(InitiativeNode initiative, String[] lines) {
        int epicOrder = 0;
        String currentEpicTitle = null;
        StringBuilder currentDescription = new StringBuilder();

        for (String line : lines) {
            Matcher h3Matcher = H3_PATTERN.matcher(line.trim());
            if (h3Matcher.matches()) {
                // Save previous epic
                if (currentEpicTitle != null) {
                    String description = currentDescription.toString().trim();
                    initiative.getEpics().add(EpicNode.builder()
                            .title(sanitizeTitle(currentEpicTitle))
                            .description(description.isEmpty() ? null : description)
                            .sortOrder(epicOrder++)
                            .build());
                }
                // Start new epic
                currentEpicTitle = h3Matcher.group(1).trim();
                currentDescription = new StringBuilder();
            } else if (currentEpicTitle != null) {
                // Collect content for current epic (skip empty leading lines)
                if (currentDescription.length() > 0 || !line.trim().isEmpty()) {
                    if (currentDescription.length() > 0) {
                        currentDescription.append("\n");
                    }
                    currentDescription.append(line);
                }
            }
        }

        // Save final epic
        if (currentEpicTitle != null) {
            String description = currentDescription.toString().trim();
            initiative.getEpics().add(EpicNode.builder()
                    .title(sanitizeTitle(currentEpicTitle))
                    .description(description.isEmpty() ? null : description)
                    .sortOrder(epicOrder)
                    .build());
        }
    }

    /**
     * Parse epics using Format B/C (list items).
     */
    private void parseFormatBCEpics(InitiativeNode initiative, String[] lines) {
        int epicOrder = 0;
        String currentEpicTitle = null;
        StringBuilder currentDescription = new StringBuilder();

        for (String line : lines) {
            String trimmedLine = line.trim();

            // Check for list item (epic)
            Matcher unorderedMatcher = UNORDERED_LIST_PATTERN.matcher(trimmedLine);
            Matcher orderedMatcher = ORDERED_LIST_PATTERN.matcher(trimmedLine);

            boolean isTopLevelListItem = false;
            String listItemContent = null;

            if (unorderedMatcher.matches() && !isIndented(line)) {
                isTopLevelListItem = true;
                listItemContent = unorderedMatcher.group(1).trim();
            } else if (orderedMatcher.matches() && !isIndented(line)) {
                isTopLevelListItem = true;
                listItemContent = orderedMatcher.group(1).trim();
            }

            if (isTopLevelListItem) {
                // Save previous epic
                if (currentEpicTitle != null) {
                    String description = currentDescription.toString().trim();
                    initiative.getEpics().add(EpicNode.builder()
                            .title(sanitizeTitle(currentEpicTitle))
                            .description(description.isEmpty() ? null : description)
                            .sortOrder(epicOrder++)
                            .build());
                }
                // Start new epic
                currentEpicTitle = listItemContent;
                currentDescription = new StringBuilder();
            } else if (currentEpicTitle != null && isIndented(line)) {
                // Collect nested content as description
                if (currentDescription.length() > 0) {
                    currentDescription.append("\n");
                }
                currentDescription.append(line);
            }
        }

        // Save final epic
        if (currentEpicTitle != null) {
            String description = currentDescription.toString().trim();
            initiative.getEpics().add(EpicNode.builder()
                    .title(sanitizeTitle(currentEpicTitle))
                    .description(description.isEmpty() ? null : description)
                    .sortOrder(epicOrder)
                    .build());
        }
    }

    // ========================================================================
    // STRATEGY 2: FORMAT F - INITIATIVES SECTION BULLETS
    // ========================================================================

    /**
     * Parse using Strategy 2 (Format F): initiatives from bullets under an "Initiatives" section.
     */
    private List<InitiativeNode> parseStrategy2FormatF(String[] lines) {
        // Find the Initiatives section
        int sectionStartLine = -1;
        int sectionHeadingLevel = 0;

        for (int i = 0; i < lines.length; i++) {
            Matcher matcher = INITIATIVES_HEADING_PATTERN.matcher(lines[i].trim());
            if (matcher.matches()) {
                sectionStartLine = i + 1;
                sectionHeadingLevel = matcher.group(1).length();
                break;
            }
        }

        if (sectionStartLine < 0) {
            return new ArrayList<>();
        }

        // Find section end (same or higher level heading, or EOF)
        int sectionEndLine = lines.length;
        for (int i = sectionStartLine; i < lines.length; i++) {
            Matcher headingMatcher = ATX_HEADING_PATTERN.matcher(lines[i].trim());
            if (headingMatcher.matches()) {
                int headingLevel = headingMatcher.group(1).length();
                if (headingLevel <= sectionHeadingLevel) {
                    sectionEndLine = i;
                    break;
                }
            }
        }

        // Parse bullets within the section
        return parseFormatFBullets(lines, sectionStartLine, sectionEndLine);
    }

    /**
     * Parse Format F bullets within a section boundary.
     */
    private List<InitiativeNode> parseFormatFBullets(String[] lines, int startLine, int endLine) {
        List<InitiativeNode> initiatives = new ArrayList<>();
        InitiativeNode currentInitiative = null;
        EpicNode currentEpic = null;
        StringBuilder epicDescription = new StringBuilder();
        int initiativeOrder = 0;
        int epicOrder = 0;
        int epicIndentLevel = -1;

        for (int i = startLine; i < endLine; i++) {
            String line = lines[i];
            String trimmedLine = line.trim();

            // Check for first-level bullet (initiative)
            Matcher firstLevelMatcher = FIRST_LEVEL_BULLET_PATTERN.matcher(trimmedLine);
            if (firstLevelMatcher.matches() && !isIndented(line)) {
                // Save previous epic if exists
                if (currentEpic != null && currentInitiative != null) {
                    finalizeEpic(currentInitiative, currentEpic, epicDescription);
                    currentEpic = null;
                    epicDescription = new StringBuilder();
                }

                // Create new initiative
                String initiativeTitle = firstLevelMatcher.group(1).trim();
                currentInitiative = InitiativeNode.builder()
                        .title(initiativeTitle)
                        .sortOrder(initiativeOrder++)
                        .epics(new ArrayList<>())
                        .build();
                initiatives.add(currentInitiative);
                epicOrder = 0;
                epicIndentLevel = -1;
                continue;
            }

            // Check for second-level bullet (epic) - indented under initiative
            Matcher indentedMatcher = INDENTED_BULLET_PATTERN.matcher(line);
            if (indentedMatcher.matches() && currentInitiative != null) {
                int currentIndent = getIndentLevel(line);

                // If this is at the epic level (second level)
                if (epicIndentLevel < 0 || currentIndent == epicIndentLevel) {
                    // Save previous epic if exists
                    if (currentEpic != null) {
                        finalizeEpic(currentInitiative, currentEpic, epicDescription);
                        epicDescription = new StringBuilder();
                    }

                    // Create new epic
                    String epicTitle = indentedMatcher.group(2).trim();
                    epicIndentLevel = currentIndent;
                    currentEpic = EpicNode.builder()
                            .title(sanitizeTitle(epicTitle))
                            .sortOrder(epicOrder++)
                            .build();
                    continue;
                }
            }

            // If we have a current epic and this line is more indented, add to description
            if (currentEpic != null && isIndented(line)) {
                int currentIndent = getIndentLevel(line);
                if (currentIndent > epicIndentLevel) {
                    if (epicDescription.length() > 0) {
                        epicDescription.append("\n");
                    }
                    epicDescription.append(line);
                }
            }
        }

        // Save final epic
        if (currentEpic != null && currentInitiative != null) {
            finalizeEpic(currentInitiative, currentEpic, epicDescription);
        }

        return initiatives;
    }

    /**
     * Finalize an epic by setting its description and adding to initiative.
     */
    private void finalizeEpic(InitiativeNode initiative, EpicNode epic, StringBuilder descriptionBuilder) {
        String description = descriptionBuilder.toString().trim();
        if (!description.isEmpty()) {
            epic.setDescription(description);
        }
        initiative.getEpics().add(epic);
    }

    /**
     * Get the indentation level of a line (number of leading spaces, tabs count as 4).
     */
    private int getIndentLevel(String line) {
        int indent = 0;
        for (char c : line.toCharArray()) {
            if (c == ' ') {
                indent++;
            } else if (c == '\t') {
                indent += 4;
            } else {
                break;
            }
        }
        return indent;
    }

    // ========================================================================
    // STRATEGY 3: FORMAT E - TABLE-BASED PARSING
    // ========================================================================

    /**
     * Parse using Strategy 3 (Format E): initiatives from tables with Initiative/Epic columns.
     */
    private List<InitiativeNode> parseStrategy3FormatE(String[] lines) {
        // Find all qualifying tables
        List<TableInfo> tables = findQualifyingTables(lines);

        if (tables.isEmpty()) {
            return new ArrayList<>();
        }

        // Process all tables and merge initiatives by title
        Map<String, InitiativeNode> initiativesByTitle = new LinkedHashMap<>();
        int globalInitiativeOrder = 0;

        for (TableInfo table : tables) {
            InitiativeNode currentInitiative = null;

            for (int i = table.dataStartLine; i < table.endLine; i++) {
                String line = lines[i].trim();
                Matcher rowMatcher = TABLE_ROW_PATTERN.matcher(line);
                if (!rowMatcher.matches()) {
                    continue;
                }

                String[] cells = parseTableCells(rowMatcher.group(1));
                if (cells.length <= Math.max(table.initiativeColIndex, table.epicColIndex)) {
                    continue;
                }

                String initiativeCell = cells[table.initiativeColIndex].trim();
                String epicCell = cells[table.epicColIndex].trim();

                // Determine current initiative
                if (!initiativeCell.isEmpty()) {
                    // Check if initiative already exists (for merging)
                    if (initiativesByTitle.containsKey(initiativeCell)) {
                        currentInitiative = initiativesByTitle.get(initiativeCell);
                    } else {
                        currentInitiative = InitiativeNode.builder()
                                .title(initiativeCell)
                                .sortOrder(globalInitiativeOrder++)
                                .epics(new ArrayList<>())
                                .build();
                        initiativesByTitle.put(initiativeCell, currentInitiative);
                    }
                }

                // Skip if no current initiative context
                if (currentInitiative == null) {
                    log.debug("Skipping row with no initiative context: {}", line);
                    continue;
                }

                // Skip if epic cell is empty
                if (epicCell.isEmpty()) {
                    continue;
                }

                // Build extra column description
                String extraDescription = buildExtraColumnDescription(cells, table);

                // Split on semicolon for multiple epics
                String[] epicTitles = epicCell.split(";");
                for (String epicTitle : epicTitles) {
                    String trimmedEpicTitle = epicTitle.trim();
                    if (!trimmedEpicTitle.isEmpty()) {
                        EpicNode epic = EpicNode.builder()
                                .title(sanitizeTitle(trimmedEpicTitle))
                                .description(extraDescription.isEmpty() ? null : extraDescription)
                                .sortOrder(currentInitiative.getEpics().size())
                                .build();
                        currentInitiative.getEpics().add(epic);
                    }
                }
            }
        }

        return new ArrayList<>(initiativesByTitle.values());
    }

    /**
     * Find all qualifying tables in the document.
     */
    private List<TableInfo> findQualifyingTables(String[] lines) {
        List<TableInfo> tables = new ArrayList<>();

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            Matcher rowMatcher = TABLE_ROW_PATTERN.matcher(line);
            if (!rowMatcher.matches()) {
                continue;
            }

            // Check if this is a header row followed by separator
            if (i + 1 >= lines.length) {
                continue;
            }

            String nextLine = lines[i + 1].trim();
            if (!TABLE_SEPARATOR_PATTERN.matcher(nextLine).matches()) {
                continue;
            }

            // Parse header cells
            String[] headerCells = parseTableCells(rowMatcher.group(1));
            int initiativeColIndex = -1;
            int epicColIndex = -1;
            List<Integer> extraColIndices = new ArrayList<>();
            List<String> extraColNames = new ArrayList<>();

            for (int j = 0; j < headerCells.length; j++) {
                String header = headerCells[j].trim().toLowerCase();
                if (header.equals("initiative") || header.equals("initiatives")) {
                    initiativeColIndex = j;
                } else if (header.equals("epic") || header.equals("epics")) {
                    epicColIndex = j;
                } else if (!header.isEmpty()) {
                    extraColIndices.add(j);
                    extraColNames.add(headerCells[j].trim());
                }
            }

            // Must have both Initiative and Epic columns
            if (initiativeColIndex < 0 || epicColIndex < 0) {
                continue;
            }

            // Find table end
            int tableEndLine = i + 2;
            while (tableEndLine < lines.length) {
                String tableLine = lines[tableEndLine].trim();
                if (!TABLE_ROW_PATTERN.matcher(tableLine).matches()) {
                    break;
                }
                tableEndLine++;
            }

            TableInfo table = new TableInfo();
            table.headerLine = i;
            table.dataStartLine = i + 2;
            table.endLine = tableEndLine;
            table.initiativeColIndex = initiativeColIndex;
            table.epicColIndex = epicColIndex;
            table.extraColIndices = extraColIndices;
            table.extraColNames = extraColNames;

            tables.add(table);

            // Skip to end of this table
            i = tableEndLine - 1;
        }

        return tables;
    }

    /**
     * Parse table cells from a row's content (without outer pipes).
     */
    private String[] parseTableCells(String rowContent) {
        return rowContent.split("\\|", -1);
    }

    /**
     * Build extra column description as markdown bullet list.
     */
    private String buildExtraColumnDescription(String[] cells, TableInfo table) {
        StringBuilder description = new StringBuilder();

        for (int i = 0; i < table.extraColIndices.size(); i++) {
            int colIndex = table.extraColIndices.get(i);
            if (colIndex < cells.length) {
                String value = cells[colIndex].trim();
                if (!value.isEmpty()) {
                    if (description.length() > 0) {
                        description.append("\n");
                    }
                    description.append("- ").append(table.extraColNames.get(i)).append(": ").append(value);
                }
            }
        }

        return description.toString();
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Check if a line is indented (for nested list items).
     */
    private boolean isIndented(String line) {
        return line.startsWith("  ") || line.startsWith("\t");
    }

    /**
     * Sanitize an epic title by removing checkbox syntax and "Epic:" prefix.
     *
     * @param title the raw title
     * @return the sanitized title
     */
    String sanitizeTitle(String title) {
        if (title == null) {
            return null;
        }

        String sanitized = title;

        // Remove checkbox syntax [ ] or [x] or [X]
        sanitized = CHECKBOX_PATTERN.matcher(sanitized).replaceFirst("");

        // Remove Epic: prefix (case-insensitive)
        sanitized = EPIC_PREFIX_PATTERN.matcher(sanitized).replaceFirst("");

        return sanitized.trim();
    }

    // ========================================================================
    // INTERNAL CLASSES
    // ========================================================================

    /**
     * Internal class to track initiative section boundaries.
     */
    private static class InitiativeSection {
        final String title;
        final int startLine;
        final int endLine;
        private String[] sourceLines;

        InitiativeSection(String title, int startLine, int endLine) {
            this.title = title;
            this.startLine = startLine;
            this.endLine = endLine;
        }

        void setSourceLines(String[] allLines) {
            this.sourceLines = allLines;
        }

        String[] getLines() {
            if (sourceLines == null) {
                return new String[0];
            }
            int length = endLine - startLine;
            String[] result = new String[length];
            System.arraycopy(sourceLines, startLine, result, 0, length);
            return result;
        }
    }

    /**
     * Internal class to track table structure.
     */
    private static class TableInfo {
        int headerLine;
        int dataStartLine;
        int endLine;
        int initiativeColIndex;
        int epicColIndex;
        List<Integer> extraColIndices;
        List<String> extraColNames;
    }
}
