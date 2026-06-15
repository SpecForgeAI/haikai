package com.example.architecturemodel.service;

import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.NoSuchElementException;
import java.util.UUID;

/**
 * Guard helper that verifies a discovery run is bound to the requested
 * (project, architecture) pair before child-entity operations proceed.
 *
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: Child Discovery tables (evidence, relationship, cluster,
 * candidate, decision_task, candidate_entity_mapping) intentionally do NOT
 * carry an architecture_id column. The architecture filter is applied via
 * JOIN to the parent discovery_run row -- this helper is the JOIN. Throws
 * NoSuchElementException (controllers map to 404) if:
 *   - the run does not exist, or
 *   - the run exists but its bound architecture / project does not match the
 *     URL path parameters.
 *
 * The 404-not-409 choice is deliberate: from the perspective of a client
 * looking at /architectures/A/discovery/runs/{runId}/..., a run that lives
 * under architecture B effectively does not exist. 404 keeps cross-architecture
 * runs invisible (safety property (b) and supports property (c) consistency).
 */
@Component
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryRunArchitectureGuard {

    private final DiscoveryRunRepository runRepository;

    /**
     * Verify the run exists AND is bound to the given (project, architecture).
     *
     * @param runId the discovery run UUID
     * @param projectId the project UUID from the URL path
     * @param architectureId the architecture UUID from the URL path
     * @throws NoSuchElementException if the run does not exist in the scope
     */
    @Transactional(readOnly = true)
    public void verify(UUID runId, UUID projectId, UUID architectureId) {
        DiscoveryRunEntity run = runRepository.findById(runId)
            .orElseThrow(() -> new NoSuchElementException(
                "Discovery run not found: " + runId));
        if (!projectId.equals(run.getProjectId())) {
            throw new NoSuchElementException(
                "Discovery run " + runId + " does not belong to project " + projectId
                    + " (actual project=" + run.getProjectId() + ")");
        }
        if (!architectureId.equals(run.getArchitectureId())) {
            throw new NoSuchElementException(
                "Discovery run " + runId + " is not bound to architecture " + architectureId
                    + " (actual architecture=" + run.getArchitectureId() + ")");
        }
    }
}
