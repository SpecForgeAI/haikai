package com.example.architecturemodel.service.import_.terraform;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Relationship inference pass.
 *
 * <p>Walks the candidate set and emits {@link InferredRelationship}s ONLY
 * when there is direct Terraform evidence for the relationship. Three
 * relationship kinds are inferred (locked from the spec):
 *
 * <ul>
 *   <li><b>Resource hosted in Subnet</b> — from {@code subnet_id} /
 *       {@code network} / {@code private_network} / {@code network_interface}
 *       / {@code vpc_connector} / {@code subnetwork_ref} references on a
 *       compute or data-store candidate that resolve to a parsed
 *       {@code google_compute_subnetwork} or {@code google_compute_network}
 *       candidate.</li>
 *   <li><b>Deployment Unit runs on Compute</b> — from {@code image} /
 *       {@code source} fields on a {@code DeploymentUnit} candidate (or
 *       inferred via the parent's {@code parent_compute_resource_address}
 *       link emitted by the importer).</li>
 *   <li><b>Load Balancer routes to Compute / Resource</b> — from the
 *       composite-LB success path's {@code composite_component_addresses} +
 *       NEG / backend-service references back into the candidate set.</li>
 * </ul>
 *
 * <p>The composite-LB FALLBACK path emits NO relationships — only warnings.
 *
 * <p>Pure deterministic logic: no LLM, no I/O. Each emission carries the
 * source candidate id, the target candidate id, the relationship type label,
 * and the source-HCL evidence snippet for transparency.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 4.6
 */
@Component
public class RelationshipInferrer {

    /** Relationship type labels surfaced on the candidate review payload. */
    public static final String REL_RESOURCE_HOSTED_IN_SUBNET = "ResourceHostedInSubnet";
    public static final String REL_DEPLOYMENT_UNIT_RUNS_ON_COMPUTE = "DeploymentUnitRunsOnCompute";
    public static final String REL_LOAD_BALANCER_ROUTES_TO = "LoadBalancerRoutesTo";

    /** Compute / data-store fields that may reference a subnet or network. */
    private static final List<String> SUBNET_REF_FIELDS = List.of(
        "subnet_id",
        "subnetwork",
        "subnetwork_ref",
        "network",
        "network_ref",
        "private_network",
        "vpc_connector"
    );

    public List<InferredRelationship> infer(List<ImportedCandidate> candidates, TerraformImportContext ctx) {
        List<InferredRelationship> out = new ArrayList<>();
        if (candidates == null || candidates.isEmpty()) return out;

        // Pre-build address -> candidate index for fast lookups by iac_address.
        Map<String, ImportedCandidate> byAddress = new LinkedHashMap<>();
        for (ImportedCandidate c : candidates) {
            if (c == null || c.proposedBinding() == null) continue;
            String addr = c.proposedBinding().iacAddress();
            if (addr != null && !addr.isBlank()) {
                byAddress.put(addr, c);
            }
        }

        // 1) Resource hosted in Subnet -- from compute / data-store candidates'
        //    subnet/network reference fields back into a parsed Subnet/Network
        //    candidate.
        for (ImportedCandidate c : candidates) {
            if (c == null) continue;
            String type = c.targetEntityType();
            if (!ImportedCandidate.TYPE_COMPUTE_RESOURCE.equals(type)
                && !ImportedCandidate.TYPE_DATA_STORE_INSTANCE.equals(type)) {
                continue;
            }
            for (String refField : SUBNET_REF_FIELDS) {
                Object refVal = c.proposedEntityFields().get(refField);
                if (refVal == null) continue;
                String targetAddr = extractRefAddress(refVal.toString());
                if (targetAddr == null) continue;
                ImportedCandidate target = findSubnetOrNetwork(byAddress, targetAddr);
                if (target == null) continue;
                out.add(new InferredRelationship(
                    REL_RESOURCE_HOSTED_IN_SUBNET,
                    c.candidateId(),
                    target.candidateId(),
                    refField + "=" + refVal,
                    c.evidence() == null ? null : c.evidence().rawSnippet()
                ));
            }
        }

        // 2) Deployment Unit runs on Compute -- DU candidates carry a
        //    parent_compute_resource_address attribute set by the importer
        //    when the image / source field unambiguously links to a parent CR.
        for (ImportedCandidate c : candidates) {
            if (c == null) continue;
            if (!ImportedCandidate.TYPE_DEPLOYMENT_UNIT.equals(c.targetEntityType())) {
                continue;
            }
            Object parentAddr = c.proposedEntityFields().get("parent_compute_resource_address");
            if (parentAddr == null) continue;
            ImportedCandidate parent = byAddress.get(parentAddr.toString());
            if (parent == null) continue;
            if (!ImportedCandidate.TYPE_COMPUTE_RESOURCE.equals(parent.targetEntityType())) continue;
            out.add(new InferredRelationship(
                REL_DEPLOYMENT_UNIT_RUNS_ON_COMPUTE,
                c.candidateId(),
                parent.candidateId(),
                "parent_compute_resource_address=" + parentAddr,
                c.evidence() == null ? null : c.evidence().rawSnippet()
            ));
        }

        // 3) Load Balancer routes to Compute / Resource -- composite-LB
        //    success only. The grouped LoadBalancer candidate carries
        //    "composite_component_addresses" and the backend service /
        //    NEG components in the candidate set carry resource refs that
        //    point at compute / infra-resource candidates.
        for (ImportedCandidate c : candidates) {
            if (c == null) continue;
            if (!ImportedCandidate.TYPE_LOAD_BALANCER.equals(c.targetEntityType())) continue;
            Object composite = c.proposedEntityFields().get("composite_component_addresses");
            if (!(composite instanceof List<?> list) || list.isEmpty()) continue;
            // The LB's evidence snippet provides the rough HCL; we use the
            // whole LB candidate as the source for any inferred routes.
            for (Object addrObj : list) {
                if (addrObj == null) continue;
                ImportedCandidate component = byAddress.get(addrObj.toString());
                if (component == null) continue;
                // Walk the component's fields looking for refs to compute or
                // infra-resource candidates.
                for (Map.Entry<String, Object> e : component.proposedEntityFields().entrySet()) {
                    Object val = e.getValue();
                    if (val == null) continue;
                    String refAddr = extractRefAddress(val.toString());
                    if (refAddr == null) continue;
                    ImportedCandidate target = byAddress.get(refAddr);
                    if (target == null) continue;
                    if (!ImportedCandidate.TYPE_COMPUTE_RESOURCE.equals(target.targetEntityType())
                        && !ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE.equals(target.targetEntityType())) {
                        continue;
                    }
                    out.add(new InferredRelationship(
                        REL_LOAD_BALANCER_ROUTES_TO,
                        c.candidateId(),
                        target.candidateId(),
                        e.getKey() + "=" + val + " (via " + addrObj + ")",
                        c.evidence() == null ? null : c.evidence().rawSnippet()
                    ));
                }
            }
        }

        return out;
    }

