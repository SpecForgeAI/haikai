package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourDiffRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Guard helper that verifies an api_behaviour_diff belongs to the
 * requested project (and, optionally, architecture) before diff-scoped
 * child-entity operations proceed.
 *
 * <p>Shape mirrors {@link DiscoveryRunArchitectureGuard}: throws
 * {@link ResourceNotFoundException} (which the controller advice maps to
 * 404) on any mismatch. The 404-not-409 choice is deliberate -- a diff
 * that belongs to a different project effectively does not exist from
 * the perspective of a client whose URL pins the wrong project.</p>
 *
 * <p>Spec: API Test Harness — Findings Integration (2026-05-25) -- Task
 * Group 1. Used as the first-line guard on every endpoint of the new
 * diff-scoped findings controller surface.</p>
 */
@Component
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourDiffArchitectureGuard {

    private final ApiBehaviourDiffRepository diffRepository;

    /**
     * Verify the diff exists AND is bound to the given project.
     *
     * <p>Note the architecture-id parameter is accepted as a
     * defence-in-depth filter when the URL carries it; current callers
     * pass {@code null} because the new diff-scoped findings URLs do not
     * include the architecture segment (the diff itself is uniquely
     * identified by diffId within projectId). Pass a non-null
     * architectureId only if the URL contract names one.</p>
     *
     * @param diffId         the api_behaviour_diff UUID
     * @param projectId      the project UUID from the URL path
     * @param architectureId optional architecture UUID; when non-null, the
     *                       diff's architecture_id MUST match
     * @throws ResourceNotFoundException if the diff does not exist in the
     *                                   requested scope
     */
    @Transactional(readOnly = true)
    public void verify(UUID diffId, UUID projectId, UUID architectureId) {
        if (diffId == null) {
            throw new ResourceNotFoundException(
                "API behaviour diff not found: diffId is null");
        }
        if (projectId == null) {
            throw new ResourceNotFoundException(
                "API behaviour diff " + diffId + " not found: projectId is null");
        }
        ApiBehaviourDiffEntity diff = diffRepository.findById(diffId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour diff not found: " + diffId));
        if (!projectId.equals(diff.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour diff " + diffId + " does not belong to project " + projectId
                    + " (actual project=" + diff.getProjectId() + ")");
        }
        if (architectureId != null
                && !architectureId.equals(diff.getArchitectureId())) {
            throw new ResourceNotFoundException(
                "API behaviour diff " + diffId + " is not bound to architecture "
                    + architectureId + " (actual architecture="
                    + diff.getArchitectureId() + ")");
        }
    }

    /** Convenience overload for the common case where architecture is not in the URL. */
    @Transactional(readOnly = true)
    public void verify(UUID diffId, UUID projectId) {
        verify(diffId, projectId, null);
    }

    /**
     * Resolve the diff entity in one round-trip (and assert scope). Useful
     * when the caller needs the architecture-id off the diff for
     * downstream service calls without a second DB hit.
     */
    @Transactional(readOnly = true)
    public ApiBehaviourDiffEntity verifyAndLoad(UUID diffId, UUID projectId) {
        if (diffId == null) {
            throw new ResourceNotFoundException(
                "API behaviour diff not found: diffId is null");
        }
        if (projectId == null) {
            throw new ResourceNotFoundException(
                "API behaviour diff " + diffId + " not found: projectId is null");
        }
        ApiBehaviourDiffEntity diff = diffRepository.findById(diffId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour diff not found: " + diffId));
        if (!projectId.equals(diff.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour diff " + diffId + " does not belong to project " + projectId
                    + " (actual project=" + diff.getProjectId() + ")");
        }
        return diff;
    }
}
