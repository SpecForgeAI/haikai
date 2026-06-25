package com.example.architecturemodel.model.dto.targetmanifest;

import java.util.List;
import java.util.Map;

/**
 * One confirmed manifest artifact in the write payload forwarded by the gateway
 * to {@code POST .../manifest-artifacts} (Spec 5 Phase 2, Task Group 1).
 *
 * <p>Maps 1:1 onto the {@code target_manifest_artifacts} columns this spec
 * persists (per tag). {@code content} and {@code packageLockContent} carry the
 * verbatim manifest / lockfile bytes (byte-for-byte; the AMS side stores them
 * unchanged as TEXT). {@code resolvedDependencies} is the resolved dependency
 * list stored as JSONB.</p>
 *
 * <p>The scoping ids ({@code projectId}, {@code targetArchitectureId}) come from
 * the controller path, not the body. Snake_case wire (AMS default -- NO
 * {@code @CamelCaseWire}); e.g. {@code manifestPath} -&gt; {@code manifest_path},
 * {@code packageLockContent} -&gt; {@code package_lock_content},
 * {@code resolvedDependencies} -&gt; {@code resolved_dependencies}.</p>
 *
 * @param tag                  service/module tag the manifest belongs to (the
 *                             per-module placement key + latest-flip scope)
 * @param kind                 manifest kind discriminator (doc-only); v1:
 *                             {@code pom|package_json}
 * @param ecosystem            ecosystem discriminator (doc-only); v1:
 *                             {@code MAVEN|NPM}
 * @param manifestPath         resolved per-module manifest path (e.g.
 *                             {@code pom.xml} / {@code package.json}); nullable
 * @param content              verbatim manifest file content (carried as TEXT)
 * @param packageLockContent   verbatim lockfile content; nullable (present for
 *                             NPM, absent for Maven)
 * @param resolvedDependencies resolved dependency entries (stored as JSONB)
 */
public record TargetManifestArtifactInput(
    String tag,
    String kind,
    String ecosystem,
    String manifestPath,
    String content,
    String packageLockContent,
    List<Map<String, Object>> resolvedDependencies
) {
}
