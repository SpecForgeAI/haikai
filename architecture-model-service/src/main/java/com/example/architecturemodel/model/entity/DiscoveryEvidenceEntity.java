package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for discovery evidence atoms.
 *
 * Each evidence atom represents a single piece of extracted evidence from a
 * source code repository during the discovery pipeline. Evidence atoms
 * are scoped to a discovery run and traceable to a specific repo, file, and
 * extraction type (file_structure, symbol, string_pattern, llm_file_analysis,
 * extension_pack_analysis).
 *
 * The data field is a type-specific JSONB payload whose shape depends on the
 * atom type:
 * - file_structure: { relativePath, extension, sizeBytes, lineCount }
 * - symbol: { name, kind, line, scope, language }
 * - string_pattern: { patternName, matchedText, line, contextSnippet }
 * - llm_file_analysis: { filePath, entities, relationships, rawLlmResponse, analyzedAt }
 * - extension_pack_analysis: { packId, filePath, findings[], analysisTimestamp }
 *
 * Spec: Phase 1a Universal Evidence Extraction (Increment 6)
 * - Task Group 1: Discovery Evidence Table and Liquibase Migration
 *
 * Extended: Log-based Discovery Enrichment (Increment 14)
 * - Task Group 1: source and logOrigin fields for log-derived evidence atoms
 *
 * Extended: Extension Pack Framework & LLM File-Level Analysis
 * - Task Group 3: llm_file_analysis type value for LLM-driven file analysis evidence
 *
 * Extended: Java/Spring Boot Extension Pack
 * - Task Group 1: extension_pack_analysis type value for deterministic pack analysis evidence
 */
@Entity
@Table(
    name = "discovery_evidence",
    indexes = {
        @Index(name = "idx_discovery_evidence_run_id", columnList = "run_id", unique = false),
        @Index(name = "idx_discovery_evidence_run_id_type", columnList = "run_id, type", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryEvidenceEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "repo_url", nullable = false)
    private String repoUrl;

    @Column(name = "file_path", nullable = false)
    private String filePath;

    /**
     * Evidence atom type discriminator.
     * Valid values: "file_structure", "symbol", "string_pattern",
     *               "llm_file_analysis", "extension_pack_analysis".
     *
     * Stored as a plain String (TEXT column) with no enum constraint,
     * allowing new type values to be added without database migrations.
     */
    @Column(name = "type", nullable = false)
    private String type;

    /**
     * Type-specific evidence payload stored as JSONB.
     */
    @Type(JsonType.class)
    @Column(name = "data", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> data = new HashMap<>();

    @Column(name = "extracted_at", nullable = false)
    @Builder.Default
    private Instant extractedAt = Instant.now();

    /**
     * Identifies the origin of the evidence atom.
     * Valid values: "code" (or null, treated as code), "log".
     * Nullable for backward compatibility with pre-existing code-derived atoms.
     *
     * Spec: Log-based Discovery Enrichment (Increment 14)
     * - Task Group 1: source field
     */
    @Column(name = "source")
    private String source;

    /**
     * JSONB metadata about the log file origin for log-sourced atoms.
     * Contains filePath, lineStart, lineEnd, optional timestamp, and optional occurrenceCount.
     * Nullable for code-sourced atoms.
     *
     * Spec: Log-based Discovery Enrichment (Increment 14)
     * - Task Group 1: logOrigin field
     */
    @Type(JsonType.class)
    @Column(name = "log_origin", columnDefinition = "jsonb")
    private Map<String, Object> logOrigin;

    @PrePersist
    protected void onCreate() {
        if (extractedAt == null) {
            extractedAt = Instant.now();
        }
    }
}
