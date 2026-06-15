package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Single source of truth for the discovery&harr;harness inventory
 * reconciliation: the protocol-aware identity key and the both-directions
 * endpoint &harr; operation comparison.
 *
 * <p>Extracted VERBATIM from {@code MigrationDiscoveryContextService}
 * (Spec: Model-Seeded Capture Inventory, 2026-06-11 -- Task Group 1) so the
 * readiness coverage gate C and the new capture-session inventory
 * reconciliation endpoint share ONE implementation. Identity keys are
 * byte-identical to the pre-extraction behaviour:</p>
 *
 * <ul>
 *   <li>REST endpoint / harness operation &rarr; {@code <METHOD> <path>}
 *       (method trimmed + upper-cased, path trimmed).</li>
 *   <li>SOAP endpoint &rarr; {@code soap::<soap_action|request_root_element>}
 *       read from {@code protocol_metadata_json}, falling back to
 *       {@code soap::<endpoint id>} when no discriminator exists (so a SOAP
 *       op is never silently collapsed into a sibling).</li>
 *   <li>Harness-captured operations carry no SOAP-action concept, so they
 *       key on {@code <METHOD> <path>}; a SOAP op discovered in the model
 *       but only ever captured by the harness therefore shows up as
 *       endpoint-without-operation (and vice versa). Model-SYNTHESISED
 *       rows carrying an {@code x-amvs-soap} block on their
 *       {@code oas_operation_json} are the exception: they key on the same
 *       {@code soap::<soap_action|request_root_element>} discriminator as
 *       their source endpoint, so include/exclude accounting rows
 *       round-trip to ACCOUNTED (see {@code operationKey}).</li>
 * </ul>
 *
 * <p><b>NO TypeScript reimplementation of this key or comparison exists
 * anywhere</b> -- the validation service and frontend consume the AMS
 * reconciliation endpoint's payload verbatim. Any future change to the
 * identity key happens HERE and nowhere else.</p>
 */
public final class InventoryReconciliationCalculator {

    private InventoryReconciliationCalculator() {
        // static calculator -- no instances
    }

    /**
     * Detailed both-directions reconciliation result.
     *
     * <p>Carries FULL refs in both directions (not just the two integers the
     * readiness gate's {@code InventoryReconciliation} record reports) plus
     * the distinct unmatched key sets the gate derives its existing counts
     * from -- key-set sizes are byte-identical to the pre-extraction
     * counting (which counted distinct KEYS, not rows).</p>
     *
     * @param endpointsWithoutOperation  model endpoints whose reconciliation
     *        key matches NO harness operation (full entity refs, input order)
     * @param operationsWithoutEndpoint  harness operations whose key matches
     *        NO model endpoint (full entity refs, input order)
     * @param unmatchedEndpointKeys      distinct unmatched endpoint keys
     *        (insertion order; size == the gate's discoveredNotCaptured)
     * @param unmatchedOperationKeys     distinct unmatched operation keys
     *        (insertion order; size == the gate's capturedNotDiscovered)
     * @param matchedEndpointCount       endpoints whose key matched at least
     *        one operation
     * @param matchedOperationCount      operations whose key matched at least
     *        one endpoint
     */
    public record Result(
        List<EndpointEntity> endpointsWithoutOperation,
        List<ApiBehaviourOperationEntity> operationsWithoutEndpoint,
        Set<String> unmatchedEndpointKeys,
        Set<String> unmatchedOperationKeys,
        int matchedEndpointCount,
        int matchedOperationCount
    ) {
        public static Result empty() {
            return new Result(List.of(), List.of(),
                new LinkedHashSet<>(), new LinkedHashSet<>(), 0, 0);
        }
    }

    /**
     * Compare a model endpoint inventory against a harness operation set in
     * both directions with the protocol-aware reconciliation key. Null
     * inputs are treated as empty (mirrors the pre-extraction null
     * tolerance).
     */
    public static Result reconcile(
            List<EndpointEntity> endpoints,
            List<ApiBehaviourOperationEntity> harnessOperations) {
        Set<String> discoveredKeys = new LinkedHashSet<>();
        if (endpoints != null) {
            for (EndpointEntity ep : endpoints) {
                discoveredKeys.add(endpointKey(ep));
            }
        }
        Set<String> harnessKeys = new LinkedHashSet<>();
        if (harnessOperations != null) {
            for (ApiBehaviourOperationEntity op : harnessOperations) {
                harnessKeys.add(operationKey(op));
            }
        }

        List<EndpointEntity> endpointsWithoutOperation = new ArrayList<>();
        Set<String> unmatchedEndpointKeys = new LinkedHashSet<>();
        int matchedEndpointCount = 0;
        if (endpoints != null) {
            for (EndpointEntity ep : endpoints) {
                String key = endpointKey(ep);
                if (harnessKeys.contains(key)) {
                    matchedEndpointCount++;
                } else {
                    endpointsWithoutOperation.add(ep);
                    unmatchedEndpointKeys.add(key);
                }
            }
        }

        List<ApiBehaviourOperationEntity> operationsWithoutEndpoint = new ArrayList<>();
        Set<String> unmatchedOperationKeys = new LinkedHashSet<>();
        int matchedOperationCount = 0;
        if (harnessOperations != null) {
            for (ApiBehaviourOperationEntity op : harnessOperations) {
                String key = operationKey(op);
                if (discoveredKeys.contains(key)) {
                    matchedOperationCount++;
                } else {
                    operationsWithoutEndpoint.add(op);
                    unmatchedOperationKeys.add(key);
                }
            }
        }

        return new Result(
            endpointsWithoutOperation,
            operationsWithoutEndpoint,
            unmatchedEndpointKeys,
            unmatchedOperationKeys,
            matchedEndpointCount,
            matchedOperationCount);
    }

