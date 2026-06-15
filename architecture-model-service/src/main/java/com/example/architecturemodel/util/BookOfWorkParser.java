package com.example.architecturemodel.util;

import com.example.architecturemodel.model.parser.EpicNode;
import com.example.architecturemodel.model.parser.FeatureNode;
import com.example.architecturemodel.model.parser.InitiativeNode;
import com.example.architecturemodel.model.parser.StoryNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parser for Book of Work markdown files.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 1.2: Create BookOfWorkParser following RoadmapParser patterns
 *
 * Supports a 4-level hierarchy based on heading levels:
 * - H2 (##) = INITIATIVE
 * - H3 (###) = EPIC
 * - H4 (####) = FEATURE
 * - H5 (#####) = STORY
 *
 * Features:
 * - Walks headings in document order and builds parent/child relationships
 * - Each child attaches to the nearest prior heading of the immediately higher level
 * - Text following a heading until the next same-or-higher-level heading becomes the item's description
 * - Allows incomplete hierarchies (branches can stop at any level)
 * - Computes deterministic IDs using StableIdGenerator
 */
@Component
@Slf4j
public class BookOfWorkParser {

    private final StableIdGenerator stableIdGenerator;

    // Pattern for H2 headings (##) - INITIATIVE
    private static final Pattern H2_PATTERN = Pattern.compile("^##\\s+(.+)$");

    // Pattern for H3 headings (###) - EPIC
    private static final Pattern H3_PATTERN = Pattern.compile("^###\\s+(.+)$");

    // Pattern for H4 headings (####) - FEATURE
    private static final Pattern H4_PATTERN = Pattern.compile("^####\\s+(.+)$");

    // Pattern for H5 headings (#####) - STORY
    private static final Pattern H5_PATTERN = Pattern.compile("^#####\\s+(.+)$");

    /**
     * Constructor with StableIdGenerator injection.
     *
     * @param stableIdGenerator the ID generator for deterministic IDs
     */
    public BookOfWorkParser(StableIdGenerator stableIdGenerator) {
        this.stableIdGenerator = stableIdGenerator;
    }

    /**
     * Parse Book of Work markdown content into a list of InitiativeNodes.
     *
     * @param markdownContent the raw markdown content
     * @param projectId the project ID for deterministic ID generation
     * @return list of parsed initiatives with their complete hierarchy
     * @throws IllegalArgumentException if content has no valid headings (H2-H5)
     */
    public List<InitiativeNode> parse(String markdownContent, String projectId) {
        if (markdownContent == null || markdownContent.isBlank()) {
            log.debug("Empty or null markdown content provided");
            throw new IllegalArgumentException("No valid headings (H2-H5) found in the Book of Work file.");
        }

        String[] lines = markdownContent.split("\\r?\\n");

        // Parse the hierarchy
        List<InitiativeNode> initiatives = parseHierarchy(lines);

        // Validate at least one valid heading exists
        if (initiatives.isEmpty()) {
            throw new IllegalArgumentException("No valid headings (H2-H5) found in the Book of Work file.");
        }

        // Compute deterministic IDs for all nodes
        computeDeterministicIds(initiatives, projectId);

        log.debug("Parsed {} initiatives from Book of Work", initiatives.size());
        return initiatives;
    }

    /**
     * Parse the 4-level hierarchy from markdown lines.
     *
     * @param lines the markdown lines to parse
     * @return list of parsed initiatives with children
     */
    private List<InitiativeNode> parseHierarchy(String[] lines) {
        List<InitiativeNode> initiatives = new ArrayList<>();

        // Current context tracking
        InitiativeNode currentInitiative = null;
        EpicNode currentEpic = null;
        FeatureNode currentFeature = null;
        StoryNode currentStory = null;

        // Description builders
        StringBuilder currentDescription = new StringBuilder();

        // Counters for sort order
        int initiativeOrder = 0;
        int epicOrder = 0;
        int featureOrder = 0;
        int storyOrder = 0;

        // Track what level we're collecting description for
        enum DescriptionTarget { NONE, INITIATIVE, EPIC, FEATURE, STORY }
        DescriptionTarget descTarget = DescriptionTarget.NONE;

        for (String line : lines) {
            String trimmedLine = line.trim();

            // Check for H2 heading (Initiative)
            Matcher h2Matcher = H2_PATTERN.matcher(trimmedLine);
            if (h2Matcher.matches()) {
                // Finalize previous description
                finalizeDescription(currentInitiative, currentEpic, currentFeature, currentStory,
                                    currentDescription, descTarget);

                // Create new initiative
                String title = h2Matcher.group(1).trim();
                currentInitiative = InitiativeNode.builder()
                        .title(title)
                        .sortOrder(initiativeOrder++)
                        .epics(new ArrayList<>())
                        .build();
                initiatives.add(currentInitiative);

                // Reset child context
                currentEpic = null;
                currentFeature = null;
                currentStory = null;
                epicOrder = 0;
                featureOrder = 0;
                storyOrder = 0;

                // Start collecting description
                currentDescription = new StringBuilder();
                descTarget = DescriptionTarget.INITIATIVE;
                continue;
            }

            // Check for H3 heading (Epic)
            Matcher h3Matcher = H3_PATTERN.matcher(trimmedLine);
            if (h3Matcher.matches()) {
                // Finalize previous description
                finalizeDescription(currentInitiative, currentEpic, currentFeature, currentStory,
                                    currentDescription, descTarget);

                String title = h3Matcher.group(1).trim();
                currentEpic = EpicNode.builder()
                        .title(title)
                        .sortOrder(epicOrder++)
                        .features(new ArrayList<>())
                        .build();

                // Attach to current initiative if exists
                if (currentInitiative != null) {
                    currentInitiative.getEpics().add(currentEpic);
                } else {
                    // Orphan epic - log warning but skip
                    log.warn("Epic '{}' has no parent initiative, skipping", title);
                    currentEpic = null;
                    descTarget = DescriptionTarget.NONE;
                    currentDescription = new StringBuilder();
                    continue;
                }

                // Reset child context
                currentFeature = null;
                currentStory = null;
                featureOrder = 0;
                storyOrder = 0;

                // Start collecting description
                currentDescription = new StringBuilder();
                descTarget = DescriptionTarget.EPIC;
                continue;
            }

            // Check for H4 heading (Feature)
            Matcher h4Matcher = H4_PATTERN.matcher(trimmedLine);
            if (h4Matcher.matches()) {
                // Finalize previous description
                finalizeDescription(currentInitiative, currentEpic, currentFeature, currentStory,
                                    currentDescription, descTarget);

                String title = h4Matcher.group(1).trim();
                currentFeature = FeatureNode.builder()
                        .title(title)
                        .sortOrder(featureOrder++)
                        .stories(new ArrayList<>())
                        .build();

                // Attach to current epic if exists
                if (currentEpic != null) {
                    currentEpic.getFeatures().add(currentFeature);
                } else {
                    // Orphan feature - log warning but skip
                    log.warn("Feature '{}' has no parent epic, skipping", title);
                    currentFeature = null;
                    descTarget = DescriptionTarget.NONE;
                    currentDescription = new StringBuilder();
                    continue;
                }

                // Reset child context
                currentStory = null;
                storyOrder = 0;

                // Start collecting description
                currentDescription = new StringBuilder();
                descTarget = DescriptionTarget.FEATURE;
                continue;
            }

            // Check for H5 heading (Story)
            Matcher h5Matcher = H5_PATTERN.matcher(trimmedLine);
            if (h5Matcher.matches()) {
                // Finalize previous description
                finalizeDescription(currentInitiative, currentEpic, currentFeature, currentStory,
                                    currentDescription, descTarget);

                String title = h5Matcher.group(1).trim();
                currentStory = StoryNode.builder()
                        .title(title)
                        .sortOrder(storyOrder++)
                        .build();

                // Attach to current feature if exists
                if (currentFeature != null) {
                    currentFeature.getStories().add(currentStory);
                } else {
                    // Orphan story - log warning but skip
                    log.warn("Story '{}' has no parent feature, skipping", title);
                    currentStory = null;
                    descTarget = DescriptionTarget.NONE;
                    currentDescription = new StringBuilder();
                    continue;
                }

                // Start collecting description
                currentDescription = new StringBuilder();
                descTarget = DescriptionTarget.STORY;
                continue;
            }

            // Collect description content (non-heading lines)
            if (descTarget != DescriptionTarget.NONE) {
                // Skip empty leading lines
                if (currentDescription.length() > 0 || !trimmedLine.isEmpty()) {
                    if (currentDescription.length() > 0) {
                        currentDescription.append("\n");
                    }
                    currentDescription.append(line);
                }
            }
        }

        // Finalize last description
        finalizeDescription(currentInitiative, currentEpic, currentFeature, currentStory,
                            currentDescription, descTarget);

        return initiatives;
    }

    /**
     * Finalize description by setting it on the appropriate node.
     */
    private void finalizeDescription(InitiativeNode initiative, EpicNode epic,
                                     FeatureNode feature, StoryNode story,
                                     StringBuilder description,
                                     Object descTarget) {
        String desc = description.toString().trim();
        if (desc.isEmpty()) {
            return;
        }

        String targetName = descTarget.toString();
        switch (targetName) {
            case "INITIATIVE":
                // InitiativeNode doesn't have description field in current model
                // Description is ignored for initiatives
                break;
            case "EPIC":
                if (epic != null) {
                    epic.setDescription(desc);
                }
                break;
            case "FEATURE":
                if (feature != null) {
                    feature.setDescription(desc);
                }
                break;
            case "STORY":
                if (story != null) {
                    story.setDescription(desc);
                }
                break;
            default:
                break;
        }
    }

    /**
     * Compute deterministic IDs for all parsed nodes.
     *
     * @param initiatives the list of parsed initiatives
     * @param projectId the project ID for ID generation
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

            // Process epics
            for (EpicNode epic : initiative.getEpics()) {
                String normalizedEpicTitle = stableIdGenerator.normalizeTitle(epic.getTitle());
                epic.setNormalizedTitle(normalizedEpicTitle);
                epic.setComputedId(stableIdGenerator.generateEpicId(projectId, normalizedInitiativeTitle, normalizedEpicTitle));

                // Process features
                for (FeatureNode feature : epic.getFeatures()) {
                    String normalizedFeatureTitle = stableIdGenerator.normalizeTitle(feature.getTitle());
                    feature.setNormalizedTitle(normalizedFeatureTitle);
                    feature.setComputedId(stableIdGenerator.generateFeatureId(projectId, normalizedEpicTitle, normalizedFeatureTitle));

                    // Process stories
                    for (StoryNode story : feature.getStories()) {
                        String normalizedStoryTitle = stableIdGenerator.normalizeTitle(story.getTitle());
                        story.setNormalizedTitle(normalizedStoryTitle);
                        story.setComputedId(stableIdGenerator.generateStoryId(projectId, normalizedFeatureTitle, normalizedStoryTitle));
                    }
                }
            }
        }
    }
}
