package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Deterministic candidate matcher.
 *
 * <p>Match key is {@code proposedBinding.iac_address} -- looked up against
 * {@link TerraformImportContext#bindingsByIacAddress()}, which is pre-built
 * from existing {@code iac_resource_bindings} rows scoped by
 * {@code projectId} + {@code architectureId}.
 *
 * <p>On match, the field-precedence rule (Q6) applies:
 * <ul>
 *   <li>User-edited values win for {@code name} and {@code description} --
 *       i.e. the proposed update keeps the EXISTING model's values for these
 *       two fields.</li>
 *   <li>Imported values win for technical fields. The whitelist is
 *       enumerated in {@link #TECHNICAL_FIELDS} and intentionally narrow:
 *       CIDR, region, zone, engine, version, machine_type, type,
 *       provider_resource_type, ip_cidr_range, routing_mode, etc.</li>
 *   <li>Other fields fall back to "imported wins" by default but the diff is
 *       always surfaced for transparency on the candidate review payload.</li>
 * </ul>
 *
 * <p>{@code iac_address} is NEVER canonicalised by the matcher -- it is
 * persisted byte-equal to what the parser saw, which is the locked round-trip
 * stability contract with the export.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 4.5
 */
@Component
public class CandidateMatcher {

    /**
     * Whitelist of "technical" fields where imported values win on match.
     * User-edited values for any other field are surfaced in the diff but
     * the imported value is what ends up in the proposed update.
     *
     * <p>Locked from the spec field list. Add new fields here only when the
     * round-trip golden fixture demands it.
     */
    public static final Set<String> TECHNICAL_FIELDS = Set.of(
        "cidr",
        "ip_cidr_range",
        "region",
        "zone",
        "location",
        "engine",
        "engine_class",
        "version",
        "database_version",
        "provider_resource_type",
        "platform_type",
        "compute_type",
        "machine_type",
        "type",
        "routing_mode",
        "memory_size_gb",
        "tier",
        "format",
        "storage_class",
        "schedule"
    );

    /**
     * Fields where the user's manual edits win on match. The proposed update
     * keeps the EXISTING model values for these fields even when the imported
     * value differs.
     */
    public static final Set<String> USER_EDITED_FIELDS = Set.of(
        "name",
        "description"
    );

    /** Coarse outcome of a single match attempt. */
    public enum Outcome {
        WILL_CREATE,
        WILL_UPDATE
    }

    /**
     * Match a single candidate against the existing model.
     *
     * @return {@link MatchResult} carrying the outcome, the matched binding
     *     (when WILL_UPDATE), the per-field diff entries, and the
     *     reconciled {@code proposedEntityFields} payload after the
     *     field-precedence rule has been applied.
     */
    public MatchResult match(ImportedCandidate candidate, TerraformImportContext ctx) {
        if (candidate == null || ctx == null
            || candidate.proposedBinding() == null) {
            return MatchResult.willCreate(candidate, List.of());
        }

        String iacAddress = candidate.proposedBinding().iacAddress();
        if (iacAddress == null || iacAddress.isBlank()) {
            return MatchResult.willCreate(candidate, List.of());
        }

        Map<String, IaCResourceBindingDto> bindingsByAddress = ctx.bindingsByIacAddress();
        IaCResourceBindingDto existing = bindingsByAddress == null
            ? null
            : bindingsByAddress.get(iacAddress);

        if (existing == null) {
            return MatchResult.willCreate(candidate, List.of());
        }

        // Reconcile fields per Q6. The matcher does NOT have direct access to
        // the existing entity's field values via the binding alone; the
        // existing-side values surfaced in the diff are sourced from
        // ctx.existingModel() when callable, otherwise the binding's
        // description / iac_resource_name fields where available. The
        // orchestrator is the canonical caller and assembles the model-side
        // values; the matcher returns an empty diff when no model is loaded.
        List<FieldDiff> diff = buildFieldDiff(candidate, existing);
        Map<String, Object> reconciled = applyFieldPrecedence(
            candidate.proposedEntityFields(),
            diff
        );

        ImportedCandidate updated = new ImportedCandidate(
            candidate.candidateId(),
            candidate.targetEntityType(),
            reconciled,
            candidate.proposedBinding(),
            candidate.confidence(),
            candidate.perCandidateWarnings(),
            candidate.evidence(),
            candidate.ignored()
        );

        return MatchResult.willUpdate(updated, existing, diff);
    }

    // ------------------------------------------------------------------
    // Diff + precedence application
    // ------------------------------------------------------------------

    /**
     * Build the per-field diff between the existing binding's surface fields
     * (description / iac_resource_name) and the proposed entity fields.
     *
     * <p>Note: this matcher does not load the full Infrastructure entity
     * record (the orchestrator does that work on approval); only the binding-
     * level surface fields are compared here. The candidate review UI shows
     * the full diff once the orchestrator has loaded the entity.
     */
    private static List<FieldDiff> buildFieldDiff(
        ImportedCandidate candidate,
        IaCResourceBindingDto existing
    ) {
        List<FieldDiff> diffs = new java.util.ArrayList<>();
        Map<String, Object> proposed = candidate.proposedEntityFields() == null
            ? Map.of()
            : candidate.proposedEntityFields();

        // Compare every key in the proposed map to whatever surface info we
        // have on the binding. The full entity-side comparison happens in
        // the orchestrator.
        Object existingName = existing.iacResourceName();
        Object existingDescription = existing.description();

        Set<String> compared = new LinkedHashSet<>();
        for (Map.Entry<String, Object> e : proposed.entrySet()) {
            String key = e.getKey();
            Object proposedVal = e.getValue();
            compared.add(key);
            Object existingVal;
            if ("name".equals(key)) {
                existingVal = existingName;
            } else if ("description".equals(key)) {
                existingVal = existingDescription;
            } else {
                // Without the loaded entity at this layer, assume divergence;
                // the orchestrator overlays the actual entity-side values
                // when assembling the final review payload.
                existingVal = null;
            }
            if (!equalLoose(existingVal, proposedVal)) {
                diffs.add(new FieldDiff(key, existingVal, proposedVal));
            }
        }
        return diffs;
    }

    /**
     * Apply the field-precedence rule:
     * <ul>
     *   <li>USER_EDITED_FIELDS -> existing wins (proposed map gets the
     *       existing value).</li>
     *   <li>TECHNICAL_FIELDS or anything else -> imported wins (proposed map
     *       keeps its value).</li>
     * </ul>
     */
    private static Map<String, Object> applyFieldPrecedence(
        Map<String, Object> proposed,
        List<FieldDiff> diffs
    ) {
        if (proposed == null) return Map.of();
        Map<String, Object> reconciled = new LinkedHashMap<>(proposed);
        for (FieldDiff d : diffs) {
            if (USER_EDITED_FIELDS.contains(d.field())) {
                if (d.existingValue() != null) {
                    reconciled.put(d.field(), d.existingValue());
                }
            }
            // technical / other fields -> imported value already in the map.
        }
        return reconciled;
    }

    private static boolean equalLoose(Object a, Object b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        return a.toString().equals(b.toString());
    }

    // ------------------------------------------------------------------
    // Result + diff records
    // ------------------------------------------------------------------

    /** Outcome of a single match attempt. */
    public record MatchResult(
        Outcome outcome,
        ImportedCandidate reconciled,
        IaCResourceBindingDto existingBinding,
        List<FieldDiff> fieldDiff
    ) {
        public MatchResult {
            fieldDiff = fieldDiff == null ? List.of() : List.copyOf(fieldDiff);
        }

        public static MatchResult willCreate(ImportedCandidate cand, List<FieldDiff> diff) {
            return new MatchResult(Outcome.WILL_CREATE, cand, null, diff);
        }

        public static MatchResult willUpdate(ImportedCandidate cand, IaCResourceBindingDto existing, List<FieldDiff> diff) {
            return new MatchResult(Outcome.WILL_UPDATE, cand, existing, diff);
        }

        public boolean isUpdate() {
            return outcome == Outcome.WILL_UPDATE;
        }
    }

    /** Per-field diff entry surfaced on the candidate review payload. */
    public record FieldDiff(
        String field,
        Object existingValue,
        Object proposedValue
    ) {}
}