    /**
     * Reconciliation key for an operation row. Harness-captured operations
     * carry no SOAP-action concept and key on {@code <METHOD> <path>} --
     * byte-identical to the pre-extraction behaviour.
     *
     * <p>Model-SYNTHESISED SOAP rows are the one exception (Model-Seeded
     * Capture Inventory spec, 2026-06-11 -- Task Group 5 gap fix): the
     * validation service's include/exclude accounting action and the
     * parse-oas SOAP pre-population path stamp the endpoint's SOAP metadata
     * onto the row's {@code oas_operation_json} under {@code x-amvs-soap}.
     * Those rows key on {@code soap::<soap_action|request_root_element>} --
     * the SAME discriminator chain as {@link #endpointKey(EndpointEntity)}
     * -- so an included (or excluded-with-reason) SOAP endpoint reconciles
     * as ACCOUNTED on the next run instead of staying permanently
     * unaccounted (and spuriously re-emitted as an
     * operation-without-model-endpoint finding). Rows without an
     * {@code x-amvs-soap} block -- every genuinely harness-captured
     * operation -- are keyed exactly as before, so the readiness gate's
     * behaviour for real harness inventories is unchanged.</p>
     */
    public static String operationKey(ApiBehaviourOperationEntity op) {
        String soapKey = operationSoapDiscriminator(op);
        if (soapKey != null) {
            return "soap::" + soapKey;
        }
        String method = op.getMethod() == null ? "" : op.getMethod().trim().toUpperCase();
        String path = op.getPath() == null ? "" : op.getPath().trim();
        return method + " " + path;
    }

    /**
     * Read the SOAP discriminator off a model-synthesised operation row's
     * {@code oas_operation_json['x-amvs-soap']} block: {@code soap_action}
     * preferred, {@code request_root_element} fallback -- mirroring
     * {@link #soapDiscriminator(EndpointEntity)} exactly. Returns null for
     * harness-captured rows (no block) and for malformed blocks.
     */
    private static String operationSoapDiscriminator(ApiBehaviourOperationEntity op) {
        Map<String, Object> oas = op.getOasOperationJson();
        if (oas == null) {
            return null;
        }
        Object block = oas.get("x-amvs-soap");
        if (!(block instanceof Map)) {
            return null;
        }
        Map<?, ?> soap = (Map<?, ?>) block;
        Object action = soap.get("soap_action");
        if (action != null && !action.toString().isBlank()) {
            return action.toString().trim();
        }
        Object root = soap.get("request_root_element");
        if (root != null && !root.toString().isBlank()) {
            return root.toString().trim();
        }
        return null;
    }

    /**
     * Protocol-aware reconciliation key for a model endpoint. SOAP keys on
     * {@code soap_action} (or {@code request_root_element} as a fallback) so
     * sibling SOAP operations on the same servlet path stay distinct; REST
     * keys on {@code <operationVerb> <path_or_address>} to line up with the
     * harness {@code {method, path}} key.
     */
    public static String endpointKey(EndpointEntity ep) {
        if (isSoapEndpoint(ep)) {
            String soapKey = soapDiscriminator(ep);
            if (soapKey != null) {
                return "soap::" + soapKey;
            }
            // No SOAP discriminator at all -- fall back to the endpoint id so the
            // op is never silently collapsed into a sibling.
            return "soap::" + (ep.getId() == null ? "" : ep.getId());
        }
        String method = ep.getOperationVerb() == null ? "" : ep.getOperationVerb().trim().toUpperCase();
        String path = ep.getPathOrAddress() == null ? "" : ep.getPathOrAddress().trim();
        return method + " " + path;
    }

    /** Read {@code soap_action} (preferred) or {@code request_root_element} from the SOAP metadata. */
    public static String soapDiscriminator(EndpointEntity ep) {
        Map<String, Object> meta = ep.getProtocolMetadataJson();
        if (meta == null) {
            return null;
        }
        Object action = meta.get("soap_action");
        if (action != null && !action.toString().isBlank()) {
            return action.toString().trim();
        }
        Object root = meta.get("request_root_element");
        if (root != null && !root.toString().isBlank()) {
            return root.toString().trim();
        }
        return null;
    }

    /** Detect SOAP via {@code protocol} / {@code endpoint_type} (case-insensitive). */
    public static boolean isSoapEndpoint(EndpointEntity ep) {
        String protocol = ep.getProtocol();
        if (protocol != null && protocol.trim().equalsIgnoreCase("SOAP")) {
            return true;
        }
        String type = ep.getEndpointType();
        return type != null && type.toLowerCase().contains("soap");
    }
}
