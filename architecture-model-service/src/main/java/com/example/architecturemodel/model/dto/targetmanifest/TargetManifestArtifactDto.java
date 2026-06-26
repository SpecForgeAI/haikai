package com.example.architecturemodel.model.dto.targetmanifest;

import com.example.architecturemodel.model.entity.targetmanifest.TargetManifestArtifactEntity;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for a {@code target_manifest_artifacts} row (Spec 5 Phase 2,
 * Task Group 1).
 *
 * <p>Returned by the latest read ({@code GET .../manifest-artifacts}) -- one DTO
 * per tag (the latest artifact for each tag). {@code content} and
 * {@code packageLockContent} are carried back verbatim so the producer emits the
 * file byte-for-byte. {@code resolvedDependencies} is the JSONB list.</p>
 *
 * <p>Serializes snake_case via the global Jackson
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE} strategy (NO
 * {@code @CamelCaseWire}); e.g. {@code targetArchitectureId} -&gt;
 * {@code target_architecture_id}, {@code manifestPath} -&gt;
 * {@code manifest_path}, {@code packageLockContent} -&gt;
 * {@code package_lock_content}, {@code resolvedDependencies} -&gt;
 * {@code resolved_dependencies}, {@code isLatest} -&gt; {@code is_latest}.</p>
 *
 * <p>Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2) --
 * Task Group 1.</p>
 */
public record TargetManifestArtifactDto(
    UUID id,
    UUID projectId,
    UUID targetArchitectureId,
    String tag,
    String kind,
    String ecosystem,
    String manifestPath,
    String content,
    String packageLockContent,
    List<Map<String, Object>> resolvedDependencies,
    List<Map<String, Object>> tier2Facts,
    UUID targetServiceElementId,
    Boolean isLatest,
    Instant createdAt
) {

    /**
     * Maps a {@link TargetManifestArtifactEntity} to its DTO. Tolerant of a null
     * {@code resolvedDependencies} (defensive -- the entity defaults it to an
     * empty list, but a hand-built entity in a test could leave it null).
     */
    public static TargetManifestArtifactDto fromEntity(TargetManifestArtifactEntity e) {
        return new TargetManifestArtifactDto(
            e.getId(),
            e.getProjectId(),
            e.getTargetArchitectureId(),
            e.getTag(),
            e.getKind(),
            e.getEcosystem(),
            e.getManifestPath(),
            e.getContent(),
            e.getPackageLockContent(),
            e.getResolvedDependencies() == null ? List.of() : e.getResolvedDependencies(),
            e.getTier2Facts() == null ? List.of() : e.getTier2Facts(),
            e.getTargetServiceElementId(),
            e.getIsLatest(),
            e.getCreatedAt()
        );
    }
}
