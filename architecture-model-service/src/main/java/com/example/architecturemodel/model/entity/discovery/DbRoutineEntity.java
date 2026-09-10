package com.example.architecturemodel.model.entity.discovery;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One harvested routine (stored procedure / function / trigger) -- the
 * routine catalog of the Stored Proc &amp; Function Behaviour Program
 * (Spec 1, changeset 229, {@code db_routines}).
 *
 * <p>Written by the discovery DB scan at completion (facts, not candidates)
 * and keyed by (architecture, schema, name, kind). The body is UNBOUNDED;
 * the signature / profile / closures are the engine pack's deterministic
 * profiler output stored verbatim as jsonb. Snake_case wire by the AMS
 * default -- Jackson renders {@code paramsJson} as {@code params_json}.</p>
 */
@Entity
@Table(name = "db_routines")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DbRoutineEntity {

    public static final String KIND_PROCEDURE = "procedure";
    public static final String KIND_FUNCTION = "function";
    public static final String KIND_TRIGGER = "trigger";

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "discovery_run_id")
    private UUID discoveryRunId;

    @Column(name = "schema_name", nullable = false, length = 128)
    private String schemaName;

    @Column(name = "routine_name", nullable = false, length = 255)
    private String routineName;

    /** procedure | function | trigger (chk_db_routines_kind). */
    @Column(name = "routine_kind", nullable = false, length = 16)
    private String routineKind;

    @Column(name = "language", length = 32)
    private String language;

    /** The FULL harvested body -- never truncated, never redacted. */
    @Column(name = "full_body", columnDefinition = "TEXT", nullable = false)
    private String fullBody;

    /** SHA-256 over the whitespace-normalised, lower-cased body. */
    @Column(name = "body_hash", nullable = false, length = 80)
    private String bodyHash;

    /** MD5 over the same normalisation (parity with the SCL proc merge). */
    @Column(name = "body_md5", length = 40)
    private String bodyMd5;

    /** [{name, ordinal, source_type, direction, default_literal}]. */
    @Type(JsonType.class)
    @Column(name = "params_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<Map<String, Object>> paramsJson = new ArrayList<>();

    @Column(name = "returns_type", length = 255)
    private String returnsType;

    @Column(name = "trigger_on_table", length = 255)
    private String triggerOnTable;

    @Type(JsonType.class)
    @Column(name = "trigger_events_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> triggerEventsJson = new ArrayList<>();

    /** The static profile (exit outcomes, result selects, constructs, ...). */
    @Type(JsonType.class)
    @Column(name = "profile_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> profileJson = new LinkedHashMap<>();

    @Type(JsonType.class)
    @Column(name = "reads_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> readsJson = new ArrayList<>();

    @Type(JsonType.class)
    @Column(name = "writes_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> writesJson = new ArrayList<>();

    @Type(JsonType.class)
    @Column(name = "proc_calls_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> procCallsJson = new ArrayList<>();

    @Type(JsonType.class)
    @Column(name = "reads_closure_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> readsClosureJson = new ArrayList<>();

    @Type(JsonType.class)
    @Column(name = "writes_closure_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> writesClosureJson = new ArrayList<>();

    @Type(JsonType.class)
    @Column(name = "trigger_expanded_writes_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> triggerExpandedWritesJson = new ArrayList<>();

    /** live | repo. */
    @Column(name = "source", nullable = false, length = 16)
    @Builder.Default
    private String source = "live";

    @Column(name = "signature_parsed", nullable = false)
    @Builder.Default
    private boolean signatureParsed = true;

    @Column(name = "signature_error", columnDefinition = "TEXT")
    private String signatureError;

    @Column(name = "harvested_at")
    private Instant harvestedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
