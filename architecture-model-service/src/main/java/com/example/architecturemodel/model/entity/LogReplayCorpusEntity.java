package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for one log-replay corpus extraction (Capture-State Discipline
 * &amp; Log-Replay program, Spec 5, 2026-08-18).
 *
 * One row per log-file extraction over a (project, architecture): the mined,
 * deduplicated real-world requests reconciliation round 2 live-replays
 * against both current and target at S0. {@code funnelJson} carries the
 * honest extraction funnel (lines -&gt; parsed -&gt; matched -&gt; useful with
 * discard reasons) OPAQUE -- AMS never parses it.
 *
 * IDs are service-assigned -- no {@code @GeneratedValue}, matching the
 * DiscoveryRunEntity / SclScanEntity pattern.
 *
 * Backed by Liquibase changeset 225-log-replay-corpus.sql.
 */
@Entity
@Table(
    name = "log_replay_corpus",
    indexes = {
        @Index(name = "idx_log_replay_corpus_project_arch", columnList = "project_id, architecture_id", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LogReplayCorpusEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    /** Display filename of the source log (null for inline content). */
    @Column(name = "file_name")
    private String fileName;

    /**
     * Corpus lifecycle status as plain TEXT ({@code staged} on creation; the
     * round-2 machinery advances it). Vocabulary owned by the callers.
     */
    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "staged";

    /** Opaque JSON: the extraction funnel + discard-reason accounting. */
    @Type(JsonType.class)
    @Column(name = "funnel_json", columnDefinition = "jsonb")
    private Map<String, Object> funnelJson;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at")
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (status == null) {
            status = "staged";
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
