package com.example.architecturemodel.service.export.terraform;

import java.util.List;

/**
 * Record carrying a single Terraform fragment emitted by a {@link TerraformExporter}.
 *
 * <p>The {@code targetFile} indicates which output file the fragment is destined
 * for (one of {@code main.tf}, {@code variables.tf}, {@code outputs.tf},
 * {@code README.md}). The {@code hclFragment} is the raw HCL block content.
 * {@code comments} are block-header / leading comment lines to prepend.
 * {@code warnings} surface up to the assembler for inclusion in
 * {@code warnings.json}.
 *
 * <p>{@code comments} and {@code warnings} are normalised to empty lists when
 * {@code null} is supplied so callers never need null-checks downstream.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp
 */
public record EmittedResource(
    String targetFile,
    String hclFragment,
    List<String> comments,
    List<String> warnings
) {
    public EmittedResource {
        comments = comments == null ? List.of() : List.copyOf(comments);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }
}
