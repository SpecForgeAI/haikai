package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.EndpointBaselineCoverageDto;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineItemRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourOperationRepository;
import com.example.architecturemodel.repository.entity.EndpointRepository;
import com.example.architecturemodel.service.migration.InventoryReconciliationCalculator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Computes the canonical endpoint→baseline coverage map for an architecture:
 * which architecture API endpoint elements are covered by an ACTIVE API
 * Behaviour Baseline, and which baseline covers each.
 *
 * <p><b>Why this exists.</b> The gateway's phase-2 Migration Delivery Plan
 * expansion used to resolve an endpoint's baseline by substring-matching the
 * endpoint NAME against the baseline's free-text NAME — which never matches a
 * descriptively-named baseline ("HiFi API Baseline v1"), so EVERY endpoint
 * showed "missing baseline" despite full capture coverage. This service does
 * the join properly and server-side, where the canonical reconciliation key
 * lives.</p>
 *
 * <p><b>How it joins.</b> For each ACTIVE baseline, every baseline item carries
 * an {@code operation_id} pointing at its {@code api_behaviour_operations} row
 * (whose {@code path} is the TEMPLATED OAS path, e.g. {@code /views/{viewId}}).
 * We key those operations with
 * {@link InventoryReconciliationCalculator#operationKey} — the SAME
 * protocol-aware key the readiness gate uses — and match them against each
 * endpoint element keyed with
 * {@link InventoryReconciliationCalculator#endpointKey}. There is NO
 * TypeScript reimplementation of this key anywhere; the gateway consumes this
 * endpoint's output verbatim.</p>
 *
 * <p>Baseline items store a CONCRETE captured path in some flows (the
 * SaveAsBaseline fallback / target replay), so a raw item-{@code (method,path)}
 * join would be non-deterministic for parameterised endpoints. The
 * {@code operation_id} indirection avoids that entirely; a bare
 * {@code (method,path)} fallback is used ONLY when an item's operation row
 * cannot be resolved (e.g. it was deleted).</p>
 *
 * <p>When more than one active baseline covers the same endpoint, the NEWEST
 * active baseline wins (baselines are iterated newest-first and the first
 * write to a key sticks).</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourEndpointBaselineCoverageService {

    private final ModelFileRepository modelFileRepository;
    private final EndpointRepository endpointRepository;
    private final ApiBehaviourBaselineRepository baselineRepository;
    private final ApiBehaviourBaselineItemRepository baselineItemRepository;
    private final ApiBehaviourOperationRepository operationRepository;

    /**
     * Returns one row per architecture endpoint element that is covered by an
     * active baseline. Endpoints with no active-baseline coverage are simply
     * absent (the gateway treats absence as {@code baselineId=null} →
     * conservative bespoke path). Returns an empty list when the architecture
     * has no model file, no endpoints, or no active baselines.
     */
    @Transactional(readOnly = true)
    public List<EndpointBaselineCoverageDto> computeCoverage(UUID projectId, UUID architectureId) {
        Optional<ModelFileEntity> modelFile =
            modelFileRepository.findByProjectIdAndArchitectureId(projectId, architectureId);
        if (modelFile.isEmpty()) {
            return List.of();
        }
        List<EndpointEntity> endpoints = endpointRepository.findByModelFileId(modelFile.get().getId());
        if (endpoints.isEmpty()) {
            return List.of();
        }

        // Collision-aware keys (Spec 2026-07-24): the twin discriminator
        // participates only where the bare verb+path actually collides, and
        // template-param NAMES are normalised away — otherwise a lone
        // suffix-named endpoint (or a spec-vs-code param-name drift) could
        // never join to its baseline and would be falsely flagged
        // "missing baseline" on the migration plan.
        Set<String> collidingBare =
            InventoryReconciliationCalculator.collidingBareEndpointKeys(endpoints);

        // Build canonical-key → baselineId over ACTIVE baselines, newest first.
        Map<String, UUID> keyToBaseline = new HashMap<>();
        List<ApiBehaviourBaselineEntity> baselines =
            baselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId);
        for (ApiBehaviourBaselineEntity baseline : baselines) {
            if (baseline.getStatus() == null || !baseline.getStatus().trim().equalsIgnoreCase("active")) {
                continue;
            }
            List<ApiBehaviourBaselineItemEntity> items =
                baselineItemRepository.findByBaselineIdOrderByCreatedAtAsc(baseline.getId());
            if (items.isEmpty()) {
                continue;
            }
            Map<UUID, ApiBehaviourOperationEntity> opsById = resolveOperations(items);
            for (ApiBehaviourBaselineItemEntity item : items) {
                String key = canonicalItemKey(item, opsById, collidingBare);
                if (key != null) {
                    // Newest-first iteration → first writer (newest baseline) wins.
                    keyToBaseline.putIfAbsent(key, baseline.getId());
                }
            }
        }
        if (keyToBaseline.isEmpty()) {
            return List.of();
        }

        List<EndpointBaselineCoverageDto> coverage = new ArrayList<>();
        for (EndpointEntity endpoint : endpoints) {
            UUID baselineId = keyToBaseline.get(
                InventoryReconciliationCalculator.endpointMatchKey(endpoint, collidingBare));
            if (baselineId != null) {
                coverage.add(new EndpointBaselineCoverageDto(
                    endpoint.getId(),
                    baselineId,
                    endpoint.getOperationVerb(),
                    endpoint.getPathOrAddress()));
            }
        }
        return coverage;
    }

    /** Batch-resolve the operation rows referenced by a baseline's items. */
    private Map<UUID, ApiBehaviourOperationEntity> resolveOperations(
            List<ApiBehaviourBaselineItemEntity> items) {
        Set<UUID> operationIds = new HashSet<>();
        for (ApiBehaviourBaselineItemEntity item : items) {
            if (item.getOperationId() != null) {
                operationIds.add(item.getOperationId());
            }
        }
        Map<UUID, ApiBehaviourOperationEntity> opsById = new HashMap<>();
        if (!operationIds.isEmpty()) {
            for (ApiBehaviourOperationEntity op : operationRepository.findAllById(operationIds)) {
                opsById.put(op.getId(), op);
            }
        }
        return opsById;
    }

    /**
     * Canonical reconciliation key for a baseline item. Prefers the referenced
     * operation row (templated OAS path, protocol-aware key); falls back to the
     * item's own {@code (method, path)} ONLY when the operation cannot be
     * resolved, using the SAME normalisation as
     * {@link InventoryReconciliationCalculator}'s REST branch.
     */
    private static String canonicalItemKey(
            ApiBehaviourBaselineItemEntity item,
            Map<UUID, ApiBehaviourOperationEntity> opsById,
            Set<String> collidingBare) {
        UUID operationId = item.getOperationId();
        if (operationId != null) {
            ApiBehaviourOperationEntity op = opsById.get(operationId);
            if (op != null) {
                return InventoryReconciliationCalculator.operationMatchKey(op, collidingBare);
            }
        }
        if (item.getMethod() == null && item.getPath() == null) {
            return null;
        }
        String method = item.getMethod() == null ? "" : item.getMethod().trim().toUpperCase();
        String path = item.getPath() == null
            ? ""
            : InventoryReconciliationCalculator.normaliseTemplateParams(item.getPath().trim());
        return method + " " + path;
    }
}
