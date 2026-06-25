package com.example.architecturemodel.model.dto.targetmanifest;

import java.util.List;

/**
 * Request body for {@code POST .../manifest-artifacts} -- the confirmed manifest
 * artifacts the gateway persists at upload (Spec 5 Phase 2, Task Group 1).
 *
 * <p>A simple list wrapper (mirrors the {@code IngestVulnerabilityReportRequest}
 * posture of carrying a {@code rows} list). The write service replaces the
 * latest artifact per {@code (project_id, target_architecture_id, tag)} and
 * keeps history (append-only, no deletes). Scoping ids come from the controller
 * path, not the body.</p>
 *
 * <p>Snake_case wire (AMS default -- NO {@code @CamelCaseWire}).</p>
 *
 * @param artifacts the confirmed manifest artifacts (one per tag)
 */
public record PersistTargetManifestArtifactsRequest(
    List<TargetManifestArtifactInput> artifacts
) {
}
