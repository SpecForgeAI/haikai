package com.example.architecturemodel.service.import_.terraform;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Record describing a single proposed Infrastructure entity classified from
 * a parsed Terraform resource block.
 *
 * <p>The record is purely transient -- it is the unit of the candidate
 * review payload returned by the importer and held in React state on the
 * frontend. No database row is created from this record directly; on
 * "Approve all" the frontend posts the proposed entity payload through the
 * existing model-save flow.
 *
 * <p>JSON shape uses snake_case via {@link JsonProperty}, mirroring the
 * sibling {@code service.export.terraform} package.
 *
 * <p><b>Per-candidate identity + ignore plumbing:</b> the V1 UI ships with
 * "Approve all" / "Discard all" only (Q11=b read-only summary). The
 * {@code candidateId} (a UUID string, generated per candidate) and
 * {@code ignored} (defaults to {@code false}) fields are nonetheless
 * carried in the payload shape so the follow-up per-row-controls UI spec
 * is purely UI work and never requires a payload-shape change.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 1.3
 */
public record ImportedCandidate(

    @JsonProperty("candidate_id")
    String candidateId,

    @JsonProperty("target_entity_type")
    String targetEntityType,

    @JsonProperty("proposed_entity_fields")
    Map<String, Object> proposedEntityFields,

    @JsonProperty("proposed_binding")
    ProposedBinding proposedBinding,

    @JsonProperty("confidence")
    BigDecimal confidence,

    @JsonProperty("per_candidate_warnings")
    List<String> perCandidateWarnings,

    @JsonProperty("evidence")
    Evidence evidence,

    @JsonProperty("ignored")
    boolean ignored

) {

    /** HIGH confidence bucket: resource type known + zero unresolved refs + env/region known. */
    public static final BigDecimal CONFIDENCE_HIGH = new BigDecimal("0.900");

    /** MEDIUM confidence bucket: resource type known but unresolved refs or env/region. */
    public static final BigDecimal CONFIDENCE_MEDIUM = new BigDecimal("0.600");

    /** LOW confidence bucket: resource type unknown or partial composite mapping. */
    public static final BigDecimal CONFIDENCE_LOW = new BigDecimal("0.300");

    /** Discriminator constants for {@link #targetEntityType}. */
    public static final String TYPE_NETWORK = "Network";
    public static final String TYPE_SUBNET = "Subnet";
    public static final String TYPE_COMPUTE_CLUSTER = "ComputeCluster";
    public static final String TYPE_COMPUTE_RESOURCE = "ComputeResource";
    public static final String TYPE_DEPLOYMENT_UNIT = "DeploymentUnit";
    public static final String TYPE_LOAD_BALANCER = "LoadBalancer";
    public static final String TYPE_LISTENER = "Listener";
    public static final String TYPE_DATA_STORE_INSTANCE = "DataStoreInstance";
    public static final String TYPE_INFRASTRUCTURE_RESOURCE = "InfrastructureResource";
    public static final String TYPE_CLOUD_ACCOUNT = "CloudAccount";
    public static final String TYPE_LOCATION = "Location";
    public static final String TYPE_ENVIRONMENT = "Environment";
    public static final String TYPE_UNSUPPORTED = "Unsupported";

    public ImportedCandidate {
        candidateId = candidateId == null || candidateId.isBlank()
            ? UUID.randomUUID().toString()
            : candidateId;
        proposedEntityFields = proposedEntityFields == null
            ? Map.of()
            : Map.copyOf(proposedEntityFields);
        perCandidateWarnings = perCandidateWarnings == null
            ? List.of()
            : List.copyOf(perCandidateWarnings);
    }

    /**
     * Convenience factory that auto-generates {@code candidateId} and
     * defaults {@code ignored} to {@code false}. The two flags are still
     * carried in the JSON payload (so the follow-up UI can flip
     * {@code ignored} without a shape change) but most production callers
     * never set them by hand.
     */
    public static ImportedCandidate of(
        String targetEntityType,
        Map<String, Object> proposedEntityFields,
        ProposedBinding proposedBinding,
        BigDecimal confidence,
        List<String> perCandidateWarnings,
        Evidence evidence
    ) {
        return new ImportedCandidate(
            UUID.randomUUID().toString(),
            targetEntityType,
            proposedEntityFields,
            proposedBinding,
            confidence,
            perCandidateWarnings,
            evidence,
            false
        );
    }

    /**
     * Proposed {@code IaCResourceBinding} fields for the candidate. Mirrors
     * the persisted shape from
     * {@link com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto}
     * minus server-managed fields (id, iac_source_id, infrastructure_point_id,
     * binding_status, last_seen_at, state_resource_id, tags) which are
     * filled by the model-save flow on approval.
     */
    public record ProposedBinding(
        @JsonProperty("iac_address")
        String iacAddress,

        @JsonProperty("iac_resource_type")
        String iacResourceType,

        @JsonProperty("iac_resource_name")
        String iacResourceName,

        @JsonProperty("provider")
        String provider,

        @JsonProperty("file_path")
        String filePath,

        @JsonProperty("start_line")
        Integer startLine,

        @JsonProperty("end_line")
        Integer endLine,

        @JsonProperty("external_id")
        String externalId,

        @JsonProperty("confidence")
        BigDecimal confidence
    ) {}

    /**
     * Source-evidence block surfaced to the candidate review UI. Drives
     * the inline collapsible drill-down to the raw HCL snippet.
     */
    public record Evidence(
        @JsonProperty("file_path")
        String filePath,

        @JsonProperty("start_line")
        Integer startLine,

        @JsonProperty("end_line")
        Integer endLine,

        @JsonProperty("raw_snippet")
        String rawSnippet,

        @JsonProperty("unresolved_expression_text")
        String unresolvedExpressionText
    ) {}
}
