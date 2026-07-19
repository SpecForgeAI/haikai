package com.example.architecturemodel.model.entity.security;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA entity for {@code security_linking_aliases} -- the project-scoped
 * value-matching memory of the upload wizard.
 *
 * <p>When a file's linking value (e.g. GitLab Project Name {@code "MRX (Risk)"})
 * doesn't exactly match a model entity, the user picks the entity in the
 * wizard's interactive value matcher; the confirmed pairing is persisted here
 * so the NEXT upload auto-resolves it ({@code match_status='auto'}). Unique per
 * {@code (project_id, level, alias_value)}; re-teaching an alias updates the
 * existing row.</p>
 *
 * <p>{@code entity_id} is TEXT (the {@code ApplicationEntity} String id family
 * in v1; {@code level} says which family). {@code entity_name} is a display
 * convenience snapshot ONLY -- reads resolve the live name from the model.</p>
 *
 * <p>Spec: Security health dashboard (2026-07-19, Spec 1 of 3). Snake_case
 * wire (AMS default) -- NO {@code @CamelCaseWire}.</p>
 */
@Entity
@Table(
    name = "security_linking_aliases",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_sec_linking_alias",
            columnNames = {"project_id", "level", "alias_value"})
    },
    indexes = {
        @Index(name = "idx_sec_linking_alias_project", columnList = "project_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SecurityLinkingAliasEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /** The hierarchy level the alias resolves at. v1: {@code application}. */
    @Column(name = "level", nullable = false)
    private String level;

    /** The file-side linking value, verbatim (e.g. {@code MRX (Risk)}). */
    @Column(name = "alias_value", nullable = false)
    private String aliasValue;

    /** The resolved model entity id (String id family per {@code level}). */
    @Column(name = "entity_id", nullable = false)
    private String entityId;

    /** Display-convenience snapshot of the entity name at teach time. */
    @Column(name = "entity_name")
    private String entityName;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
