package com.example.architecturemodel.repository.discovery;

import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA repository for {@link DiscoveryCapabilityEntity} (Liquibase
 * changeset 184).
 *
 * <p>Provides the scoped finders the capability service / controller need:</p>
 * <ul>
 *   <li>{@link #findByRunIdOrderByCreatedAtAsc(UUID)} -- read a run's
 *       capabilities (oldest-first) for the synthesis read + the findings
 *       Capabilities section.</li>
 *   <li>{@link #findByProjectIdAndArchitectureIdOrderByCreatedAtAsc(UUID, UUID)}
 *       -- read all capabilities for a project + architecture (no run filter).</li>
 * </ul>
 *
 * <p>Mirrors the {@code DiscoveryFindingRepository} /
 * {@code MigrationReconciliationBreakRepository} structural pattern (CRUD via
 * {@link JpaRepository} plus focused derived finders on the indexed read keys).</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 */
@Repository
public interface DiscoveryCapabilityRepository
    extends JpaRepository<DiscoveryCapabilityEntity, UUID> {

    /**
     * All capabilities for a discovery run, oldest-first (creation order).
     *
     * @param runId the synthesising run UUID
     * @return the run's capabilities, oldest first
     */
    List<DiscoveryCapabilityEntity> findByRunIdOrderByCreatedAtAsc(UUID runId);

    /**
     * All capabilities for a project + architecture, oldest-first (no run filter).
     *
     * @param projectId      the owning project UUID
     * @param architectureId the owning architecture UUID
     * @return the project+architecture capabilities, oldest first
     */
    List<DiscoveryCapabilityEntity> findByProjectIdAndArchitectureIdOrderByCreatedAtAsc(
        UUID projectId, UUID architectureId);
}
