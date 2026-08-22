package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * One foundation adjudication fact (Foundations &amp; Scope program, Spec 1,
 * 2026-08-22): a rule-level answer from the Foundations Review with
 * provenance and an evidence hash. Durable and additive — a re-scan whose
 * evidence changed flips {@code stale} instead of silently dropping the
 * answer. Unique per (project, architecture, decision_key).
 */
@Entity
@Table(name = "foundation_decisions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FoundationDecisionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "project_id", nullable = false)
    private String projectId;

    @Column(name = "architecture_id", nullable = false)
    private String architectureId;

    @Column(name = "decision_key", nullable = false)
    private String decisionKey;

    @Column(name = "rule_key", nullable = false)
    private String ruleKey;

    @Column(name = "question_text")
    private String questionText;

    @Column(name = "answer", nullable = false)
    private String answer;

    @Column(name = "scope")
    private String scope;

    @Type(JsonType.class)
    @Column(name = "targets_json", columnDefinition = "jsonb", nullable = false)
    private List<Map<String, Object>> targetsJson;

    @Type(JsonType.class)
    @Column(name = "payload_json", columnDefinition = "jsonb")
    private Map<String, Object> payloadJson;

    @Column(name = "rationale")
    private String rationale;

    @Column(name = "evidence_hash")
    private String evidenceHash;

    @Column(name = "stale", nullable = false)
    private boolean stale;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
