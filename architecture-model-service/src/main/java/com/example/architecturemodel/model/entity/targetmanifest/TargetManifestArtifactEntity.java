package com.example.architecturemodel.model.entity.targetmanifest;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * JPA entity for {@code target_manifest_artifacts} -- the durable store of
 * confirmed target dependency manifests (pom.xml / package.json) that gives the
 * Spec 5 Phase 2 producer its "replace latest, keep history" lifecycle.
 *
 * <p>Each (re-)upload of a confirmed manifest inserts ONE row per tag (with
 * {@link #isLatest}{@code =true}). Re-upload for the same
 * {@code (project_id, target_architecture_id, tag)} flips the prior latest
 * artifact's {@link #isLatest} to {@code false} and inserts a new
 * {@code is_latest=true} row; prior rows are RETAINED as history (append-only,
 * NO deletes). The producer reads only the latest artifacts (one per tag) for a
 * {@code (project_id, target_architecture_id)}. The flip is scoped per
 * {@code (project_id, target_architecture_id, tag)} so distinct tags flip
 * independently and a sibling tag's latest is never demoted.</p>
 *
 * <p>This entity mirrors
 * {@code model/entity/vulnerability/VulnerabilityReportEntity.java} for its
 * lifecycle (the {@code is_latest} flag, the {@code @PrePersist} timestamp
 * default, the {@code @Builder.Default} {@code is_latest=TRUE}) and borrows the
 * {@code @Type(JsonType.class)} + {@code columnDefinition = "jsonb"} idiom from
 * {@code VulnerabilityEntity.fixedInVersions} (VulnerabilityEntity.java:191-211)
 * for {@link #resolvedDependencies}.</p>
 *
 * <p><b>Verbatim bytes:</b> {@link #content} and {@link #packageLockContent}
 * carry the confirmed manifest / lockfile content byte-for-byte as TEXT (no
 * trim, no re-encode, no trailing-newline drift) -- this is the file the
 * carriage emits into the generated target codebase.</p>
 *
 * <p><b>String-typed enumish fields:</b> {@code kind}, {@code ecosystem} are
 * plain {@link String} (NOT Java enums), matching the discovery / vulnerability
 * family convention. Documented value lists live in the
 * {@code 199-target-manifest-artifacts.sql} {@code COMMENT ON COLUMN} blocks;
 * no DB enum.</p>
 *
 * <p>Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2) --
 * Task Group 1. Snake_case wire (AMS default) -- NO {@code @CamelCaseWire}.</p>
 */
@Entity
@Table(
    name = "target_manifest_artifacts",
    indexes = {
        @Index(name = "idx_target_manifest_artifact_project_id", columnList = "project_id"),
        @Index(name = "idx_target_manifest_artifact_target_architecture_id", columnList = "target_architecture_id"),
        @Index(name = "idx_target_manifest_artifact_tag", columnList = "tag"),
        @Index(name = "idx_target_manifest_artifact_is_latest", columnList = "is_latest")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TargetManifestArtifactEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "target_architecture_id", nullable = false)
    private UUID targetArchitectureId;

    /**
     * Service/module tag the manifest belongs to (the per-module placement key).
     * The latest-flip is scoped per
     * {@code (project_id, target_architecture_id, tag)} so distinct tags can each
     * be "latest" independently.
     */
    @Column(name = "tag", nullable = false)
    private String tag;

    /**
     * Manifest kind discriminator (doc-only). v1 values: {@code pom},
     * {@code package_json}. Nullable. String-typed (no DB enum).
     */
    @Column(name = "kind")
    private String kind;

    /**
     * Ecosystem discriminator (doc-only). v1 values: {@code MAVEN}, {@code NPM}.
     * Nullable. String-typed (no DB enum).
     */
    @Column(name = "ecosystem")
    private String ecosystem;

    /**
     * Resolved per-module manifest path relative to the module root (e.g.
     * {@code pom.xml} / {@code package.json}). Nullable when unresolved at
     * upload.
     */
    @Column(name = "manifest_path")
    private String manifestPath;

    /**
     * The verbatim confirmed manifest file content, carried byte-for-byte as
     * TEXT (no trim / re-encode / trailing-newline drift). This is the file
     * emitted into the generated target codebase.
     */
    @Column(name = "content", columnDefinition = "TEXT")
    private String content;

    /**
     * The verbatim lockfile content (e.g. {@code package-lock.json}), carried
     * byte-for-byte as TEXT. Nullable -- present for NPM artifacts, absent for
     * Maven.
     */
    @Column(name = "package_lock_content", columnDefinition = "TEXT")
    private String packageLockContent;

    /**
     * The resolved dependency entries for this manifest, jsonb via the
     * Hypersistence {@link JsonType} (mirrors
     * {@code VulnerabilityEntity.fixedInVersions}). Empty-array default (NOT
     * null) so reads are total. Each element mirrors the gateway
     * {@code ResolvedDependency} shape.
     */
    @Type(JsonType.class)
    @Column(name = "resolved_dependencies", columnDefinition = "jsonb")
    @Builder.Default
    private List<Map<String, Object>> resolvedDependencies = new ArrayList<>();

    /**
     * Tier-2 "free facts" for this artifact -- manifest-declared technology
     * OUTSIDE the 51 architecture questions (e.g. an MCP SDK, a Spring AI / LLM
     * client), named by the upload LLM gap-fill. jsonb via the Hypersistence
     * {@link JsonType} (mirrors {@link #resolvedDependencies}). Empty-array
     * default (NOT null) so reads are total. Each element is a
     * { friendly_name, coordinate } object. Informational only (never new
     * questions); feeds the prompt-ready output.
     *
     * <p>Spec: Target Dependency-Manifest Auto-Answer (Comprehensive) + Tier-2
     * Free Facts (2026-06-26) -- Task Group 7. Snake_case wire ({@code tier2Facts}
     * -&gt; {@code tier2_facts}); NO {@code @CamelCaseWire}.</p>
     */
    @Type(JsonType.class)
    @Column(name = "tier2_facts", columnDefinition = "jsonb")
    @Builder.Default
    private List<Map<String, Object>> tier2Facts = new ArrayList<>();

    /**
     * Logical foreign key to the target-state Application-domain {@code services}
     * element (the codebase that builds this service) the manifest is bound to.
     * Replaces the brittle free-text {@link #tag} association on new uploads and
     * is the data-model foundation for precise scaffold-story homing.
     *
     * <p>LOGICAL FK only -- there is NO physical DB foreign-key constraint,
     * because the referenced {@code services} elements are soft-deleted
     * (archived), not hard-deleted; cleanup is logical (this column is nulled on
     * archive of the chosen element). Validated at write to belong to the path
     * {@code targetArchitectureId} and be non-archived. Nullable -- legacy rows
     * read back null (no backfill); UI-required going forward. NO
     * {@code @Builder.Default}.</p>
     *
     * <p>Spec: Target Manifest -&gt; Service Association (Foreign Key) (2026-06-26)
     * -- Task Group 1. Snake_case wire ({@code targetServiceElementId} -&gt;
     * {@code target_service_element_id}); NO {@code @CamelCaseWire}.</p>
     */
    @Column(name = "target_service_element_id")
    private UUID targetServiceElementId;

    /**
     * Latest-version flag. Exactly one row per
     * {@code (project_id, target_architecture_id, tag)} carries {@code true} at
     * a time; re-upload flips the prior latest to {@code false}. Defaults to
     * {@code true} on a fresh upload.
     */
    @Column(name = "is_latest", nullable = false)
    @Builder.Default
    private Boolean isLatest = Boolean.TRUE;

    /**
     * Creation timestamp. Defaulted via {@link #onCreate()} when unset.
     */
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
