package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for one deduplicated useful request in a log-replay corpus
 * (Capture-State Discipline &amp; Log-Replay program, Spec 5, 2026-08-18).
 *
 * Replay-critical fields (method, template + concrete path, occurrence
 * count, richness) are structured columns; the request payload
 * ({@code requestJson}: headers / query / body) is OPAQUE JSON -- AMS never
 * parses it. {@code responseStatus} is the LOGGED status, kept for
 * diagnostics only -- logged responses are NEVER oracles (they describe
 * production state at logging time, not S0).
 *
 * Backed by Liquibase changeset 225-log-replay-corpus.sql.
 */
@Entity
@Table(
    name = "log_replay_corpus_item",
    indexes = {
        @Index(name = "idx_log_replay_corpus_item_corpus", columnList = "corpus_id", unique = false),
        @Index(name = "idx_log_replay_corpus_item_template", columnList = "corpus_id, method, path_template", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LogReplayCorpusItemEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "corpus_id", nullable = false)
    private UUID corpusId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /** Uppercase HTTP method. */
    @Column(name = "method", nullable = false)
    private String method;

    /** Normalized path template ({@code {id}} placeholders) -- the join key. */
    @Column(name = "path_template", nullable = false)
    private String pathTemplate;

    /** The concrete path AS LOGGED, query string preserved -- the replay URL. */
    @Column(name = "concrete_path", nullable = false)
    private String concretePath;

    /** Opaque JSON: {@code { headers?, query?, body? }} exactly as mined. */
    @Type(JsonType.class)
    @Column(name = "request_json", columnDefinition = "jsonb")
    private Map<String, Object> requestJson;

    /** The LOGGED response status (diagnostic only, never an oracle). */
    @Column(name = "response_status")
    private Integer responseStatus;

    /** How many identical requests collapsed into this item. */
    @Column(name = "occurrence_count", nullable = false)
    @Builder.Default
    private Integer occurrenceCount = 1;

    /** {@code url_only} | {@code with_body} -- the tier the item carries. */
    @Column(name = "richness", nullable = false)
    private String richness;

    /** The committed-model endpoint this item matched, when resolved. */
    @Column(name = "matched_endpoint_id")
    private UUID matchedEndpointId;

    @Column(name = "source_file_name")
    private String sourceFileName;

    @Column(name = "line_number")
    private Integer lineNumber;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (occurrenceCount == null) {
            occurrenceCount = 1;
        }
    }
}
