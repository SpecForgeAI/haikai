package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for a mined SCL contract.
 *
 * One row per Structural Contract Language contract (behaviour table / shape
 * contract / boundary contract / fragment) mined out of a legacy codebase by
 * a scan. The contract body ({@code bodyJson}), roots ({@code rootsJson}) and
 * gloss ({@code glossJson}) are OPAQUE JSON -- architecture-model-service
 * NEVER parses them; it stores and serves them verbatim.
 *
 * Uniqueness is (scan_id, contract_key) -- the miner's stable per-scan key
 * (e.g. {@code T-abc123}). Re-mining upserts on that pair at the service
 * layer ({@code SclCorpusService#bulkUpsertContracts}); the UNIQUE index from
 * changeset 224 is the belt-and-braces DB guarantee.
 *
 * {@code fanIn} is the miner-computed inbound-reference count, indexed
 * ((scan_id, fan_in), changeset 224) so "the most load-bearing contracts
 * first" listings are cheap.
 *
 * IDs are service-assigned ({@code UUID.randomUUID()} when absent) -- there is
 * NO {@code @GeneratedValue}, matching the DiscoveryRunEntity pattern.
 *
 * Backed by Liquibase changeset 224-scl-corpus.sql.
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 */
@Entity
@Table(
    name = "scl_contract",
    indexes = {
        @Index(name = "uq_scl_contract_scan_key", columnList = "scan_id, contract_key", unique = true),
        @Index(name = "idx_scl_contract_project_arch", columnList = "project_id, architecture_id", unique = false),
        @Index(name = "idx_scl_contract_scan_kind", columnList = "scan_id, kind", unique = false),
        @Index(name = "idx_scl_contract_scan_fan_in", columnList = "scan_id, fan_in", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SclContractEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "scan_id", nullable = false)
    private UUID scanId;

    /** The miner's stable per-scan contract key (e.g. {@code T-abc123}). */
    @Column(name = "contract_key", nullable = false)
    private String contractKey;

    /**
     * Contract kind discriminator as plain TEXT (behaviour table / shape
     * contract / boundary contract / fragment vocabularies are owned by the
     * miner; AMS does not validate the value).
     */
    @Column(name = "kind", nullable = false)
    private String kind;

    @Column(name = "source_path")
    private String sourcePath;

    @Column(name = "source_symbol")
    private String sourceSymbol;

    /** Miner-computed content hash of the contract body (change detection). */
    @Column(name = "content_hash", nullable = false)
    private String contentHash;

    /** Inbound-reference count computed by the miner. NOT NULL DEFAULT 0. */
    @Column(name = "fan_in", nullable = false)
    @Builder.Default
    private Integer fanIn = 0;

    /** Opaque JSON: the entrypoint roots this contract is reachable from. */
    @Type(JsonType.class)
    @Column(name = "roots_json", columnDefinition = "jsonb")
    private Map<String, Object> rootsJson;

    /** Opaque JSON: the contract body itself. NEVER parsed by AMS. */
    @Type(JsonType.class)
    @Column(name = "body_json", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> bodyJson;

    /** Opaque JSON: the LLM annotation-pass gloss. Null until annotated. */
    @Type(JsonType.class)
    @Column(name = "gloss_json", columnDefinition = "jsonb")
    private Map<String, Object> glossJson;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    /** Null until the first update (the column is NULLable, changeset 224). */
    @Column(name = "updated_at")
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        // Defence-in-depth for the no-args/all-args construction paths that
        // bypass the @Builder.Default initializer: honour the DB DEFAULT 0.
        if (fanIn == null) {
            fanIn = 0;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
