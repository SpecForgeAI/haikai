package com.example.architecturemodel.service.import_.terraform;

import java.util.List;

/**
 * Strategy interface for per-provider Terraform import.
 *
 * <p>Each implementation classifies parsed HCL blocks (delivered via the
 * {@link TerraformImportContext}) into a list of {@link ImportedCandidate}
 * records describing the proposed Infrastructure entity, the proposed
 * {@code IaCResourceBinding} shape, the source {@code file:line} evidence,
 * and a confidence bucket. The candidate set is transient -- no database
 * mutation occurs in the importer; the candidate review UI is responsible
 * for staging the user's approval, which is then applied through the
 * existing model-save flow.
 *
 * <p>V1 only registers {@code GcpTerraformImporter}
 * (providerId {@code "GCP"}). Future providers (AWS, Azure, etc.) implement
 * this same interface; Spring injects {@code List<TerraformImporter>} into
 * the import service which resolves by {@link #providerId()}.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp
 */
public interface TerraformImporter {

    /** Provider identifier used as the Spring bean lookup key (e.g. {@code "GCP"}). */
    String providerId();

    /**
     * Classify the parsed HCL files supplied on the {@code ctx} into a list
     * of {@link ImportedCandidate} records.
     *
     * <p>Implementations MUST NOT throw on unsupported resource types,
     * unresolved variable references, partial composite groupings, or
     * malformed HCL fragments; instead, they record TODO entries on the
     * candidate's {@code perCandidateWarnings} and on the context's mutable
     * {@code warnings} collector. Hard failures are reserved for invalid
     * inputs already caught at the controller boundary.
     */
    List<ImportedCandidate> importResources(TerraformImportContext ctx);
}
