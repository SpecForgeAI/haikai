package com.example.architecturemodel.model.dto.migration;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.UUID;

/**
 * Request body for {@code POST /api/projects/{projectId}/migration-discovery-context}.
 *
 * <p>All optional fields are nullable / boxed so that absent JSON fields do
 * not silently overwrite into primitive defaults (per
 * {@code project_primitive_double_dto_overwrite.md}). Where the spec defines
 * a default value, the service layer applies it when the request field is
 * {@code null} -- the DTO itself preserves the distinction between
 * "field omitted" and "field set explicitly".</p>
 *
 * <p>Spec: Migration Discovery Context Integration (2026-05-16) -- Task Group 1
 * (D1 / D7).</p>
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane (2026-05-24) --
 * Task Group 4.5 additively adds the {@link #includeTargetStateDecisions}
 * flag. Default {@code true} (per Q13) -- body field, not query param,
 * matching the existing include-flag pattern on this DTO.</p>
 *
 * @param currentArchitectureId required: the current-state architecture being analysed
 * @param targetArchitectureId  optional target-state architecture for mappings
 * @param discoveryRunIds       optional explicit run scope; when null/empty the
 *                              service resolves the latest completed runs for
 *                              the current architecture
 * @param apiBehaviourBaselineIds optional explicit baseline scope; when null/empty
 *                                the service resolves baselines for the project
 * @param includeFindings        nullable boolean; service defaults to {@code true}
 * @param includeEvidence        nullable boolean; service defaults to {@code true}
 * @param includeRuntimeEvidence nullable boolean; service defaults to {@code true}
 * @param includeDbFindings      nullable boolean; service defaults to {@code true}
 * @param includeMappings        nullable boolean; service defaults to {@code true}
 * @param maxFindings            nullable cap on prioritised findings (service default 100)
 * @param maxEvidenceItems       nullable cap on evidence highlights (service default 100)
 * @param includeTargetStateDecisions nullable boolean; service defaults to {@code true}
 *                                    when null. When explicitly {@code false}, the
 *                                    aggregation service still populates the new
 *                                    {@code targetStateDecisionsSummary} block with
 *                                    {@link com.example.architecturemodel.model.dto.targetstate.TargetStateDecisionsSummaryDto#empty()}
 *                                    so the response shape stays byte-stable for
 *                                    existing consumers.
 */
public record MigrationDiscoveryContextRequestDto(
    @JsonProperty("currentArchitectureId")
    UUID currentArchitectureId,

    @JsonProperty("targetArchitectureId")
    UUID targetArchitectureId,

    @JsonProperty("discoveryRunIds")
    List<UUID> discoveryRunIds,

    @JsonProperty("apiBehaviourBaselineIds")
    List<UUID> apiBehaviourBaselineIds,

    @JsonProperty("includeFindings")
    Boolean includeFindings,

    @JsonProperty("includeEvidence")
    Boolean includeEvidence,

    @JsonProperty("includeRuntimeEvidence")
    Boolean includeRuntimeEvidence,

    @JsonProperty("includeDbFindings")
    Boolean includeDbFindings,

    @JsonProperty("includeMappings")
    Boolean includeMappings,

    @JsonProperty("maxFindings")
    Integer maxFindings,

    @JsonProperty("maxEvidenceItems")
    Integer maxEvidenceItems,

    @JsonProperty("includeTargetStateDecisions")
    Boolean includeTargetStateDecisions
) {

    /** Service-wide default for {@code maxFindings} (count-based bound v1). */
    public static final int DEFAULT_MAX_FINDINGS = 100;

    /** Service-wide default for {@code maxEvidenceItems} (count-based bound v1). */
    public static final int DEFAULT_MAX_EVIDENCE_ITEMS = 100;

    /** Resolve {@code includeFindings} with the documented default. */
    public boolean includeFindingsOrDefault() {
        return includeFindings == null || includeFindings;
    }

    public boolean includeEvidenceOrDefault() {
        return includeEvidence == null || includeEvidence;
    }

    public boolean includeRuntimeEvidenceOrDefault() {
        return includeRuntimeEvidence == null || includeRuntimeEvidence;
    }

    public boolean includeDbFindingsOrDefault() {
        return includeDbFindings == null || includeDbFindings;
    }

    public boolean includeMappingsOrDefault() {
        return includeMappings == null || includeMappings;
    }

    public int maxFindingsOrDefault() {
        return maxFindings == null || maxFindings <= 0 ? DEFAULT_MAX_FINDINGS : maxFindings;
    }

    public int maxEvidenceItemsOrDefault() {
        return maxEvidenceItems == null || maxEvidenceItems <= 0
            ? DEFAULT_MAX_EVIDENCE_ITEMS
            : maxEvidenceItems;
    }

    /**
     * Resolve {@code includeTargetStateDecisions} with default {@code true}
     * (per Q13). When the caller omits the flag we treat it as opt-in by
     * default so existing aggregation responses naturally pick up the new
     * block; when the caller sets it explicitly to {@code false} the service
     * still populates the field with {@code TargetStateDecisionsSummaryDto.empty()}
     * rather than {@code null} to keep the response shape stable.
     */
    public boolean includeTargetStateDecisionsOrDefault() {
        return includeTargetStateDecisions == null || includeTargetStateDecisions;
    }
}
