/**
 * Terraform <strong>import</strong> service package.
 *
 * <p>Sibling to {@code service.export.terraform}; the directory + package
 * segment is named {@code import_} (trailing underscore) because
 * {@code import} is a reserved keyword in Java and may not be used as a
 * package identifier. This follows the existing repo precedent already set
 * by {@code model.dto.interface_discovery} for the {@code interface}
 * keyword.
 *
 * <p>V1 hosts a provider-neutral strategy interface ({@link
 * com.example.architecturemodel.service.import_.terraform.TerraformImporter})
 * with a single concrete implementation registered for GCP. The package
 * also owns the transient candidate review payload records
 * ({@link com.example.architecturemodel.service.import_.terraform.ImportedCandidate},
 * {@link com.example.architecturemodel.service.import_.terraform.ImportReviewResult})
 * and the value-class context carrier
 * ({@link com.example.architecturemodel.service.import_.terraform.TerraformImportContext}).
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp
 */
package com.example.architecturemodel.service.import_.terraform;
