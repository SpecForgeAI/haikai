package com.example.architecturemodel.util;

import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Utility class for generating stable, deterministic UUIDs for work items.
 *
 * Uses MD5-based UUID generation (UUID v3 style) via Java's nameUUIDFromBytes()
 * to produce consistent IDs based on a key string. This ensures that the same
 * input always produces the same UUID, enabling safe repeated imports.
 *
 * Key formats:
 * - Initiative: "work_item|{projectId}|INITIATIVE|{normalizedTitle}"
 * - Epic: "work_item|{projectId}|EPIC|{parentNormalizedTitle}|{normalizedTitle}"
 * - Feature: "work_item|{projectId}|FEATURE|{parentNormalizedTitle}|{normalizedTitle}"
 * - Story: "work_item|{projectId}|STORY|{parentNormalizedTitle}|{normalizedTitle}"
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 1.4: Extended with FEATURE and STORY types
 */
@Component
public class StableIdGenerator {

    private static final String KEY_PREFIX = "work_item";
    private static final String INITIATIVE_TYPE = "INITIATIVE";
    private static final String EPIC_TYPE = "EPIC";
    private static final String FEATURE_TYPE = "FEATURE";
    private static final String STORY_TYPE = "STORY";
    private static final String DELIMITER = "|";

    /**
     * Normalize a title for use in deterministic key generation.
     *
     * Normalization rules:
     * - Trim leading and trailing whitespace
     * - Collapse consecutive whitespace characters to single spaces
     * - Convert to lowercase
     * - Preserve punctuation (do NOT strip beyond whitespace normalization)
     *
     * @param title the raw title to normalize
     * @return the normalized title, or null if input is null
     */
    public String normalizeTitle(String title) {
        if (title == null) {
            return null;
        }

        // Trim leading/trailing whitespace
        String normalized = title.trim();

        // Collapse consecutive whitespace (spaces, tabs, newlines) to single space
        normalized = normalized.replaceAll("\\s+", " ");

        // Convert to lowercase
        normalized = normalized.toLowerCase();

        return normalized;
    }

    /**
     * Generate a deterministic UUID for an initiative work item.
     *
     * Key format: "work_item|{projectId}|INITIATIVE|{normalizedTitle}"
     *
     * @param projectId the project ID
     * @param normalizedTitle the already-normalized initiative title
     * @return deterministic UUID for the initiative
     */
    public UUID generateInitiativeId(String projectId, String normalizedTitle) {
        String key = buildKey(KEY_PREFIX, projectId, INITIATIVE_TYPE, normalizedTitle);
        return UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Generate a deterministic UUID for an epic work item.
     *
     * Key format: "work_item|{projectId}|EPIC|{parentNormalizedTitle}|{normalizedTitle}"
     *
     * Including the parent initiative's normalized title in the key ensures that
     * an epic with the same title under different initiatives gets different IDs.
     *
     * @param projectId the project ID
     * @param parentNormalizedTitle the already-normalized parent initiative title
     * @param normalizedTitle the already-normalized epic title
     * @return deterministic UUID for the epic
     */
    public UUID generateEpicId(String projectId, String parentNormalizedTitle, String normalizedTitle) {
        String key = buildKey(KEY_PREFIX, projectId, EPIC_TYPE, parentNormalizedTitle, normalizedTitle);
        return UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Generate a deterministic UUID for a feature work item.
     *
     * Spec 2026-01-10: Upload Book of Work from Markdown
     * Task Group 1.4: Added generateFeatureId
     *
     * Key format: "work_item|{projectId}|FEATURE|{epicNormalizedTitle}|{normalizedTitle}"
     *
     * Including the parent epic's normalized title in the key ensures that
     * a feature with the same title under different epics gets different IDs.
     *
     * @param projectId the project ID
     * @param parentNormalizedTitle the already-normalized parent epic title
     * @param normalizedTitle the already-normalized feature title
     * @return deterministic UUID for the feature
     */
    public UUID generateFeatureId(String projectId, String parentNormalizedTitle, String normalizedTitle) {
        String key = buildKey(KEY_PREFIX, projectId, FEATURE_TYPE, parentNormalizedTitle, normalizedTitle);
        return UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Generate a deterministic UUID for a story work item.
     *
     * Spec 2026-01-10: Upload Book of Work from Markdown
     * Task Group 1.4: Added generateStoryId
     *
     * Key format: "work_item|{projectId}|STORY|{featureNormalizedTitle}|{normalizedTitle}"
     *
     * Including the parent feature's normalized title in the key ensures that
     * a story with the same title under different features gets different IDs.
     *
     * @param projectId the project ID
     * @param parentNormalizedTitle the already-normalized parent feature title
     * @param normalizedTitle the already-normalized story title
     * @return deterministic UUID for the story
     */
    public UUID generateStoryId(String projectId, String parentNormalizedTitle, String normalizedTitle) {
        String key = buildKey(KEY_PREFIX, projectId, STORY_TYPE, parentNormalizedTitle, normalizedTitle);
        return UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Build a key string from parts joined by the delimiter.
     *
     * @param parts the parts to join
     * @return the joined key string
     */
    private String buildKey(String... parts) {
        return String.join(DELIMITER, parts);
    }
}