    /**
     * Parse a Terraform reference expression like
     * {@code google_compute_subnetwork.app.self_link} or
     * {@code google_compute_subnetwork.app.id} into its iac_address
     * ({@code google_compute_subnetwork.app}). Returns {@code null} when the
     * input is not a recognisable resource reference.
     */
    static String extractRefAddress(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String s = raw.trim();
        // Strip surrounding quotes if the importer described the value as a
        // JSON-quoted string.
        if (s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2) {
            s = s.substring(1, s.length() - 1);
        }
        // var.* / local.* / module.* are not infrastructure refs.
        if (s.startsWith("var.") || s.startsWith("local.") || s.startsWith("module.")) {
            return null;
        }
        // Must look like <resource_type>.<name>(.<attr>)? where <resource_type>
        // starts with a lowercase letter and contains underscores -- standard
        // Terraform resource reference shape.
        String[] parts = s.split("\\.");
        if (parts.length < 2) return null;
        // First part is the resource type (e.g. google_compute_subnetwork);
        // it must contain at least one underscore for the GCP shape, but to
        // stay provider-neutral we just require it to be a bare identifier.
        if (parts[0].isBlank() || parts[1].isBlank()) return null;
        if (!isIdent(parts[0]) || !isIdent(parts[1])) return null;
        return parts[0] + "." + parts[1];
    }

    private static boolean isIdent(String s) {
        if (s == null || s.isEmpty()) return false;
        char c0 = s.charAt(0);
        if (!(Character.isLetter(c0) || c0 == '_')) return false;
        for (int i = 1; i < s.length(); i++) {
            char c = s.charAt(i);
            if (!(Character.isLetterOrDigit(c) || c == '_' || c == '-')) return false;
        }
        return true;
    }

    private static ImportedCandidate findSubnetOrNetwork(Map<String, ImportedCandidate> byAddress, String addr) {
        ImportedCandidate target = byAddress.get(addr);
        if (target == null) return null;
        String t = target.targetEntityType();
        if (ImportedCandidate.TYPE_SUBNET.equals(t) || ImportedCandidate.TYPE_NETWORK.equals(t)) {
            return target;
        }
        return null;
    }

    /**
     * A single inferred relationship surfaced on the candidate review payload.
     * Carries source / target candidate ids (UUID strings auto-generated by
     * {@link ImportedCandidate#of(String, Map, ImportedCandidate.ProposedBinding,
     * java.math.BigDecimal, List, ImportedCandidate.Evidence)}), the
     * relationship type label, and the source HCL evidence snippet.
     */
    public record InferredRelationship(

        @JsonProperty("relationship_type")
        String relationshipType,

        @JsonProperty("source_candidate_id")
        String sourceCandidateId,

        @JsonProperty("target_candidate_id")
        String targetCandidateId,

        @JsonProperty("evidence_expression")
        String evidenceExpression,

        @JsonProperty("evidence_snippet")
        String evidenceSnippet
    ) {}
}
